"""Enable Banking API boundary: connection lifecycle, sync and review actions."""

import json

from requests import HTTPError, RequestException

from django.core import signing
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST, require_http_methods

from .api_helpers import api_json_body
from .api_serializers import (
    api_bank_error,
    api_bank_review_row,
    api_category,
    api_connection,
    api_date,
    api_money,
    api_transaction,
    category_api_cache,
    category_catalog_queryset,
)
from .banking import (
    BANK_SYNC_UNAVAILABLE_ERROR,
    BankConnectionUnavailable,
    enqueue_connection_sync,
    sync_connection,
)
from .banking_client import EnableBankingClient, banking_configured
from .bank_review_services import BankReviewConflict, BankTransferConflict, bank_transfer_candidates, confirm_bank_transaction, confirm_bank_transfer
from .models import BankConnection, BankSyncRun, BankTransaction, Category, CategoryRule, Transaction
from .category_services import is_reopened_split_origin, iter_matching_category_rules, remember_category_rule


def prepare_bank_rows(rows):
    prepared = list(rows)
    for row in prepared:
        row.suggested_category_id = row.category_id or getattr(getattr(row, "prediction", None), "category_id", None)
    return prepared


def api_bank_transfer_candidate(candidate):
    def side(value):
        return {
            "bank_transaction_id": value["bank_transaction_id"],
            "transaction_id": value["transaction_id"],
            "account": {"id": value["account_id"], "name": value["account_name"]},
            "booking_date": api_date(value["date"]),
            "description": value["description"],
            "amount": api_money(value["amount"]),
        }

    return {
        "candidate_type": candidate["candidate_type"],
        "candidate_id": candidate["candidate_id"],
        "source": candidate["source"],
        "outgoing": side(candidate["outgoing"]),
        "incoming": side(candidate["incoming"]),
        "transfer_amount": api_money(candidate["transfer_amount"]),
        "fee_amount": api_money(candidate["fee_amount"]),
        "requires_fee_confirmation": candidate["requires_fee_confirmation"],
        "days_apart": candidate["days_apart"],
    }


def perform_bank_review_action(row, action, category=None, refund_for=None, *, preserve_existing_refund=True):
    if action == "transfer":
        persisted = BankTransaction.objects.filter(pk=row.pk).values("status", "transaction_id").first()
        if persisted and persisted["status"] == BankTransaction.Status.IMPORTED and persisted["transaction_id"]:
            return "importado"
        raise ValueError("El traspaso requiere seleccionar una contrapartida y confirmar el preview.")
    if action not in {"confirm", "force", "import", "skip"}:
        raise ValueError("Acción bancaria no válida.")
    if action in {"confirm", "force", "import"}:
        movement = confirm_bank_transaction(
            row,
            category=category,
            force=action in {"force", "import"},
            refund_for=refund_for,
            preserve_existing_refund=preserve_existing_refund,
        )
        if hasattr(row, "prediction"):
            row.prediction.status = (
                row.prediction.Status.ACCEPTED
                if movement.category_id == row.prediction.category_id
                else row.prediction.Status.REJECTED
            )
            row.prediction.save(update_fields=["status", "updated_at"])
        return "importado"
    if action == "skip":
        changed = BankTransaction.objects.filter(
            pk=row.pk, status=BankTransaction.Status.PENDING
        ).update(status=BankTransaction.Status.SKIPPED)
        if changed:
            row.refresh_from_db()
            return "omitido"

    row.refresh_from_db()
    if row.status == BankTransaction.Status.IMPORTED:
        return "importado"
    if action == "skip" and row.status == BankTransaction.Status.SKIPPED:
        return "omitido"
    raise ValueError("El movimiento ya no está pendiente.")


@require_http_methods(["GET", "POST"])
def api_bank_connect(request):
    if not banking_configured():
        return JsonResponse(
            {
                "ok": False,
                "configured": False,
                "error": "Completa primero la configuración de Enable Banking.",
            },
            status=400,
        )

    client = EnableBankingClient()
    if request.method == "GET":
        try:
            banks = client.banks("ES")
        except Exception:
            return JsonResponse(
                {
                    "ok": False,
                    "configured": True,
                    "error": "No se pudo consultar el listado de bancos. Inténtalo de nuevo.",
                },
                status=502,
            )
        return JsonResponse(
            {
                "ok": True,
                "configured": True,
                "country": "ES",
                "banks": [
                    {"name": bank.get("name", ""), "country": bank.get("country", "ES")}
                    for bank in sorted(banks, key=lambda item: item.get("name", "").lower())
                    if bank.get("name")
                ],
            }
        )

    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    bank_name = str(payload.get("bank_name") or "").strip()
    bank_country = str(payload.get("bank_country") or "ES").strip() or "ES"
    if not bank_name:
        return JsonResponse({"ok": False, "errors": {"bank_name": ["Selecciona un banco."]}}, status=400)

    state_payload = {"name": bank_name, "country": bank_country}
    if payload.get("return_to"):
        state_payload["next_url"] = str(payload["return_to"]).strip()
    state = signing.dumps(state_payload, salt="enable-banking-auth", compress=True)
    try:
        auth_payload = client.start_authorization(bank_name, bank_country, state)
    except Exception:
        return JsonResponse(
            {"ok": False, "error": "No se pudo iniciar la autorización bancaria. Inténtalo de nuevo."},
            status=502,
        )
    return JsonResponse({"ok": True, "url": auth_payload["url"]})


@require_POST
def api_bank_reconnect(request, pk):
    if not banking_configured():
        return JsonResponse(
            {
                "ok": False,
                "configured": False,
                "error": "Completa primero la configuración de Enable Banking.",
            },
            status=400,
        )

    connection = get_object_or_404(BankConnection, pk=pk)
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    state_payload = {
        "name": connection.bank_name,
        "country": connection.bank_country,
        "reconnect_connection_id": connection.pk,
    }
    if payload.get("return_to"):
        state_payload["next_url"] = str(payload["return_to"]).strip()
    state = signing.dumps(state_payload, salt="enable-banking-auth", compress=True)
    try:
        auth_payload = EnableBankingClient().start_authorization(
            connection.bank_name,
            connection.bank_country,
            state,
        )
    except Exception:
        return JsonResponse(
            {"ok": False, "error": "No se pudo iniciar la reconexión bancaria. Inténtalo de nuevo."},
            status=502,
        )
    return JsonResponse({"ok": True, "url": auth_payload["url"], "connection": api_connection(connection)})


def _sync_requires_reconnect(connection):
    if connection.status != BankConnection.Status.NEEDS_RECONNECT:
        return None
    return JsonResponse(
        {
            "ok": False,
            "reconnect_required": True,
            "error": "La autorización bancaria ha caducado. Reconecta el banco antes de sincronizar.",
            "connection": api_connection(connection),
        },
        status=409,
    )


@require_POST
def api_bank_sync(request, pk):
    connection = get_object_or_404(BankConnection, pk=pk)
    reconnect_response = _sync_requires_reconnect(connection)
    if reconnect_response:
        return reconnect_response
    try:
        run = sync_connection(connection)
    except BankConnectionUnavailable:
        return JsonResponse({"ok": False, "error": BANK_SYNC_UNAVAILABLE_ERROR}, status=409)
    connection.refresh_from_db()
    if run.status == BankSyncRun.Status.FAILED:
        status = 400
        message = api_bank_error(run.error or "Error de sincronización")
    elif run.status == BankSyncRun.Status.COMPLETED:
        status = 200
        message = "Sincronización completada."
    else:
        status = 200
        message = "Sincronización iniciada."
    return JsonResponse(
        {
            "ok": run.status != BankSyncRun.Status.FAILED,
            "status": run.status,
            "message": message,
            "connection": api_connection(connection),
        },
        status=status,
    )


@require_POST
def api_bank_sync_async(request, pk):
    """Compatibility-safe opt-in endpoint for the background sync path."""
    connection = get_object_or_404(BankConnection, pk=pk)
    reconnect_response = _sync_requires_reconnect(connection)
    if reconnect_response:
        return reconnect_response
    try:
        run = enqueue_connection_sync(connection)
    except BankConnectionUnavailable:
        return JsonResponse({"ok": False, "error": BANK_SYNC_UNAVAILABLE_ERROR}, status=409)
    connection.refresh_from_db()
    return JsonResponse(
        {
            "ok": True,
            "status": run.status,
            "job_id": run.pk,
            "job_status": run.status,
            "status_url": reverse("api_bank_sync_status", args=[connection.pk]),
            "connection": api_connection(connection),
        },
        status=202 if run.status == BankSyncRun.Status.QUEUED else 200,
    )


@require_GET
def api_bank_sync_status(request, pk):
    connection = get_object_or_404(BankConnection, pk=pk)
    run = BankSyncRun.objects.filter(connection=connection).order_by("-started_at", "-pk").first()
    return JsonResponse(
        {
            "ok": True,
            "job_id": run.pk if run else None,
            "job_status": run.status if run else None,
            "pending_count": run.pending_count if run else 0,
            "imported_count": run.imported_count if run else 0,
            "error": api_bank_error(run.error) if run else "",
            "connection": api_connection(connection),
        }
    )


@require_GET
def api_bank_connection_status(request, pk):
    connection = get_object_or_404(BankConnection, pk=pk)
    return JsonResponse({"ok": True, "connection": api_connection(connection)})


@require_POST
def api_bank_disconnect(request, pk):
    connection = get_object_or_404(BankConnection, pk=pk)
    active_sync = BankSyncRun.objects.filter(
        connection=connection,
        status__in=(BankSyncRun.Status.QUEUED, BankSyncRun.Status.RUNNING),
    ).exists()
    if active_sync:
        return JsonResponse(
            {"ok": False, "error": "Hay una sincronización bancaria en curso. Espera a que termine antes de desconectar."},
            status=409,
        )

    session_id = connection.session_id
    try:
        EnableBankingClient().delete_session(session_id)
    except HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else None
        if status_code == 429:
            return JsonResponse(
                {
                    "ok": False,
                    "error": "El banco ha limitado la revocación. El estado local no ha cambiado; inténtalo más tarde.",
                },
                status=429,
            )
        return JsonResponse(
            {
                "ok": False,
                "error": "No se pudo confirmar la revocación remota. El estado local no ha cambiado; puedes volver a intentarlo.",
            },
            status=503,
        )
    except RequestException:
        return JsonResponse(
            {
                "ok": False,
                "error": "No se pudo confirmar la revocación remota. El estado local no ha cambiado; puedes volver a intentarlo.",
            },
            status=503,
        )

    disconnected_at = timezone.now()
    with transaction.atomic():
        disconnected = BankConnection.objects.filter(pk=connection.pk, session_id=session_id).update(
            status=BankConnection.Status.DISCONNECTED,
            sync_status=BankConnection.SyncStatus.IDLE,
            sync_started_at=None,
        )
        if disconnected:
            BankSyncRun.objects.filter(
                connection_id=connection.pk,
                status__in=(BankSyncRun.Status.QUEUED, BankSyncRun.Status.RUNNING),
            ).update(
                status=BankSyncRun.Status.FAILED,
                error="La conexión bancaria se ha desconectado.",
                finished_at=disconnected_at,
            )
    connection.refresh_from_db()
    if not disconnected:
        return JsonResponse(
            {
                "ok": False,
                "error": "La autorización bancaria cambió durante la desconexión. Se ha conservado la sesión actual; vuelve a intentarlo.",
                "connection": api_connection(connection),
            },
            status=409,
        )
    return JsonResponse({"ok": True, "message": "Conexión bancaria desconectada.", "connection": api_connection(connection)})


@require_GET
def api_bank_review(request):
    rows = prepare_bank_rows(
        BankTransaction.objects.filter(status=BankTransaction.Status.PENDING).select_related(
            "bank_account__account", "category", "prediction__category", "transaction", "transaction__refund_for"
        ).prefetch_related("transaction__allocations__category", "transaction__allocations__category__parent")
    )
    unlinked_transfers = list(
        BankTransaction.objects.filter(
            status=BankTransaction.Status.SKIPPED,
            possible_transfer=True,
            transaction__isnull=True,
            fee_transaction__isnull=True,
        ).select_related("bank_account__account", "category", "prediction__category")
    )
    refund_candidates = list(
        Transaction.objects.filter(archived=False, kind=Transaction.Kind.EXPENSE, transfer_group__isnull=True)
        .select_related("account", "category", "category__parent")
        .prefetch_related("tags", "attachments", "allocations__category", "allocations__category__parent")
        .order_by("-date", "-created_at")[:80]
    )
    categories = list(category_catalog_queryset(active=True))
    category_cache = {category.pk: category for category in categories}
    rules = list(CategoryRule.objects.filter(active=True).select_related("category").order_by("priority", "description", "pk"))
    category_rule_matches = {
        row.pk: (
            []
            if is_reopened_split_origin(row)
            else list(iter_matching_category_rules(row.description, row.amount, row.kind, row.bank_account.account_id, rules=rules))
        )
        for row in rows
    }
    category_cache.update(
        category_api_cache(
            (
                {row.category_id for row in rows}
                | {row.category_id for row in unlinked_transfers}
                | {getattr(row, "suggested_category_id", None) for row in rows}
                | {getattr(row, "suggested_category_id", None) for row in unlinked_transfers}
                | {
                    allocation.category_id
                    for row in rows if row.transaction_id and row.transaction.archived
                    for allocation in row.transaction.allocations.all()
                    if allocation.category_id
                }
                | {movement.category_id for movement in refund_candidates}
                | {rule.category_id for matches in category_rule_matches.values() for rule in matches}
            )
            - category_cache.keys()
        )
    )
    return JsonResponse(
        {
            "rows": [api_bank_review_row(row, category_cache=category_cache, category_rule_matches=category_rule_matches[row.pk]) for row in rows],
            "unlinked_transfers": [api_bank_review_row(row, category_cache=category_cache) for row in unlinked_transfers],
            "categories": [api_category(category, category_cache=category_cache) for category in categories],
            "refund_candidates": [api_transaction(movement, category_cache=category_cache) for movement in refund_candidates],
        }
    )


@require_POST
def api_bank_review_action(request, pk, action):
    row = get_object_or_404(
        BankTransaction.objects.select_related("prediction__category", "transaction__refund_for"),
        pk=pk,
    )
    try:
        payload = api_json_body(request)
        if action == "transfer":
            confirm_fee = payload.get("confirm_fee", False)
            if not isinstance(confirm_fee, bool):
                raise ValueError("La confirmación de comisión no es válida.")
            result = confirm_bank_transfer(
                row.pk,
                candidate_type=payload.get("candidate_type"),
                candidate_id=payload.get("candidate_id"),
                confirm_fee=confirm_fee,
            )
            return JsonResponse({"ok": True, "removed": result["removed"], "message": result["message"]})
        category = None
        refund_for = None
        if payload.get("category"):
            category = Category.objects.filter(pk=payload["category"], kind=row.kind).first()
            if not category:
                raise ValueError("La categoría no corresponde al tipo de movimiento.")
        if payload.get("refund_for"):
            if row.kind != Category.Kind.INCOME:
                raise ValueError("Solo un ingreso puede marcarse como reembolso.")
            refund_for = Transaction.objects.filter(
                pk=payload["refund_for"],
                kind=Transaction.Kind.EXPENSE,
                transfer_group__isnull=True,
            ).select_related("account", "category", "category__parent").first()
            if refund_for and refund_for.archived and not (
                row.transaction_id and row.transaction.refund_for_id == refund_for.pk
            ):
                refund_for = None
            if not refund_for:
                raise ValueError("El gasto de reembolso no es válido.")
        result = perform_bank_review_action(
            row,
            action,
            category,
            refund_for=refund_for,
            preserve_existing_refund="refund_for" not in payload,
        )
    except (BankReviewConflict, BankTransferConflict) as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=409)
    except (ValueError, json.JSONDecodeError) as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    if payload.get("remember_category") and (category or row.category):
        remember_category_rule(row.description, row.kind, category or row.category)
    return JsonResponse({"ok": True, "removed": [row.pk], "message": f"Movimiento {result}."})


@require_GET
def api_bank_review_transfer_options(request, pk):
    row = get_object_or_404(BankTransaction.objects.select_related("bank_account__account"), pk=pk)
    try:
        candidates = bank_transfer_candidates(row.pk)
    except BankTransferConflict as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=409)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    return JsonResponse({"ok": True, "candidates": [api_bank_transfer_candidate(candidate) for candidate in candidates]})


@require_POST
def api_bank_review_bulk(request):
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    action = payload.get("action", "")
    if action == "transfer":
        return JsonResponse({"ok": False, "error": "Selecciona una pareja y confirma su preview antes de enlazar el traspaso."}, status=400)
    rows = BankTransaction.objects.filter(status=BankTransaction.Status.PENDING).select_related("prediction__category")
    if action == "import_safe":
        rows = rows.filter(possible_duplicate=False, possible_transfer=False)
        action = "confirm"
    else:
        selected = payload.get("rows") or []
        if not selected:
            return JsonResponse({"ok": False, "error": "Selecciona al menos un movimiento."}, status=400)
        rows = rows.filter(pk__in=selected)

    category_map = {str(key): value for key, value in (payload.get("categories") or {}).items()}
    removed = []
    failed = []
    for row in rows:
        category = None
        category_id = category_map.get(str(row.pk))
        if category_id:
            category = Category.objects.filter(pk=category_id, kind=row.kind).first()
            if not category:
                failed.append(row.pk)
                continue
        elif action == "confirm" and hasattr(row, "prediction") and not is_reopened_split_origin(row):
            category = row.prediction.category
        try:
            perform_bank_review_action(row, action, category)
        except ValueError:
            failed.append(row.pk)
        else:
            removed.append(row.pk)
    message = f"{len(removed)} movimientos procesados."
    if failed:
        message += f" {len(failed)} requieren revisión individual."
    return JsonResponse({"ok": True, "removed": removed, "failed": failed, "message": message})
