"""Dashboard bootstrap, preferences, and snapshot API boundary."""

import json
import logging
from datetime import timedelta
from time import perf_counter

from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST, require_http_methods

from .api_helpers import api_json_body
from .api_serializers import (
    api_account,
    api_attention_signal,
    api_budget_item,
    api_category,
    api_connection,
    api_date,
    api_datetime,
    api_metrics,
    api_money,
    api_review,
    api_subscription,
    api_transaction,
    category_api_cache,
    category_catalog_queryset,
)
from .banking_client import banking_configured
from .dashboard_services import attention_signals, dashboard_activation_summary, dashboard_review_queue, dashboard_review_summary
from .models import Account, BankConnection, DashboardPreferences, MonthlyDashboardSnapshot, RecurringOccurrence, Transaction
from .services import (
    account_balance,
    account_balances,
    category_totals,
    dashboard_metrics,
    detected_subscriptions,
    month_bounds,
    monthly_category_totals,
    scheduled_pending_occurrences,
    shift_month,
    transaction_filters_url,
)
from .subscription_reviews import pending_subscription_candidates

logger = logging.getLogger(__name__)


@require_GET
def api_bootstrap(request):
    started_at = perf_counter()
    query_start = len(connection.queries)
    metrics = dashboard_metrics()
    metrics_at = perf_counter()
    review = dashboard_review_summary()
    review["has_banking_configured"] = banking_configured()
    shared_subscriptions = detected_subscriptions()
    shared_category_rows = category_totals(metrics["start"], metrics["end"])
    signals = attention_signals(
        limit=5,
        totals={"expense": metrics["expense"]},
        projection=metrics["projection"],
        subscriptions=shared_subscriptions,
        current_category_rows=shared_category_rows,
    )
    signals_at = perf_counter()
    for signal in signals:
        signal["url"] = transaction_filters_url(signal["filters"])
    account_list = list(Account.objects.filter(active=True))
    balance_cache = account_balances(account_list)
    accounts = [{"account": account, "balance": balance_cache[account.pk]} for account in account_list]
    budget_items = sorted(
        metrics["budgets"],
        key=lambda item: (0 if item["pace"] == "high" else 1, -item["actual_percent"], str(item["budget"].category)),
    )[:5]
    recent = list(
        Transaction.objects.filter(archived=False)
        .select_related("account", "category", "category__parent", "refund_for", "refund_for__category", "refund_for__category__parent")
        .prefetch_related("tags", "attachments", "allocations__category", "allocations__category__parent")[:8]
    )
    categories = list(category_catalog_queryset(active=True))
    category_cache = {category.pk: category for category in categories}
    recent_category_ids = {movement.category_id for movement in recent if movement.category_id}
    recent_category_ids.update(
        row.category_id
        for movement in recent
        for row in movement.allocations.all()
        if row.category_id
    )
    category_cache.update(category_api_cache(recent_category_ids - category_cache.keys()))
    preferences = dashboard_preferences_for(request)
    dashboard_data = dashboard_widgets_payload(
        metrics,
        review,
        accounts,
        budget_items,
        subscriptions=shared_subscriptions,
        current_category_rows=shared_category_rows,
        category_cache=category_cache,
        balance_cache=balance_cache,
    )
    activation = dashboard_activation_summary(review, account_list)
    dashboard_at = perf_counter()
    payload = {
            "csrf_token": get_token(request),
            "metrics": api_metrics(metrics),
            "review": api_review(review),
            "accounts": [api_account(item["account"], item["balance"]) for item in accounts],
            "categories": [api_category(category, category_cache=category_cache) for category in categories],
            "recent": [api_transaction(movement, category_cache=category_cache) for movement in recent],
            "budget_items": [api_budget_item(item, category_cache=category_cache) for item in budget_items],
            "signals": [api_attention_signal(signal) for signal in signals],
            "connections": [api_connection(connection) for connection in BankConnection.objects.prefetch_related("bank_accounts__account")],
            "preferences": serialize_dashboard_preferences(preferences),
            "dashboard": dashboard_data,
            "review_queue": dashboard_review_queue(),
            "activation": activation,
    }
    if settings.DEBUG:
        serialized_size = len(json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8"))
        logger.info(
            "bootstrap_diagnostics total_ms=%.1f metrics_ms=%.1f signals_ms=%.1f dashboard_ms=%.1f queries=%d bytes=%d",
            (perf_counter() - started_at) * 1000,
            (metrics_at - started_at) * 1000,
            (signals_at - metrics_at) * 1000,
            (dashboard_at - signals_at) * 1000,
            len(connection.queries) - query_start,
            serialized_size,
        )
    return JsonResponse(payload)


DEFAULT_DASHBOARD_WIDGET_ORDER = [
    "balance", "actions", "priority", "bank_health", "savings", "safe_spend", "budget_risk",
    "recurring_next", "refunds", "subscriptions", "accounts", "category_rise", "recent", "activation",
]


def dashboard_preferences_for(request, *, create=False):
    user = request.user if getattr(request, "user", None) and request.user.is_authenticated else None
    preferences = DashboardPreferences.objects.filter(user=user).first()
    if not preferences and create:
        preferences = DashboardPreferences.objects.create(user=user)
    return preferences


def serialize_dashboard_preferences(preferences):
    if preferences is None:
        return {
            "widget_order": DEFAULT_DASHBOARD_WIDGET_ORDER,
            "hidden_widgets": [],
            "density": "normal",
            "content_mode": "full",
            "created_at": "",
            "updated_at": "",
            "last_snapshot_month": "",
        }
    order = [item for item in preferences.widget_order if item in DEFAULT_DASHBOARD_WIDGET_ORDER]
    order += [item for item in DEFAULT_DASHBOARD_WIDGET_ORDER if item not in order]
    return {
        "widget_order": order,
        "hidden_widgets": [item for item in preferences.hidden_widgets if item in DEFAULT_DASHBOARD_WIDGET_ORDER],
        "density": preferences.density,
        "content_mode": preferences.content_mode,
        "created_at": api_datetime(preferences.created_at),
        "updated_at": api_datetime(preferences.updated_at),
        "last_snapshot_month": preferences.last_snapshot_month,
    }


def dashboard_widgets_payload(
    metrics,
    review,
    account_rows,
    budget_items,
    *,
    subscriptions=None,
    current_category_rows=None,
    category_cache=None,
    balance_cache=None,
):
    today = timezone.localdate()
    start = today.replace(day=1)
    previous_start = (start.replace(day=1) - timedelta(days=1)).replace(day=1)
    current_categories = (
        {item["label"]: item["total"] for item in current_category_rows}
        if current_category_rows is not None
        else monthly_category_totals(start)
    )
    previous_categories = monthly_category_totals(previous_start)
    rises = [
        {"category": label, "current": api_money(amount), "previous": api_money(previous_categories.get(label, 0)),
         "difference": api_money(amount - previous_categories.get(label, 0)),
         "percent": api_money((amount - previous_categories.get(label, 0)) / previous_categories.get(label) * 100) if previous_categories.get(label) else None}
        for label, amount in current_categories.items() if amount > previous_categories.get(label, 0)
    ]
    rises.sort(key=lambda item: item["difference"], reverse=True)
    pending_occurrences = sorted(
        scheduled_pending_occurrences(start, month_bounds(shift_month(start, 12))[1]),
        key=lambda item: (item.due_date, item.amount, item.rule.pk),
    )
    overdue_occurrences = [item for item in pending_occurrences if item.due_date < today]
    persisted_overdue = RecurringOccurrence.objects.filter(
        status=RecurringOccurrence.Status.PENDING,
        due_date__lt=start,
        rule__active=True,
    ).select_related("rule")
    overdue_keys = {(item.rule.pk, item.due_date) for item in overdue_occurrences}
    overdue_keys.update((item.rule_id, item.due_date) for item in persisted_overdue)
    next_occurrence = next((item for item in pending_occurrences if item.due_date >= today), None)
    budget_risk = sorted(budget_items, key=lambda item: max(item["actual_percent"], item["projected_percent"]), reverse=True)[:1]
    subscription_rows = subscriptions if subscriptions is not None else detected_subscriptions()
    subscription_rows = pending_subscription_candidates(subscription_rows)
    serialized_subscriptions = [api_subscription(item, category_cache=category_cache, balance_cache=balance_cache) for item in subscription_rows[:3]]
    bank_errors = [api_connection(connection) for connection in BankConnection.objects.exclude(last_error="").order_by("bank_name")]
    priority = []
    if review.get("bank_connections_with_errors"):
        priority.append({"id": "bank-error", "label": "Conexiones bancarias con error", "count": review["bank_connections_with_errors"], "severity": "critical", "url": "/?tab=review&focus=bank"})
    if review["bank_pending_count"]:
        priority.append({"id": "bank-review", "label": "Movimientos bancarios por revisar", "count": review["bank_pending_count"], "severity": "high", "url": "/?tab=review"})
    if review["csv_pending_count"]:
        priority.append({"id": "csv", "label": "Lotes CSV pendientes", "count": review["csv_pending_count"], "severity": "high", "url": "/?tab=settings&focus=csv"})
    if metrics["safe_to_spend"] < 0:
        priority.append({"id": "safe-spend", "label": "Margen mensual negativo", "count": 1, "severity": "high", "url": "/?tab=planning"})
    if overdue_keys:
        priority.append({"id": "recurring", "label": "Recurrentes vencidos", "count": len(overdue_keys), "severity": "high", "url": "/?tab=planning"})
    if budget_risk and budget_risk[0]["pace"] == "high":
        priority.append({"id": "budget", "label": "Presupuesto con ritmo alto", "count": 1, "severity": "high", "url": "/?tab=planning"})
    return {
        "priority_tasks": priority,
        "bank_errors": bank_errors,
        "recurring_next": {
            "name": next_occurrence.rule.name, "date": api_date(next_occurrence.due_date), "amount": api_money(next_occurrence.amount),
            "account": next_occurrence.rule.account.name, "category": next_occurrence.rule.category.display_name,
            "status": "Pendiente", "url": "/?tab=planning",
        } if next_occurrence else None,
        "budget_risk": api_budget_item(budget_risk[0], category_cache=category_cache) if budget_risk else None,
        "category_rise": rises[0] if rises else None,
        "refunds": [],
        "subscriptions": serialized_subscriptions,
        "account_balances": [api_account(item["account"], item["balance"]) for item in sorted(account_rows, key=lambda item: (bool(getattr(getattr(item["account"], "bank_link", None), "connection", None) and getattr(getattr(item["account"].bank_link, "connection", None), "last_error", "")), -item["balance"], item["account"].name))],
    }


@require_http_methods(["GET", "PUT"])
def api_dashboard_preferences(request):
    preferences = dashboard_preferences_for(request, create=request.method == "PUT")
    if request.method == "PUT":
        try:
            payload = api_json_body(request)
        except ValueError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=400)
        if "widget_order" in payload:
            order = payload["widget_order"]
            if not isinstance(order, list) or any(item not in DEFAULT_DASHBOARD_WIDGET_ORDER for item in order):
                return JsonResponse({"ok": False, "error": "Orden de widgets no válido."}, status=400)
            preferences.widget_order = list(dict.fromkeys(order))
        if "hidden_widgets" in payload:
            preferences.hidden_widgets = [item for item in payload["hidden_widgets"] if item in DEFAULT_DASHBOARD_WIDGET_ORDER and item not in {"balance", "priority"}]
        if payload.get("density") in {"normal", "compact"}:
            preferences.density = payload["density"]
        if payload.get("content_mode") in {"full", "balance", "review"}:
            preferences.content_mode = payload["content_mode"]
        preferences.save()
    return JsonResponse({"ok": True, "preferences": serialize_dashboard_preferences(preferences)})


@require_POST
def api_dashboard_preferences_reset(request):
    preferences = dashboard_preferences_for(request, create=True)
    preferences.widget_order = DEFAULT_DASHBOARD_WIDGET_ORDER
    preferences.hidden_widgets = []
    preferences.density = "normal"
    preferences.content_mode = "full"
    preferences.save()
    return JsonResponse({"ok": True, "preferences": serialize_dashboard_preferences(preferences)})


@require_http_methods(["GET", "POST"])
def api_dashboard_snapshot(request):
    preferences = dashboard_preferences_for(request, create=request.method == "POST")
    user = request.user if getattr(request, "user", None) and request.user.is_authenticated else None
    month = request.GET.get("month") or timezone.localdate().strftime("%Y-%m")
    if request.method == "GET":
        snapshot = MonthlyDashboardSnapshot.objects.filter(user=user, month=month).first()
        return JsonResponse({"snapshot": {"month": snapshot.month, "payload": snapshot.payload, "captured_at": api_datetime(snapshot.captured_at)} if snapshot else None})
    metrics = dashboard_metrics()
    review = dashboard_review_summary()
    account_rows = [{"account": account, "balance": account_balance(account)} for account in Account.objects.filter(active=True)]
    snapshot_payload = {"month": month, "metrics": api_metrics(metrics), "review": api_review(review), "accounts": [api_account(item["account"], item["balance"]) for item in account_rows], "budget_items": [api_budget_item(item) for item in metrics["budgets"]], "dashboard": dashboard_widgets_payload(metrics, review, account_rows, metrics["budgets"])}
    snapshot, created = MonthlyDashboardSnapshot.objects.update_or_create(user=preferences.user, month=month, defaults={"payload": snapshot_payload})
    preferences.last_snapshot_month = month
    preferences.save(update_fields=["last_snapshot_month", "updated_at"])
    return JsonResponse({"ok": True, "replaced": not created, "snapshot": {"month": snapshot.month, "payload": snapshot.payload, "captured_at": api_datetime(snapshot.captured_at)}})
