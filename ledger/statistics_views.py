"""Statistics HTTP boundary: request parsing, report links and JSON endpoints."""

from datetime import date, timedelta
from decimal import Decimal
from urllib.parse import urlencode

from django.http import JsonResponse
from django.urls import reverse
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.views.decorators.http import require_GET

from .api_serializers import react_transactions_url
from .models import BankConnection, BankSyncRun, BankTransaction, ImportBatch, ImportRow
from .statistics import (
    ALLOWED_PERIODS,
    StatisticsRangeError,
    month_end as statistics_month_end,
    preset_statistics_range,
    statistics_month_report,
    statistics_report,
    validate_statistics_range,
)


def complete_statistics_date(raw_value):
    """Parse only canonical YYYY-MM-DD values, never partial dates."""
    raw_value = raw_value or ""
    normalized = raw_value.strip()
    value = parse_date(normalized)
    return value if raw_value == normalized and value and value.isoformat() == raw_value else None

def statistics_scope_from_request(request):
    period = request.GET.get("period", "12")
    basis = request.GET.get("basis", "analytics")
    if period not in ALLOWED_PERIODS:
        raise StatisticsRangeError("El periodo debe ser 3, 6, 12 o custom.")
    if basis not in {"analytics", "all"}:
        raise StatisticsRangeError("La base debe ser analytics o all.")
    if period == "custom":
        start = complete_statistics_date(request.GET.get("date_from"))
        end = complete_statistics_date(request.GET.get("date_to"))
        if start is None or end is None:
            raise StatisticsRangeError("Indica dos fechas completas para el rango personalizado.")
        validate_statistics_range(start, end)
    else:
        start, end = preset_statistics_range(period)
    return period, basis, start, end

def statistics_active_range_from_request(request, year, month):
    basis = request.GET.get("basis", "analytics")
    if basis not in {"analytics", "all"}:
        raise StatisticsRangeError("La base debe ser analytics o all.")
    raw_start = request.GET.get("date_from")
    raw_end = request.GET.get("date_to")
    if raw_start or raw_end:
        start = complete_statistics_date(raw_start)
        end = complete_statistics_date(raw_end)
        if start is None or end is None:
            raise StatisticsRangeError("Indica dos fechas completas para el periodo activo.")
        validate_statistics_range(start, end)
        return basis, start, end
    try:
        selected_month = date(year, month, 1)
    except ValueError as exc:
        raise StatisticsRangeError("Mes no válido.") from exc
    today = timezone.localdate()
    if selected_month > today:
        raise StatisticsRangeError("El mes no puede ser posterior al actual.")
    return basis, selected_month, min(statistics_month_end(selected_month), today)

def statistics_movement_filters(start, end, basis, **extra):
    return {
        "date_from": start.isoformat() if isinstance(start, date) else start,
        "date_to": end.isoformat() if isinstance(end, date) else end,
        "analytics": {"analytics": "included", "excluded": "excluded", "all": "all"}[basis],
        **extra,
    }

def statistics_coverage(start, end):
    """Describe source freshness and unresolved rows without claiming historical reconciliation."""
    pending_imports = ImportRow.objects.filter(
        status=ImportRow.Status.PENDING,
        date__range=(start, end),
    ).count()
    latest_import = ImportBatch.objects.order_by("-created_at").values_list("created_at", flat=True).first()
    pending_banking = BankTransaction.objects.filter(
        status=BankTransaction.Status.PENDING,
        booking_date__range=(start, end),
    ).count()
    connections = list(BankConnection.objects.all())
    if not connections:
        banking_status = "not_configured"
        last_synced_at = None
    else:
        last_synced_at = max((item.last_synced_at for item in connections if item.last_synced_at), default=None)
        latest_run = (
            BankSyncRun.objects.filter(connection__in=connections)
            .order_by("-started_at", "-pk")
            .first()
        )
        stale_sync = last_synced_at is None or last_synced_at < timezone.now() - timedelta(days=7)
        banking_status = "attention" if (
            pending_banking
            or stale_sync
            or (latest_run is not None and latest_run.status == BankSyncRun.Status.FAILED)
            or any(item.sync_status == BankConnection.SyncStatus.ERROR for item in connections)
            or any(item.status != BankConnection.Status.AUTHORIZED for item in connections)
        ) else "current"
    return {
        "imports": {
            "status": "pending" if pending_imports else "clear",
            "pending_count": pending_imports,
            "last_activity_at": latest_import,
        },
        "banking": {
            "status": banking_status,
            "pending_count": pending_banking,
            "last_synced_at": last_synced_at,
        },
    }

def add_statistics_links(payload):
    scope = payload["scope"]
    basis = scope["basis"]
    active_start = scope["date_from"]
    active_end = scope["date_to"]
    comparison_scope = payload.get("comparison", {}).get("scope")
    for driver in payload.get("comparison", {}).get("category_drivers", []):
        family_value = driver["family_id"] if driver["family_id"] is not None else "uncategorized"
        driver["current_movements_url"] = react_transactions_url(
            statistics_movement_filters(
                active_start,
                active_end,
                basis,
                category_family=family_value,
                statistics_attribution="purchase",
            )
        )
        driver["previous_movements_url"] = react_transactions_url(
            statistics_movement_filters(
                comparison_scope["date_from"],
                comparison_scope["date_to"],
                basis,
                category_family=family_value,
                statistics_attribution="purchase",
            )
        )
    for variation in payload.get("comparison", {}).get("category_variations", []):
        family_value = variation["family_id"] if variation["family_id"] is not None else "uncategorized"
        variation["current_movements_url"] = react_transactions_url(
            statistics_movement_filters(
                active_start, active_end, basis, category_family=family_value, statistics_attribution="purchase",
            )
        )
        variation["previous_movements_url"] = react_transactions_url(
            statistics_movement_filters(
                comparison_scope["date_from"], comparison_scope["date_to"], basis,
                category_family=family_value, statistics_attribution="purchase",
            )
        )
    for item in payload.get("monthly_series", []):
        detail_query = urlencode(
            {
                "basis": basis,
                "date_from": active_start.isoformat(),
                "date_to": active_end.isoformat(),
            }
        )
        year, month = (int(part) for part in item["month"].split("-"))
        item["detail_url"] = f"{reverse('api_statistics_month', args=[year, month])}?{detail_query}"
        item["movements_url"] = react_transactions_url(
            statistics_movement_filters(
                item["date_from"],
                item["date_to"],
                basis,
                statistics_attribution="report",
            )
        )
    for family in payload.get("categories", []):
        family_value = family["family_id"] if family["family_id"] is not None else "uncategorized"
        family["movements_url"] = react_transactions_url(
            statistics_movement_filters(
                active_start,
                active_end,
                basis,
                category_family=family_value,
                statistics_attribution="purchase",
            )
        )
        for subcategory in family["subcategories"]:
            category_id = subcategory["category_id"]
            extra = (
                {"category": category_id}
                if category_id is not None
                else {"category_family": "uncategorized"}
            )
            subcategory["movements_url"] = react_transactions_url(
                statistics_movement_filters(
                    active_start,
                    active_end,
                    basis,
                    statistics_attribution="purchase",
                    **extra,
                )
            )
    for family in payload.get("basis_reconciliation", {}).get("excluded_categories", []):
        family_value = family["family_id"] if family["family_id"] is not None else "uncategorized"
        family["movements_url"] = react_transactions_url(
            statistics_movement_filters(
                active_start,
                active_end,
                "excluded",
                category_family=family_value,
                statistics_attribution="purchase",
            )
        )
    analysis = payload.get("analysis", {})
    for item in [*analysis.get("merchants", []), *analysis.get("recurring", [])]:
        item["movements_url"] = react_transactions_url(
            statistics_movement_filters(
                active_start, active_end, basis, description=item["description"], statistics_attribution="purchase",
            )
        )
    month_scopes = {item["month"]: item for item in payload.get("monthly_series", [])}
    for row in analysis.get("category_matrix", {}).get("rows", []):
        family_value = row["family_id"] if row["family_id"] is not None else "uncategorized"
        for value in row.get("values", []):
            month_scope = month_scopes[value["month"]]
            value["movements_url"] = react_transactions_url(
                statistics_movement_filters(
                    month_scope["date_from"], month_scope["date_to"], basis,
                    category_family=family_value, statistics_attribution="purchase",
                )
            )
    uncategorized = payload.get("data_quality", {}).get("uncategorized")
    if uncategorized is not None:
        uncategorized["movements_url"] = react_transactions_url(
            statistics_movement_filters(
                active_start, active_end, basis, category_family="uncategorized", statistics_attribution="purchase",
            )
        )
    if "daily_series" in payload:
        payload["movements_url"] = react_transactions_url(
            statistics_movement_filters(
                active_start,
                active_end,
                basis,
                statistics_attribution="report",
            )
        )
    for point in payload.get("insights", {}).get("rhythm", {}).get("points", []):
        point["movements_url"] = react_transactions_url(
            statistics_movement_filters(point["date"], point["date"], basis, statistics_attribution="report")
        )
    for spike in payload.get("insights", {}).get("spikes", {}).get("items", []):
        family_value = spike["family_id"] if spike["family_id"] is not None else "uncategorized"
        spike["movements_url"] = react_transactions_url(
            statistics_movement_filters(
                active_start,
                active_end,
                basis,
                category_family=family_value,
                statistics_attribution="purchase",
            )
        )
    for link in payload.get("money_map", {}).get("links", []):
        family_value = link.get("category_family")
        families = link.get("category_families") or []
        if len(families) > 1:
            family_values = [item if item is not None else "uncategorized" for item in families]
            link["movements_url"] = react_transactions_url(
                statistics_movement_filters(active_start, active_end, basis, category_family=",".join(str(item) for item in family_values))
            )
        else:
            if family_value is None and len(families) == 1:
                family_value = families[0] if families[0] is not None else "uncategorized"
            if family_value is not None:
                link["movements_url"] = react_transactions_url(
                    statistics_movement_filters(active_start, active_end, basis,
                                                category_family=family_value, statistics_attribution="purchase")
                )
    return payload

def statistics_json(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: statistics_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [statistics_json(item) for item in value]
    return value

@require_GET
def api_statistics(request):
    try:
        period, basis, start, end = statistics_scope_from_request(request)
        payload = statistics_report(start, end, basis)
    except StatisticsRangeError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    payload["scope"]["period"] = period
    payload["coverage"] = statistics_coverage(start, end)
    add_statistics_links(payload)
    return JsonResponse(statistics_json(payload))

@require_GET
def api_statistics_month(request, year, month):
    try:
        basis, active_start, active_end = statistics_active_range_from_request(request, year, month)
        payload = statistics_month_report(year, month, active_start, active_end, basis)
    except StatisticsRangeError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    add_statistics_links(payload)
    return JsonResponse(statistics_json(payload))
