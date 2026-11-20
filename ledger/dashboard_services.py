"""Dashboard-only signals and review queue builders."""

from collections import defaultdict
from decimal import Decimal

from django.db.models import Count, DateTimeField, Max, Min
from django.db.models.functions import Lower, TruncMonth
from django.utils import timezone

from .models import (
    Account,
    BankAccount,
    BankConnection,
    BankTransaction,
    Category,
    ImportBatch,
    ImportRow,
    RecurringRule,
    SavingsObjective,
    Transaction,
)
from .services import (
    ZERO,
    analytics_transactions,
    build_projection_summary,
    category_totals,
    detected_subscriptions,
    median_decimal,
    month_bounds,
    recurring_description_stats,
    signed_pending_amount,
    transaction_amount_in_reporting_basis,
    transaction_totals,
)
from .subscription_reviews import subscription_review_context, subscription_review_map


def attention_signals(
    limit=None,
    basis="analytics",
    *,
    totals=None,
    projection=None,
    subscriptions=None,
    current_category_rows=None,
):
    current_start, current_end = month_bounds()
    totals = totals if totals is not None else transaction_totals(current_start, current_end, basis=basis)
    projection = projection if projection is not None else build_projection_summary(current_start, basis=basis)
    signals = []

    for item in projection["category_watchlist"]:
        signals.append(
            {
                "title": "Subida por categoría",
                "label": item["label"],
                "value": item["difference"],
                "value_kind": "money",
                "detail": {
                    "kind": "projection_vs_median",
                    "projected": item["projected"],
                    "baseline": item["baseline"],
                },
                "filters": item["filters"],
                "severity": item["difference"],
            }
        )

    history_queryset = analytics_transactions(basis=basis).filter(
        kind__in=[Transaction.Kind.INCOME, Transaction.Kind.EXPENSE]
    ).select_related("account", "category").prefetch_related("allocations__category", "allocations__category__parent")
    current_rows = list(history_queryset.filter(date__range=(current_start, current_end)).order_by("-date", "-pk"))
    current_rows.sort(key=lambda movement: transaction_amount_in_reporting_basis(movement, basis), reverse=True)
    current_descriptions = {movement.description.lower() for movement in current_rows if not movement.is_refund}
    historical_amounts = defaultdict(list)
    if current_descriptions:
        historical_rows = list(history_queryset.annotate(_normalized_description=Lower("description")).filter(
            date__lt=current_start,
            _normalized_description__in=current_descriptions,
        ))
        for movement in historical_rows:
            if movement.kind == Transaction.Kind.INCOME and movement.refund_for_id:
                continue
            amount = transaction_amount_in_reporting_basis(movement, basis)
            if amount > ZERO:
                historical_amounts[(movement.kind, movement.description.lower())].append(amount)
    for movement in current_rows:
        if movement.is_refund:
            continue
        previous = historical_amounts[(movement.kind, movement.description.lower())]
        if len(previous) < 5:
            continue
        baseline = median_decimal(previous)
        current_amount = transaction_amount_in_reporting_basis(movement, basis)
        if baseline and current_amount >= baseline * Decimal("1.75") and current_amount - baseline >= Decimal("25"):
            signals.append(
                {
                    "title": "Movimiento inusual",
                    "label": movement.description,
                    "value": current_amount,
                    "value_kind": "money",
                    "detail": {"kind": "above_historical_median", "baseline": baseline},
                    "filters": {"description": movement.description, "kind": movement.kind, "analytics": "included"},
                    "severity": current_amount - baseline,
                }
            )
            break

    subscription_rows = subscriptions if subscriptions is not None else detected_subscriptions(basis=basis)
    subscription_reviews = subscription_review_map(subscription_rows)
    for subscription in subscription_rows:
        review = subscription_reviews.get((subscription["account"].pk, subscription["normalized_description"]))
        review_context = subscription_review_context(subscription, review)
        if review_context["status"] != "pending" or subscription["exceptional_charge"]:
            continue
        previous_median = subscription["previous_median"] or subscription["median_amount"]
        latest_amount = subscription["latest_amount"]
        if (
            latest_amount > previous_median
            and previous_median
            and latest_amount - previous_median >= Decimal("2")
            and latest_amount / previous_median > Decimal("1.10")
            and subscription["last_date"] >= current_start
        ):
            signals.append(
                {
                    "title": "Suscripción encarecida",
                    "label": subscription["description"],
                    "value": latest_amount,
                    "value_kind": "money",
                    "detail": {
                        "kind": "previous_median",
                        "baseline": previous_median,
                        "latest_amount": latest_amount,
                        "date": subscription["last_date"].isoformat(),
                    },
                    "filters": subscription["filters"],
                    "severity": latest_amount - previous_median,
                }
            )

    income_groups, months_window = recurring_description_stats(Category.Kind.INCOME, basis=basis, months=6)
    today = timezone.localdate()
    for data in income_groups.values():
        present_months = sum(1 for month in months_window[:-1] if month in data["months"])
        if present_months < 4:
            continue
        average_day = int(round(sum(data["days"]) / len(data["days"]))) if data["days"] else 1
        if current_start in data["months"] or today.day <= average_day + 7:
            continue
        signals.append(
            {
                "title": "Cobro recurrente ausente",
                "label": data["description"],
                "value": f"Día habitual {average_day}",
                "value_kind": "text",
                "detail": {
                    "kind": "text",
                    "text": "Solía aparecer de forma recurrente y este mes aún no ha entrado.",
                },
                "filters": {"description": data["description"], "kind": Transaction.Kind.INCOME, "analytics": "included"},
                "severity": Decimal("60"),
            }
        )

    category_rows = (
        current_category_rows
        if current_category_rows is not None
        else category_totals(current_start, current_end, basis=basis)
    )
    generic = next((item for item in category_rows if (item["label"] or "").lower() == "otros gastos"), None)
    if generic and totals["expense"] and generic["total"] / totals["expense"] > Decimal("0.20"):
        signals.append(
            {
                "title": "Categoría demasiado genérica",
                "label": "Otros gastos",
                "value": generic["total"],
                "value_kind": "money",
                "detail": {
                    "kind": "text",
                    "text": "Concentra más del 20% de tu gasto del mes. Merece recategorización.",
                },
                "filters": {
                    "category": generic["category_id"],
                    "kind": Transaction.Kind.EXPENSE,
                    "analytics": "included",
                },
                "severity": generic["total"],
            }
        )

    signals.sort(key=lambda item: item["severity"], reverse=True)
    return signals[:limit] if limit else signals


def dashboard_review_summary():
    bank_pending = BankTransaction.objects.filter(status=BankTransaction.Status.PENDING)
    csv_pending = ImportRow.objects.filter(status=ImportRow.Status.PENDING)
    connections = BankConnection.objects.all()
    last_synced_at = connections.aggregate(last=Max("last_synced_at", output_field=DateTimeField()))["last"]
    last_imported_bank_date = BankTransaction.objects.filter(status=BankTransaction.Status.IMPORTED).aggregate(
        last=Max("booking_date")
    )["last"]
    bank_pending_count = bank_pending.count()
    csv_pending_count = csv_pending.count()
    bank_pending_amount = signed_pending_amount(bank_pending)
    csv_pending_amount = signed_pending_amount(csv_pending)
    return {
        "bank_pending_count": bank_pending_count,
        "csv_pending_count": csv_pending_count,
        "total_pending_count": bank_pending_count + csv_pending_count,
        "bank_pending_amount": bank_pending_amount,
        "csv_pending_amount": csv_pending_amount,
        "pending_net_amount": bank_pending_amount + csv_pending_amount,
        "last_bank_sync_at": last_synced_at,
        "last_bank_imported_date": last_imported_bank_date,
        "bank_connections_active": connections.filter(status=BankConnection.Status.AUTHORIZED).count(),
        "bank_connections_with_errors": connections.exclude(last_error="").count(),
        "bank_connections_needing_reconnect": connections.filter(
            status=BankConnection.Status.NEEDS_RECONNECT
        ).count(),
        "bank_accounts_linked": BankAccount.objects.count(),
        "has_pending_review": (bank_pending_count + csv_pending_count) > 0,
        "pending_import_batches": ImportBatch.objects.filter(status=ImportBatch.Status.REVIEW).count(),
    }


def dashboard_activation_summary(review_summary, active_accounts):
    """Derive first-run progress from financial records; never persist onboarding flags."""
    first_account_created_at = Account.objects.aggregate(first=Min("created_at"))["first"]
    transaction_state = Transaction.objects.filter(
        kind__in=[Transaction.Kind.INCOME, Transaction.Kind.EXPENSE]
    ).aggregate(
        first=Min("created_at"),
        activity_months=Count(TruncMonth("date"), distinct=True),
    )
    first_movement = transaction_state["first"]
    elapsed_seconds = None
    if first_account_created_at and first_movement:
        elapsed_seconds = max(0, int((first_movement - first_account_created_at).total_seconds()))
    activity_months = int(transaction_state["activity_months"] or 0)
    return {
        "has_active_account": bool(active_accounts),
        "has_reviewed_movement": first_movement is not None,
        "pending_review_count": int(review_summary.get("total_pending_count") or 0),
        "has_savings_objective": SavingsObjective.objects.exists(),
        "distinct_activity_months": activity_months,
        "is_mature": activity_months >= 3,
        "time_to_first_reviewed_movement_seconds": elapsed_seconds,
    }


def _api_decimal(value):
    return float(value or ZERO)


def dashboard_review_queue():
    """Return one stable, actionable queue derived from existing review data."""
    today = timezone.localdate()
    queue = []

    def add(key, priority, title, detail, href, impact=ZERO):
        queue.append(
            {
                "id": key,
                "type": key.split(":", 1)[0],
                "priority": priority,
                "title": title,
                "detail": detail,
                "impact": _api_decimal(impact),
                "href": href,
            }
        )

    pending_csv = ImportRow.objects.filter(status=ImportRow.Status.PENDING)
    pending_bank = BankTransaction.objects.filter(status=BankTransaction.Status.PENDING)
    duplicate_csv = pending_csv.filter(possible_duplicate=True).count()
    duplicate_bank = pending_bank.filter(possible_duplicate=True).count()
    if pending_csv.exists():
        add("csv:pending", 10, "Importaciones CSV pendientes", f"{pending_csv.count()} filas esperan confirmación.", "/?tab=review")
    if pending_bank.exists():
        add("bank:pending", 10, "Movimientos bancarios pendientes", f"{pending_bank.count()} movimientos esperan confirmación.", "/?tab=review")
    if duplicate_csv or duplicate_bank:
        add("duplicates:pending", 20, "Duplicados sospechosos", f"{duplicate_csv + duplicate_bank} filas requieren una decisión.", "/?tab=review")

    uncategorized = Transaction.objects.filter(
        archived=False,
        transfer_group__isnull=True,
        kind=Transaction.Kind.EXPENSE,
        category__isnull=True,
    ).count()
    if uncategorized:
        add("transactions:uncategorized", 30, "Gastos sin categoría", f"{uncategorized} movimientos no están distribuidos.", "/?tab=transactions&category_family=uncategorized")

    expired = RecurringRule.objects.filter(active=True, end_date__lt=today).count()
    ambiguous = RecurringRule.objects.filter(active=True, category__isnull=True).count()
    if expired:
        add("recurring:expired", 35, "Recurrentes vencidos", f"{expired} reglas tienen una fecha final pasada.", "/?tab=planning")
    if ambiguous:
        add("recurring:ambiguous", 35, "Recurrentes incompletos", f"{ambiguous} reglas necesitan categoría.", "/?tab=planning")

    errors = BankConnection.objects.exclude(last_error="").count()
    reconnects = BankConnection.objects.filter(status=BankConnection.Status.NEEDS_RECONNECT).count()
    if errors or reconnects:
        add("bank:connection", 5, "Conexiones bancarias con incidencia", f"{errors + reconnects} conexiones requieren atención.", "/?tab=review")
    return sorted(queue, key=lambda item: (item["priority"], item["id"]))
