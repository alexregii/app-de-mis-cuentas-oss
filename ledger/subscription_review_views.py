"""Endpoints for explicit, evidence-bound subscription review decisions."""

from datetime import timedelta
from decimal import Decimal, InvalidOperation
import re

from django.db import IntegrityError, OperationalError, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.views.decorators.http import require_POST

from .api_helpers import api_json_body
from .models import SubscriptionReview
from .services import detected_subscriptions


def _response(payload, *, status=200):
    response = JsonResponse(payload, status=status)
    response["Cache-Control"] = "private, no-store"
    return response


def _same_request(review, *, status, evidence_signature, next_review_date, monthly_periodicity_confirmed, confirmed_annual_cost):
    return (
        review.status == status
        and review.evidence_signature == evidence_signature
        and review.next_review_date == next_review_date
        and review.monthly_periodicity_confirmed == monthly_periodicity_confirmed
        and review.confirmed_annual_cost == confirmed_annual_cost
    )


def _result(review, *, created=False, idempotent=False):
    return _response(
        {
            "ok": True,
            "idempotent": idempotent,
            "review": {
                "account_id": review.account_id,
                "normalized_description": review.normalized_description,
                "status": review.status,
                "revision": review.revision,
                "evidence_signature": review.evidence_signature,
                "next_review_date": review.next_review_date.isoformat() if review.next_review_date else None,
                "monthly_periodicity_confirmed": review.monthly_periodicity_confirmed,
                "confirmed_annual_cost": float(review.confirmed_annual_cost) if review.confirmed_annual_cost is not None else None,
                "reviewed_at": review.reviewed_at.isoformat(),
            },
        },
        status=201 if created else 200,
    )


@require_POST
def api_subscription_review(request):
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return _response({"ok": False, "error": str(exc)}, status=400)
    if not isinstance(payload, dict):
        return _response({"ok": False, "error": "La decisión de revisión no es válida."}, status=400)

    account_id = payload.get("account_id")
    normalized_description = payload.get("normalized_description")
    action = payload.get("action")
    expected_revision = payload.get("expected_revision")
    evidence_signature = payload.get("evidence_signature")
    if type(account_id) is not int or account_id <= 0:
        return _response({"ok": False, "error": "La cuenta indicada no es válida."}, status=400)
    if not isinstance(normalized_description, str) or not normalized_description or len(normalized_description) > 180:
        return _response({"ok": False, "error": "El concepto indicado no es válido."}, status=400)
    if type(expected_revision) is not int or expected_revision < 0:
        return _response({"ok": False, "error": "La revisión ha cambiado. Recarga Plan antes de decidir."}, status=400)
    if not isinstance(action, str) or action not in {"accept", "dismiss"}:
        return _response({"ok": False, "error": "Elige aceptar o descartar la sugerencia."}, status=400)
    if not isinstance(evidence_signature, str) or not re.fullmatch(r"[0-9a-f]{64}", evidence_signature):
        return _response({"ok": False, "error": "Recarga Plan antes de revisar esta sugerencia."}, status=400)

    status = SubscriptionReview.Status.ACCEPTED if action == "accept" else SubscriptionReview.Status.DISMISSED
    next_review_date = None
    monthly_periodicity_confirmed = False
    confirmed_annual_cost = None
    if action == "accept":
        raw_review_date = payload.get("next_review_date")
        try:
            next_review_date = parse_date(raw_review_date) if isinstance(raw_review_date, str) else None
        except (TypeError, ValueError):
            next_review_date = None
        today = timezone.localdate()
        if next_review_date is None or not today <= next_review_date <= today + timedelta(days=1825):
            return _response({"ok": False, "error": "Indica una próxima revisión entre hoy y los próximos cinco años."}, status=400)
        monthly_periodicity_confirmed = payload.get("monthly_periodicity_confirmed", False)
        if type(monthly_periodicity_confirmed) is not bool:
            return _response({"ok": False, "error": "La confirmación de periodicidad no es válida."}, status=400)
        raw_annual_cost = payload.get("confirmed_annual_cost")
        if raw_annual_cost not in (None, ""):
            if isinstance(raw_annual_cost, bool) or not isinstance(raw_annual_cost, (str, int, float)):
                return _response({"ok": False, "error": "El coste anual confirmado no es válido."}, status=400)
            try:
                confirmed_annual_cost = Decimal(str(raw_annual_cost)).quantize(Decimal("0.01"))
            except (InvalidOperation, ValueError):
                return _response({"ok": False, "error": "El coste anual confirmado no es válido."}, status=400)
            if not confirmed_annual_cost.is_finite() or not Decimal("0.01") <= confirmed_annual_cost <= Decimal("999999999999.99"):
                return _response({"ok": False, "error": "El coste anual confirmado debe ser mayor que cero."}, status=400)

    try:
        with transaction.atomic():
            review = (
                SubscriptionReview.objects.select_for_update()
                .filter(account_id=account_id, normalized_description=normalized_description)
                .first()
            )
            if review and _same_request(
                review,
                status=status,
                evidence_signature=evidence_signature,
                next_review_date=next_review_date,
                monthly_periodicity_confirmed=monthly_periodicity_confirmed,
                confirmed_annual_cost=confirmed_annual_cost,
            ):
                return _result(review, idempotent=True)
            current_revision = review.revision if review else 0
            if expected_revision != current_revision:
                return _response({"ok": False, "code": "review_changed", "error": "La revisión cambió en otra solicitud. Recarga Plan antes de decidir."}, status=409)

            candidate = next(
                (
                    item for item in detected_subscriptions(basis="analytics")
                    if item["account"].pk == account_id
                    and item["normalized_description"] == normalized_description
                ),
                None,
            )
            if candidate is None or not candidate["account"].active or not candidate["category"] or not candidate["category"].active:
                return _response({"ok": False, "code": "stale_evidence", "error": "La sugerencia ya no está disponible. Recarga Plan."}, status=409)

            if candidate["evidence_signature"] != evidence_signature:
                return _response({"ok": False, "code": "stale_evidence", "error": "Los movimientos cambiaron desde que cargaste Plan. Recarga antes de revisar."}, status=409)

            created = review is None
            if review is None:
                review = SubscriptionReview(account_id=account_id, normalized_description=normalized_description)
            review.status = status
            review.revision = expected_revision + 1
            review.evidence_signature = evidence_signature
            review.reviewed_monthly_amount = candidate["review_monthly_amount"]
            review.reviewed_months_seen = candidate["months_seen"]
            review.next_review_date = next_review_date
            review.monthly_periodicity_confirmed = monthly_periodicity_confirmed
            review.confirmed_annual_cost = confirmed_annual_cost
            review.reviewed_at = timezone.now()
            review.save()
    except IntegrityError:
        # Two first-time decisions may race around the unique account/concept key.
        review = SubscriptionReview.objects.filter(
            account_id=account_id, normalized_description=normalized_description
        ).first()
        if review and _same_request(
            review,
            status=status,
            evidence_signature=evidence_signature,
            next_review_date=next_review_date,
            monthly_periodicity_confirmed=monthly_periodicity_confirmed,
            confirmed_annual_cost=confirmed_annual_cost,
        ):
            return _result(review, idempotent=True)
        return _response({"ok": False, "code": "review_changed", "error": "La revisión cambió a la vez en otra solicitud. Recarga Plan."}, status=409)
    except OperationalError:
        return _response({"ok": False, "code": "review_busy", "error": "No se pudo guardar ahora. Repite la misma decisión."}, status=503)
    return _result(review, created=created)
