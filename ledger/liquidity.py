"""Read-only inputs and provenance for the Plan daily-liquidity forecast."""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Prefetch, Q, Sum

from .calculations.ledger import is_valid_transfer_pair, signed_amount
from .calculations.liquidity import calculate_liquidity_forecast
from .models import Account, BankAccount, BankConnection, BankTransaction, ReconciliationSnapshot, RecurringOccurrence, Transaction
from .services import scheduled_occurrences, signed_expression

ZERO = Decimal("0.00")
TRANSFER_KINDS = {Transaction.Kind.TRANSFER_IN, Transaction.Kind.TRANSFER_OUT}


def _bank_link(account):
    try:
        return account.bank_link
    except BankAccount.DoesNotExist:
        return None


def _connection_reasons(connection, *, now):
    reasons = []
    if connection.status != BankConnection.Status.AUTHORIZED:
        reasons.append("bank_connection_not_authorized")
    if connection.sync_status != BankConnection.SyncStatus.IDLE or connection.last_error:
        reasons.append("bank_sync_not_healthy")
    if connection.authorized_until and connection.authorized_until <= now:
        reasons.append("bank_authorization_expired")
    if connection.last_synced_at is None or connection.last_synced_at <= now - timedelta(hours=23) or connection.last_synced_at > now:
        reasons.append("bank_sync_stale")
    return reasons


def _balance_sources(account, *, date_from, now):
    link = _bank_link(account)
    reasons = []
    if link:
        connection = link.connection
        reasons.extend(_connection_reasons(connection, now=now))
        if link.currency != "EUR":
            reasons.append("unsupported_account_currency")
        bank_is_verified = (
            link.remote_balance is not None
            and link.remote_balance_type == "CLBD"
            and link.currency == "EUR"
            and link.remote_balance_currency == "EUR"
            and link.remote_balance_reference_date is not None
            and link.balance_updated_at is not None
            and link.balance_provenance_updated_at == link.balance_updated_at
            and connection.last_synced_at is not None
            and connection.last_synced_at >= link.balance_updated_at
            and link.remote_balance_reference_date < date_from
        )
        bank_candidate = None
        if bank_is_verified:
            bank_candidate = {
                "cut_date": link.remote_balance_reference_date,
                "amount": link.remote_balance,
                "source": {
                    "kind": "bank_booked_balance",
                    "cut_date": link.remote_balance_reference_date,
                    "observed_at": link.balance_updated_at,
                    "balance_type": link.remote_balance_type,
                    "currency": link.remote_balance_currency,
                },
            }
    else:
        bank_candidate = None

    snapshots = getattr(account, "liquidity_reconciliation_snapshots", [])
    reconciled = [
        snapshot for snapshot in snapshots
        if snapshot.status == ReconciliationSnapshot.Status.RECONCILED
        and snapshot.difference == ZERO
        and snapshot.date < date_from
    ]
    reconciliation_candidate = None
    if reconciled:
        snapshot = max(reconciled, key=lambda item: (item.date, item.created_at))
        reconciliation_candidate = {
            "cut_date": snapshot.date,
            "amount": snapshot.statement_balance,
            "source": {
                "kind": "reconciled_statement",
                "cut_date": snapshot.date,
                "observed_at": snapshot.created_at,
                "balance_type": "statement",
                "currency": "EUR",
            },
        }

    candidates = [item for item in (bank_candidate, reconciliation_candidate) if item]
    if candidates:
        newest_date = max(item["cut_date"] for item in candidates)
        newest = [item for item in candidates if item["cut_date"] == newest_date]
        if len({item["amount"] for item in newest}) > 1:
            reasons.append("conflicting_balance_cuts")
            anchor = None
        else:
            anchor = next((item for item in newest if item["source"]["kind"] == "bank_booked_balance"), newest[0])
    else:
        anchor = None

    differences = [snapshot for snapshot in snapshots if snapshot.status == ReconciliationSnapshot.Status.DIFFERENCE]
    latest_difference = max(differences, key=lambda item: (item.date, item.created_at), default=None)
    if latest_difference and (
        anchor is None
        or latest_difference.date > anchor["cut_date"]
        or (latest_difference.date == anchor["cut_date"] and latest_difference.statement_balance != anchor["amount"])
    ):
        reasons.append("reconciliation_difference_after_balance_cut")
    if link and anchor is None:
        reasons.append("no_verified_balance_cut")
    if not link and anchor is None:
        anchor = {
            "cut_date": date.min,
            "amount": account.opening_balance,
            "source": {
                "kind": "ledger_opening_balance",
                    "cut_date": date_from - timedelta(days=1),
                    "observed_at": None,
                "balance_type": "ledger",
                "currency": "EUR",
            },
        }
    return link, anchor, list(dict.fromkeys(reasons))


@transaction.atomic
def liquidity_forecast(account_ids, *, date_from, date_to, today, now):
    """Load a fixed, read-only ledger snapshot and run the pure liquidity calculation."""
    if not account_ids or len(set(account_ids)) != len(account_ids):
        raise ValueError("Selecciona una o más cuentas sin repetir.")
    accounts = list(
        Account.objects.filter(pk__in=account_ids, active=True)
        .select_related("bank_link__connection")
        .prefetch_related(Prefetch(
            "reconciliation_snapshots",
            queryset=ReconciliationSnapshot.objects.order_by("date", "created_at"),
            to_attr="liquidity_reconciliation_snapshots",
        ))
        .order_by("pk")
    )
    if len(accounts) != len(account_ids):
        raise ValueError("Todas las cuentas deben existir y estar activas.")

    unknown_reasons = defaultdict(list)
    anchors = {}
    provenance = {}
    links = {}
    for account in accounts:
        link, anchor, reasons = _balance_sources(account, date_from=date_from, now=now)
        links[account.pk] = link
        unknown_reasons[account.pk].extend(reasons)
        if anchor:
            anchors[account.pk] = anchor
            provenance[account.pk] = anchor["source"]
        else:
            provenance[account.pk] = {"kind": "unknown", "cut_date": None, "balance_type": "", "currency": "EUR"}

    ledger_ids = [account.pk for account in accounts if account.pk not in anchors]
    anchor_ids = list(anchors)
    starting_balances = {}
    if ledger_ids:
        ledger_totals = {
            row["account_id"]: row["total"]
            for row in Transaction.objects.filter(
                account_id__in=ledger_ids,
                archived=False,
                date__lt=date_from,
            ).values("account_id").annotate(total=Sum(signed_expression()))
        }
        account_by_id = {account.pk: account for account in accounts}
        for account_id in ledger_ids:
            starting_balances[account_id] = account_by_id[account_id].opening_balance + ledger_totals.get(account_id, ZERO)

    movement_filter = None
    for account_id in account_ids:
        if account_id in anchors:
            anchor = anchors[account_id]
            account_filter = Q(account_id=account_id, date__gt=anchor["cut_date"], date__lte=date_to)
        else:
            account_filter = Q(account_id=account_id, date__range=(date_from, date_to))
        movement_filter = account_filter if movement_filter is None else movement_filter | account_filter
    movements = list(
        Transaction.objects.filter(movement_filter, archived=False).select_related("account").order_by("date", "pk")
    )
    bridge_movements = [
        movement for movement in movements
        if movement.account_id in anchors and movement.date < date_from
    ]
    bridge_totals = defaultdict(lambda: ZERO)
    for movement in bridge_movements:
        bridge_totals[movement.account_id] += signed_amount(movement.kind, movement.amount)
    for account_id, anchor in anchors.items():
        starting_balances[account_id] = anchor["amount"] + bridge_totals[account_id]

    transactions = [movement for movement in movements if movement.date >= date_from]
    transfer_reasons = _transfer_integrity_reasons(account_ids, bridge_movements + transactions)
    for account_id, reasons in transfer_reasons.items():
        unknown_reasons[account_id].extend(reasons)

    unresolved_bank_rows = _unresolved_bank_accounts(anchors, links, date_to)
    for account_id in unresolved_bank_rows:
        unknown_reasons[account_id].append("bank_rows_unreviewed_after_balance_cut")

    overdue_pending = set(RecurringOccurrence.objects.filter(
        rule__account_id__in=account_ids,
        status=RecurringOccurrence.Status.PENDING,
        due_date__lt=today,
    ).values_list("rule__account_id", flat=True).distinct())
    for account_id in overdue_pending:
        unknown_reasons[account_id].append("overdue_recurring_occurrence")

    confirmed_after_cut = Q()
    for account_id, anchor in anchors.items():
        confirmed_after_cut |= Q(rule__account_id=account_id, due_date__gt=anchor["cut_date"], due_date__lte=date_to)
    if anchors:
        broken_confirmed = set(RecurringOccurrence.objects.filter(
            confirmed_after_cut,
            status=RecurringOccurrence.Status.CONFIRMED,
        ).filter(
            Q(transaction__isnull=True) | Q(transaction__archived=True)
        ).values_list("rule__account_id", flat=True).distinct())
        for account_id in broken_confirmed:
            unknown_reasons[account_id].append("confirmed_recurring_without_active_transaction")

    scheduled = scheduled_occurrences(today, date_to)
    scheduled = [item for item in scheduled if item.rule.account_id in account_ids]
    pre_range_occurrences = [
        item for item in scheduled
        if item.status == RecurringOccurrence.Status.PENDING and today <= item.due_date < date_from
    ]
    forecast_occurrences = [
        item for item in scheduled
        if item.status == RecurringOccurrence.Status.PENDING and date_from <= item.due_date <= date_to
    ]

    return calculate_liquidity_forecast(
        accounts,
        date_from=date_from,
        date_to=date_to,
        starting_balances=starting_balances,
        provenance=provenance,
        unknown_reasons=unknown_reasons,
        transactions=transactions,
        forecast_occurrences=forecast_occurrences,
        pre_range_occurrences=pre_range_occurrences,
    )


def _transfer_integrity_reasons(account_ids, movements):
    reasons = defaultdict(list)
    relevant = list({movement.pk: movement for movement in movements}.values())
    groups = set()
    for movement in relevant:
        if movement.kind not in TRANSFER_KINDS:
            continue
        if movement.transfer_group is None:
            reasons[movement.account_id].append("transfer_pair_incomplete")
        else:
            groups.add(movement.transfer_group)
    if not groups:
        return reasons
    pairs = defaultdict(list)
    for movement in Transaction.objects.filter(transfer_group__in=groups).order_by("transfer_group", "pk"):
        pairs[movement.transfer_group].append(movement)
    for group, pair in pairs.items():
        outgoing = [movement for movement in pair if movement.kind == Transaction.Kind.TRANSFER_OUT]
        incoming = [movement for movement in pair if movement.kind == Transaction.Kind.TRANSFER_IN]
        valid = len(pair) == 2 and len(outgoing) == 1 and len(incoming) == 1 and is_valid_transfer_pair(outgoing[0], incoming[0])
        if not valid:
            for movement in pair:
                if movement.account_id in account_ids and not movement.archived:
                    reasons[movement.account_id].append("transfer_pair_incomplete")
    return reasons


def _unresolved_bank_accounts(anchors, links, date_to):
    predicate = Q()
    has_bank_cut = False
    for account_id, anchor in anchors.items():
        if links.get(account_id):
            predicate |= Q(bank_account__account_id=account_id, booking_date__gt=anchor["cut_date"], booking_date__lte=date_to)
            has_bank_cut = True
    if not has_bank_cut:
        return set()
    unresolved = BankTransaction.objects.filter(predicate).filter(
        Q(status__in=(BankTransaction.Status.PENDING, BankTransaction.Status.SKIPPED))
        | Q(status=BankTransaction.Status.IMPORTED, transaction__isnull=True)
        | Q(status=BankTransaction.Status.IMPORTED, transaction__archived=True)
        | Q(status=BankTransaction.Status.IMPORTED, fee_transaction__archived=True)
        | ~Q(currency="EUR")
    ).values_list("bank_account__account_id", flat=True).distinct()
    return set(unresolved)
