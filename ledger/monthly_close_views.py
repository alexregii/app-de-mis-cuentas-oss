from copy import deepcopy

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .api_helpers import api_json_body
from .api_serializers import react_transactions_url
from .models import MonthlyClose
from .monthly_closures import MonthlyCloseConflict, build_monthly_close_preview, close_source_status, create_monthly_close


def _add_source_links(report):
    result = deepcopy(report)
    basis_filter = "included" if result["scope"]["basis"] == MonthlyClose.Basis.ANALYTICS else "all"
    start = result["scope"]["date_from"]
    end = result["scope"]["date_to"]
    result["source_movements_url"] = react_transactions_url({
        "date_from": start,
        "date_to": end,
        "analytics": basis_filter,
        "statistics_attribution": "report",
    })
    for day in result["daily_series"]:
        day["source_movements_url"] = react_transactions_url({
            "date_from": day["date"],
            "date_to": day["date"],
            "analytics": basis_filter,
            "statistics_attribution": "report",
        })
    return result


def _close_payload(close, source_digest):
    return {
        "month": close.month.strftime("%Y-%m"),
        "basis": close.basis,
        "version": close.version,
        "status_at_close": close.status_at_close,
        "origin": close.origin,
        "source_verification": close_source_status(close, source_digest),
        "source_digest": close.source_digest,
        "report": _add_source_links(close.report),
        "accounts": close.accounts,
        "issues": close.issues,
        "declarations": close.declarations,
        "correction_reason": close.correction_reason,
        "created_at": close.created_at.isoformat(),
    }


def _state(month, basis):
    preview = build_monthly_close_preview(month, basis)
    versions = list(MonthlyClose.objects.filter(month__year=int(month[:4]), month__month=int(month[5:7]), basis=basis).order_by("version"))
    return {
        "preview": {**preview, "report": _add_source_links(preview["report"])},
        "versions": [_close_payload(version, preview["source_digest"]) for version in versions],
    }


@require_http_methods(["GET", "POST"])
def api_monthly_closures(request):
    if request.method == "GET":
        month = request.GET.get("month", "")
        basis = request.GET.get("basis", MonthlyClose.Basis.ANALYTICS)
        try:
            state = _state(month, basis)
        except ValueError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=400)
        return JsonResponse({"ok": True, **state})

    try:
        payload = api_json_body(request)
        if not isinstance(payload, dict):
            raise ValueError("La solicitud de cierre no es válida.")
        close, created = create_monthly_close(
            month_value=payload.get("month"),
            basis=payload.get("basis"),
            source_digest=payload.get("source_digest"),
            idempotency_key=payload.get("idempotency_key"),
            declarations=payload.get("declarations", {}),
            correction_reason=payload.get("correction_reason", ""),
        )
        state = _state(payload["month"], payload["basis"])
    except MonthlyCloseConflict as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=409)
    except (KeyError, TypeError, ValueError) as exc:
        message = str(exc) or "La solicitud de cierre no es válida."
        return JsonResponse({"ok": False, "error": message}, status=400)
    return JsonResponse({"ok": True, "created": created, **state}, status=201 if created else 200)
