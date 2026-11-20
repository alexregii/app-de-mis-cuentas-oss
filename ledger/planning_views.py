"""Planning, budgets, recurring rules, and savings-goal API boundary."""

from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.core import signing
from django.db import IntegrityError, OperationalError, transaction
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.views.decorators.http import require_GET, require_POST, require_http_methods

from .api_helpers import api_json_body
from .api_serializers import (
    api_account,
    api_budget,
    api_budget_item,
    api_category,
    api_date,
    api_datetime,
    api_errors,
    api_metrics,
    api_money,
    api_occurrence,
    api_planning_subscription_candidate,
    api_projection,
    api_recurring_rule,
    api_savings_objective,
    api_savings_objective_summary,
    api_transaction,
)
from .forms import BudgetForm, RecurringRuleForm, SavingsGoalForm
from .liquidity import liquidity_forecast
from .models import (
    Account,
    Budget,
    Category,
    CategoryRule,
    RecurringOccurrence,
    RecurringRule,
    SavingsGoal,
    SavingsObjective,
    Transaction,
    normalize_match_text,
)
from .recurring_services import confirm_occurrence, generate_recurring_occurrences, refresh_recurring_rule_schedule
from .services import (
    dashboard_metrics,
    detected_subscriptions,
    month_bounds,
    parse_month_date,
    scheduled_pending_occurrences,
    shift_month,
)
from .subscription_reviews import subscription_review_context, subscription_review_map
from .savings_objectives import (
    SavingsObjectiveConfirmationRequired,
    SavingsObjectiveConflict,
    create_objective,
    planning_objectives_payload,
    set_objective_allocation,
    sync_annual_reserve,
    update_objective,
)

BUDGET_COPY_SALT = "ledger.budget-copy-preview.v1"


class BudgetCopyConflict(Exception):
    """The reviewed budget snapshot changed before the copy was applied."""

    def __init__(self, message, *, code="stale_preview"):
        super().__init__(message)
        self.code = code


def _budget_copy_month(raw_month):
    if not isinstance(raw_month, str) or len(raw_month) != 7 or raw_month[4] != "-":
        return None
    parsed = parse_month_date(raw_month)
    return parsed if parsed and parsed.strftime("%Y-%m") == raw_month else None


def _budget_copy_snapshot_state(budget):
    return None if budget is None else {"budget_id": budget.pk, "limit": str(budget.limit)}


def _same_budget_copy_state(current, expected):
    if expected is None or expected.get("budget_id") is None:
        return current is None
    if current is None:
        return False
    return current.pk == expected.get("budget_id") and str(current.limit) == expected.get("limit")


def _private_json(payload, *, status=200):
    response = JsonResponse(payload, status=status)
    response["Cache-Control"] = "private, no-store"
    return response


@require_http_methods(["GET", "PUT"])
def api_savings_goal(request):
    goal = SavingsGoal.objects.filter(active=True).order_by("-updated_at").first() or SavingsGoal()
    if request.method == "PUT":
        try:
            payload = api_json_body(request)
        except ValueError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=400)
        form = SavingsGoalForm(payload, instance=goal)
        if not form.is_valid():
            return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
        SavingsGoal.objects.exclude(pk=goal.pk).update(active=False)
        goal = form.save()
    return JsonResponse(
        {
            "ok": True,
            "goal": {
                "id": goal.pk,
                "percentage": api_money(goal.percentage),
                "minimum": api_money(goal.minimum),
                "active": goal.active,
                "updated_at": api_datetime(goal.updated_at) if goal.pk else "",
            },
        }
    )


def _savings_objective_action_response(objective, *, status=200, created=None):
    state = planning_objectives_payload()
    payload = {
        "ok": True,
        "objective": api_savings_objective(objective),
        "summary": api_savings_objective_summary(state["summary"]),
    }
    if created is not None:
        payload["created"] = created
    return JsonResponse(payload, status=status)


def _savings_objective_error(exc):
    if isinstance(exc, SavingsObjectiveConfirmationRequired):
        return JsonResponse(
            {
                "ok": False,
                "error": str(exc),
                "code": exc.code,
                "summary": api_savings_objective_summary(exc.summary),
            },
            status=409,
        )
    if isinstance(exc, SavingsObjectiveConflict):
        return JsonResponse({"ok": False, "error": str(exc), "code": exc.code}, status=exc.status)
    if isinstance(exc, ValueError):
        return JsonResponse({"ok": False, "error": str(exc), "code": "invalid_request"}, status=400)
    if isinstance(exc, OperationalError) and "locked" in str(exc).lower():
        return JsonResponse(
            {"ok": False, "error": "Otro cambio está guardando metas. Reintenta la acción.", "code": "temporarily_locked"},
            status=503,
        )
    raise exc


@require_POST
def api_savings_objectives(request):
    try:
        payload = api_json_body(request)
        if not isinstance(payload, dict):
            raise ValueError("El cuerpo debe ser un objeto JSON.")
        objective, created = create_objective(payload)
    except (ValueError, SavingsObjectiveConflict, OperationalError) as exc:
        return _savings_objective_error(exc)
    except IntegrityError as exc:
        return _savings_objective_error(SavingsObjectiveConflict("concurrent_create", "La meta ya se creó en otra solicitud."))
    return _savings_objective_action_response(objective, status=201 if created else 200, created=created)


@require_http_methods(["PATCH"])
def api_savings_objective_detail(request, pk):
    try:
        payload = api_json_body(request)
        if not isinstance(payload, dict):
            raise ValueError("El cuerpo debe ser un objeto JSON.")
        objective, _ = update_objective(pk, payload)
    except (ValueError, SavingsObjectiveConflict, OperationalError) as exc:
        return _savings_objective_error(exc)
    return _savings_objective_action_response(objective)


@require_http_methods(["PUT"])
def api_savings_objective_allocation(request, pk):
    try:
        payload = api_json_body(request)
        if not isinstance(payload, dict):
            raise ValueError("El cuerpo debe ser un objeto JSON.")
        objective, _ = set_objective_allocation(pk, payload)
    except (ValueError, SavingsObjectiveConflict, OperationalError) as exc:
        return _savings_objective_error(exc)
    return _savings_objective_action_response(objective)


@require_GET
def api_planning_calendar(request):
    raw_month = request.GET.get("month", "")
    selected = parse_month_date(raw_month) if raw_month else timezone.localdate().replace(day=1)
    if selected is None:
        return JsonResponse({"ok": False, "error": "El mes debe usar el formato AAAA-MM."}, status=400)
    start, end = month_bounds(selected)
    today = timezone.localdate()
    grid_start = start - timedelta(days=(start.weekday() + 1) % 7)
    grid_end = end + timedelta(days=6 - ((end.weekday() + 1) % 7) + 1)
    actuals = list(Transaction.objects.filter(archived=False, account__active=True, date__range=(grid_start, grid_end - timedelta(days=1))).select_related("account"))
    occurrences = scheduled_pending_occurrences(grid_start, grid_end - timedelta(days=1))
    by_day = {day: {"date": day.isoformat(), "in_month": start <= day <= end, "confirmed": [], "forecast": [],
                    "income": 0.0, "expense": 0.0, "transfer_net": 0.0, "actual_income": 0.0,
                    "actual_expense": 0.0, "actual_transfer_net": 0.0, "projected_income": 0.0,
                    "projected_expense": 0.0, "projected_transfer_net": 0.0, "actual_count": 0,
                    "projected_count": 0, "has_income": False, "has_expense": False, "has_transfer": False,
                    "ending_balance": 0.0} for day in (grid_start + timedelta(days=i) for i in range((grid_end-grid_start).days))}

    def is_transfer(movement):
        return bool(movement.transfer_group) or movement.kind in {Transaction.Kind.TRANSFER_IN, Transaction.Kind.TRANSFER_OUT}

    def signed(movement):
        return movement.amount if movement.kind in {Transaction.Kind.INCOME, Transaction.Kind.TRANSFER_IN} else -movement.amount

    opening = sum((account.opening_balance for account in Account.objects.filter(active=True)), Decimal("0"))
    before = Transaction.objects.filter(archived=False, date__lt=grid_start, account__active=True).select_related("account")
    opening += sum((signed(movement) for movement in before), Decimal("0"))
    if grid_start > today:
        opening += sum((item.amount if item.rule.kind == Category.Kind.INCOME else -item.amount
                        for item in scheduled_pending_occurrences(today + timedelta(days=1), grid_start - timedelta(days=1))), Decimal("0"))
    for movement in actuals:
        transfer = is_transfer(movement)
        item = {"id": str(movement.pk), "date": movement.date.isoformat(), "description": movement.description,
                "amount": api_money(movement.amount), "kind": movement.kind, "state": "confirmed",
                "account": movement.account.name, "is_transfer": transfer}
        by_day[movement.date]["confirmed"].append(item)
        by_day[movement.date]["actual_count"] += 1
        if transfer:
            by_day[movement.date]["transfer_net"] += api_money(signed(movement)); by_day[movement.date]["actual_transfer_net"] += api_money(signed(movement)); by_day[movement.date]["has_transfer"] = True
        elif movement.kind == Transaction.Kind.INCOME:
            by_day[movement.date]["income"] += item["amount"]; by_day[movement.date]["actual_income"] += item["amount"]; by_day[movement.date]["has_income"] = True
        elif movement.kind == Transaction.Kind.EXPENSE:
            by_day[movement.date]["expense"] += item["amount"]; by_day[movement.date]["actual_expense"] += item["amount"]; by_day[movement.date]["has_expense"] = True
    for occurrence in occurrences:
        item = {"id": f"forecast:{occurrence.rule.pk}:{occurrence.due_date.isoformat()}", "date": occurrence.due_date.isoformat(),
                "description": occurrence.rule.name, "amount": api_money(occurrence.amount),
                "kind": occurrence.rule.kind, "state": "forecast", "account": occurrence.rule.account.name,
                "is_transfer": False}
        by_day[occurrence.due_date]["forecast"].append(item); by_day[occurrence.due_date]["projected_count"] += 1
        if occurrence.rule.kind == Category.Kind.INCOME:
            by_day[occurrence.due_date]["income"] += item["amount"]; by_day[occurrence.due_date]["projected_income"] += item["amount"]; by_day[occurrence.due_date]["has_income"] = True
        else:
            by_day[occurrence.due_date]["expense"] += item["amount"]; by_day[occurrence.due_date]["projected_expense"] += item["amount"]; by_day[occurrence.due_date]["has_expense"] = True
    running = opening
    days = []
    for day, item in by_day.items():
        running += Decimal(str(item["income"])) - Decimal(str(item["expense"])) + Decimal(str(item["transfer_net"]))
        item["ending_balance"] = api_money(running)
        days.append(item)
    return JsonResponse({"month": selected.strftime("%Y-%m"), "period": {"start": api_date(start), "end": api_date(end),
        "as_of": api_date(today), "status": "past" if end < today else "future" if start > today else "current"},
        "days": days, "confirmed_count": len(actuals), "forecast_count": len(occurrences), "currency": "EUR",
        "warning": "Las previsiones no son movimientos reales." if occurrences else ""})


def _liquidity_json_value(value):
    if isinstance(value, datetime):
        return api_datetime(value)
    if isinstance(value, date):
        return api_date(value)
    if isinstance(value, Decimal):
        return api_money(value)
    if isinstance(value, dict):
        return {key: _liquidity_json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_liquidity_json_value(item) for item in value]
    return value


@require_GET
def api_planning_liquidity(request):
    raw_accounts = request.GET.getlist("account")
    if not raw_accounts:
        return JsonResponse({"ok": False, "error": "Selecciona al menos una cuenta."}, status=400)
    try:
        account_ids = [int(raw_account) for raw_account in raw_accounts]
    except (TypeError, ValueError):
        return JsonResponse({"ok": False, "error": "Las cuentas deben ser identificadores válidos."}, status=400)
    if any(account_id <= 0 for account_id in account_ids) or len(set(account_ids)) != len(account_ids):
        return JsonResponse({"ok": False, "error": "Las cuentas deben ser identificadores válidos y no repetirse."}, status=400)

    try:
        date_from = parse_date(request.GET.get("date_from", ""))
        date_to = parse_date(request.GET.get("date_to", ""))
    except (TypeError, ValueError):
        date_from = date_to = None
    today = timezone.localdate()
    if date_from is None or date_to is None:
        return JsonResponse({"ok": False, "error": "Indica un rango de fechas válido en formato AAAA-MM-DD."}, status=400)
    if date_from < today or date_to < date_from or (date_to - date_from).days >= 90 or date_to > today + timedelta(days=89):
        return JsonResponse({"ok": False, "error": "La previsión debe empezar hoy o después y cubrir como máximo 90 días desde hoy."}, status=400)
    try:
        result = liquidity_forecast(account_ids, date_from=date_from, date_to=date_to, today=today, now=timezone.now())
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    return JsonResponse(_liquidity_json_value(result))


def api_planning(request):
    raw_month = request.GET.get("month", "")
    selected_month = parse_month_date(raw_month) if raw_month else timezone.localdate().replace(day=1)
    if selected_month is None:
        return JsonResponse({"ok": False, "error": "El mes debe usar el formato AAAA-MM."}, status=400)
    metrics = dashboard_metrics(selected_month)
    savings_objectives = planning_objectives_payload(ledger_balance=metrics["total_balance"])
    period_start = metrics["start"]
    period_end = metrics["end"]
    as_of = timezone.localdate()
    period_status = "past" if period_end < as_of else "future" if period_start > as_of else "current"
    active_goal = metrics["savings_goal_config"]
    goal = active_goal or SavingsGoal.objects.filter(active=False).order_by("-updated_at").first()
    detected_candidates = detected_subscriptions(basis="analytics")
    review_map = subscription_review_map(detected_candidates)
    candidates_with_state = []
    for candidate in detected_candidates:
        account = candidate.get("account")
        category = candidate.get("category")
        if not account or not account.active or not category or not category.active:
            continue
        review = review_map.get((account.pk, candidate["normalized_description"]))
        review_context = subscription_review_context(candidate, review, today=as_of)
        candidates_with_state.append((candidate, review, review_context))

    candidates_with_state.sort(
        key=lambda item: (item[2]["status"] != "pending", -item[0]["annual_cost"])
    )
    candidates_with_state = candidates_with_state[:8]
    account_ids = {candidate["account"].pk for candidate, _, _ in candidates_with_state}
    normalized_descriptions = {candidate["normalized_description"] for candidate, _, _ in candidates_with_state}
    if normalized_descriptions:
        category_rule_rows = CategoryRule.objects.filter(
            normalized_description__in=normalized_descriptions,
            kind=Category.Kind.EXPENSE,
            active=True,
        ).filter(Q(account__isnull=True) | Q(account_id__in=account_ids)).values_list("account_id", "normalized_description")
        category_rule_rows = list(category_rule_rows)
        recurring_rule_rows = RecurringRule.objects.filter(
            kind=Category.Kind.EXPENSE,
            active=True,
            account_id__in=account_ids,
        ).values_list("account_id", "name")
        recurring_rule_rows = list(recurring_rule_rows)
    else:
        category_rule_rows = []
        recurring_rule_rows = []
    global_category_rules = {normalized for account_id, normalized in category_rule_rows if account_id is None}
    account_category_rules = {(account_id, normalized) for account_id, normalized in category_rule_rows if account_id is not None}
    recurring_rule_keys = {(account_id, normalize_match_text(name)) for account_id, name in recurring_rule_rows}

    subscription_candidates = []
    for candidate, review, review_context in candidates_with_state:
        account = candidate["account"]
        normalized = candidate["normalized_description"]
        has_category_rule = normalized in global_category_rules or (account.pk, normalized) in account_category_rules
        has_recurring_rule = (account.pk, normalized) in recurring_rule_keys
        subscription_candidates.append(
            api_planning_subscription_candidate(
                candidate,
                review=review,
                review_context=review_context,
                has_category_rule=has_category_rule,
                has_recurring_rule=has_recurring_rule,
            )
        )
    return JsonResponse(
        {
            "period": {
                "month": period_start.strftime("%Y-%m"),
                "start": api_date(period_start),
                "end": api_date(period_end),
                "as_of": api_date(as_of),
                "status": period_status,
                "partial": period_status == "current" and as_of < period_end,
            },
            "goal": {
                "configured": bool(goal),
                "active": bool(goal and goal.active),
                "percentage": api_money(goal.percentage) if goal else 0,
                "minimum": api_money(goal.minimum) if goal else 0,
                "target": api_money(metrics["savings_goal"]),
            },
            "savings_objectives": {
                "items": [api_savings_objective(item) for item in savings_objectives["items"]],
                "summary": api_savings_objective_summary(savings_objectives["summary"]),
            },
            "margin": {
                "expected_income": api_money(metrics["expected_income"]),
                "confirmed_expense": api_money(metrics["expense"]),
                "pending_recurring": api_money(metrics["commitments"]),
                "savings_goal": api_money(metrics["savings_goal"]),
                "available": api_money(metrics["safe_to_spend"]),
            },
            "metrics": api_metrics(metrics),
            "projection": api_projection(metrics["projection"]),
            "subscription_candidates": subscription_candidates,
            "budget_progress": [api_budget_item(item) for item in metrics["budgets"]],
            "budgets": [
                api_budget(budget)
                for budget in Budget.objects.filter(month=period_start).select_related("category", "category__parent")
            ],
            "rules": [
                api_recurring_rule(rule, period_start=period_start, period_end=period_end, as_of=as_of)
                for rule in RecurringRule.objects.select_related("account", "category", "category__parent")
            ],
            "occurrences": [
                api_occurrence(occurrence)
                for occurrence in RecurringOccurrence.objects.select_related("rule", "rule__account", "rule__category", "rule__category__parent").filter(
                    status=RecurringOccurrence.Status.PENDING,
                    rule__active=True,
                    due_date__range=(period_start, period_end),
                ).order_by("due_date", "pk")
            ],
            "accounts": [api_account(account, balance=Decimal("0")) for account in Account.objects.filter(active=True)],
            "categories": [api_category(category) for category in Category.objects.filter(active=True).select_related("parent")],
        }
    )


@require_POST
def api_planning_prepare(request):
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    raw_month = payload.get("month", "")
    selected_month = parse_month_date(raw_month)
    if selected_month is None:
        return JsonResponse({"ok": False, "error": "El mes debe usar el formato AAAA-MM."}, status=400)
    start, end = month_bounds(selected_month)
    created = generate_recurring_occurrences(start, end)
    return JsonResponse({"ok": True, "month": start.strftime("%Y-%m"), "created": created})


@require_GET
def api_budgets_copy_preview(request):
    source_month_text = request.GET.get("source_month", "")
    target_month_text = request.GET.get("target_month", "")
    source_month = _budget_copy_month(source_month_text)
    target_month = _budget_copy_month(target_month_text)
    if source_month is None or target_month is None:
        return _private_json({"ok": False, "error": "Elige meses válidos para el origen y destino."}, status=400)
    if source_month == target_month:
        return _private_json({"ok": False, "error": "El mes de origen y destino deben ser distintos."}, status=400)

    source_budgets = list(
        Budget.objects.filter(month=source_month)
        .select_related("category", "category__parent")
        .order_by("category__name", "category_id", "pk")
    )
    category_ids = [budget.category_id for budget in source_budgets]
    target_budgets = {
        budget.category_id: budget
        for budget in Budget.objects.filter(month=target_month, category_id__in=category_ids)
    }
    snapshot = {
        "version": 1,
        "source_month": source_month.strftime("%Y-%m"),
        "target_month": target_month.strftime("%Y-%m"),
        "source": [
            {
                "category_id": budget.category_id,
                "budget_id": budget.pk,
                "limit": str(budget.limit),
                "active": budget.category.active,
                "kind": budget.category.kind,
            }
            for budget in source_budgets
        ],
        "target": [
            {
                "category_id": category_id,
                **_budget_copy_snapshot_state(target_budgets.get(category_id)),
            }
            if category_id in target_budgets
            else {"category_id": category_id, "budget_id": None, "limit": None}
            for category_id in category_ids
        ],
    }
    items = []
    for budget in source_budgets:
        target_budget = target_budgets.get(budget.category_id)
        active_expense = budget.category.active and budget.category.kind == Category.Kind.EXPENSE
        status = "inactive" if not budget.category.active else "unsupported" if not active_expense else "existing" if target_budget else "new"
        items.append({
            "category": {
                "id": budget.category_id,
                "display_name": budget.category.display_name,
                "active": budget.category.active,
                "kind": budget.category.kind,
            },
            "source_limit": str(budget.limit),
            "destination_limit": str(target_budget.limit) if target_budget else None,
            "status": status,
            "can_copy": active_expense,
            "selected_by_default": active_expense and target_budget is None,
        })
    return _private_json({
        "ok": True,
        "source_month": snapshot["source_month"],
        "target_month": snapshot["target_month"],
        "preview_token": signing.dumps(snapshot, salt=BUDGET_COPY_SALT, compress=True),
        "items": items,
    })


@require_POST
def api_budgets_copy(request):
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return _private_json({"ok": False, "error": str(exc)}, status=400)
    if not isinstance(payload, dict):
        return _private_json({"ok": False, "error": "La solicitud de copia no es válida."}, status=400)
    preview_token = payload.get("preview_token")
    selected_ids = payload.get("selected_category_ids")
    if not isinstance(preview_token, str) or not isinstance(selected_ids, list):
        return _private_json({"ok": False, "error": "Genera una vista previa y selecciona presupuestos."}, status=400)
    if any(type(category_id) is not int or category_id <= 0 for category_id in selected_ids):
        return _private_json({"ok": False, "error": "La selección de categorías no es válida."}, status=400)
    if len(set(selected_ids)) != len(selected_ids):
        return _private_json({"ok": False, "error": "No repitas una categoría en la selección."}, status=400)
    if not selected_ids:
        return _private_json({"ok": False, "error": "Selecciona al menos un presupuesto."}, status=400)

    try:
        snapshot = signing.loads(preview_token, salt=BUDGET_COPY_SALT)
    except signing.BadSignature:
        return _private_json({"ok": False, "error": "La vista previa no es válida. Genera otra."}, status=409)
    if not isinstance(snapshot, dict) or snapshot.get("version") != 1:
        return _private_json({"ok": False, "error": "La vista previa ha cambiado. Genera otra."}, status=409)
    source_month = _budget_copy_month(snapshot.get("source_month"))
    target_month = _budget_copy_month(snapshot.get("target_month"))
    if source_month is None or target_month is None or source_month == target_month:
        return _private_json({"ok": False, "error": "La vista previa ha cambiado. Genera otra."}, status=409)

    try:
        source_snapshot = {item["category_id"]: item for item in snapshot["source"]}
        target_snapshot = {item["category_id"]: item for item in snapshot["target"]}
        if any(category_id not in source_snapshot or category_id not in target_snapshot for category_id in selected_ids):
            return _private_json({"ok": False, "error": "La selección no coincide con la vista previa."}, status=400)
        source_limits = {category_id: Decimal(source_snapshot[category_id]["limit"]) for category_id in selected_ids}
        target_limits = {
            category_id: Decimal(target_snapshot[category_id]["limit"])
            if target_snapshot[category_id]["limit"] is not None else None
            for category_id in selected_ids
        }
    except (KeyError, TypeError, InvalidOperation):
        return _private_json({"ok": False, "error": "La vista previa no es válida. Genera otra."}, status=409)

    create_rows = []
    update_rows = []
    unchanged_ids = []
    try:
        with transaction.atomic():
            current_sources = list(
                Budget.objects.select_for_update()
                .filter(month=source_month, category_id__in=selected_ids)
                .select_related("category")
            )
            source_by_category = {budget.category_id: budget for budget in current_sources}
            current_targets = list(
                Budget.objects.select_for_update().filter(month=target_month, category_id__in=selected_ids)
            )
            target_by_category = {budget.category_id: budget for budget in current_targets}

            for category_id in selected_ids:
                expected_source = source_snapshot[category_id]
                source_budget = source_by_category.get(category_id)
                if (
                    source_budget is None
                    or source_budget.pk != expected_source["budget_id"]
                    or str(source_budget.limit) != expected_source["limit"]
                ):
                    raise BudgetCopyConflict("El presupuesto de origen cambió. Genera una nueva vista previa.")
                if expected_source["active"] is not True or expected_source["kind"] != Category.Kind.EXPENSE:
                    raise BudgetCopyConflict("Solo puedes copiar categorías activas de gasto.", code="invalid_selection")

                target_budget = target_by_category.get(category_id)
                source_limit = source_limits[category_id]
                if target_budget is not None and target_budget.limit == source_limit:
                    unchanged_ids.append(category_id)
                    continue
                if not source_budget.category.active or source_budget.category.kind != Category.Kind.EXPENSE:
                    raise BudgetCopyConflict("La categoría ya no está activa para presupuestar.")

                expected_target = target_snapshot[category_id]
                if not _same_budget_copy_state(target_budget, expected_target):
                    raise BudgetCopyConflict("El presupuesto de destino cambió. Genera una nueva vista previa.")
                if target_budget is None:
                    create_rows.append(Budget(month=target_month, category_id=category_id, limit=source_limit))
                else:
                    update_rows.append((target_budget, target_limits[category_id], source_limit))

            for target_budget, expected_limit, source_limit in update_rows:
                updated = Budget.objects.filter(
                    pk=target_budget.pk,
                    month=target_month,
                    category_id=target_budget.category_id,
                    limit=expected_limit,
                ).update(limit=source_limit)
                if updated != 1:
                    raise BudgetCopyConflict("El presupuesto de destino cambió. Genera una nueva vista previa.")
            if create_rows:
                Budget.objects.bulk_create(create_rows)
            result_budget_ids = dict(
                Budget.objects.filter(month=target_month, category_id__in=selected_ids)
                .values_list("category_id", "pk")
            )
    except BudgetCopyConflict as exc:
        return _private_json({"ok": False, "error": str(exc), "code": exc.code}, status=409)
    except IntegrityError:
        return _private_json({"ok": False, "error": "Otro cambio modificó esos presupuestos. Revisa la vista previa.", "code": "concurrent_change"}, status=409)
    except OperationalError as exc:
        if "locked" not in str(exc).lower():
            raise
        return _private_json({"ok": False, "error": "Otro cambio está guardando presupuestos. Reintenta la confirmación.", "code": "concurrent_change"}, status=409)

    return _private_json({
        "ok": True,
        "created": len(create_rows),
        "updated": len(update_rows),
        "unchanged": len(unchanged_ids),
        "budget_ids": [result_budget_ids[category_id] for category_id in selected_ids],
    })


@require_http_methods(["POST"])
def api_budgets(request):
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    form = BudgetForm(payload)
    if not form.is_valid():
        return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
    budget, _ = Budget.objects.update_or_create(
        month=form.cleaned_data["month"],
        category=form.cleaned_data["category"],
        defaults={"limit": form.cleaned_data["limit"]},
    )
    return JsonResponse({"ok": True, "budget": api_budget(budget)}, status=201)


@require_http_methods(["PATCH", "DELETE"])
def api_budget_detail(request, pk):
    budget = get_object_or_404(Budget.objects.select_related("category", "category__parent"), pk=pk)
    if request.method == "DELETE":
        budget_pk = budget.pk
        budget.delete()
        return JsonResponse({"ok": True, "removed": [budget_pk], "removed_type": "budget", "message": "Presupuesto eliminado."})
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    current = {"month": budget.month.strftime("%Y-%m"), "category": budget.category_id, "limit": budget.limit}
    current.update(payload)
    form = BudgetForm(current, instance=budget)
    if not form.is_valid():
        return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
    budget = form.save()
    return JsonResponse({"ok": True, "budget": api_budget(budget)})


@require_http_methods(["POST"])
def api_recurring_rules(request):
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    form = RecurringRuleForm(payload)
    if not form.is_valid():
        return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
    rule = form.save()
    return JsonResponse({"ok": True, "rule": api_recurring_rule(rule)}, status=201)


@transaction.atomic
@require_http_methods(["PATCH", "DELETE"])
def api_recurring_rule_detail(request, pk):
    rule = get_object_or_404(RecurringRule.objects.select_for_update().select_related("account", "category", "category__parent"), pk=pk)
    if request.method == "DELETE":
        rule_pk = rule.pk
        rule.active = False
        rule.save(update_fields=["active"])
        return JsonResponse({"ok": True, "paused": [rule_pk], "message": "Recurrente pausado."})
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    linked_annual_goal = SavingsObjective.objects.filter(recurring_rule=rule).exists()
    if linked_annual_goal and (
        payload.get("frequency", rule.frequency) != RecurringRule.Frequency.YEARLY
        or payload.get("kind", rule.kind) != Category.Kind.EXPENSE
    ):
        return JsonResponse({"ok": False, "code": "annual_reserve_linked", "error": "Desvincula primero la reserva anual antes de cambiar el tipo o la frecuencia."}, status=409)
    current = {
        "name": rule.name,
        "kind": rule.kind,
        "amount": rule.amount,
        "account": rule.account_id,
        "category": rule.category_id,
        "frequency": rule.frequency,
        "day_of_month": rule.day_of_month,
        "start_date": rule.start_date.isoformat(),
        "end_date": rule.end_date.isoformat() if rule.end_date else "",
        "notes": rule.notes,
        "active": rule.active,
    }
    current.update(payload)
    form = RecurringRuleForm(current, instance=rule)
    if not form.is_valid():
        return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
    rule = form.save()
    refresh_recurring_rule_schedule(rule)
    return JsonResponse({"ok": True, "rule": api_recurring_rule(rule)})


@transaction.atomic
@require_POST
def api_occurrence_action(request, pk, action):
    occurrence = get_object_or_404(RecurringOccurrence.objects.select_for_update(), pk=pk)
    if action == "confirm":
        movement = confirm_occurrence(occurrence)
        if not movement:
            return JsonResponse({"ok": False, "error": "La previsión sigue esperando un movimiento real coincidente."}, status=409)
        return JsonResponse({"ok": True, "transaction": api_transaction(movement), "removed": [occurrence.pk], "message": "Previsión conciliada con un movimiento real."})
    if action == "skip" and occurrence.status == RecurringOccurrence.Status.PENDING and occurrence.rule.active:
        occurrence.status = RecurringOccurrence.Status.SKIPPED
        occurrence.save(update_fields=["status"])
        sync_annual_reserve(occurrence.rule, after=occurrence.due_date, strictly_after=True)
        return JsonResponse({"ok": True, "removed": [occurrence.pk], "message": "Ocurrencia omitida."})
    return JsonResponse({"ok": False, "error": "No se pudo procesar la ocurrencia."}, status=400)
