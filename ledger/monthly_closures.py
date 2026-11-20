from __future__ import annotations

import hashlib
import json
import re
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, OperationalError, transaction
from django.db.models import Case, DecimalField, F, Q, Sum, When
from django.utils import timezone

from .models import (
    Account,
    BankConnection,
    BankTransaction,
    Category,
    ImportRow,
    MonthlyClose,
    ReconciliationSnapshot,
    Transaction,
)
from .reconciliation import reconciliation_ledger_balance
from .services import parse_month_date
from .statistics import StatisticsRangeError, month_end, statistics_month_report
from .transaction_allocations import allocation_rows_for

MONTH_PATTERN = re.compile(r"^\d{4}-\d{2}$")
MAX_REASON_LENGTH = 1000


class MonthlyCloseConflict(ValueError):
    pass


def parse_month(value):
    if not isinstance(value, str) or not MONTH_PATTERN.fullmatch(value):
        raise ValueError("Indica el mes con el formato YYYY-MM.")
    month = parse_month_date(value)
    if month is None:
        raise ValueError("El mes no es válido.")
    cutoff = month_end(month)
    if cutoff >= timezone.localdate():
        raise ValueError("Solo se pueden cerrar meses completos ya finalizados.")
    return month, cutoff


def _money(value):
    return format(Decimal(value), ".2f")


def _json_value(value):
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return value


def _digest(value):
    serialized = json.dumps(_json_value(value), cls=DjangoJSONEncoder, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _category_signature(category):
    if not category:
        return None
    path = []
    current = category
    while current:
        path.append({
            "name": current.name,
            "kind": current.kind,
            "active": current.active,
            "exclude_from_analytics": current.exclude_from_analytics,
        })
        current = current.parent if current.parent_id else None
    return list(reversed(path))


def _transaction_signature(movement):
    refund_target = movement.refund_for
    signature = {
        "account": movement.account.name,
        "date": movement.date.isoformat(),
        "kind": movement.kind,
        "amount": _money(movement.amount),
        "description": movement.description,
        "category": _category_signature(movement.category),
        "source": movement.source,
        "refund_for": ({
            "account": refund_target.account.name,
            "date": refund_target.date.isoformat(),
            "kind": refund_target.kind,
            "amount": _money(refund_target.amount),
            "description": refund_target.description,
        } if refund_target else None),
        "transfer_group": str(movement.transfer_group) if movement.transfer_group else None,
    }
    rows = allocation_rows_for(movement)
    if rows:
        signature["allocations"] = [
            {
                "category": _category_signature(row.category),
                "amount": _money(row.amount),
                "position": row.position,
            }
            for row in rows
        ]
    return signature


def _report_snapshot(month, cutoff, basis):
    raw = statistics_month_report(month.year, month.month, month, cutoff, basis)
    categories = []
    for family in raw["categories"]:
        categories.append({
            "family_name": family["family_name"],
            "gross_expense": _money(family["gross_expense"]),
            "refunds_applied": _money(family["refunds_applied"]),
            "net_expense": _money(family["net_expense"]),
            "subcategories": [{
                "name": row["name"],
                "gross_expense": _money(row["gross_expense"]),
                "refunds_applied": _money(row["refunds_applied"]),
                "net_expense": _money(row["net_expense"]),
            } for row in family["subcategories"]],
        })
    return {
        "scope": {
            "month": month.strftime("%Y-%m"),
            "date_from": month.isoformat(),
            "date_to": cutoff.isoformat(),
            "cutoff": cutoff.isoformat(),
            "basis": basis,
            "basis_label": raw["scope"]["basis_label"],
        },
        "activity_status": raw["activity_status"],
        "summary": _json_value(raw["summary"]),
        "daily_series": [{
            "date": row["date"].isoformat(),
            **_json_value({key: value for key, value in row.items() if key != "date"}),
        } for row in raw["daily_series"]],
        "categories": categories,
    }


def _account_and_cut_data(month, cutoff):
    historical_transactions = Transaction.objects.filter(archived=False, date__lte=cutoff)
    month_expenses = Transaction.objects.filter(
        archived=False,
        kind=Transaction.Kind.EXPENSE,
        date__range=(month, cutoff),
    ).values("pk")
    late_refunds = Transaction.objects.filter(
        archived=False,
        kind=Transaction.Kind.INCOME,
        refund_for_id__in=month_expenses,
    )
    account_ids = set(Account.objects.filter(created_at__date__lte=cutoff).values_list("pk", flat=True))
    account_ids.update(historical_transactions.values_list("account_id", flat=True))
    account_ids.update(late_refunds.values_list("account_id", flat=True))
    account_ids.update(BankTransaction.objects.filter(
        status=BankTransaction.Status.PENDING,
        booking_date__lte=cutoff,
    ).values_list("bank_account__account_id", flat=True))
    account_ids.update(ImportRow.objects.filter(
        status=ImportRow.Status.PENDING,
        date__lte=cutoff,
    ).values_list("batch__account_id", flat=True))
    account_ids.update(ReconciliationSnapshot.objects.filter(date__lte=cutoff).values_list("account_id", flat=True))
    accounts = list(
        Account.objects.filter(pk__in=account_ids)
        .select_related("bank_link__connection")
        .order_by("name", "pk")
    )
    account_ids = [account.pk for account in accounts]
    balance_by_account = {account.pk: account.opening_balance for account in accounts}
    historical_balances = Transaction.objects.filter(
        account_id__in=account_ids,
        archived=False,
        date__lte=cutoff,
    ).order_by().values("account_id").annotate(
        total=Sum(Case(
            When(kind__in=(Transaction.Kind.EXPENSE, Transaction.Kind.TRANSFER_OUT), then=-F("amount")),
            default=F("amount"),
            output_field=DecimalField(max_digits=14, decimal_places=2),
        )),
    ).values_list("account_id", "total")
    for account_id, total in historical_balances:
        balance_by_account[account_id] += total or Decimal("0")
    snapshots = list(
        ReconciliationSnapshot.objects.filter(account_id__in=account_ids, date__lte=cutoff)
        .select_related("account")
        .order_by("account_id", "date", "created_at", "pk")
    )
    history_by_account = defaultdict(list)
    latest_by_account = {}
    for snapshot in snapshots:
        history_by_account[snapshot.account_id].append(snapshot)
        latest_by_account[snapshot.account_id] = snapshot

    checks = []
    issues = []
    for account in accounts:
        ledger_balance_at_cut = balance_by_account[account.pk]
        snapshot = latest_by_account.get(account.pk)
        bank_link = getattr(account, "bank_link", None)
        connection = bank_link.connection if bank_link else None
        bank_context = None if not bank_link else {
            "bank_name": connection.bank_name,
            "connection_status": connection.status,
            "sync_status": connection.sync_status,
            "last_synced_at": _json_value(connection.last_synced_at),
            "currency": bank_link.currency,
            "balance": _money(bank_link.remote_balance) if bank_link.remote_balance is not None else None,
            "balance_type": bank_link.remote_balance_type,
            "balance_currency": bank_link.remote_balance_currency,
            "balance_reference_date": _json_value(bank_link.remote_balance_reference_date),
            "balance_provenance_updated_at": _json_value(bank_link.balance_provenance_updated_at),
        }
        reasons = []
        snapshot_values = None
        current_ledger_balance = None
        if snapshot is None:
            reasons.append("missing_month_end_cut")
            current_ledger_balance = ledger_balance_at_cut
        else:
            current_ledger_balance = ledger_balance_at_cut if snapshot.date == cutoff else reconciliation_ledger_balance(account, snapshot.date)
            stale = current_ledger_balance != snapshot.ledger_balance
            if snapshot.date != cutoff:
                reasons.append("cutoff_not_month_end")
            if snapshot.status != ReconciliationSnapshot.Status.RECONCILED or snapshot.difference != 0:
                reasons.append("statement_difference")
            if stale:
                reasons.append("ledger_changed_after_cut")
            snapshot_values = {
                "date": snapshot.date.isoformat(),
                "statement_balance": _money(snapshot.statement_balance),
                "ledger_balance_at_reconciliation": _money(snapshot.ledger_balance),
                "current_ledger_balance_at_cut": _money(current_ledger_balance),
                "difference": _money(snapshot.difference),
                "status": snapshot.status,
                "stale": stale,
            }
        if connection and (
            connection.status != BankConnection.Status.AUTHORIZED
            or connection.sync_status != BankConnection.SyncStatus.IDLE
            or connection.last_synced_at is None
        ):
            reasons.append("bank_connection_attention")
        check = {
            "account_name": account.name,
            "account_kind": account.kind,
            "created_at": _json_value(account.created_at),
            "created_after_cutoff": account.created_at.date() > cutoff,
            "opening_balance": _money(account.opening_balance),
            "ledger_balance_at_cut": _money(ledger_balance_at_cut),
            "active_at_capture": account.active,
            "reconciliation": snapshot_values,
            "reconciliation_history": [{
                "date": item.date.isoformat(),
                "statement_balance": _money(item.statement_balance),
                "ledger_balance": _money(item.ledger_balance),
                "difference": _money(item.difference),
                "status": item.status,
            } for item in history_by_account[account.pk]],
            "bank_source": bank_context,
            "issue_codes": reasons,
        }
        checks.append(check)
        if reasons:
            issues.append({
                "key": f"account:{account.pk}:reconciliation",
                "type": "account_reconciliation",
                "title": f"Corte pendiente: {account.name}",
                "account_name": account.name,
                "description": "La cuenta no está reconciliada exactamente al fin del mes.",
                "details": {"reasons": reasons, "reconciliation": snapshot_values},
            })
    return accounts, checks, issues, history_by_account


def _pending_source_issues(cutoff):
    bank_rows = list(
        BankTransaction.objects.filter(status=BankTransaction.Status.PENDING, booking_date__lte=cutoff)
        .select_related("bank_account__account")
        .order_by("bank_account__account__name", "booking_date", "pk")
    )
    csv_rows = list(
        ImportRow.objects.filter(status=ImportRow.Status.PENDING, date__lte=cutoff)
        .select_related("batch__account", "batch")
        .order_by("batch__account__name", "date", "batch_id", "row_number", "pk")
    )
    bank_groups = defaultdict(list)
    csv_groups = defaultdict(list)
    for row in bank_rows:
        bank_groups[row.bank_account.account.name].append({
            "source_id": row.pk,
            "date": row.booking_date.isoformat(),
            "description": row.description,
            "amount": _money(row.amount),
            "kind": row.kind,
            "possible_duplicate": row.possible_duplicate,
            "possible_transfer": row.possible_transfer,
        })
    for row in csv_rows:
        csv_groups[row.batch.account.name].append({
            "source_id": row.pk,
            "filename": row.batch.filename,
            "row_number": row.row_number,
            "date": row.date.isoformat(),
            "description": row.description,
            "amount": _money(row.amount),
            "kind": row.kind,
            "possible_duplicate": row.possible_duplicate,
        })
    issues = []
    for account_name, rows in bank_groups.items():
        issues.append({
            "key": f"bank:{account_name}:pending",
            "type": "pending_bank",
            "title": f"Movimientos bancarios pendientes: {account_name}",
            "account_name": account_name,
            "description": f"Hay {len(rows)} movimientos bancarios pendientes hasta el corte.",
            "details": {"rows": rows},
        })
    for account_name, rows in csv_groups.items():
        issues.append({
            "key": f"csv:{account_name}:pending",
            "type": "pending_csv",
            "title": f"Filas CSV pendientes: {account_name}",
            "account_name": account_name,
            "description": f"Hay {len(rows)} filas CSV pendientes hasta el corte.",
            "details": {"rows": rows},
        })
    return bank_rows, csv_rows, issues


def _transfer_issues(cutoff):
    group_ids = list(
        Transaction.objects.filter(archived=False, transfer_group__isnull=False, date__lte=cutoff)
        .order_by()
        .values_list("transfer_group", flat=True)
        .distinct()
    )
    groups = defaultdict(list)
    rows = Transaction.objects.filter(archived=False, transfer_group__in=group_ids).select_related("account").order_by("transfer_group", "date", "pk")
    for row in rows:
        groups[row.transfer_group].append(row)
    issues = []
    signatures = []
    for group_id, legs in groups.items():
        leg_rows = [{
            "account_name": row.account.name,
            "date": row.date.isoformat(),
            "kind": row.kind,
            "amount": _money(row.amount),
            "description": row.description,
        } for row in legs]
        signatures.append({"legs": leg_rows})
        by_kind = {row.kind: row for row in legs}
        consistent = (
            len(legs) == 2
            and set(by_kind) == {Transaction.Kind.TRANSFER_IN, Transaction.Kind.TRANSFER_OUT}
            and by_kind[Transaction.Kind.TRANSFER_IN].amount == by_kind[Transaction.Kind.TRANSFER_OUT].amount
            and by_kind[Transaction.Kind.TRANSFER_IN].account_id != by_kind[Transaction.Kind.TRANSFER_OUT].account_id
        )
        if not consistent:
            issues.append({
                "key": f"transfer:{group_id}",
                "type": "transfer_inconsistent",
                "title": "Traspaso interno inconsistente",
                "description": "El grupo de traspaso no conserva dos piernas opuestas, simétricas y entre cuentas distintas.",
                "details": {"group_id": str(group_id), "legs": leg_rows},
            })
    signatures.sort(key=lambda item: json.dumps(item, sort_keys=True, ensure_ascii=False))
    return signatures, issues


def _financial_source_signatures(month, cutoff):
    month_expenses = Transaction.objects.filter(
        archived=False,
        kind=Transaction.Kind.EXPENSE,
        date__range=(month, cutoff),
    ).order_by().values("pk")
    rows = Transaction.objects.filter(archived=False).filter(
        Q(date__range=(month, cutoff), kind__in=(Transaction.Kind.INCOME, Transaction.Kind.EXPENSE))
        | Q(kind=Transaction.Kind.INCOME, refund_for_id__in=month_expenses)
    ).select_related(
        "account", "category", "category__parent", "refund_for", "refund_for__account", "refund_for__category", "refund_for__category__parent",
    ).prefetch_related("allocations__category", "allocations__category__parent")
    signatures = [_transaction_signature(row) for row in rows]
    signatures.sort(key=lambda item: json.dumps(item, sort_keys=True, ensure_ascii=False))
    return signatures


def build_monthly_close_preview(month_value, basis):
    month, cutoff = parse_month(month_value)
    if basis not in {MonthlyClose.Basis.ANALYTICS, MonthlyClose.Basis.ALL}:
        raise ValueError("La base debe ser analytics o all.")
    report = _report_snapshot(month, cutoff, basis)
    accounts, account_checks, issues, reconciliation_history = _account_and_cut_data(month, cutoff)
    bank_rows, csv_rows, pending_issues = _pending_source_issues(cutoff)
    transfer_signatures, transfer_issues = _transfer_issues(cutoff)
    issues.extend(pending_issues)
    issues.extend(transfer_issues)
    if report["activity_status"] == "unknown":
        issues.append({
            "key": f"coverage:{month:%Y-%m}:{basis}",
            "type": "coverage_unknown",
            "title": "Cobertura del mes desconocida",
            "description": "No hay movimientos reportables y no se puede demostrar que no haya fuentes pendientes fuera de la app.",
            "details": {"basis": basis, "month": month.strftime("%Y-%m")},
        })
    issues.sort(key=lambda item: (item.get("account_name", ""), item["type"], item["key"]))

    bank_signature = []
    for row in bank_rows:
        bank_signature.append({
            "account": row.bank_account.account.name,
            "date": row.booking_date.isoformat(),
            "description": row.description,
            "amount": _money(row.amount),
            "kind": row.kind,
            "currency": row.currency,
            "status": row.status,
            "possible_duplicate": row.possible_duplicate,
            "possible_transfer": row.possible_transfer,
        })
    bank_signature.sort(key=lambda item: json.dumps(item, sort_keys=True, ensure_ascii=False))
    csv_signature = []
    for row in csv_rows:
        csv_signature.append({
            "account": row.batch.account.name,
            "filename": row.batch.filename,
            "date": row.date.isoformat(),
            "row_number": row.row_number,
            "description": row.description,
            "amount": _money(row.amount),
            "kind": row.kind,
            "status": row.status,
            "possible_duplicate": row.possible_duplicate,
        })
    csv_signature.sort(key=lambda item: json.dumps(item, sort_keys=True, ensure_ascii=False))
    reconciliation_signatures = []
    for account_id, history in reconciliation_history.items():
        account = next((item for item in accounts if item.pk == account_id), None)
        if not account:
            continue
        reconciliation_signatures.extend({
            "account": account.name,
            "date": row.date.isoformat(),
            "statement_balance": _money(row.statement_balance),
            "ledger_balance": _money(row.ledger_balance),
            "difference": _money(row.difference),
            "status": row.status,
        } for row in history)
    reconciliation_signatures.sort(key=lambda item: json.dumps(item, sort_keys=True, ensure_ascii=False))
    account_signatures = [{
        "account_name": item["account_name"],
        "account_kind": item["account_kind"],
        "created_at": item["created_at"],
        "created_after_cutoff": item["created_after_cutoff"],
        "opening_balance": item["opening_balance"],
        "ledger_balance_at_cut": item["ledger_balance_at_cut"],
        "active_at_capture": item["active_at_capture"],
        "bank_source": item["bank_source"],
        "reconciliation": item["reconciliation"],
        "issue_codes": item["issue_codes"],
    } for item in account_checks]
    manifest = {
        "month": month.strftime("%Y-%m"),
        "cutoff": cutoff.isoformat(),
        "basis": basis,
        "accounts": account_signatures,
        "transactions": _financial_source_signatures(month, cutoff),
        "reconciliations": reconciliation_signatures,
        "pending_bank": bank_signature,
        "pending_csv": csv_signature,
        "transfer_groups": transfer_signatures,
        "report": report,
    }
    source_digest = _digest(manifest)
    return {
        "month": month.strftime("%Y-%m"),
        "cutoff": cutoff.isoformat(),
        "basis": basis,
        "source_digest": source_digest,
        "report": report,
        "accounts": account_checks,
        "issues": issues,
    }


def _normalize_declarations(raw):
    if not isinstance(raw, dict):
        raise ValueError("Las declaraciones deben asociar una clave de incidencia con su motivo.")
    declarations = {}
    for key, reason in raw.items():
        if not isinstance(key, str) or not key:
            raise ValueError("La clave de incidencia no es válida.")
        if not isinstance(reason, str) or not reason.strip() or len(reason.strip()) > MAX_REASON_LENGTH:
            raise ValueError("Cada incidencia requiere un motivo de hasta 1000 caracteres.")
        declarations[key] = reason.strip()
    return [{"issue_key": key, "reason": declarations[key]} for key in sorted(declarations)]


def _validate_declarations(declarations, issue_keys):
    for declaration in declarations:
        if declaration["issue_key"] not in issue_keys:
            raise ValueError("La declaración hace referencia a una incidencia que ya no existe.")
    missing = issue_keys - {declaration["issue_key"] for declaration in declarations}
    if missing:
        raise MonthlyCloseConflict("Declara o resuelve todas las incidencias materiales antes de cerrar el mes.")
    return declarations


def _request_digest(month, basis, source_digest, declarations, correction_reason):
    return _digest({
        "month": month,
        "basis": basis,
        "source_digest": source_digest,
        "declarations": declarations,
        "correction_reason": correction_reason,
    })


def create_monthly_close(*, month_value, basis, source_digest, idempotency_key, declarations, correction_reason=""):
    month, cutoff = parse_month(month_value)
    if basis not in {MonthlyClose.Basis.ANALYTICS, MonthlyClose.Basis.ALL}:
        raise ValueError("La base debe ser analytics o all.")
    try:
        idempotency_key = str(uuid.UUID(str(idempotency_key)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("El idempotency_key debe ser un UUID válido.") from exc
    if not isinstance(source_digest, str) or not re.fullmatch(r"[0-9a-f]{64}", source_digest):
        raise ValueError("La previsualización no contiene una huella válida.")
    if not isinstance(correction_reason, str) or len(correction_reason.strip()) > MAX_REASON_LENGTH:
        raise ValueError("El motivo de corrección debe tener como máximo 1000 caracteres.")
    normalized_declarations = _normalize_declarations(declarations)
    request_digest = _request_digest(month_value, basis, source_digest, normalized_declarations, correction_reason.strip())

    try:
        with transaction.atomic():
            previous_request = MonthlyClose.objects.filter(idempotency_key=idempotency_key).first()
            if previous_request:
                if previous_request.request_digest != request_digest:
                    raise MonthlyCloseConflict("La clave de idempotencia ya se usó con otro contenido.")
                return previous_request, False

            preview = build_monthly_close_preview(month_value, basis)
            if preview["source_digest"] != source_digest:
                raise MonthlyCloseConflict("Los datos cambiaron desde la previsualización. Actualiza el checklist y vuelve a revisar.")
            issue_keys = {item["key"] for item in preview["issues"]}
            normalized_declarations = _validate_declarations(normalized_declarations, issue_keys)
            latest_version = MonthlyClose.objects.filter(month=month, basis=basis).order_by("-version").first()
            if latest_version and not correction_reason.strip():
                raise ValueError("Indica el motivo de esta nueva versión del cierre.")
            if latest_version and latest_version.source_digest == preview["source_digest"]:
                raise MonthlyCloseConflict("No hay cambios en las fuentes que justifiquen una nueva versión del cierre.")
            request_digest = _request_digest(month_value, basis, source_digest, normalized_declarations, correction_reason.strip())
            status = MonthlyClose.Status.DECLARED if normalized_declarations else MonthlyClose.Status.CLEAN
            close = MonthlyClose.objects.create(
                month=month,
                basis=basis,
                version=(latest_version.version + 1) if latest_version else 1,
                status_at_close=status,
                origin=MonthlyClose.Origin.NATIVE,
                source_digest=source_digest,
                idempotency_key=idempotency_key,
                request_digest=request_digest,
                report=preview["report"],
                accounts=preview["accounts"],
                issues=preview["issues"],
                declarations=normalized_declarations,
                correction_reason=correction_reason.strip(),
            )
            return close, True
    except IntegrityError as exc:
        previous_request = MonthlyClose.objects.filter(idempotency_key=idempotency_key).first()
        if previous_request:
            if previous_request.request_digest == request_digest:
                return previous_request, False
            raise MonthlyCloseConflict("La clave de idempotencia ya se usó con otro contenido.") from exc
        raise MonthlyCloseConflict("Otra solicitud cerró este mes; actualiza el historial y vuelve a revisar.") from exc
    except OperationalError as exc:
        previous_request = MonthlyClose.objects.filter(idempotency_key=idempotency_key).first()
        if previous_request and previous_request.request_digest == request_digest:
            return previous_request, False
        raise MonthlyCloseConflict("El cierre compite con otra escritura; actualiza el checklist y reintenta.") from exc


def close_source_status(close, current_digest):
    latest_version = MonthlyClose.objects.filter(month=close.month, basis=close.basis).order_by("-version").values_list("version", flat=True).first()
    if close.version != latest_version:
        return "superseded"
    if close.origin == MonthlyClose.Origin.PORTABLE_ARCHIVE:
        return "unknown"
    if close.source_digest != current_digest:
        return "stale"
    return "current"
