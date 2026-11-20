import time
from datetime import timedelta

import requests
from django.db import IntegrityError, OperationalError, transaction
from django.db.models import F, Q
from django.utils import timezone

from .banking_staging import select_balance, stage_remote_transactions
from .models import BankConnection, BankSyncRun, BankTransaction

SYNC_RUN_STALE_AFTER = timedelta(minutes=10)
SYNC_RUN_GRACE_PERIOD = timedelta(seconds=30)
SYNC_WRITE_ATTEMPTS = 5
SYNC_WRITE_RETRY_DELAYS = (0.0, 0.02, 0.05, 0.1, 0.2)


@transaction.atomic
def reconcile_connection_sync_state(connection, now=None):
    if connection.sync_status != BankConnection.SyncStatus.SYNCING:
        return connection

    if not _lock_authorized_connection(connection.pk):
        connection.refresh_from_db()
        return connection
    connection.refresh_from_db()
    if connection.sync_status != BankConnection.SyncStatus.SYNCING:
        return connection

    now = now or timezone.now()
    stale_before = now - SYNC_RUN_STALE_AFTER
    running_runs = BankSyncRun.objects.filter(connection=connection, status=BankSyncRun.Status.RUNNING)
    recent_running = running_runs.filter(started_at__gte=stale_before).order_by("-started_at").first()
    if recent_running:
        return connection

    latest_run = BankSyncRun.objects.filter(connection=connection).order_by("-started_at").first()
    if latest_run and latest_run.status == BankSyncRun.Status.QUEUED:
        return connection
    if latest_run and latest_run.status == BankSyncRun.Status.COMPLETED:
        connection.sync_status = BankConnection.SyncStatus.IDLE
        connection.sync_started_at = None
        connection.save(update_fields=["sync_status", "sync_started_at"])
        return connection
    if latest_run and latest_run.status == BankSyncRun.Status.FAILED:
        connection.sync_status = BankConnection.SyncStatus.ERROR
        connection.sync_started_at = None
        connection.last_error = latest_run.error or "La sincronización ha fallado."
        connection.save(update_fields=["sync_status", "sync_started_at", "last_error"])
        return connection

    if connection.sync_started_at and connection.sync_started_at >= now - SYNC_RUN_GRACE_PERIOD:
        return connection

    message = "La sincronización tardó demasiado y se ha detenido. Vuelve a intentarlo."
    connection.sync_status = BankConnection.SyncStatus.ERROR
    connection.sync_started_at = None
    connection.last_error = message
    connection.save(update_fields=["sync_status", "sync_started_at", "last_error"])
    running_runs.update(status=BankSyncRun.Status.FAILED, error=message, finished_at=now)
    return connection


ACTIVE_SYNC_STATUSES = (BankSyncRun.Status.QUEUED, BankSyncRun.Status.RUNNING)
BANK_SYNC_UNAVAILABLE_ERROR = "La conexión bancaria ya no está autorizada. Vuelve a conectarla antes de sincronizar."
BANK_SYNC_CANCELLED_ERROR = "La conexión o sincronización dejó de estar activa."


class BankConnectionUnavailable(RuntimeError):
    pass


def _lock_authorized_connection(connection_id):
    """Serialize a sync write with disconnect before doing any related reads."""
    # The no-op UPDATE acquires SQLite's writer lock before staging starts.
    return BankConnection.objects.filter(
        pk=connection_id,
        status=BankConnection.Status.AUTHORIZED,
    ).update(sync_status=F("sync_status")) > 0


def _lock_authorized_sync_run(connection_id, run_id):
    if not _lock_authorized_connection(connection_id):
        return False
    return BankSyncRun.objects.filter(
        pk=run_id,
        connection_id=connection_id,
        status=BankSyncRun.Status.RUNNING,
    ).update(status=F("status")) > 0


def _finish_sync_failure(run, error, *, connection_updates=None):
    finished_at = timezone.now()
    with transaction.atomic():
        if connection_updates and _lock_authorized_sync_run(run.connection_id, run.pk):
            BankConnection.objects.filter(
                pk=run.connection_id,
                status=BankConnection.Status.AUTHORIZED,
            ).update(**connection_updates)
        BankSyncRun.objects.filter(
            pk=run.pk,
            connection_id=run.connection_id,
            status=BankSyncRun.Status.RUNNING,
        ).update(status=BankSyncRun.Status.FAILED, error=error, finished_at=finished_at)
    run.refresh_from_db()
    return run


def _active_sync_run(connection_id):
    return (
        BankSyncRun.objects.filter(connection_id=connection_id, status__in=ACTIVE_SYNC_STATUSES)
        .order_by("-started_at", "-pk")
        .first()
    )


def _mark_connection_syncing(connection_id, started_at):
    BankConnection.objects.filter(pk=connection_id).update(
        sync_status=BankConnection.SyncStatus.SYNCING,
        sync_started_at=started_at,
    )


def _retry_sync_write(attempt):
    delay = SYNC_WRITE_RETRY_DELAYS[min(attempt, len(SYNC_WRITE_RETRY_DELAYS) - 1)]
    if delay:
        time.sleep(delay)


def enqueue_connection_sync(connection):
    """Persist one idempotent sync request while the connection is authorized.

    The partial unique index on active runs is the serialization primitive. A
    concurrent SQLite writer may lose the insert race or briefly encounter a
    database lock; both cases are retried and resolve to the winning run. The
    conditional connection update is the first statement so it serializes the
    short transaction with disconnect without a deferred read-before-write.
    """
    for attempt in range(SYNC_WRITE_ATTEMPTS):
        _retry_sync_write(attempt)
        try:
            with transaction.atomic():
                if not _lock_authorized_connection(connection.pk):
                    raise BankConnectionUnavailable(BANK_SYNC_UNAVAILABLE_ERROR)
                connection.refresh_from_db()
                reconcile_connection_sync_state(connection)
                now = timezone.now()
                try:
                    # Keep the uniqueness failure inside a savepoint so callers
                    # that already own an atomic block can continue after the
                    # losing insert race.
                    with transaction.atomic():
                        run = BankSyncRun.objects.create(
                            connection_id=connection.pk,
                            status=BankSyncRun.Status.QUEUED,
                        )
                except IntegrityError:
                    run = _active_sync_run(connection.pk)
                    if not run:
                        continue
                _mark_connection_syncing(connection.pk, run.started_at or now)
            return run
        except OperationalError:
            if attempt == SYNC_WRITE_ATTEMPTS - 1:
                raise
    active_run = _active_sync_run(connection.pk)
    if active_run:
        return active_run
    raise RuntimeError("No se pudo encolar la sincronización bancaria.")


def claim_next_bank_sync():
    """Claim one queued run with a compare-and-set update.

    SQLite does not provide useful row-lock semantics for this queue. Selecting
    a candidate and changing it only while it is still queued and authorized
    makes two worker processes safe: exactly one UPDATE affects the row.
    """
    for attempt in range(SYNC_WRITE_ATTEMPTS):
        _retry_sync_write(attempt)
        try:
            retry_claim = False
            claimed_id = None
            with transaction.atomic():
                candidate = (
                    BankSyncRun.objects.filter(
                        status=BankSyncRun.Status.QUEUED,
                        connection__status=BankConnection.Status.AUTHORIZED,
                    )
                    .order_by("started_at", "pk")
                    .values("pk", "connection_id")
                    .first()
                )
                if not candidate:
                    return None
                if not _lock_authorized_connection(candidate["connection_id"]):
                    retry_claim = True
                else:
                    now = timezone.now()
                    updated = BankSyncRun.objects.filter(
                        pk=candidate["pk"],
                        status=BankSyncRun.Status.QUEUED,
                        connection__status=BankConnection.Status.AUTHORIZED,
                    ).update(
                        status=BankSyncRun.Status.RUNNING,
                        started_at=now,
                    )
                    if not updated:
                        retry_claim = True
                    else:
                        _mark_connection_syncing(candidate["connection_id"], now)
                        claimed_id = candidate["pk"]
            if retry_claim:
                continue
            return BankSyncRun.objects.select_related("connection").get(pk=claimed_id)
        except OperationalError:
            if attempt == SYNC_WRITE_ATTEMPTS - 1:
                raise
    return None


def _ensure_running_sync(connection):
    """Return ``(run, owns_execution)`` using SQLite-safe CAS semantics."""
    for attempt in range(SYNC_WRITE_ATTEMPTS):
        _retry_sync_write(attempt)
        try:
            retry_claim = False
            with transaction.atomic():
                if not _lock_authorized_connection(connection.pk):
                    raise BankConnectionUnavailable(BANK_SYNC_UNAVAILABLE_ERROR)
                connection.refresh_from_db()
                reconcile_connection_sync_state(connection)
                active_run = _active_sync_run(connection.pk)
                if active_run:
                    if active_run.status == BankSyncRun.Status.QUEUED:
                        now = timezone.now()
                        promoted = BankSyncRun.objects.filter(
                            pk=active_run.pk,
                            status=BankSyncRun.Status.QUEUED,
                        ).update(status=BankSyncRun.Status.RUNNING, started_at=now)
                        if promoted:
                            _mark_connection_syncing(connection.pk, now)
                            return BankSyncRun.objects.get(pk=active_run.pk), True
                        retry_claim = True
                    else:
                        _mark_connection_syncing(connection.pk, active_run.started_at)
                        return active_run, False
                else:
                    now = timezone.now()
                    conflict = False
                    try:
                        with transaction.atomic():
                            run = BankSyncRun.objects.create(connection_id=connection.pk, status=BankSyncRun.Status.RUNNING)
                    except IntegrityError:
                        conflict = True
                    if not conflict:
                        _mark_connection_syncing(connection.pk, run.started_at or now)
                        return run, True
                    retry_claim = True
            if retry_claim:
                continue
        except OperationalError:
            if attempt == SYNC_WRITE_ATTEMPTS - 1:
                raise
    active_run = _active_sync_run(connection.pk)
    if active_run:
        return active_run, False
    raise RuntimeError("No se pudo iniciar la sincronización bancaria.")


def sync_connection(connection, client=None, *, run=None):
    from .banking_client import EnableBankingClient

    if run is None:
        run, owns_execution = _ensure_running_sync(connection)
        if not owns_execution:
            return run
    else:
        run.refresh_from_db()
        if run.status != BankSyncRun.Status.RUNNING:
            return run
        connection = BankConnection.objects.get(pk=run.connection_id)
        if connection.status != BankConnection.Status.AUTHORIZED:
            _finish_sync_failure(run, BANK_SYNC_UNAVAILABLE_ERROR)
            return run
    client = client or EnableBankingClient()
    scoped_rows = BankTransaction.objects.filter(bank_account__connection=connection)
    initial_pending = scoped_rows.filter(status=BankTransaction.Status.PENDING).count()
    try:
        for bank_account in connection.bank_accounts.select_related("account"):
            balance = select_balance(client.balances(bank_account.remote_uid), currency=bank_account.currency)
            if balance is not None:
                observed_at = timezone.now()
                with transaction.atomic():
                    if not _lock_authorized_sync_run(connection.pk, run.pk):
                        raise BankConnectionUnavailable(BANK_SYNC_CANCELLED_ERROR)
                    bank_account.remote_balance = balance.amount
                    bank_account.balance_updated_at = observed_at
                    bank_account.remote_balance_type = balance.balance_type
                    bank_account.remote_balance_currency = balance.currency
                    bank_account.remote_balance_reference_date = balance.reference_date
                    bank_account.balance_provenance_updated_at = observed_at
                    bank_account.save(
                        update_fields=[
                            "remote_balance",
                            "balance_updated_at",
                            "remote_balance_type",
                            "remote_balance_currency",
                            "remote_balance_reference_date",
                            "balance_provenance_updated_at",
                        ]
                    )
            date_from = (
                bank_account.last_transaction_date - timedelta(days=7)
                if bank_account.last_transaction_date
                else timezone.localdate() - timedelta(days=90)
            )
            continuation = None
            fallback_occurrences = {}
            while True:
                payload = client.transactions(bank_account.remote_uid, date_from, continuation)
                with transaction.atomic():
                    if not _lock_authorized_sync_run(connection.pk, run.pk):
                        raise BankConnectionUnavailable(BANK_SYNC_CANCELLED_ERROR)
                    stage_remote_transactions(
                        bank_account,
                        payload.get("transactions", []),
                        fallback_occurrences=fallback_occurrences,
                    )
                continuation = payload.get("continuation_key")
                if not continuation:
                    break
            with transaction.atomic():
                if not _lock_authorized_sync_run(connection.pk, run.pk):
                    raise BankConnectionUnavailable(BANK_SYNC_CANCELLED_ERROR)
                bank_account.last_transaction_date = timezone.localdate()
                bank_account.save(update_fields=["last_transaction_date"])
        with transaction.atomic():
            if not _lock_authorized_sync_run(connection.pk, run.pk):
                raise BankConnectionUnavailable(BANK_SYNC_CANCELLED_ERROR)
            connection.refresh_from_db()
            connection.last_synced_at = timezone.now()
            connection.last_error = ""
            connection.sync_status = BankConnection.SyncStatus.IDLE
            connection.sync_started_at = None
            connection.save(update_fields=["last_synced_at", "last_error", "sync_status", "sync_started_at"])
            pending_count = scoped_rows.filter(status=BankTransaction.Status.PENDING).count()
            finished_at = timezone.now()
            completed = BankSyncRun.objects.filter(
                pk=run.pk,
                connection_id=connection.pk,
                status=BankSyncRun.Status.RUNNING,
            ).update(
                status=BankSyncRun.Status.COMPLETED,
                error="",
                pending_count=pending_count,
                imported_count=max(pending_count - initial_pending, 0),
                finished_at=finished_at,
            )
            if not completed:
                raise BankConnectionUnavailable(BANK_SYNC_CANCELLED_ERROR)
    except BankConnectionUnavailable as exc:
        _finish_sync_failure(run, str(exc))
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else None
        if status_code == 429:
            error = "El banco ha alcanzado su límite de consultas. Se reintentará mañana."
        else:
            error = f"No se pudo sincronizar con el banco (HTTP {status_code or 'desconocido'})."
        connection_update = {
            "last_error": error,
            "sync_status": BankConnection.SyncStatus.ERROR,
            "sync_started_at": None,
        }
        if status_code in {401, 403, 404}:
            connection_update["status"] = BankConnection.Status.NEEDS_RECONNECT
        _finish_sync_failure(run, error, connection_updates=connection_update)
    except Exception:
        error = "No se pudo sincronizar con el banco. Inténtalo de nuevo."
        _finish_sync_failure(
            run,
            error,
            connection_updates={
                "last_error": error,
                "sync_status": BankConnection.SyncStatus.ERROR,
                "sync_started_at": None,
            },
        )
    finally:
        run.refresh_from_db()
    return run


def sync_all_connections():
    due_before = timezone.now() - timedelta(hours=23)
    connections = BankConnection.objects.filter(status=BankConnection.Status.AUTHORIZED).filter(
        Q(last_synced_at__isnull=True) | Q(last_synced_at__lte=due_before)
    )
    due = []
    for connection in connections:
        latest_attempt = BankSyncRun.objects.filter(connection=connection).order_by("-started_at").first()
        if not latest_attempt or latest_attempt.started_at <= due_before:
            due.append(connection)
    runs = []
    for connection in due:
        try:
            runs.append(sync_connection(connection))
        except BankConnectionUnavailable:
            continue
    return runs


def enqueue_due_connections():
    """Enqueue daily-due connections without doing provider I/O in the caller."""
    due_before = timezone.now() - timedelta(hours=23)
    connections = BankConnection.objects.filter(status=BankConnection.Status.AUTHORIZED).filter(
        Q(last_synced_at__isnull=True) | Q(last_synced_at__lte=due_before)
    )
    runs = []
    for connection in connections:
        latest_attempt = BankSyncRun.objects.filter(connection=connection).order_by("-started_at").first()
        if not latest_attempt or latest_attempt.started_at <= due_before:
            try:
                runs.append(enqueue_connection_sync(connection))
            except BankConnectionUnavailable:
                continue
    return runs
