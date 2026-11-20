import json

from django.core.paginator import Paginator
from django.db import DatabaseError, transaction as db_transaction
from django.db.models import prefetch_related_objects
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_GET, require_POST, require_http_methods

from .forms import (
    TransactionForm,
    TransferForm,
)
from .api_helpers import api_json_body
from .api_serializers import (
    api_account,
    api_category,
    api_choice_list,
    api_errors,
    api_refund_candidate,
    api_transaction,
    category_api_cache,
    category_catalog_queryset,
)
from .models import (
    Account,
    BankTransaction,
    Category,
    ImportRow,
    RecurringOccurrence,
    RecurringRule,
    SavingsObjective,
    Transaction,
    TransactionAllocation,
)
from .recurring_services import match_recurring_occurrence
from .services import account_balances
from .transaction_services import archive_transaction, create_transfer, reopen_imported_transaction
from .transaction_allocations import (
    TransactionAllocationConflict,
    TransactionAllocationError,
    normalize_allocation_payload,
    replace_transaction_allocations,
)
from .statistics import StatisticsRangeError, annotate_statistics_drilldown, statistics_report_drilldown, validate_statistics_range
from .statistics_views import complete_statistics_date, statistics_json
from .transaction_queries import filtered_movements_from_request, transaction_filter_summary

_MISSING = object()


def _lock_refund_target(refund_for_id):
    if not refund_for_id:
        return
    try:
        refund_for_id = int(refund_for_id)
    except (TypeError, ValueError):
        return
    Transaction.objects.select_for_update().filter(pk=refund_for_id).first()


def _allocation_payload(request, payload=None):
    raw = request.POST.get("allocations", _MISSING) if request.content_type and request.content_type.startswith("multipart/form-data") else (payload or {}).get("allocations", _MISSING)
    if raw is _MISSING:
        return _MISSING
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except ValueError as exc:
            raise TransactionAllocationError("Las partidas no contienen JSON válido.") from exc
    return raw


@require_http_methods(["GET", "POST"])
def api_transactions(request):
    if request.method == "POST":
        if request.content_type and request.content_type.startswith("multipart/form-data"):
            payload = request.POST
            form = TransactionForm(request.POST, request.FILES)
        else:
            try:
                payload = api_json_body(request)
            except ValueError as exc:
                return JsonResponse({"ok": False, "error": str(exc)}, status=400)
            form = TransactionForm(payload)
        try:
            allocations = _allocation_payload(request, payload)
        except TransactionAllocationError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=400)
        with db_transaction.atomic():
            _lock_refund_target(form.data.get("refund_for"))
            if not form.is_valid():
                return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
            if allocations is not _MISSING:
                try:
                    normalize_allocation_payload(
                        allocations,
                        kind=form.cleaned_data["kind"],
                        total=form.cleaned_data["amount"],
                    )
                except TransactionAllocationError as exc:
                    return JsonResponse({"ok": False, "error": str(exc)}, status=400)
            movement = form.save()
            if allocations is not _MISSING:
                movement, _changed = replace_transaction_allocations(movement, allocations)
            match_recurring_occurrence(movement)
            movement = (
                Transaction.objects.select_related("account", "category", "category__parent", "refund_for")
                .prefetch_related("tags", "attachments", "allocations__category", "allocations__category__parent")
                .get(pk=movement.pk)
            )
            return JsonResponse({"ok": True, "transaction": api_transaction(movement)}, status=201)

    attribution_summary = None
    statistics_attribution = request.GET.get("statistics_attribution", "")
    if statistics_attribution and statistics_attribution not in {"report", "purchase"}:
        return JsonResponse({"ok": False, "error": "Modo de atribución estadística no válido."}, status=400)
    if statistics_attribution == "report":
        incompatible_filters = {
            key
            for key in (
                "q",
                "description",
                "month",
                "kind",
                "account",
                "category",
                "category_family",
                "source",
                "statistics_basis",
            )
            if request.GET.get(key)
        }
        if incompatible_filters:
            return JsonResponse(
                {"ok": False, "error": "El detalle estadístico no admite filtros adicionales."},
                status=400,
            )
        report_start = complete_statistics_date(request.GET.get("date_from"))
        report_end = complete_statistics_date(request.GET.get("date_to"))
        analytics_filter = request.GET.get("analytics", "included")
        if analytics_filter not in {"included", "all"}:
            return JsonResponse(
                {"ok": False, "error": "El detalle estadístico solo admite base included o all."},
                status=400,
            )
        basis = "analytics" if analytics_filter == "included" else "all"
        if report_start is None or report_end is None:
            return JsonResponse({"ok": False, "error": "El detalle estadístico requiere dos fechas completas."}, status=400)
        try:
            filtered_movements, attribution_summary = statistics_report_drilldown(
                report_start,
                report_end,
                basis,
            )
        except StatisticsRangeError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    elif statistics_attribution == "purchase":
        selectors = [key for key in ("category", "category_family", "description") if request.GET.get(key)]
        if len(selectors) != 1:
            return JsonResponse(
                {"ok": False, "error": "El detalle por compra requiere una categoría, familia o concepto."},
                status=400,
            )
        selector = selectors[0]
        selector_value = request.GET[selector]
        if selector == "description":
            selector_is_valid = bool(selector_value.strip())
        elif selector == "category_family" and selector_value == "uncategorized":
            selector_is_valid = True
        else:
            try:
                selector_id = int(selector_value)
            except (TypeError, ValueError):
                selector_is_valid = False
            else:
                selector_is_valid = selector_id > 0 and selector_value == str(selector_id)
                if selector_is_valid:
                    selector_query = Category.objects.filter(pk=selector_id, kind=Category.Kind.EXPENSE)
                    if selector == "category_family":
                        selector_query = selector_query.filter(parent__isnull=True)
                    selector_is_valid = selector_query.exists()
        if not selector_is_valid:
            return JsonResponse(
                {"ok": False, "error": "La categoría del detalle por compra no es válida."},
                status=400,
            )
        incompatible_filters = {
            key
            for key in ("q", "month", "kind", "account", "source", "statistics_basis")
            if request.GET.get(key)
        }
        if incompatible_filters:
            return JsonResponse(
                {"ok": False, "error": "El detalle por compra no admite filtros adicionales."},
                status=400,
            )
        attributed_start = complete_statistics_date(request.GET.get("date_from"))
        attributed_end = complete_statistics_date(request.GET.get("date_to"))
        analytics_filter = request.GET.get("analytics", "included")
        if analytics_filter not in {"included", "all", "excluded"}:
            return JsonResponse(
                {"ok": False, "error": "El detalle por compra solo admite base included, excluded o all."},
                status=400,
            )
        if attributed_start is None or attributed_end is None:
            return JsonResponse(
                {"ok": False, "error": "El detalle por compra requiere dos fechas completas."},
                status=400,
            )
        try:
            validate_statistics_range(attributed_start, attributed_end)
        except StatisticsRangeError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=400)
        filtered_movements = filtered_movements_from_request(request).order_by("-date", "-created_at", "-pk")
        attribution_basis = {"included": "analytics", "excluded": "excluded", "all": "all"}[analytics_filter]
        filtered_movements, attribution_summary = annotate_statistics_drilldown(filtered_movements, basis=attribution_basis)
    else:
        filtered_movements = filtered_movements_from_request(request)
    summary = transaction_filter_summary(filtered_movements)
    paginator = Paginator(filtered_movements, 50)
    page_obj = paginator.get_page(request.GET.get("page") or 1)
    page_source = page_obj.object_list
    if hasattr(page_source, "prefetch_related"):
        page_rows = list(page_source.prefetch_related("allocations__category", "allocations__category__parent"))
    else:
        page_rows = list(page_source)
        prefetch_related_objects(page_rows, "allocations__category", "allocations__category__parent")
    account_options = list(Account.objects.filter(active=True))
    balance_cache = account_balances(account_options)
    category_options = list(category_catalog_queryset(active=True))
    category_cache = {category.pk: category for category in category_options}
    allocation_category_ids = {
        row.category_id
        for movement in page_rows
        for row in movement.allocations.all()
        if row.category_id
    }
    category_ids = {movement.category_id for movement in page_rows if movement.category_id} | allocation_category_ids
    category_cache.update(category_api_cache(category_ids - category_cache.keys()))
    manual_transfer_groups = {
        movement.transfer_group
        for movement in page_rows
        if movement.transfer_group and movement.source == Transaction.Source.MANUAL
    }
    fee_transaction_ids = set(
        BankTransaction.objects.filter(fee_transaction_id__in=[movement.pk for movement in page_rows])
        .values_list("fee_transaction_id", flat=True)
    ) if page_rows else set()
    linked_manual_groups = set(
        BankTransaction.objects.filter(transaction__transfer_group__in=manual_transfer_groups)
        .values_list("transaction__transfer_group", flat=True)
    ) if manual_transfer_groups else set()
    response_payload = {
        "count": paginator.count,
        "page": page_obj.number,
        "page_size": paginator.per_page,
        "num_pages": paginator.num_pages,
        "has_next": page_obj.has_next(),
        "has_previous": page_obj.has_previous(),
        "results": [
            api_transaction(
                movement,
                category_cache=category_cache,
                can_reopen=(
                    movement.source in {Transaction.Source.CSV, Transaction.Source.ENABLE_BANKING}
                    or movement.transfer_group in linked_manual_groups
                ),
                can_allocate=movement.pk not in fee_transaction_ids,
            )
            for movement in page_rows
        ],
        "filters": {
            "accounts": [api_account(account, balance=balance_cache[account.pk]) for account in account_options],
            "categories": [api_category(category, category_cache=category_cache) for category in category_options],
            "kinds": [{"value": value, "label": label} for value, label in Transaction.Kind.choices],
            "sources": [{"value": value, "label": label} for value, label in Transaction.Source.choices],
        },
        "summary": summary,
    }
    if attribution_summary is not None:
        response_payload["statistics_attribution"] = statistics_json(attribution_summary)
    return JsonResponse(response_payload)


@require_http_methods(["PATCH"])
@db_transaction.atomic
def api_transaction_detail(request, pk):
    movement = get_object_or_404(Transaction.objects.select_for_update(), pk=pk, archived=False)
    if movement.transfer_group:
        return JsonResponse({"ok": False, "error": "Los traspasos enlazados no se editan; archívalos y crea uno nuevo."}, status=400)
    reserve_occurrence = (
        RecurringOccurrence.objects.select_for_update().select_related("rule").get(pk=movement.recurring_occurrence_id)
        if movement.recurring_occurrence_id else None
    )
    if BankTransaction.objects.filter(fee_transaction_id=movement.pk).exists():
        return JsonResponse(
            {"ok": False, "error": "La comisión forma parte de un traspaso enlazado; reabre el origen bancario para modificarla."},
            status=400,
        )
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    try:
        allocations = _allocation_payload(request, payload)
    except TransactionAllocationError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    current = {
        "kind": movement.kind,
        "amount": movement.amount,
        "account": movement.account_id,
        "date": movement.date.isoformat(),
        "description": movement.description,
        "category": movement.category_id or "",
        "refund_for": movement.refund_for_id or "",
        "notes": movement.notes,
        "tag_names": ", ".join(movement.tags.values_list("name", flat=True)),
    }
    # ModelForm._post_clean mutates the instance during is_valid(); retain the persisted values for this guard.
    persisted_kind = movement.kind
    persisted_amount = movement.amount
    persisted_category_id = movement.category_id
    persisted_date = movement.date
    persisted_account_id = movement.account_id
    current.update(payload)
    for refund_for_id in (movement.refund_for_id, current.get("refund_for")):
        _lock_refund_target(refund_for_id)
    form = TransactionForm(current, instance=movement)
    if not form.is_valid():
        return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
    locked_annual_payment = bool(
        reserve_occurrence
        and reserve_occurrence.status == RecurringOccurrence.Status.CONFIRMED
        and (
            reserve_occurrence.reserve_objective_id
            or reserve_occurrence.reserve_consumed_amount
            or (reserve_occurrence.rule.kind == Category.Kind.EXPENSE and reserve_occurrence.rule.frequency == RecurringRule.Frequency.YEARLY)
            or SavingsObjective.objects.filter(recurring_rule_id=reserve_occurrence.rule_id).exists()
        )
    )
    if locked_annual_payment and (
        form.cleaned_data["kind"] != persisted_kind
        or form.cleaned_data["amount"] != persisted_amount
        or form.cleaned_data["date"] != persisted_date
        or form.cleaned_data["account"].pk != persisted_account_id
    ):
        return JsonResponse({"ok": False, "code": "annual_reserve_payment_locked", "error": "Reabre el cargo anual antes de cambiar importe, fecha, tipo o cuenta para conservar la reserva."}, status=409)
    existing_allocations = TransactionAllocation.objects.filter(transaction=movement).exists()
    if existing_allocations and allocations is _MISSING and (
        form.cleaned_data["amount"] != persisted_amount
        or (form.cleaned_data["category"].pk if form.cleaned_data["category"] else None) != persisted_category_id
        or form.cleaned_data["kind"] != persisted_kind
    ):
        return JsonResponse(
            {"ok": False, "error": "Incluye allocations para mantener la suma de las partidas al cambiar importe o categoría."},
            status=400,
        )
    if allocations is not _MISSING:
        try:
            normalize_allocation_payload(
                allocations,
                kind=form.cleaned_data["kind"],
                total=form.cleaned_data["amount"],
            )
        except TransactionAllocationError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=400)
        if "expected_allocation_revision" not in payload:
            return JsonResponse({"ok": False, "error": "expected_allocation_revision es obligatorio."}, status=400)
        expected_allocation_revision = payload["expected_allocation_revision"]
        if type(expected_allocation_revision) is not int or expected_allocation_revision < 0:
            return JsonResponse({"ok": False, "error": "expected_allocation_revision no es válido."}, status=400)
    try:
        with db_transaction.atomic():
            if not Transaction.objects.filter(pk=movement.pk, archived=False).exists():
                return JsonResponse({"ok": False, "error": "El movimiento cambió durante la edición; vuelve a cargarlo."}, status=409)
            form.save(force_update=True)
            if allocations is not _MISSING:
                movement = Transaction.objects.select_for_update().get(pk=movement.pk)
                replace_transaction_allocations(
                    movement,
                    allocations,
                    expected_revision=expected_allocation_revision,
                )
    except TransactionAllocationConflict as exc:
        return JsonResponse({"ok": False, "code": "stale_allocation_revision", "error": str(exc)}, status=409)
    except TransactionAllocationError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    except DatabaseError:
        if not Transaction.objects.filter(pk=movement.pk, archived=False).exists():
            return JsonResponse({"ok": False, "error": "El movimiento cambió durante la edición; vuelve a cargarlo."}, status=409)
        raise
    movement = (
        Transaction.objects.select_related("account", "category", "category__parent", "refund_for")
        .prefetch_related("tags", "attachments", "allocations__category", "allocations__category__parent")
        .get(pk=movement.pk)
    )
    return JsonResponse({"ok": True, "transaction": api_transaction(movement)})


@require_POST
def api_transaction_archive(request, pk):
    movement = get_object_or_404(Transaction, pk=pk, archived=False)
    try:
        removed = archive_transaction(movement)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    return JsonResponse({"ok": True, "removed": removed, "removed_type": "transaction", "message": "Movimiento archivado."})


@require_POST
def api_transaction_reopen(request, pk):
    movement = get_object_or_404(Transaction, pk=pk, archived=False)
    try:
        result = reopen_imported_transaction(movement)
    except (ValueError, ImportRow.DoesNotExist, BankTransaction.DoesNotExist) as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    return JsonResponse(
        {
            "ok": True,
            "removed_type": "transaction",
            "message": "Movimiento reabierto para revisión.",
            **result,
        }
    )
@require_POST
@db_transaction.atomic
def api_transaction_bulk_category(request):
    try:
        payload = api_json_body(request)
        row_ids = [int(row_id) for row_id in payload.get("rows", [])]
        category_id = int(payload.get("category"))
    except (TypeError, ValueError, json.JSONDecodeError):
        return JsonResponse({"ok": False, "error": "Selecciona movimientos y una categoría válida."}, status=400)
    row_ids = list(dict.fromkeys(row_ids))
    if not row_ids:
        return JsonResponse({"ok": False, "error": "Selecciona al menos un movimiento."}, status=400)
    category = Category.objects.select_for_update().filter(pk=category_id, active=True).first()
    if not category:
        return JsonResponse({"ok": False, "error": "La categoría seleccionada no está disponible."}, status=400)
    movements = list(
        Transaction.objects.select_for_update()
        .filter(pk__in=row_ids, archived=False)
        .select_related("category")
        .order_by("pk")
    )
    if len(movements) != len(row_ids):
        return JsonResponse({"ok": False, "error": "Uno de los movimientos ya no está disponible."}, status=400)
    if any(movement.transfer_group for movement in movements):
        return JsonResponse({"ok": False, "error": "Los traspasos no se recategorizan en lote."}, status=400)
    if TransactionAllocation.objects.filter(transaction_id__in=row_ids).exists():
        return JsonResponse({"ok": False, "error": "Los movimientos repartidos deben editarse por separado para conservar sus partidas."}, status=400)
    if any(movement.kind != category.kind for movement in movements):
        return JsonResponse({"ok": False, "error": "Todos los movimientos deben corresponder al tipo de la categoría."}, status=400)
    for movement in movements:
        movement.category = category
        movement.full_clean()
        movement.save(update_fields=["category", "updated_at"])
    return JsonResponse({"ok": True, "updated": sorted(row_ids), "message": f"{len(row_ids)} movimientos recategorizados."})


@require_POST
def api_transfer_create(request):
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    form = TransferForm(payload)
    if not form.is_valid():
        return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
    try:
        outgoing, incoming = create_transfer(
            source_account=form.cleaned_data["source_account"],
            target_account=form.cleaned_data["target_account"],
            amount=form.cleaned_data["amount"],
            tx_date=form.cleaned_data["date"],
            description=form.cleaned_data["description"],
            notes=form.cleaned_data["notes"],
        )
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    movements = (
        Transaction.objects.filter(pk__in=[outgoing.pk, incoming.pk])
        .select_related("account", "category", "category__parent", "refund_for")
        .prefetch_related("tags", "attachments")
    )
    return JsonResponse({"ok": True, "transactions": [api_transaction(movement) for movement in movements]}, status=201)


@require_GET
def api_options(request):
    refund_candidates = (
        Transaction.objects.filter(archived=False, kind=Transaction.Kind.EXPENSE, transfer_group__isnull=True)
        .order_by("-date", "-created_at")[:100]
    )
    return JsonResponse(
        {
            # Keep the pre-lazy-loading shape for the currently deployed React
            # client.  The new client reads these facts from bootstrap, but the
            # backend release precedes it and must not leave Movimientos unusable.
            "accounts": [api_account(account) for account in Account.objects.filter(active=True)],
            "categories": [api_category(category) for category in category_catalog_queryset(active=True)],
            "refund_candidates": [api_refund_candidate(movement) for movement in refund_candidates],
            "account_kinds": api_choice_list(Account.Kind.choices),
            "category_kinds": api_choice_list(Category.Kind.choices),
            "transaction_kinds": api_choice_list([(Transaction.Kind.EXPENSE, "Gasto"), (Transaction.Kind.INCOME, "Ingreso")]),
            "transaction_sources": api_choice_list(Transaction.Source.choices),
            "recurring_frequencies": api_choice_list(RecurringRule.Frequency.choices),
        }
    )
