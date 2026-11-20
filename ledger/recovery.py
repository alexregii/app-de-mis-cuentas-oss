import json
import os
import sqlite3
import stat
import tempfile
import zipfile
from contextlib import closing
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction as db_transaction
from django.utils import timezone
from .backup_contract import DATABASE_ENTRY, read_manifest, validate_archive_entries
from .models import Account, Category, MonthlyClose, RecurringOccurrence, RecurringRule, ReconciliationSnapshot, SavingsGoal, SavingsObjective, Tag, Transaction
from .transaction_allocations import TransactionAllocationError, normalize_allocation_payload, replace_transaction_allocations


class RestoreBusyError(RuntimeError):
    pass


def backup_directory():
    return Path(settings.BASE_DIR) / "backups"


def recovery_directory():
    directory = Path(settings.BASE_DIR) / "data" / "recovery"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def operation_lock_directory():
    return recovery_directory() / "operation.lock"


def operation_lock_status():
    lock_directory = operation_lock_directory()
    if not lock_directory.exists() and not lock_directory.is_symlink():
        return None
    if lock_directory.is_symlink() or not lock_directory.is_dir():
        return {"operation": "unknown", "message": "La aplicación está en mantenimiento."}
    try:
        payload = json.loads((lock_directory / "operation.json").read_text(encoding="utf-8"))
        operation = payload.get("operation") if isinstance(payload, dict) else None
        message = payload.get("message") if isinstance(payload, dict) else None
        if operation not in {"backend_release", "restore", "restore_request"} or not isinstance(message, str):
            raise ValueError("invalid operation lock")
        return {"operation": operation, "message": message}
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError, AttributeError):
        return {"operation": "unknown", "message": "La aplicación está en mantenimiento."}


def operation_allows_backup(kind, operation):
    if operation is None:
        return True
    return (
        operation.get("operation") == "backend_release" and kind == "pre-release"
    ) or (
        operation.get("operation") == "restore" and kind == "pre-restore"
    )


def acquire_operation_lock(operation, message):
    if operation not in {"backend_release", "restore", "restore_request"}:
        raise ValueError("Operación de mantenimiento no reconocida.")
    lock_directory = operation_lock_directory()
    try:
        lock_directory.mkdir(mode=0o700)
    except FileExistsError as exc:
        raise RestoreBusyError("La aplicación ya está realizando una operación de mantenimiento.") from exc
    try:
        (lock_directory / "operation.json").write_text(
            json.dumps({"operation": operation, "message": message}, separators=(",", ":")),
            encoding="utf-8",
        )
    except OSError:
        lock_directory.rmdir()
        raise
    return lock_directory


def release_operation_lock(lock_directory):
    expected = operation_lock_directory()
    if Path(lock_directory) != expected:
        raise ValueError("No se puede liberar un lock de operación ajeno.")
    marker = expected / "operation.json"
    if marker.exists():
        marker.unlink()
    expected.rmdir()


def publish_restore_request(archive):
    recovery = recovery_directory()
    staged_directory = (recovery / "staged").resolve()
    try:
        archive_path = Path(archive).resolve(strict=True)
    except OSError as exc:
        raise ValueError("La copia previsualizada ya no está disponible.") from exc
    if archive_path.parent != staged_directory or archive_path.suffix.lower() != ".zip":
        raise ValueError("La solicitud debe señalar una copia previsualizada válida.")

    lock_directory = acquire_operation_lock("restore_request", "La restauración está pendiente.")
    request = recovery / "restore-request.json"
    part = recovery / "restore-request.part"
    try:
        if request.exists():
            raise RestoreBusyError("Ya hay una restauración pendiente.")
        descriptor = os.open(part, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                json.dump({"archive": f"/data/recovery/staged/{archive_path.name}"}, output, separators=(",", ":"))
                output.flush()
                os.fsync(output.fileno())
        except Exception:
            if part.exists():
                part.unlink()
            raise
        if request.exists():
            part.unlink(missing_ok=True)
            raise RestoreBusyError("Ya hay una restauración pendiente.")
        try:
            os.replace(part, request)
        except OSError:
            part.unlink(missing_ok=True)
            raise
    finally:
        release_operation_lock(lock_directory)


def inspect_restore_archive(upload):
    try:
        with zipfile.ZipFile(upload) as archive:
            entries = archive.infolist()
            names = validate_archive_entries(entries)
            read_manifest(archive, names)
            total_size = sum(entry.file_size for entry in entries)
            compressed_size = sum(entry.compress_size for entry in entries)
            if len(entries) > 10_000 or total_size > 4 * 1024 * 1024 * 1024 or (compressed_size and total_size > compressed_size * 200):
                raise ValueError("La copia supera los límites de seguridad permitidos.")
            with tempfile.TemporaryDirectory() as directory:
                database = Path(directory) / DATABASE_ENTRY
                database.write_bytes(archive.read(DATABASE_ENTRY))
                with closing(sqlite3.connect(f"file:{database}?mode=ro", uri=True)) as connection:
                    if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                        raise ValueError("La base de datos de la copia está dañada.")
                    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                    required = {"django_migrations", "ledger_account", "ledger_transaction"}
                    if not required.issubset(tables):
                        raise ValueError("La copia no corresponde a una instalación compatible de Mis cuentas.")
            return {"files": len(names), "media_files": sum(name.startswith("media/") for name in names), "size": upload.size}
    except zipfile.BadZipFile as exc:
        raise ValueError("El archivo no es una copia ZIP válida.") from exc


def latest_backup():
    directory = backup_directory()
    archives = sorted(directory.rglob("*.zip"), key=lambda item: item.stat().st_mtime, reverse=True) if directory.exists() else []
    if not archives:
        return None
    archive = archives[0]
    return {"name": archive.name, "created_at": datetime.fromtimestamp(archive.stat().st_mtime, tz=timezone.get_current_timezone()).isoformat(), "size": archive.stat().st_size, "destination": str(directory)}


def _file_modified_at(path):
    try:
        timestamp = path.stat().st_mtime
    except OSError:
        return None
    return datetime.fromtimestamp(timestamp, tz=timezone.get_current_timezone())


def _regular_file_modified_at(path):
    try:
        info = path.lstat()
    except OSError:
        return None
    if not stat.S_ISREG(info.st_mode):
        return None
    return datetime.fromtimestamp(info.st_mtime, tz=timezone.get_current_timezone())


def scheduled_backup_status(now=None):
    now = now or timezone.now()
    scheduler = Path(settings.BASE_DIR) / "data" / "scheduler"
    heartbeat_at = _file_modified_at(scheduler / "backup-worker-heartbeat")
    failure_at = _file_modified_at(scheduler / "backup-last-failure.stamp")

    scheduled_directory = backup_directory() / "scheduled"
    archives = scheduled_directory.glob("*.zip") if scheduled_directory.exists() else ()
    success_times = (_regular_file_modified_at(path) for path in archives)
    success_at = max((timestamp for timestamp in success_times if timestamp is not None), default=None)

    worker = "healthy" if heartbeat_at and now - heartbeat_at <= timedelta(hours=2) else "stale"
    if failure_at and (success_at is None or failure_at > success_at):
        schedule = "failed"
    elif success_at is None:
        schedule = "missing"
    elif now - success_at > timedelta(hours=24):
        schedule = "stale"
    else:
        schedule = "healthy"

    return {
        "worker": worker,
        "schedule": schedule,
        "heartbeat_at": heartbeat_at.isoformat() if heartbeat_at else None,
        "last_failure_at": failure_at.isoformat() if failure_at else None,
        "last_success_at": success_at.isoformat() if success_at else None,
    }


def write_portable_export(output):
    manifest = {"format": "miscuentas-portable", "version": 5, "created_at": timezone.now().isoformat(), "includes": ["data.json", "media/"]}
    accounts = list(Account.objects.order_by("pk"))
    categories = list(Category.objects.order_by("pk"))
    linked_rule_ids = set(SavingsObjective.objects.filter(recurring_rule__isnull=False).values_list("recurring_rule_id", flat=True))
    linked_rule_ids.update(RecurringOccurrence.objects.filter(
        reserve_consumed_amount__gt=0, reserve_objective__isnull=False
    ).values_list("rule_id", flat=True))
    annual_reserve_rules = list(RecurringRule.objects.filter(pk__in=linked_rule_ids).select_related("account", "category").order_by("pk"))
    legacy_savings_goal = SavingsGoal.objects.filter(active=True).order_by("-updated_at", "-pk").first()
    if legacy_savings_goal is None:
        legacy_savings_goal = SavingsGoal.objects.order_by("-updated_at", "-pk").first()
    transaction_rows = []
    for item in Transaction.objects.select_related("account", "category", "recurring_occurrence__rule").prefetch_related("tags", "allocations__category").order_by("pk"):
        transaction = {
            "id": f"transaction:{item.pk}",
            "account": f"account:{item.account_id}",
            "kind": item.kind,
            "amount": str(item.amount),
            "date": item.date.isoformat(),
            "description": item.description,
            "category": f"category:{item.category_id}" if item.category_id else None,
            "refund_for": f"transaction:{item.refund_for_id}" if item.refund_for_id else None,
            "notes": item.notes,
            "source": item.source,
            "archived": item.archived,
            "transfer_group": str(item.transfer_group) if item.transfer_group else None,
            "tags": [f"tag:{tag.pk}" for tag in item.tags.all()],
        }
        if item.recurring_occurrence_id and item.recurring_occurrence.rule_id in linked_rule_ids:
            transaction["recurring_occurrence"] = f"recurring_occurrence:{item.recurring_occurrence_id}"
        allocations = list(item.allocations.all())
        if allocations:
            transaction["allocations"] = [
                {
                    "category": f"category:{allocation.category_id}" if allocation.category_id else None,
                    "amount": str(allocation.amount),
                    "position": allocation.position,
                }
                for allocation in allocations
            ]
        transaction_rows.append(transaction)
    data = {
        "accounts": [{"id": f"account:{item.pk}", "name": item.name, "kind": item.kind, "opening_balance": str(item.opening_balance), "color": item.color, "active": item.active, "created_at": item.created_at.isoformat()} for item in accounts],
        "categories": [{"id": f"category:{item.pk}", "name": item.name, "kind": item.kind, "parent": f"category:{item.parent_id}" if item.parent_id else None, "color": item.color, "active": item.active, "exclude_from_analytics": item.exclude_from_analytics} for item in categories],
        "tags": [{"id": f"tag:{item.pk}", "name": item.name} for item in Tag.objects.order_by("pk")],
        "transactions": transaction_rows,
        "reconciliation_snapshots": [{"account": f"account:{item.account_id}", "date": item.date.isoformat(), "statement_balance": str(item.statement_balance), "ledger_balance": str(item.ledger_balance), "difference": str(item.difference), "status": item.status} for item in ReconciliationSnapshot.objects.order_by("account_id", "date", "created_at", "pk")],
        "monthly_closes": [{"month": item.month.isoformat(), "basis": item.basis, "version": item.version, "status_at_close": item.status_at_close, "source_digest": item.source_digest, "idempotency_key": item.idempotency_key, "request_digest": item.request_digest, "report": item.report, "accounts": item.accounts, "issues": item.issues, "declarations": item.declarations, "correction_reason": item.correction_reason, "created_at": item.created_at.isoformat()} for item in MonthlyClose.objects.order_by("month", "basis", "version")],
        "annual_reserve_rules": [{
            "id": f"recurring_rule:{rule.pk}",
            "name": rule.name,
            "kind": rule.kind,
            "amount": str(rule.amount),
            "account": f"account:{rule.account_id}",
            "category": f"category:{rule.category_id}",
            "frequency": rule.frequency,
            "day_of_month": rule.day_of_month,
            "start_date": rule.start_date.isoformat(),
            "end_date": rule.end_date.isoformat() if rule.end_date else "",
            "active": rule.active,
            "notes": rule.notes,
            "occurrences": [{
                "id": f"recurring_occurrence:{occurrence.pk}",
                "due_date": occurrence.due_date.isoformat(),
                "amount": str(occurrence.amount),
                "status": occurrence.status,
                "reserve_consumed_amount": str(occurrence.reserve_consumed_amount),
                "reserve_objective": f"savings_objective:{occurrence.reserve_objective_id}" if occurrence.reserve_objective_id else None,
            } for occurrence in rule.occurrences.select_related("reserve_objective").order_by("due_date", "pk")],
        } for rule in annual_reserve_rules],
        "legacy_savings_goal": {
            "percentage": str(legacy_savings_goal.percentage),
            "minimum": str(legacy_savings_goal.minimum),
            "active": legacy_savings_goal.active,
        } if legacy_savings_goal else None,
        "savings_objectives": [{
            "id": f"savings_objective:{item.pk}",
            "name": item.name,
            "target_amount": str(item.target_amount),
            "target_date": item.target_date.isoformat(),
            "priority": item.priority,
            "assigned_amount": str(item.assigned_amount),
            "archived": item.archived,
            "recurring_rule": f"recurring_rule:{item.recurring_rule_id}" if item.recurring_rule_id else None,
        } for item in SavingsObjective.objects.select_related("recurring_rule").order_by("archived", "priority", "target_date", "pk")],
    }
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        archive.writestr("data.json", json.dumps(data, ensure_ascii=False, separators=(",", ":")))
        media = Path(settings.MEDIA_ROOT)
        if media.exists():
            for file in media.rglob("*"):
                if file.is_file(): archive.write(file, Path("media") / file.relative_to(media))


def import_portable(data):
    if data.get("format") != "miscuentas-portable" or data.get("version") not in {1, 2, 3, 4, 5}:
        raise ValueError("Formato portable no compatible.")
    if (Account.objects.exists() or Category.objects.exists() or Transaction.objects.exists()
            or ReconciliationSnapshot.objects.exists() or MonthlyClose.objects.exists()
            or SavingsGoal.objects.exists() or SavingsObjective.objects.exists()
            or RecurringRule.objects.exists() or RecurringOccurrence.objects.exists()):
        raise ValueError("La importación portable solo se admite en una instalación vacía.")
    restored_objectives = []
    restored_objective_refs = {}
    recurring_occurrences = {}
    reserve_objective_refs = {}
    reserve_consumed_values = {}
    recurring_transactions = {}
    restored_legacy_goal = False
    restored_allocations = 0
    with db_transaction.atomic():
        accounts = {}
        for item in data.get("accounts", []):
            account = Account.objects.create(name=item["name"], kind=item["kind"], opening_balance=item["opening_balance"], color=item.get("color", "#3478F6"), active=item.get("active", True))
            if item.get("created_at"):
                created_at = datetime.fromisoformat(item["created_at"])
                Account.objects.filter(pk=account.pk).update(created_at=created_at)
                account.created_at = created_at
            accounts[item["id"]] = account
        categories = {}
        for item in data.get("categories", []):
            if item.get("parent") is None: categories[item["id"]] = Category.objects.create(name=item["name"], kind=item["kind"], color=item.get("color", "#8E8E93"), active=item.get("active", True), exclude_from_analytics=item.get("exclude_from_analytics", False))
        for item in data.get("categories", []):
            if item.get("parent"):
                parent = categories.get(item["parent"])
                if not parent: raise ValueError("Categoría padre no encontrada.")
                categories[item["id"]] = Category.objects.create(name=item["name"], kind=item["kind"], parent=parent, color=item.get("color", "#8E8E93"), active=item.get("active", True), exclude_from_analytics=item.get("exclude_from_analytics", False))
        recurring_rules = {}
        if data.get("version") == 5:
            reserve_rule_data = data.get("annual_reserve_rules", [])
            if not isinstance(reserve_rule_data, list):
                raise ValueError("La lista de reservas anuales portable no es válida.")
            for item in reserve_rule_data:
                required = {"id", "name", "kind", "amount", "account", "category", "frequency", "day_of_month", "start_date", "end_date", "active", "notes", "occurrences"}
                if not isinstance(item, dict) or set(item) != required or item["id"] in recurring_rules:
                    raise ValueError("Una regla de reserva anual portable no es válida.")
                account = accounts.get(item["account"])
                category = categories.get(item["category"])
                if not account or not category or item["kind"] not in Category.Kind.values or item["frequency"] not in RecurringRule.Frequency.values or type(item["active"]) is not bool:
                    raise ValueError("Una regla de reserva anual portable no es válida.")
                rule = RecurringRule(
                    name=item["name"],
                    kind=item["kind"],
                    amount=item["amount"],
                    account=account,
                    category=category,
                    frequency=item["frequency"],
                    day_of_month=item["day_of_month"],
                    start_date=date.fromisoformat(item["start_date"]),
                    end_date=date.fromisoformat(item["end_date"]) if item["end_date"] else None,
                    active=item["active"],
                    notes=item["notes"],
                )
                try:
                    rule.full_clean()
                except ValidationError as exc:
                    raise ValueError("Una regla de reserva anual portable no es válida.") from exc
                rule.save()
                recurring_rules[item["id"]] = rule
                if not isinstance(item["occurrences"], list):
                    raise ValueError("La lista de ocurrencias anuales portable no es válida.")
                for occurrence_data in item["occurrences"]:
                    occurrence_fields = {"id", "due_date", "amount", "status", "reserve_consumed_amount", "reserve_objective"}
                    if not isinstance(occurrence_data, dict) or set(occurrence_data) != occurrence_fields or occurrence_data["id"] in recurring_occurrences:
                        raise ValueError("Una ocurrencia de reserva anual portable no es válida.")
                    reserve_objective_ref = occurrence_data["reserve_objective"]
                    try:
                        consumed = Decimal(str(occurrence_data["reserve_consumed_amount"]))
                    except (InvalidOperation, TypeError, ValueError) as exc:
                        raise ValueError("El importe consumido de la ocurrencia no es válido.") from exc
                    if not consumed.is_finite() or consumed < 0 or consumed.as_tuple().exponent < -2:
                        raise ValueError("El importe consumido de la ocurrencia no es válido.")
                    if reserve_objective_ref is not None and not isinstance(reserve_objective_ref, str):
                        raise ValueError("El objetivo consumido de la ocurrencia portable no es válido.")
                    occurrence = RecurringOccurrence(
                        rule=rule,
                        due_date=date.fromisoformat(occurrence_data["due_date"]),
                        amount=occurrence_data["amount"],
                        status=occurrence_data["status"],
                        reserve_consumed_amount=Decimal("0.00"),
                    )
                    try:
                        occurrence.full_clean(validate_unique=False)
                    except ValidationError as exc:
                        raise ValueError("Una ocurrencia de reserva anual portable no es válida.") from exc
                    occurrence.save()
                    recurring_occurrences[occurrence_data["id"]] = occurrence
                    reserve_consumed_values[occurrence_data["id"]] = consumed
                    if reserve_objective_ref:
                        reserve_objective_refs[occurrence_data["id"]] = reserve_objective_ref
                if rule.active:
                    linked_targets = [
                        objective_data.get("target_date")
                        for objective_data in data.get("savings_objectives", [])
                        if isinstance(objective_data, dict) and objective_data.get("recurring_rule") == item["id"]
                    ]
                    for target_text in linked_targets:
                        try:
                            target_date = date.fromisoformat(target_text)
                        except (TypeError, ValueError) as exc:
                            raise ValueError("El vencimiento portable de la reserva anual no es válido.") from exc
                        RecurringOccurrence.objects.get_or_create(
                            rule=rule,
                            due_date=target_date,
                            defaults={"amount": item["amount"]},
                        )
        tags = {item["id"]: Tag.objects.create(name=item["name"]) for item in data.get("tags", [])}
        transactions = {}
        for item in data.get("transactions", []):
            account, category = accounts.get(item["account"]), categories.get(item.get("category")) if item.get("category") else None
            if not account: raise ValueError("Cuenta de movimiento no encontrada.")
            occurrence_ref = item.get("recurring_occurrence") if data.get("version") == 5 else None
            occurrence = recurring_occurrences.get(occurrence_ref) if occurrence_ref else None
            if occurrence_ref and occurrence is None:
                raise ValueError("No se encontró la ocurrencia recurrente del movimiento portable.")
            if occurrence is not None and Transaction.objects.filter(recurring_occurrence=occurrence).exists():
                raise ValueError("Una ocurrencia recurrente portable solo puede enlazarse a un movimiento.")
            transaction = Transaction.objects.create(account=account, kind=item["kind"], amount=item["amount"], date=item["date"], description=item["description"], category=category, notes=item.get("notes", ""), source=item.get("source", Transaction.Source.MANUAL), archived=item.get("archived", False), transfer_group=item.get("transfer_group"), recurring_occurrence=occurrence)
            transaction.tags.set([tags[tag] for tag in item.get("tags", []) if tag in tags])
            if occurrence is not None:
                recurring_transactions[occurrence.pk] = transaction
            if data.get("version") in {4, 5} and "allocations" in item:
                allocation_data = item["allocations"]
                if not isinstance(allocation_data, list):
                    raise ValueError("La lista de partidas de un movimiento portable no es válida.")
                positions = [part.get("position") for part in allocation_data if isinstance(part, dict)]
                if len(positions) != len(allocation_data) or any(type(position) is not int or position < 0 for position in positions) or len(set(positions)) != len(positions):
                    raise ValueError("El orden de las partidas de un movimiento portable no es válido.")
                allocation_payload = []
                for part in sorted(allocation_data, key=lambda value: value["position"]):
                    if not isinstance(part, dict) or set(part) != {"category", "amount", "position"}:
                        raise ValueError("Una partida portable no es válida.")
                    category_ref = part["category"]
                    allocation_category = categories.get(category_ref) if category_ref else None
                    if category_ref and not allocation_category:
                        raise ValueError("No se encontró la categoría de una partida portable.")
                    allocation_payload.append({
                        "category_id": allocation_category.pk if allocation_category else None,
                        "amount": part["amount"],
                    })
                if len(allocation_payload) > 1 and category:
                    raise ValueError("Un movimiento portable repartido no debe declarar una categoría legacy.")
                try:
                    normalize_allocation_payload(
                        allocation_payload,
                        kind=transaction.kind,
                        total=transaction.amount,
                    )
                except TransactionAllocationError as exc:
                    raise ValueError("Las partidas de un movimiento portable no son válidas.") from exc
                replace_transaction_allocations(transaction, allocation_payload)
                restored_allocations += len(allocation_payload) if len(allocation_payload) > 1 else 0
            transactions[item["id"]] = transaction
        for item in data.get("transactions", []):
            if item.get("refund_for"):
                transaction, refund = transactions[item["id"]], transactions.get(item["refund_for"])
                if not refund: raise ValueError("Movimiento de reembolso no encontrado.")
                transaction.refund_for = refund; transaction.save()
        for item in data.get("reconciliation_snapshots", []):
            account = accounts.get(item.get("account"))
            if not account:
                raise ValueError("Cuenta de conciliación no encontrada en el export.")
            ReconciliationSnapshot.objects.create(
                account=account,
                date=date.fromisoformat(item["date"]),
                statement_balance=item["statement_balance"],
                ledger_balance=item["ledger_balance"],
                difference=item["difference"],
                status=item["status"],
            )
        for item in data.get("monthly_closes", []):
            MonthlyClose.objects.create(
                month=date.fromisoformat(item["month"]),
                basis=item["basis"],
                version=item["version"],
                status_at_close=item["status_at_close"],
                origin=MonthlyClose.Origin.PORTABLE_ARCHIVE,
                source_digest=item["source_digest"],
                idempotency_key=item["idempotency_key"],
                request_digest=item["request_digest"],
                report=item.get("report", {}),
                accounts=item.get("accounts", []),
                issues=item.get("issues", []),
                declarations=item.get("declarations", []),
                correction_reason=item.get("correction_reason", ""),
                created_at=datetime.fromisoformat(item["created_at"]) if item.get("created_at") else timezone.now(),
            )
        if data.get("version") in {3, 4, 5}:
            legacy_goal = data.get("legacy_savings_goal")
            if legacy_goal is not None:
                if not isinstance(legacy_goal, dict) or type(legacy_goal.get("active")) is not bool:
                    raise ValueError("Configuración legacy de ahorro no válida.")
                goal = SavingsGoal(
                    percentage=legacy_goal.get("percentage"),
                    minimum=legacy_goal.get("minimum"),
                    active=legacy_goal["active"],
                )
                try:
                    goal.full_clean()
                except ValidationError as exc:
                    raise ValueError("Configuración legacy de ahorro no válida.") from exc
                goal.save()
                restored_legacy_goal = True

            objective_data = data.get("savings_objectives", [])
            if not isinstance(objective_data, list):
                raise ValueError("La lista de metas de ahorro no es válida.")
            for item in objective_data:
                if not isinstance(item, dict) or type(item.get("archived")) is not bool:
                    raise ValueError("Una meta de ahorro portable no es válida.")
                objective_rule = recurring_rules.get(item.get("recurring_rule")) if data.get("version") == 5 and item.get("recurring_rule") else None
                if objective_rule and (objective_rule.kind != Category.Kind.EXPENSE or objective_rule.frequency != RecurringRule.Frequency.YEARLY):
                    raise ValueError("Una meta portable solo puede vincularse a una regla anual de gasto.")
                objective = SavingsObjective(
                    name=item.get("name"),
                    target_amount=item.get("target_amount"),
                    target_date=item.get("target_date"),
                    priority=item.get("priority"),
                    assigned_amount=item.get("assigned_amount"),
                    archived=item["archived"],
                    recurring_rule=objective_rule,
                )
                try:
                    objective.full_clean(validate_unique=False)
                except ValidationError as exc:
                    raise ValueError("Una meta de ahorro portable no es válida.") from exc
                if data.get("version") == 5 and item.get("recurring_rule") and objective.recurring_rule_id is None:
                    raise ValueError("No se encontró la regla anual de la meta portable.")
                if objective.recurring_rule_id and SavingsObjective.objects.filter(recurring_rule_id=objective.recurring_rule_id).exists():
                    raise ValueError("Una regla anual portable solo puede vincularse a una meta.")
                if data.get("version") == 5:
                    objective_ref = item.get("id")
                    if not isinstance(objective_ref, str) or objective_ref in restored_objective_refs:
                        raise ValueError("El identificador portable de la meta no es válido.")
                    restored_objective_refs[objective_ref] = objective
                objective.save()
                restored_objectives.append(objective.pk)
            for occurrence_ref, occurrence in recurring_occurrences.items():
                objective_ref = reserve_objective_refs.get(occurrence_ref)
                objective = restored_objective_refs.get(objective_ref) if objective_ref else None
                consumed = reserve_consumed_values[occurrence_ref]
                if (objective_ref and objective is None) or (consumed and objective is None):
                    raise ValueError("No se encontró el objetivo de una reserva anual consumida.")
                if objective and objective.recurring_rule_id not in (None, occurrence.rule_id):
                    raise ValueError("El vínculo portable entre reserva, ocurrencia y meta no es válido.")
                occurrence.reserve_objective = objective
                occurrence.reserve_consumed_amount = consumed
                try:
                    occurrence.full_clean(validate_unique=False)
                except ValidationError as exc:
                    raise ValueError("Una ocurrencia de reserva anual portable no es válida.") from exc
                if occurrence.reserve_consumed_amount and occurrence.status != RecurringOccurrence.Status.CONFIRMED:
                    raise ValueError("Una reserva consumida requiere una ocurrencia confirmada.")
                occurrence.save(update_fields=["reserve_objective", "reserve_consumed_amount"])
            for occurrence in recurring_occurrences.values():
                movement = recurring_transactions.get(occurrence.pk)
                if occurrence.status == RecurringOccurrence.Status.CONFIRMED:
                    if movement is not None:
                        # Newly created Django instances still hold serialized strings until reloaded.
                        movement.refresh_from_db(fields=["amount", "date", "archived", "transfer_group", "kind"])
                    if (movement is None or movement.archived or movement.transfer_group or movement.amount != occurrence.amount
                            or abs((movement.date - occurrence.due_date).days) > 7
                            or (occurrence.reserve_consumed_amount > 0 and movement.kind != Transaction.Kind.EXPENSE)):
                        raise ValueError("Una ocurrencia confirmada debe enlazar su único pago compatible.")
                elif movement is not None:
                    raise ValueError("Solo una ocurrencia confirmada puede enlazarse a un pago portable.")
    result = {"accounts": len(accounts), "categories": len(categories), "transactions": len(transactions)}
    if data.get("version") in {3, 4, 5}:
        result["legacy_savings_goal"] = int(restored_legacy_goal)
        result["savings_objectives"] = len(restored_objectives)
    if data.get("version") in {4, 5}:
        result["transaction_allocations"] = restored_allocations
    return result
