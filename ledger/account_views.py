"""Account and reconciliation API boundary."""

from decimal import Decimal, InvalidOperation

from django.db.models import Sum
from django.db.models.deletion import ProtectedError
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.views.decorators.http import require_http_methods

from .api_helpers import api_json_body
from .api_serializers import (
    api_account,
    api_connection,
    api_date,
    api_datetime,
    api_errors,
    api_money,
    api_transaction,
)
from .banking_client import banking_configured
from .forms import AccountForm
from .reconciliation import reconciliation_ledger_balance
from .models import (
    Account,
    BankConnection,
    BankTransaction,
    ImportRow,
    ReconciliationSnapshot,
    Transaction,
)


@require_http_methods(["GET", "POST"])
def api_accounts(request):
    if request.method == "POST":
        try:
            payload = api_json_body(request)
        except ValueError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=400)
        form = AccountForm(payload)
        if not form.is_valid():
            return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
        account = form.save()
        return JsonResponse({"ok": True, "account": api_account(account)}, status=201)
    return JsonResponse(
        {
            "accounts": [api_account(account) for account in Account.objects.select_related("bank_link")],
            "connections": [api_connection(connection) for connection in BankConnection.objects.prefetch_related("bank_accounts__account")],
            "banking_configured": banking_configured(),
        }
    )


@require_http_methods(["GET", "PATCH", "DELETE"])
def api_account_detail(request, pk):
    account = get_object_or_404(Account.objects.select_related("bank_link__connection"), pk=pk)
    if request.method == "GET":
        today = timezone.localdate()
        period_start = today.replace(day=1)
        movements = (
            Transaction.objects.filter(account=account, archived=False)
            .select_related("account", "category", "category__parent", "refund_for")
            .prefetch_related("tags", "attachments", "allocations__category", "allocations__category__parent")
        )
        period = movements.filter(date__gte=period_start, date__lte=today, transfer_group__isnull=True)
        income = period.filter(kind=Transaction.Kind.INCOME).aggregate(total=Sum("amount"))["total"] or Decimal("0")
        expense = period.filter(kind=Transaction.Kind.EXPENSE).aggregate(total=Sum("amount"))["total"] or Decimal("0")
        link = getattr(account, "bank_link", None)
        return JsonResponse(
            {
                "account": api_account(account),
                "period": {"start": api_date(period_start), "end": api_date(today), "income": api_money(income), "expense": api_money(expense)},
                "recent": [api_transaction(movement) for movement in movements.order_by("-date", "-created_at")[:10]],
                "connection": api_connection(link.connection) if link else None,
                "latest_reconciliation": api_reconciliation_snapshot(account.reconciliation_snapshots.first()),
            }
        )
    if request.method == "DELETE":
        account_pk = account.pk
        try:
            account.delete()
        except ProtectedError:
            return JsonResponse(
                {
                    "ok": False,
                    "error": "No se puede eliminar la cuenta porque tiene movimientos, importaciones, reglas o una conexión bancaria asociada.",
                },
                status=400,
            )
        return JsonResponse({"ok": True, "removed": [account_pk], "removed_type": "account", "message": "Cuenta eliminada."})
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    current = {
        "name": account.name,
        "kind": account.kind,
        "opening_balance": account.opening_balance,
        "color": account.color,
        "active": account.active,
    }
    current.update(payload)
    form = AccountForm(current, instance=account)
    if not form.is_valid():
        return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
    account = form.save()
    return JsonResponse({"ok": True, "account": api_account(account)})


def api_reconciliation_snapshot(snapshot):
    if snapshot is None:
        return None
    current_ledger_balance = reconciliation_ledger_balance(snapshot.account, snapshot.date)
    ledger_change = current_ledger_balance - snapshot.ledger_balance
    stale = ledger_change != 0
    pending_bank = BankTransaction.objects.filter(bank_account__account=snapshot.account, booking_date__lte=snapshot.date, status=BankTransaction.Status.PENDING)
    pending_imports = ImportRow.objects.filter(batch__account=snapshot.account, date__lte=snapshot.date, status=ImportRow.Status.PENDING)
    diagnosis = {
        "pending_bank": pending_bank.count(),
        "pending_imports": pending_imports.count(),
        "possible_duplicates": pending_bank.filter(possible_duplicate=True).count() + pending_imports.filter(possible_duplicate=True).count(),
    }
    return {
        "id": snapshot.pk,
        "date": api_date(snapshot.date),
        "statement_balance": api_money(snapshot.statement_balance),
        "ledger_balance": api_money(snapshot.ledger_balance),
        "difference": api_money(snapshot.difference),
        "status": "stale" if stale else snapshot.status,
        "status_display": "Requiere nueva conciliación" if stale else snapshot.get_status_display(),
        "current_ledger_balance": api_money(current_ledger_balance),
        "ledger_change": api_money(ledger_change),
        "stale": stale,
        "diagnosis": diagnosis,
        "created_at": api_datetime(snapshot.created_at),
    }


@require_http_methods(["GET", "POST"])
def api_account_reconciliations(request, pk):
    account = get_object_or_404(Account, pk=pk)
    if request.method == "GET":
        snapshots = account.reconciliation_snapshots.all()[:12]
        return JsonResponse({"snapshots": [api_reconciliation_snapshot(snapshot) for snapshot in snapshots]})
    try:
        payload = api_json_body(request)
        statement_date = parse_date(str(payload.get("date") or ""))
        statement_balance = Decimal(str(payload.get("statement_balance") or ""))
    except (ValueError, InvalidOperation):
        return JsonResponse({"ok": False, "error": "Indica una fecha y un saldo de extracto válidos."}, status=400)
    if statement_date is None or statement_date > timezone.localdate():
        return JsonResponse({"ok": False, "error": "La fecha de extracto debe ser hoy o anterior."}, status=400)
    max_money = Decimal("999999999999.99")
    if (
        not statement_balance.is_finite()
        or statement_balance.as_tuple().exponent < -2
        or abs(statement_balance) > max_money
    ):
        return JsonResponse({"ok": False, "error": "Indica un saldo de extracto válido con un máximo de dos decimales."}, status=400)
    ledger_balance = reconciliation_ledger_balance(account, statement_date)
    difference = statement_balance - ledger_balance
    status = ReconciliationSnapshot.Status.RECONCILED if difference == 0 else ReconciliationSnapshot.Status.DIFFERENCE
    snapshot = ReconciliationSnapshot.objects.create(account=account, date=statement_date, statement_balance=statement_balance, ledger_balance=ledger_balance, difference=difference, status=status)
    return JsonResponse({"ok": True, "snapshot": api_reconciliation_snapshot(snapshot)}, status=201)
