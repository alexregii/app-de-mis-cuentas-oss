"""CSV import and review API boundary."""

from django.core.paginator import Paginator
from django.db import transaction as db_transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_GET, require_POST, require_http_methods

from .api_helpers import api_json_body
from .api_serializers import (
    api_account,
    api_category,
    api_errors,
    api_import_batch_payload,
    api_import_profile,
    api_import_row,
    category_api_cache,
)
from .forms import CSVUploadForm, ImportProfileForm
from .models import Account, Category, CategoryRule, ImportBatch, ImportProfile, ImportRow
from .import_services import confirm_import_row, get_or_create_import_category, parse_csv_upload
from .category_services import is_reopened_split_origin, iter_matching_category_rules


@require_GET
def api_imports(request):
    default_profile_id = ImportProfile.objects.filter(name="CSV genérico").values_list("pk", flat=True).first()
    return JsonResponse(
        {
            "profiles": [api_import_profile(profile) for profile in ImportProfile.objects.all()],
            "default_profile_id": default_profile_id,
            "batches": [api_import_batch_payload(batch) for batch in ImportBatch.objects.select_related("account", "profile")[:20]],
            "accounts": [api_account(account) for account in Account.objects.filter(active=True)],
        }
    )


@require_POST
def api_import_profiles(request):
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    form = ImportProfileForm(payload)
    if not form.is_valid():
        return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
    profile = form.save()
    return JsonResponse({"ok": True, "profile": api_import_profile(profile)}, status=201)


@require_POST
def api_import_upload(request):
    form = CSVUploadForm(request.POST, request.FILES)
    if not form.is_valid():
        return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
    try:
        batch = parse_csv_upload(form.cleaned_data["file"], form.cleaned_data["account"], form.cleaned_data["profile"])
    except (KeyError, ValueError, UnicodeDecodeError) as exc:
        return JsonResponse({"ok": False, "errors": {"file": [f"No se pudo leer el CSV: {exc}"]}}, status=400)
    return JsonResponse({"ok": True, "batch": api_import_batch_payload(batch)}, status=201)


@require_POST
def api_import_batch_confirm(request, pk):
    batch = get_object_or_404(ImportBatch, pk=pk)
    imported = 0
    removed = []
    try:
        with db_transaction.atomic():
            for row in batch.rows.filter(status=ImportRow.Status.PENDING, possible_duplicate=False).select_related("batch", "category"):
                confirm_import_row(row)
                imported += 1
                removed.append(row.pk)
            if not batch.rows.filter(status=ImportRow.Status.PENDING).exists():
                batch.status = ImportBatch.Status.COMPLETED
                batch.save(update_fields=["status"])
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    return JsonResponse({"ok": True, "message": f"{imported} filas importadas. Los posibles duplicados siguen pendientes.", "imported": imported, "removed": removed})


@require_http_methods(["GET", "DELETE"])
def api_import_batch(request, pk):
    batch = get_object_or_404(ImportBatch.objects.select_related("account", "profile"), pk=pk)
    if request.method == "DELETE":
        if batch.rows.filter(transaction__isnull=False).exists():
            return JsonResponse({"ok": False, "error": "No se puede eliminar un lote CSV que ya creó movimientos."}, status=400)
        filename = batch.filename
        batch.delete()
        return JsonResponse({"ok": True, "message": f"Lote CSV {filename} eliminado."})
    return JsonResponse({"batch": api_import_batch_payload(batch)})


@require_GET
def api_import_rows(request, pk):
    batch = get_object_or_404(ImportBatch.objects.select_related("account", "profile"), pk=pk)
    row_queryset = batch.rows.select_related("category", "category__parent", "transaction", "transaction__refund_for").prefetch_related(
        "transaction__allocations__category", "transaction__allocations__category__parent"
    )
    status = request.GET.get("status")
    if status:
        row_queryset = row_queryset.filter(status=status)
    paginator = Paginator(row_queryset, 100)
    page_obj = paginator.get_page(request.GET.get("page") or 1)
    page_rows = list(page_obj.object_list)
    rules = list(CategoryRule.objects.filter(active=True).select_related("category").order_by("priority", "description", "pk"))
    matching_rules = {
        row.pk: list(iter_matching_category_rules(row.description, row.amount, row.kind, batch.account_id, rules=rules))
        for row in page_rows
        if row.status == ImportRow.Status.PENDING and not is_reopened_split_origin(row)
    }
    categories = list(Category.objects.filter(active=True).select_related("parent"))
    category_cache = {category.pk: category for category in categories}
    category_cache.update(category_api_cache(
        {rule.category_id for matches in matching_rules.values() for rule in matches} - category_cache.keys()
    ))
    return JsonResponse(
        {
            "batch": api_import_batch_payload(batch),
            "count": paginator.count,
            "page": page_obj.number,
            "num_pages": paginator.num_pages,
            "has_next": page_obj.has_next(),
            "has_previous": page_obj.has_previous(),
            "results": [api_import_row(row, category_rule_matches=matching_rules.get(row.pk, ()), category_cache=category_cache) for row in page_rows],
            "categories": [api_category(category, category_cache=category_cache) for category in categories],
        }
    )


@require_POST
def api_import_row_action(request, pk, action):
    row = get_object_or_404(ImportRow.objects.select_related("batch", "category"), pk=pk)
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    preserves_split = row.status == ImportRow.Status.PENDING and is_reopened_split_origin(row)
    category_change_requested = action == "category" or (
        action in {"confirm", "force"}
        and (
            payload.get("category") not in (None, "", 0, "0")
            or bool(str(payload.get("new_category") or "").strip())
            or bool(str(payload.get("new_subcategory") or "").strip())
        )
    )
    if preserves_split and category_change_requested:
        return JsonResponse({"ok": False, "error": "El reparto existente se conserva al reconfirmar y no admite una categoría única."}, status=409)
    if "category" in payload:
        row.category_id = payload.get("category") or None
        row.save(update_fields=["category"])
    if payload.get("new_category"):
        row.category = get_or_create_import_category(row.kind, payload["new_category"], payload.get("new_subcategory", ""))
        row.save(update_fields=["category"])
    if action == "category":
        return JsonResponse({"ok": True, "row": api_import_row(row), "message": f"Categoría de la fila {row.row_number} actualizada."})
    try:
        if action == "force":
            row.possible_duplicate = False
            row.save(update_fields=["possible_duplicate"])
            confirm_import_row(row)
        elif action == "confirm":
            confirm_import_row(row)
        elif action == "skip":
            row.status = ImportRow.Status.SKIPPED
            row.save(update_fields=["status"])
        else:
            return JsonResponse({"ok": False, "error": "Acción de importación no válida."}, status=400)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    if not row.batch.rows.filter(status=ImportRow.Status.PENDING).exists():
        row.batch.status = ImportBatch.Status.COMPLETED
        row.batch.save(update_fields=["status"])
    return JsonResponse({"ok": True, "removed": [row.pk], "message": f"Fila {row.row_number} procesada."})


@require_POST
def api_import_review_bulk(request, pk):
    batch = get_object_or_404(ImportBatch, pk=pk)
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    action = payload.get("action", "")
    rows = batch.rows.filter(status=ImportRow.Status.PENDING).select_related("batch", "category")
    if action == "import_safe":
        rows = rows.filter(possible_duplicate=False)
        action = "confirm"
    else:
        selected = payload.get("rows") or []
        if not selected:
            return JsonResponse({"ok": False, "error": "Selecciona al menos una fila."}, status=400)
        rows = rows.filter(pk__in=selected)
    category_map = {str(key): value for key, value in (payload.get("categories") or {}).items()}
    removed = []
    failed = []
    for row in rows:
        category_id = category_map.get(str(row.pk))
        if category_id:
            if is_reopened_split_origin(row):
                failed.append(row.pk)
                continue
            row.category = Category.objects.filter(pk=category_id, kind=row.kind).first()
            if not row.category:
                failed.append(row.pk)
                continue
            row.save(update_fields=["category"])
        try:
            if action == "force":
                row.possible_duplicate = False
                row.save(update_fields=["possible_duplicate"])
                confirm_import_row(row)
            elif action == "confirm":
                confirm_import_row(row)
            elif action == "skip":
                row.status = ImportRow.Status.SKIPPED
                row.save(update_fields=["status"])
            else:
                failed.append(row.pk)
                continue
        except ValueError:
            failed.append(row.pk)
        else:
            removed.append(row.pk)
    if not batch.rows.filter(status=ImportRow.Status.PENDING).exists():
        batch.status = ImportBatch.Status.COMPLETED
        batch.save(update_fields=["status"])
    message = f"{len(removed)} filas procesadas."
    if failed:
        message += f" {len(failed)} requieren revisión individual."
    return JsonResponse({"ok": True, "removed": removed, "failed": failed, "message": message})
