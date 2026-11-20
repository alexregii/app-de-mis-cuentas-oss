import calendar
import hashlib
import json
from collections import defaultdict
from datetime import date, timedelta
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import urlencode

from django.db import transaction
from django.db.models import Case, DecimalField, Exists, F, OuterRef, Q, Subquery, Sum, Value, When
from django.db.models.functions import Coalesce
from django.urls import reverse
from django.utils import timezone

from .calculations.ledger import NEGATIVE_KINDS, allocate_refunds, period_totals
from .calculations.recurrence import occurrence_dates, safe_day
from .models import (
    Account,
    Budget,
    Category,
    CategoryRule,
    RecurringOccurrence,
    RecurringRule,
    SavingsGoal,
    Transaction,
    TransactionAllocation,
    first_day,
    normalize_match_text,
)
from .transaction_allocations import (
    allocation_rows_for,
    category_in_reporting_basis,
    refund_extra_parts_in_basis,
    transaction_allocation_parts,
    transaction_amount_in_reporting_basis,
)

ZERO = Decimal("0.00")


@dataclass(frozen=True)
class ScheduledOccurrence:
    rule: RecurringRule
    due_date: date
    amount: Decimal
    status: str
    occurrence: RecurringOccurrence | None = None


def month_bounds(value=None):
    value = value or timezone.localdate()
    start = first_day(value)
    return start, last_day_of_month(start)


def last_day_of_month(value):
    return value.replace(day=calendar.monthrange(value.year, value.month)[1])


def parse_month_date(value):
    try:
        return date.fromisoformat(f"{value}-01")
    except ValueError:
        return None


def signed_expression():
    return Case(
        When(kind__in=NEGATIVE_KINDS, then=-F("amount")),
        default=F("amount"),
        output_field=DecimalField(max_digits=14, decimal_places=2),
    )


def account_balance(account):
    movement_total = (
        account.transactions.filter(archived=False).aggregate(
            total=Coalesce(Sum(signed_expression()), Value(ZERO), output_field=DecimalField(max_digits=14, decimal_places=2))
        )["total"]
        or ZERO
    )
    return account.opening_balance + movement_total


def account_balances(accounts=None):
    """Return active-account balances with one grouped ledger aggregation."""

    if accounts is None:
        accounts = list(Account.objects.filter(active=True))
    else:
        accounts = list(accounts)
    account_ids = [account.pk for account in accounts]
    totals = (
        Transaction.objects.filter(archived=False, account_id__in=account_ids)
        .values("account_id")
        .annotate(
            total=Coalesce(
                Sum(signed_expression()),
                Value(ZERO),
                output_field=DecimalField(max_digits=14, decimal_places=2),
            )
        )
    )
    movement_totals = {row["account_id"]: row["total"] for row in totals}
    return {account.pk: account.opening_balance + movement_totals.get(account.pk, ZERO) for account in accounts}


def total_balance():
    opening = Account.objects.filter(active=True).aggregate(total=Sum("opening_balance"))["total"] or ZERO
    movements = (
        Transaction.objects.filter(archived=False, account__active=True)
        .aggregate(
            total=Coalesce(
                Sum(signed_expression()),
                Value(ZERO),
                output_field=DecimalField(max_digits=14, decimal_places=2),
            )
        )["total"]
        or ZERO
    )
    return opening + movements


def shift_month(value, offset):
    month_index = (value.year * 12 + value.month - 1) + offset
    return date(month_index // 12, month_index % 12 + 1, 1)


def median_decimal(values):
    values = sorted([Decimal(str(value)) for value in values if value is not None])
    if not values:
        return ZERO
    middle = len(values) // 2
    if len(values) % 2:
        return values[middle]
    return (values[middle - 1] + values[middle]) / 2


def analytics_transactions(*, start=None, end=None, basis="analytics"):
    queryset = Transaction.objects.filter(archived=False)
    if start and end:
        queryset = queryset.filter(date__range=(start, end))
    if basis in {"analytics", "excluded"}:
        legacy = Q(allocations__isnull=True) & _category_scope_q("category", basis)
        split = Q(allocations__isnull=False) & _category_scope_q("allocations__category", basis)
        queryset = queryset.filter(legacy | split).distinct()
    return queryset


def _category_scope_q(field, basis):
    if basis == "all":
        return Q()
    if basis == "excluded":
        return Q(**{f"{field}__exclude_from_analytics": True})
    return Q(**{f"{field}__isnull": True}) | Q(**{f"{field}__exclude_from_analytics": False})


def refund_adjustments(*, start=None, end=None):
    queryset = Transaction.objects.filter(archived=False, kind=Transaction.Kind.INCOME, refund_for__isnull=False)
    if start and end:
        queryset = queryset.filter(date__range=(start, end))
    return queryset


def refund_adjustment_parts(*, start=None, end=None, basis="analytics", allocation="expense"):
    if allocation == "expense":
        period_expenses = analytics_transactions(start=start, end=end, basis=basis).filter(kind=Transaction.Kind.EXPENSE)
        refund_targets = set(period_expenses.values_list("id", flat=True))
    else:
        period_refunds = refund_adjustments(start=start, end=end).select_related(
            "refund_for", "refund_for__category", "refund_for__category__parent"
        )
        refund_targets = {movement.refund_for_id for movement in period_refunds}
    if not refund_targets:
        return []
    all_refunds = (
        Transaction.objects.filter(
            archived=False,
            kind=Transaction.Kind.INCOME,
            refund_for_id__in=refund_targets,
        )
        .select_related("category", "category__parent", "refund_for", "refund_for__category", "refund_for__category__parent")
        .prefetch_related(
            "allocations__category",
            "allocations__category__parent",
            "refund_for__allocations__category",
            "refund_for__allocations__category__parent",
        )
        .order_by("refund_for_id", "date", "created_at", "pk")
    )

    rows = []
    for allocation_row in allocate_refunds(all_refunds):
        movement = allocation_row.refund
        if allocation != "expense" and start and end and not (start <= movement.date <= end):
            continue
        expense = allocation_row.expense
        expense_categories = {
            part.category_id: part.category
            for part in transaction_allocation_parts(expense)
        }
        category_parts = tuple(
            (category_id, amount)
            for category_id, amount in allocation_row.category_applied
            if category_in_reporting_basis(expense_categories.get(category_id), basis)
        )
        extra_parts = refund_extra_parts_in_basis(allocation_row, basis)
        rows.append(
            {
                "movement": movement,
                "applied": sum((amount for _category_id, amount in category_parts), ZERO),
                "extra": sum((amount for _category_id, amount in extra_parts), ZERO),
                "category_parts": category_parts,
                "extra_parts": extra_parts,
                "split_expense": allocation_row.split_expense,
            }
        )
    return rows


def refund_extra_income_total(*, start=None, end=None, basis="analytics"):
    return sum((row["extra"] for row in refund_adjustment_parts(start=start, end=end, basis=basis, allocation="refund")), ZERO)


def transaction_filters_url(filters):
    query = urlencode({"tab": "transactions", **{key: value for key, value in filters.items() if value not in (None, "")}})
    return f"/?{query}"


def signed_pending_amount(queryset, kind_field="kind", amount_field="amount"):
    return (
        queryset.aggregate(
            total=Coalesce(
                Sum(
                    Case(
                        When(**{kind_field: Category.Kind.EXPENSE}, then=-F(amount_field)),
                        default=F(amount_field),
                        output_field=DecimalField(max_digits=14, decimal_places=2),
                    )
                ),
                Value(ZERO),
                output_field=DecimalField(max_digits=14, decimal_places=2),
            )
        )["total"]
        or ZERO
    )


def _transaction_amount_total(start, end, *, kind, basis, include_refunds=True):
    base = Transaction.objects.filter(archived=False, kind=kind, date__range=(start, end))
    if not include_refunds:
        base = base.filter(refund_for__isnull=True)
    allocation_rows = TransactionAllocation.objects.filter(transaction_id=OuterRef("pk"))
    allocation_total = (
        allocation_rows.filter(_category_scope_q("category", basis))
        .order_by()
        .values("transaction_id")
        .annotate(total=Sum("amount"))
        .values("total")[:1]
    )
    legacy_condition = Q(_has_allocations=False)
    if basis != "all":
        legacy_condition &= _category_scope_q("category", basis)
    amount_expression = Case(
        When(
            _has_allocations=True,
            then=Coalesce(F("_allocated_amount"), Value(ZERO), output_field=DecimalField(max_digits=14, decimal_places=2)),
        ),
        When(legacy_condition, then=F("amount")),
        default=Value(ZERO),
        output_field=DecimalField(max_digits=14, decimal_places=2),
    )
    return base.annotate(
        _has_allocations=Exists(allocation_rows),
        _allocated_amount=Subquery(allocation_total, output_field=DecimalField(max_digits=14, decimal_places=2)),
    ).aggregate(
        total=Coalesce(Sum(amount_expression), Value(ZERO), output_field=DecimalField(max_digits=14, decimal_places=2))
    )["total"] or ZERO


def transaction_totals(start, end, basis="all"):
    gross_income = _transaction_amount_total(
        start,
        end,
        kind=Transaction.Kind.INCOME,
        basis=basis,
        include_refunds=False,
    )
    refund_parts = refund_adjustment_parts(start=start, end=end, basis=basis, allocation="expense")
    refunds = sum((row["applied"] for row in refund_parts), ZERO)
    refund_extra_income = refund_extra_income_total(start=start, end=end, basis=basis)
    gross_income += refund_extra_income
    gross_expense = _transaction_amount_total(
        start,
        end,
        kind=Transaction.Kind.EXPENSE,
        basis=basis,
    )
    totals = period_totals(
        income=gross_income,
        gross_expense=gross_expense,
        refunds_applied=refunds,
    )
    return {
        "income": totals["income"],
        "expense": totals["net_expense"],
        "gross_income": totals["income"],
        "gross_expense": totals["gross_expense"],
        "refunds": totals["refunds_applied"],
    }


def savings_contributions(start, end):
    savings_ids = set(Account.objects.filter(kind=Account.Kind.SAVINGS).values_list("id", flat=True))
    groups = defaultdict(lambda: {"in": ZERO, "out": ZERO})
    transfers = Transaction.objects.filter(
        archived=False,
        date__range=(start, end),
        kind__in=[Transaction.Kind.TRANSFER_IN, Transaction.Kind.TRANSFER_OUT],
        transfer_group__isnull=False,
    )
    for movement in transfers:
        if movement.account_id in savings_ids:
            key = str(movement.transfer_group)
            groups[key]["in" if movement.kind == Transaction.Kind.TRANSFER_IN else "out"] += movement.amount
    return sum((values["in"] - values["out"] for values in groups.values()), ZERO)


def get_savings_goal(projected_income, *, goal=None):
    goal = goal or SavingsGoal.objects.filter(active=True).order_by("-updated_at").first()
    if not goal:
        return ZERO
    return max(goal.minimum, (projected_income * goal.percentage / Decimal("100")).quantize(Decimal("0.01")))


def scheduled_occurrences(start, end):
    """Return the effective schedule without creating or reconciling rows."""
    rules = list(
        RecurringRule.objects.filter(active=True, start_date__lte=end)
        .filter(Q(end_date__isnull=True) | Q(end_date__gte=start))
        .select_related("account", "category", "category__parent")
    )
    persisted = {
        (occurrence.rule_id, occurrence.due_date): occurrence
        for occurrence in RecurringOccurrence.objects.filter(rule__in=rules, due_date__range=(start, end)).select_related(
            "rule", "rule__account", "rule__category", "rule__category__parent"
        )
    }
    result = []
    for rule in rules:
        for due_date in occurrence_dates(rule, start, end):
            occurrence = persisted.get((rule.pk, due_date))
            result.append(
                ScheduledOccurrence(
                    rule=rule,
                    due_date=due_date,
                    amount=occurrence.amount if occurrence else rule.amount,
                    status=occurrence.status if occurrence else RecurringOccurrence.Status.PENDING,
                    occurrence=occurrence,
                )
            )
    return result


def scheduled_pending_occurrences(start, end, *, kind=None):
    return [
        item
        for item in scheduled_occurrences(start, end)
        if item.status == RecurringOccurrence.Status.PENDING and (kind is None or item.rule.kind == kind)
    ]


def pending_commitments(start, end):
    return sum(
        (item.amount for item in scheduled_pending_occurrences(start, end, kind=Category.Kind.EXPENSE)),
        ZERO,
    )


def pending_income(start, end):
    return sum(
        (item.amount for item in scheduled_pending_occurrences(start, end, kind=Category.Kind.INCOME)),
        ZERO,
    )


def confirmed_recurring_expense(start, end, *, basis="all"):
    movements = list(
        Transaction.objects.filter(
            archived=False,
            kind=Transaction.Kind.EXPENSE,
            recurring_occurrence__isnull=False,
            date__range=(start, end),
        )
        .select_related("category", "category__parent")
        .prefetch_related("allocations__category", "allocations__category__parent")
    )
    if not movements:
        return ZERO
    movement_ids = {movement.pk for movement in movements}
    gross = sum((transaction_amount_in_reporting_basis(movement, basis) for movement in movements), ZERO)
    applied = sum(
        (
            row["applied"]
            for row in refund_adjustment_parts(start=start, end=end, basis=basis)
            if row["movement"].refund_for_id in movement_ids
        ),
        ZERO,
    )
    return gross - applied


def budget_progress(month=None, *, as_of=None):
    start, end = month_bounds(month)
    as_of = as_of or timezone.localdate()
    actual_end = min(end, as_of)
    result = []
    elapsed_ratio = (
        Decimal("1")
        if end < as_of
        else Decimal("0")
        if start > as_of
        else Decimal(as_of.day) / Decimal(end.day)
    )
    net_by_category = {
        item["category_id"]: item["total"]
        for item in category_totals(start, actual_end, basis="all")
    } if actual_end >= start else {}
    for budget in Budget.objects.filter(month=start).select_related("category", "category__parent"):
        category_ids = [budget.category_id, *budget.category.children.values_list("id", flat=True)]
        spent = sum((net_by_category.get(category_id, ZERO) for category_id in category_ids), ZERO)
        percent = (spent / budget.limit * 100).quantize(Decimal("0.1")) if budget.limit else ZERO
        projected_percent = (percent / elapsed_ratio).quantize(Decimal("0.1")) if elapsed_ratio else ZERO
        pace = "low" if projected_percent < 90 else "high" if projected_percent > 110 else "normal"
        result.append(
            {
                "budget": budget,
                "spent": spent,
                "remaining": budget.limit - spent,
                "percent": min(percent, Decimal("100")),
                "actual_percent": percent,
                "projected_percent": projected_percent,
                "pace": pace,
            }
        )
    return result


def month_starts_before(reference_start, count):
    return [shift_month(reference_start, -offset) for offset in range(1, count + 1)]


def category_totals(start, end, *, basis="analytics", limit=None):
    expenses = Transaction.objects.filter(
        archived=False,
        kind=Transaction.Kind.EXPENSE,
        date__range=(start, end),
    ).annotate(
        _allocation_category_id=Coalesce("allocations__category_id", "category_id"),
        _allocation_category_name=Coalesce("allocations__category__name", "category__name"),
        _allocation_parent_name=Coalesce("allocations__category__parent__name", "category__parent__name"),
        _allocated_amount=Case(
            When(allocations__isnull=False, then=F("allocations__amount")),
            default=F("amount"),
            output_field=DecimalField(max_digits=14, decimal_places=2),
        ),
    )
    if basis in {"analytics", "excluded"}:
        expenses = expenses.filter(
            (Q(allocations__isnull=True) & _category_scope_q("category", basis))
            | (Q(allocations__isnull=False) & _category_scope_q("allocations__category", basis))
        )
    rows_by_category = {
        item["_allocation_category_id"]: {
            "category_id": item["_allocation_category_id"],
            "category__name": item["_allocation_category_name"],
            "category__parent__name": item["_allocation_parent_name"],
            "total": item["total"],
        }
        for item in expenses.values(
            "_allocation_category_id",
            "_allocation_category_name",
            "_allocation_parent_name",
        ).annotate(total=Coalesce(Sum("_allocated_amount"), ZERO))
    }

    refund_totals = defaultdict(lambda: ZERO)
    refund_metadata = {}
    for refund in refund_adjustment_parts(start=start, end=end, basis=basis):
        expense = refund["movement"].refund_for
        category_names = {
            part.category_id: (
                part.category.name if part.category else None,
                part.category.parent.name if part.category and part.category.parent_id else None,
            )
            for part in transaction_allocation_parts(expense)
        }
        for category_id, amount in refund["category_parts"]:
            if category_id is None and not refund["split_expense"]:
                continue
            refund_totals[category_id] += amount
            if category_id not in refund_metadata:
                name, parent_name = category_names.get(category_id, (None, None))
                refund_metadata[category_id] = {"category__name": name, "category__parent__name": parent_name}

    for category_id, amount in refund_totals.items():
        row = rows_by_category.setdefault(
            category_id,
            {
                "category_id": category_id,
                **refund_metadata[category_id],
                "total": ZERO,
            },
        )
        row["total"] -= amount
    rows = list(rows_by_category.values())
    rows.sort(key=lambda item: item["total"], reverse=True)
    if limit:
        rows = rows[:limit]
    for row in rows:
        parent = row["category__parent__name"]
        name = row["category__name"] or "Sin categoría"
        row["label"] = f"{parent} · {name}" if parent else name
    return rows


def monthly_category_totals(month_start, *, basis="analytics"):
    start, end = month_bounds(month_start)
    return {item["label"]: item["total"] for item in category_totals(start, end, basis=basis)}


def build_projection_summary(month=None, basis="analytics", *, as_of=None):
    start, end = month_bounds(month)
    as_of = as_of or timezone.localdate()
    actual_end = min(end, as_of)
    actual_totals = transaction_totals(start, actual_end, basis=basis) if actual_end >= start else {
        "income": ZERO,
        "expense": ZERO,
    }
    previous_six = month_starts_before(start, 6)
    historical_totals = {item: transaction_totals(item, month_bounds(item)[1], basis=basis) for item in previous_six}
    historical_expense = [historical_totals[item]["expense"] for item in previous_six if historical_totals[item]["expense"] > ZERO]
    expense_median = median_decimal(historical_expense)
    historical_income = median_decimal([historical_totals[item]["income"] for item in previous_six if historical_totals[item]["income"] > ZERO])
    commitments = pending_commitments(start, end)
    expected_income_pending = pending_income(start, end)
    sufficient = bool(actual_totals["income"] or actual_totals["expense"] or historical_expense or historical_income or commitments or expected_income_pending)

    if end <= as_of:
        actual_savings = actual_totals["income"] - actual_totals["expense"]
        return {
            "actual_expense": actual_totals["expense"], "projected_expense": actual_totals["expense"],
            "projected_savings": actual_savings, "expense_median": expense_median,
            "delta_vs_median": actual_totals["expense"] - expense_median, "normalized_income": historical_income,
            "normalized_savings": actual_savings,
            "normalized_savings_rate": (actual_savings / historical_income * 100).quantize(Decimal("0.1")) if historical_income else ZERO,
            "expense_expected_to_date": actual_totals["expense"], "expense_delta_vs_pace": ZERO,
            "method": "Mes cerrado. La proyección coincide con el cierre real.", "as_of": end,
            "sufficient": sufficient, "category_watchlist": [],
        }

    if start > as_of:
        projected_expense = max(expense_median, commitments)
        projected_income = max(historical_income, expected_income_pending)
        return {
            "actual_expense": ZERO, "projected_expense": projected_expense,
            "projected_savings": projected_income - projected_expense, "expense_median": expense_median,
            "delta_vs_median": projected_expense - expense_median, "normalized_income": historical_income,
            "normalized_savings": projected_income - projected_expense,
            "normalized_savings_rate": ((projected_income - projected_expense) / projected_income * 100).quantize(Decimal("0.1")) if projected_income else ZERO,
            "expense_expected_to_date": ZERO, "expense_delta_vs_pace": ZERO,
            "method": "Previsión futura basada en el historial y los recurrentes conocidos.", "as_of": as_of,
            "sufficient": sufficient, "category_watchlist": [],
        }

    day_ratio = Decimal(as_of.day) / Decimal(end.day)
    fixed_confirmed = confirmed_recurring_expense(start, actual_end, basis=basis)
    historical_variable = []
    for previous_month in previous_six:
        previous_start, previous_end = month_bounds(previous_month)
        historical_variable.append(max(historical_totals[previous_month]["expense"] - confirmed_recurring_expense(previous_start, previous_end, basis=basis), ZERO))
    variable_median = median_decimal(historical_variable)
    observed_variable = max(actual_totals["expense"] - fixed_confirmed, ZERO)
    variable_pace = observed_variable / day_ratio if day_ratio else observed_variable
    projected_variable = (variable_pace * day_ratio + variable_median * (Decimal("1") - day_ratio)).quantize(Decimal("0.01"))
    projected_expense = projected_variable + fixed_confirmed + commitments
    projected_income = actual_totals["income"] + expected_income_pending
    expected_expense_to_date = (expense_median * day_ratio).quantize(Decimal("0.01"))
    normalized_savings = historical_income - projected_expense
    current_categories = category_totals(start, actual_end, basis=basis) if actual_end >= start else []
    historical_categories = {item: monthly_category_totals(item, basis=basis) for item in previous_six} if current_categories else {}
    category_watchlist = []
    for item in current_categories:
        label, amount = item["label"], item["total"]
        candidate = amount / day_ratio if day_ratio else amount
        baseline = median_decimal([historical_categories[previous_month].get(label, ZERO) for previous_month in previous_six])
        if baseline and candidate >= baseline * Decimal("1.5") and candidate - baseline >= Decimal("50"):
            category_watchlist.append({"label": label, "projected": candidate, "baseline": baseline, "difference": candidate - baseline, "filters": {"category": item["category_id"], "kind": Transaction.Kind.EXPENSE, "analytics": "included"}})
    category_watchlist.sort(key=lambda item: item["difference"], reverse=True)
    return {
        "actual_expense": actual_totals["expense"], "projected_expense": projected_expense,
        "projected_savings": projected_income - projected_expense, "expense_median": expense_median,
        "delta_vs_median": projected_expense - expense_median, "normalized_income": historical_income,
        "normalized_savings": normalized_savings,
        "normalized_savings_rate": (normalized_savings / historical_income * 100).quantize(Decimal("0.1")) if historical_income else ZERO,
        "expense_expected_to_date": expected_expense_to_date,
        "expense_delta_vs_pace": actual_totals["expense"] - expected_expense_to_date,
        "method": "Previsión combinada: historial de gasto variable y ritmo confirmado hasta hoy.", "as_of": as_of,
        "sufficient": sufficient, "category_watchlist": category_watchlist[:5],
    }


def recurring_description_stats(kind, *, basis="analytics", months=6):
    current_start = timezone.localdate().replace(day=1)
    months_window = [shift_month(current_start, -offset) for offset in range(months - 1, -1, -1)]
    first_window_start = months_window[0]
    queryset = analytics_transactions(start=first_window_start, end=month_bounds(current_start)[1], basis=basis).filter(kind=kind)
    if kind == Transaction.Kind.INCOME:
        queryset = queryset.filter(refund_for__isnull=True)
    queryset = queryset.select_related("category", "account").prefetch_related(
        "allocations__category", "allocations__category__parent"
    ).order_by("date", "pk")
    grouped = {}
    for movement in queryset:
        allocated_amount = transaction_amount_in_reporting_basis(movement, basis)
        if allocated_amount <= ZERO:
            continue
        parts = [part for part in transaction_allocation_parts(movement) if category_in_reporting_basis(part.category, basis)]
        categories = {part.category_id: part.category for part in parts}
        allocation_signature = [{"category_id": part.category_id, "amount": str(part.amount)} for part in parts]
        category = next(iter(categories.values())) if len(categories) == 1 else None
        normalized = normalize_match_text(movement.description)
        key = (movement.account_id, normalized) if kind == Transaction.Kind.EXPENSE else normalized
        data = grouped.setdefault(
            key,
            {
                "description": movement.description,
                "months": defaultdict(list),
                "month_records": defaultdict(list),
                "days": [],
                "evidence": [],
                "latest": movement,
                "latest_amount": allocated_amount,
                "account": movement.account,
                "category": category,
            },
        )
        month_key = movement.date.replace(day=1)
        data["months"][month_key].append(allocated_amount)
        data["month_records"][month_key].append({"id": movement.pk, "amount": allocated_amount})
        data["days"].append(movement.date.day)
        evidence = {
            "id": movement.pk,
            "date": movement.date.isoformat(),
            "amount": str(allocated_amount),
            "description": movement.description,
            "category_id": movement.category_id if not allocation_rows_for(movement) else None,
        }
        if allocation_rows_for(movement):
            evidence["allocations"] = allocation_signature
        data["evidence"].append(evidence)
        if movement.date >= data["latest"].date:
            data["latest"] = movement
            data["latest_amount"] = allocated_amount
            data["account"] = movement.account
            data["category"] = category
    return grouped, months_window


def detected_subscriptions(limit=None, basis="analytics"):
    grouped, months_window = recurring_description_stats(Category.Kind.EXPENSE, basis=basis, months=6)
    current_start = timezone.localdate().replace(day=1)
    candidates = []
    for (_, normalized), data in grouped.items():
        month_amounts = {month: median_decimal(amounts) for month, amounts in data["months"].items()}
        latest_month = data["latest"].date.replace(day=1)
        median_amount = median_decimal(list(month_amounts.values()))
        latest_month_values = data["months"].get(latest_month, [])
        latest_month_median = median_decimal(latest_month_values) if latest_month_values else ZERO
        present_months = sum(1 for month in months_window if month in month_amounts)
        missing_months = len(months_window) - present_months
        typical_day = int(round(sum(data["days"]) / len(data["days"]))) if data["days"] else 1
        if current_start not in month_amounts and timezone.localdate().day <= typical_day + 7:
            missing_months = max(missing_months - 1, 0)
        previous_months = [month for month in months_window if month in month_amounts and month != latest_month]
        previous_values = [month_amounts[month] for month in previous_months]
        previous_median = median_decimal(previous_values) if previous_values else ZERO
        if present_months < 4 or missing_months > 1 or not previous_median:
            continue
        previous_stable = (max(previous_values) - min(previous_values)) / previous_median <= Decimal("0.15")
        confirmed_step_change = False
        if not previous_stable and len(previous_values) >= 4:
            older_values = previous_values[:-1]
            older_median = median_decimal(older_values)
            previous_month_amount = previous_values[-1]
            older_stable = bool(older_median) and (max(older_values) - min(older_values)) / older_median <= Decimal("0.15")
            step_started = bool(older_median) and abs(previous_month_amount - older_median) / older_median > Decimal("0.15")
            recent_months_agree = bool(previous_month_amount) and (
                abs(latest_month_median - previous_month_amount) / previous_month_amount <= Decimal("0.15")
            )
            confirmed_step_change = older_stable and step_started and recent_months_agree
            if confirmed_step_change:
                previous_median = older_median
        if not previous_stable and not confirmed_step_change:
            continue
        latest_amount = data["latest_amount"]
        previous_month_amount = previous_values[-1] if previous_values else ZERO
        exceptional_charge = (
            latest_amount > previous_median * Decimal("1.5")
            and latest_month_median > previous_median * Decimal("1.5")
            and previous_month_amount <= previous_median * Decimal("1.5")
        )
        stability_values = latest_month_values
        if exceptional_charge:
            stability_values = [
                record["amount"] for record in data["month_records"][latest_month]
                if record["id"] != data["latest"].pk
            ]
        stability_median = median_decimal(stability_values) if stability_values else ZERO
        if stability_median and (max(stability_values) - min(stability_values)) / stability_median > Decimal("0.15"):
            continue
        evidence_signature = hashlib.sha256(
            json.dumps(data["evidence"], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        candidates.append(
            {
                "description": data["description"],
                "normalized_description": normalized,
                "evidence_signature": evidence_signature,
                "median_amount": median_amount,
                "annual_cost": (median_amount * Decimal("12")).quantize(Decimal("0.01")),
                "last_date": data["latest"].date,
                "latest_amount": latest_amount,
                "latest_month_median": latest_month_median,
                "review_monthly_amount": median_amount if exceptional_charge else latest_month_median,
                "previous_median": previous_median,
                "confirmed_step_change": confirmed_step_change,
                "exceptional_charge": exceptional_charge,
                "months_seen": present_months,
                "typical_day": typical_day,
                "account": data["account"],
                "category": data["category"],
                "filters": {
                    "account": data["account"].pk,
                    "description": data["description"],
                    "kind": Transaction.Kind.EXPENSE,
                    "analytics": "included",
                },
            }
        )
    candidates.sort(key=lambda item: item["annual_cost"], reverse=True)
    return candidates[:limit] if limit else candidates


def dashboard_metrics(month=None, *, as_of=None):
    start, end = month_bounds(month)
    as_of = as_of or timezone.localdate()
    actual_end = min(end, as_of)
    totals = transaction_totals(start, actual_end) if actual_end >= start else {
        "income": ZERO, "expense": ZERO, "gross_expense": ZERO, "refunds": ZERO,
    }
    expected_income = totals["income"] + pending_income(start, end)
    goal_setting = SavingsGoal.objects.filter(active=True).order_by("-updated_at").first()
    goal = get_savings_goal(expected_income, goal=goal_setting)
    commitments = pending_commitments(start, end)
    net_savings = totals["income"] - totals["expense"]
    safe_to_spend = expected_income - totals["expense"] - commitments - goal
    goal_progress = int(max(ZERO, min((net_savings / goal * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP), Decimal("100")))) if goal else 0
    projection = build_projection_summary(start, as_of=as_of)
    return {
        "start": start,
        "end": end,
        "total_balance": total_balance(),
        "income": totals["income"],
        "expense": totals["expense"],
        "gross_expense": totals["gross_expense"],
        "refunds": totals["refunds"],
        "balance": net_savings,
        "net_savings": net_savings,
        "savings_contributions": savings_contributions(start, actual_end) if actual_end >= start else ZERO,
        "commitments": commitments,
        "expected_income": expected_income,
        "savings_goal": goal,
        "savings_goal_config": goal_setting,
        "savings_goal_progress": goal_progress,
        "safe_to_spend": safe_to_spend,
        "projection": projection,
        "budgets": budget_progress(start, as_of=as_of),
    }
