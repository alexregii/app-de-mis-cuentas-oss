"""Category catalog and category-rule API boundary."""

from datetime import timedelta
from decimal import Decimal

from django.db import transaction as db_transaction
from django.db.models import Count, Max, Q, Sum
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST, require_http_methods

from .api_helpers import api_json_body
from .api_serializers import (
    api_category,
    api_category_rule,
    api_category_rule_application,
    api_errors,
    api_money,
    api_transaction,
    category_catalog_queryset,
)
from .forms import CategoryForm, CategoryRuleForm
from .models import (
    BankTransaction,
    Budget,
    Category,
    CategoryMergeOperation,
    CategoryRule,
    CategoryRuleApplication,
    ImportRow,
    Transaction,
    TransactionAllocation,
)
from .category_services import apply_category_rule_historically, preview_category_rule, restore_category_rule_record


@require_http_methods(["GET", "POST"])
def api_categories(request):
    if request.method == "POST":
        try:
            payload = api_json_body(request)
        except ValueError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=400)
        form = CategoryForm(payload)
        if not form.is_valid():
            return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
        category = form.save()
        return JsonResponse({"ok": True, "category": api_category(category)}, status=201)
    categories = list(category_catalog_queryset().order_by("kind", "parent__sort_order", "sort_order", "name"))
    children_by_parent = {}
    for category in categories:
        children_by_parent.setdefault(category.parent_id, []).append(category)
    return JsonResponse(
        {
            "categories": [api_category(category) for category in categories],
            "roots": [
                {
                    **api_category(category),
                    "children": [api_category(child) for child in children_by_parent.get(category.pk, [])],
                }
                for category in children_by_parent.get(None, [])
            ],
        }
    )


@require_http_methods(["PATCH"])
def api_category_detail(request, pk):
    category = get_object_or_404(Category, pk=pk)
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    current = {
        "name": category.name,
        "kind": category.kind,
        "parent": category.parent_id or "",
        "color": category.color,
        "icon": category.icon,
        "active": category.active,
        "exclude_from_analytics": category.exclude_from_analytics,
    }
    current.update(payload)
    form = CategoryForm(current, instance=category)
    if not form.is_valid():
        return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
    category = form.save()
    return JsonResponse({"ok": True, "category": api_category(category)})


def _category_impact(category):
    legacy_transactions = category.transactions.filter(transfer_group__isnull=True)
    allocation_rows = category.transaction_allocations.filter(transaction__transfer_group__isnull=True)
    return {
        "category": api_category(category),
        "transactions": legacy_transactions.count() + allocation_rows.values("transaction_id").distinct().count(),
        "transaction_total": api_money(
            (legacy_transactions.aggregate(total=Sum("amount"))["total"] or 0)
            + (allocation_rows.aggregate(total=Sum("amount"))["total"] or 0)
        ),
        "budgets": category.budgets.count(),
        "rules": category.rules.count(),
        "imports": ImportRow.objects.filter(category=category).count(),
        "children": category.children.filter(active=True).count(),
    }


@require_POST
def api_category_preview_deactivate(request, pk):
    category = get_object_or_404(Category, pk=pk)
    return JsonResponse({"ok": True, "impact": _category_impact(category)})


@require_POST
def api_category_deactivate(request, pk):
    category = get_object_or_404(Category, pk=pk)
    if category.children.filter(active=True).exists():
        return JsonResponse({"ok": False, "errors": {"category": ["Resuelve primero las subcategorías activas."]}}, status=400)
    category.active = False
    category.deactivated_at = timezone.now()
    category.save(update_fields=["active", "deactivated_at"])
    return JsonResponse({"ok": True, "category": api_category(category)})


@require_http_methods(["PUT"])
def api_category_order(request):
    payload = api_json_body(request)
    categories = {category.pk: category.parent_id for category in Category.objects.all()}
    proposed_parents = dict(categories)
    for item in payload.get("order", []):
        category_id = item.get("id")
        parent_id = item.get("parent_id")
        if category_id not in categories or (parent_id is not None and parent_id not in categories):
            return JsonResponse({"ok": False, "errors": {"order": ["La categoría indicada no existe."]}}, status=400)
        proposed_parents[category_id] = parent_id
    for category_id in proposed_parents:
        visited = set()
        current = category_id
        while current is not None:
            if current in visited:
                return JsonResponse({"ok": False, "errors": {"order": ["Una categoría no puede depender de sí misma ni de una subcategoría."]}}, status=400)
            visited.add(current)
            current = proposed_parents.get(current)
    with db_transaction.atomic():
        for index, item in enumerate(payload.get("order", [])):
            Category.objects.filter(pk=item.get("id")).update(sort_order=index, parent_id=item.get("parent_id"))
    return JsonResponse({"ok": True})


@require_http_methods(["PUT"])
def api_category_favorites(request):
    payload = api_json_body(request)
    favorite_ids = {int(value) for value in payload.get("category_ids", [])}
    Category.objects.update(is_favorite=False)
    Category.objects.filter(pk__in=favorite_ids, active=True).update(is_favorite=True)
    return JsonResponse({"ok": True})


@require_GET
def api_category_duplicates(request):
    groups = Category.objects.values("kind", "parent_id", "name").annotate(total=Count("id")).filter(total__gt=1)
    return JsonResponse({"groups": [[api_category(item) for item in Category.objects.filter(kind=group["kind"], parent_id=group["parent_id"], name=group["name"])] for group in groups]})


@require_GET
def api_category_unused(request):
    cutoff = timezone.localdate() - timedelta(days=int(request.GET.get("days", 365)))
    categories = Category.objects.annotate(last_used_at=Max("transactions__date")).filter(
        transactions__isnull=True,
        transaction_allocations__isnull=True,
        budgets__isnull=True,
        rules__isnull=True,
        importrow__isnull=True,
    ).distinct()
    return JsonResponse({"categories": [api_category(item) for item in categories], "cutoff": cutoff.isoformat()})


@require_GET
def api_category_transactions(request, pk):
    category = get_object_or_404(Category, pk=pk)
    movements = (
        Transaction.objects.filter(archived=False)
        .filter(Q(category=category) | Q(allocations__category=category))
        .distinct()
        .select_related("account", "category", "category__parent")
        .prefetch_related("allocations__category", "allocations__category__parent")
        .order_by("-date")[:100]
    )
    return JsonResponse({"transactions": [api_transaction(item) for item in movements]})


@require_POST
def api_category_merge_preview(request):
    payload = api_json_body(request)
    source_ids = [int(value) for value in payload.get("source_ids", [])]
    destination = get_object_or_404(Category, pk=payload.get("destination_id"))
    sources = Category.objects.filter(pk__in=source_ids).exclude(pk=destination.pk)
    if any(source.kind != destination.kind for source in sources):
        return JsonResponse({"ok": False, "errors": {"destination_id": ["No se pueden mezclar ingresos y gastos."]}}, status=400)
    impacts = [_category_impact(source) for source in sources]
    return JsonResponse({"ok": True, "destination": api_category(destination), "sources": impacts, "totals": {key: sum(item[key] for item in impacts) for key in ["transactions", "budgets", "rules", "imports"]}})


@require_POST
def api_category_merge(request):
    payload = api_json_body(request)
    source_ids = [int(value) for value in payload.get("source_ids", [])]
    destination = get_object_or_404(Category, pk=payload.get("destination_id"))
    sources = list(Category.objects.select_for_update().filter(pk__in=source_ids).exclude(pk=destination.pk))
    if not sources or any(source.kind != destination.kind for source in sources):
        return JsonResponse({"ok": False, "errors": {"source_ids": ["Las categorías deben ser compatibles y distintas del destino."]}}, status=400)
    with db_transaction.atomic():
        snapshot = {"categories": [], "transactions": [], "budgets": [], "rules": [], "imports": []}
        transaction_snapshots = {}
        for source in sources:
            snapshot["categories"].append({"id": source.pk, "active": source.active, "merged_into": source.merged_into_id})
            for item in source.transactions.all():
                transaction_snapshots.setdefault(item.pk, {
                    "id": item.pk,
                    "category": item.category_id,
                    "kind": item.kind,
                    "amount": str(item.amount),
                    "allocations": [],
                })
            for allocation in source.transaction_allocations.select_related("transaction").order_by("transaction_id", "position"):
                item = transaction_snapshots.setdefault(
                    allocation.transaction_id,
                    {
                        "id": allocation.transaction_id,
                        "category": allocation.transaction.category_id,
                        "kind": allocation.transaction.kind,
                        "amount": str(allocation.transaction.amount),
                        "allocations": [],
                    },
                )
                if not item["allocations"]:
                    item["allocations"] = [
                        {"category": row.category_id, "amount": str(row.amount), "position": row.position}
                        for row in allocation.transaction.allocations.all()
                    ]
            for item in source.budgets.all():
                snapshot["budgets"].append({"id": item.pk, "category": source.pk})
            for item in source.rules.all():
                snapshot["rules"].append({"id": item.pk, "category": source.pk})
            for item in ImportRow.objects.filter(category=source):
                snapshot["imports"].append({"id": item.pk, "category": source.pk})
            source.budgets.update(category=destination)
            source.rules.update(category=destination)
            ImportRow.objects.filter(category=source).update(category=destination)
            source.active = False
            source.merged_into = destination
            source.deactivated_at = timezone.now()
            source.save(update_fields=["active", "merged_into", "deactivated_at"])
        for item in transaction_snapshots.values():
            movement = Transaction.objects.select_for_update().get(pk=item["id"])
            if item["allocations"]:
                merged_parts = {}
                for part in item["allocations"]:
                    category_id = destination.pk if part["category"] in source_ids else part["category"]
                    current = merged_parts.get(category_id)
                    if current:
                        current["amount"] = str(Decimal(current["amount"]) + Decimal(part["amount"]))
                        current["position"] = min(current["position"], part["position"])
                    else:
                        merged_parts[category_id] = {
                            "category": category_id,
                            "amount": part["amount"],
                            "position": part["position"],
                        }
                TransactionAllocation.objects.filter(transaction=movement).delete()
                ordered_parts = sorted(merged_parts.values(), key=lambda part: part["position"])
                if len(ordered_parts) == 1:
                    movement.category_id = ordered_parts[0]["category"]
                else:
                    movement.category_id = None
                    TransactionAllocation.objects.bulk_create([
                        TransactionAllocation(
                            transaction=movement,
                            category_id=part["category"],
                            amount=Decimal(part["amount"]),
                            position=position,
                        )
                        for position, part in enumerate(ordered_parts)
                    ])
                movement.allocation_revision += 1
                movement.save(update_fields=["category", "allocation_revision", "updated_at"])
                item["merged_allocation_revision"] = movement.allocation_revision
            elif item["category"] in source_ids:
                movement.category_id = destination.pk
                movement.save(update_fields=["category", "updated_at"])
            item["merged_category"] = movement.category_id
        snapshot["transactions"] = list(transaction_snapshots.values())
        operation = CategoryMergeOperation.objects.create(source_categories=source_ids, destination=destination, transaction_count=len(snapshot["transactions"]), budget_count=len(snapshot["budgets"]), rule_count=len(snapshot["rules"]), import_count=len(snapshot["imports"]), user=request.user if request.user.is_authenticated else None, snapshot=snapshot)
    return JsonResponse({"ok": True, "operation": {"id": operation.pk, "reversible": operation.reversible}, "category": api_category(destination)})


@require_POST
def api_category_merge_undo(request, pk):
    operation = get_object_or_404(CategoryMergeOperation, pk=pk)
    if operation.status != CategoryMergeOperation.Status.COMPLETED or not operation.reversible:
        return JsonResponse({"ok": False, "error": "La fusión ya no es reversible."}, status=400)
    partial = False
    with db_transaction.atomic():
        for item in operation.snapshot.get("transactions", []):
            movement = Transaction.objects.select_for_update().filter(pk=item["id"]).first()
            if not movement:
                partial = True
                continue
            if item.get("allocations"):
                if (
                    movement.allocation_revision != item.get("merged_allocation_revision")
                    or movement.category_id != item.get("merged_category")
                    or (item.get("kind") is not None and movement.kind != item["kind"])
                    or (item.get("amount") is not None and movement.amount != Decimal(item["amount"]))
                ):
                    partial = True
                    continue
                TransactionAllocation.objects.filter(transaction=movement).delete()
                TransactionAllocation.objects.bulk_create([
                    TransactionAllocation(
                        transaction=movement,
                        category_id=part["category"],
                        amount=Decimal(part["amount"]),
                        position=part["position"],
                    )
                    for part in item["allocations"]
                ])
                movement.category_id = item["category"]
                movement.allocation_revision += 1
                movement.save(update_fields=["category", "allocation_revision", "updated_at"])
            elif movement.category_id == item.get("merged_category"):
                movement.category_id = item["category"]
                movement.save(update_fields=["category", "updated_at"])
            else:
                partial = True
        for item in operation.snapshot.get("budgets", []): Budget.objects.filter(pk=item["id"], category=operation.destination).update(category_id=item["category"])
        for item in operation.snapshot.get("rules", []): CategoryRule.objects.filter(pk=item["id"], category=operation.destination).update(category_id=item["category"])
        for item in operation.snapshot.get("imports", []): ImportRow.objects.filter(pk=item["id"], category=operation.destination).update(category_id=item["category"])
        for item in operation.snapshot.get("categories", []): Category.objects.filter(pk=item["id"]).update(active=item["active"], merged_into_id=item["merged_into"] , deactivated_at=None)
        operation.status = CategoryMergeOperation.Status.PARTIAL if partial else CategoryMergeOperation.Status.UNDONE
        operation.reversible = False
        operation.save(update_fields=["status", "reversible"])
    return JsonResponse({"ok": True, "partial": partial})


@require_http_methods(["GET", "POST"])
def api_category_rules(request):
    if request.method == "POST":
        try:
            payload = api_json_body(request)
        except ValueError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=400)
        form = CategoryRuleForm(payload)
        if not form.is_valid():
            return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
        rule = form.save()
        return JsonResponse({"ok": True, "rule": api_category_rule(rule)}, status=201)
    rules = CategoryRule.objects.select_related("category", "category__parent", "account").order_by("priority", "description")
    return JsonResponse({"rules": [api_category_rule(rule) for rule in rules]})


@require_GET
def api_category_rule_applications(request):
    try:
        limit = int(request.GET.get("limit", "20"))
        offset = int(request.GET.get("offset", "0"))
    except ValueError:
        return JsonResponse({"ok": False, "error": "Paginación no válida."}, status=400)
    if limit < 1 or limit > 50 or offset < 0:
        return JsonResponse({"ok": False, "error": "Paginación fuera de rango."}, status=400)
    rows = list(
        CategoryRuleApplication.objects.select_related("rule")
        .order_by("-applied_at", "-pk")[offset:offset + limit + 1]
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    return JsonResponse({
        "applications": [api_category_rule_application(application) for application in rows],
        "next_offset": offset + limit if has_more else None,
    })


@require_http_methods(["PATCH", "DELETE"])
def api_category_rule_detail(request, pk):
    rule = get_object_or_404(CategoryRule.objects.select_related("category", "category__parent"), pk=pk)
    if request.method == "DELETE":
        rule_pk = rule.pk
        rule.active = False
        rule.save(update_fields=["active", "updated_at"])
        return JsonResponse({"ok": True, "removed": [rule_pk], "removed_type": "category_rule", "message": "Regla eliminada."})
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    current = {"description": rule.description, "kind": rule.kind, "category": rule.category_id, "active": rule.active}
    current.update(payload)
    form = CategoryRuleForm(current, instance=rule)
    if not form.is_valid():
        return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
    rule = form.save()
    return JsonResponse({"ok": True, "rule": api_category_rule(rule)})


@require_POST
def api_category_rule_apply(request, pk):
    rule = get_object_or_404(CategoryRule.objects.select_related("category"), pk=pk)
    result = apply_category_rule_historically(rule)
    return JsonResponse({"ok": True, "result": result, "message": f"Regla aplicada. {result['total']} registros actualizados."})


@require_POST
def api_category_rule_preview(request, pk):
    rule = get_object_or_404(CategoryRule.objects.select_related("category", "account"), pk=pk)
    result = preview_category_rule(rule)
    result.pop("transaction_objects", None); result.pop("bank_objects", None); result.pop("csv_objects", None)
    rule.last_tested_at = timezone.now(); rule.last_test_result = result
    rule.save(update_fields=["last_tested_at", "last_test_result", "updated_at"])
    return JsonResponse({"ok": True, "result": result})


@require_POST
def api_category_rule_undo(request, pk, application_id):
    with db_transaction.atomic():
        # Claim with a conditional write before reading the audit. This also
        # serializes undo requests on SQLite, where select_for_update is a no-op.
        claimed = CategoryRuleApplication.objects.filter(
            pk=application_id,
            rule_id=pk,
            status=CategoryRuleApplication.Status.COMPLETED,
            reversible=True,
        ).update(reversible=False)
        if not claimed:
            application = get_object_or_404(
                CategoryRuleApplication.objects.select_for_update(),
                pk=application_id,
                rule_id=pk,
            )
            if application.status == CategoryRuleApplication.Status.UNDONE:
                return JsonResponse({"ok": True, "partial": False, "application_id": application.pk, "idempotent": True})
            if application.status == CategoryRuleApplication.Status.PARTIAL:
                return JsonResponse({"ok": True, "partial": True, "application_id": application.pk, "idempotent": True})
            return JsonResponse({"ok": False, "error": "Esta aplicación ya no está disponible para deshacer."}, status=409)

        application = CategoryRuleApplication.objects.select_for_update().get(pk=application_id, rule_id=pk)
        partial = False
        for item in application.affected_records or []:
            if not restore_category_rule_record(item):
                partial = True
        application.status = CategoryRuleApplication.Status.PARTIAL if partial else CategoryRuleApplication.Status.UNDONE
        application.reversible = False
        application.save(update_fields=["status", "reversible"])
    return JsonResponse({"ok": True, "partial": partial, "application_id": application.pk})


@require_http_methods(["PUT"])
def api_category_rule_order(request):
    payload = api_json_body(request)
    with db_transaction.atomic():
        for priority, rule_id in enumerate(payload.get("rule_ids", []), start=1):
            CategoryRule.objects.filter(pk=rule_id).update(priority=priority)
    return JsonResponse({"ok": True})


@require_GET
def api_category_rule_conflicts(request):
    rules = list(CategoryRule.objects.filter(active=True).select_related("category", "account"))
    conflicts = []
    for index, first in enumerate(rules):
        for second in rules[index + 1:]:
            same_scope = first.kind == second.kind and (not first.account_id or not second.account_id or first.account_id == second.account_id)
            first_text = first.normalized_description
            second_text = second.normalized_description
            exact_overlap = first_text == second_text
            partial_overlap = (
                (first.match_mode != CategoryRule.MatchMode.EXACT and first_text in second_text)
                or (second.match_mode != CategoryRule.MatchMode.EXACT and second_text in first_text)
            )
            overlaps = exact_overlap or partial_overlap
            ranges = (first.amount_min is None or second.amount_max is None or first.amount_min <= second.amount_max) and (second.amount_min is None or first.amount_max is None or second.amount_min <= first.amount_max)
            if same_scope and overlaps and ranges and first.category_id != second.category_id:
                conflicts.append({"rule_a": api_category_rule(first), "rule_b": api_category_rule(second), "reason": "Condiciones solapadas con categorías distintas."})
    return JsonResponse({"conflicts": conflicts})


@require_POST
def api_category_rule_from_transaction(request, pk):
    movement = get_object_or_404(Transaction, pk=pk)
    return JsonResponse({"ok": True, "prefill": {"description": movement.description, "kind": "expense" if movement.kind == Transaction.Kind.EXPENSE else "income", "category": movement.category_id, "account": movement.account_id, "amount_min": str(movement.amount), "amount_max": str(movement.amount)}})
