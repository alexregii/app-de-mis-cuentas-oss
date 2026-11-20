"""Persistent monthly aggregates for the statistics read path."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .calculations.ledger import allocate_refunds
from .calculations.statistics import family_categories, summarize_amounts
from .models import MonthlyFinancialAggregate, Transaction
from .transaction_allocations import category_in_reporting_basis, refund_extra_parts_in_basis, transaction_allocation_parts

ZERO = Decimal("0.00")
BASES = ("analytics", "all")


def _month_cursor(start, end):
    cursor = start.replace(day=1)
    while cursor <= end:
        yield cursor
        cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)


def _next_month(value):
    return (value.replace(day=28) + timedelta(days=4)).replace(day=1)


def _month_end(value):
    return _next_month(value) - timedelta(days=1)


def _coalesce_months(months):
    """Return contiguous ``(start, end)`` spans for dirty month starts."""
    ordered = sorted({month.replace(day=1) for month in months})
    if not ordered:
        return []
    spans = []
    span_start = span_end = ordered[0]
    for month in ordered[1:]:
        if month == _next_month(span_end):
            span_end = month
            continue
        spans.append((span_start, span_end))
        span_start = span_end = month
    spans.append((span_start, span_end))
    return spans


def _money(value):
    return f"{Decimal(value):.2f}"


def _category_metadata(category):
    parent = category.parent if category and category.parent_id else None
    return {
        "category_id": category.pk if category else None,
        "category_name": category.name if category else "Sin categoría",
        "family_id": parent.pk if parent else category.pk if category else None,
        "family_name": parent.name if parent else category.name if category else "Sin categoría",
        "color": parent.color if parent else category.color if category else "#8e8e93",
        "is_direct_family_expense": bool(category and not category.parent_id),
    }


def _category_allowed(category, basis):
    return basis == "all" or category is None or not category.exclude_from_analytics


def _empty_day():
    return {"income": "0.00", "gross_expense": "0.00", "refunds_applied": "0.00", "extra_income": "0.00", "categories": {}, "merchants": {}, "uncategorized_expenses": {}}


def _add(day, field, value):
    day[field] = _money(Decimal(day[field]) + Decimal(value))


def recompute_monthly_financial_aggregates(start=None, end=None, *, expected_versions=None):
    """Rebuild both bases from one scan, optionally guarded by dirty versions.

    The normal full rebuild keeps its historical integer return value. The
    worker passes ``expected_versions`` and receives counts for successful
    writes and version conflicts. A conflict intentionally leaves the row
    dirty so the next coalesced pass observes the newer source data.
    """
    all_transactions = Transaction.objects.filter(archived=False)
    if start is None:
        start = all_transactions.order_by("date").values_list("date", flat=True).first()
    if end is None:
        end = all_transactions.order_by("-date").values_list("date", flat=True).first()
    if not start or not end or start > end:
        return {"rebuilt": 0, "conflicts": 0} if expected_versions is not None else 0

    months = list(_month_cursor(start, end))
    payloads = {basis: {month: {"days": {}} for month in months} for basis in BASES}
    movements = list(
        all_transactions.filter(
            date__range=(start, end),
            kind__in=[Transaction.Kind.INCOME, Transaction.Kind.EXPENSE],
        )
        .select_related("category", "category__parent")
        .prefetch_related("allocations__category", "allocations__category__parent")
    )
    expense_meta = {basis: {} for basis in BASES}
    for movement in movements:
        month = movement.date.replace(day=1)
        parts = transaction_allocation_parts(movement)
        for basis in BASES:
            allowed_parts = [part for part in parts if category_in_reporting_basis(part.category, basis)]
            if not allowed_parts:
                continue
            day = payloads[basis][month]["days"].setdefault(movement.date.isoformat(), _empty_day())
            if movement.kind == Transaction.Kind.INCOME:
                if movement.refund_for_id:
                    continue
                _add(day, "income", sum((part.amount for part in allowed_parts), ZERO))
                continue
            gross_expense = sum((part.amount for part in allowed_parts), ZERO)
            _add(day, "gross_expense", gross_expense)
            category_keys = {}
            metadata_rows = []
            for part in allowed_parts:
                metadata = _category_metadata(part.category)
                category_key = str(part.category_id) if part.category_id is not None else "null"
                category_keys[part.category_id] = category_key
                category = day["categories"].setdefault(category_key, {**metadata, "gross_expense": "0.00", "refunds_applied": "0.00"})
                _add(category, "gross_expense", part.amount)
                if part.category_id is None:
                    uncategorized = day["uncategorized_expenses"].setdefault(
                        str(movement.pk),
                        {"transaction_id": movement.pk, "gross_expense": "0.00", "refunds_applied": "0.00"},
                    )
                    _add(uncategorized, "gross_expense", part.amount)
                metadata_rows.append(metadata)
            merchant_key = movement.description.strip() or "Sin concepto"
            families = {(item["family_id"], item["family_name"]) for item in metadata_rows}
            if len(families) == 1:
                family_id, family_name = next(iter(families))
            else:
                family_id, family_name = None, "Varias categorías"
            merchant = day["merchants"].setdefault(
                merchant_key,
                {
                    "description": merchant_key,
                    "family_id": family_id,
                    "family_name": family_name,
                    "net_expense": "0.00",
                    "transaction_count": 0,
                    "last_date": movement.date.isoformat(),
                },
            )
            _add(merchant, "net_expense", gross_expense)
            merchant["transaction_count"] += 1
            merchant["last_date"] = max(merchant["last_date"], movement.date.isoformat())
            expense_meta[basis][movement.pk] = (movement.date, category_keys, merchant_key)

    scoped_expenses = all_transactions.filter(date__range=(start, end), kind=Transaction.Kind.EXPENSE).values("pk")
    refunds = (
        all_transactions.filter(kind=Transaction.Kind.INCOME, refund_for__isnull=False)
        .filter(Q(refund_for_id__in=scoped_expenses) | Q(date__range=(start, end)))
        .select_related("category", "category__parent", "refund_for", "refund_for__category", "refund_for__category__parent")
        .prefetch_related(
            "allocations__category",
            "allocations__category__parent",
            "refund_for__allocations__category",
            "refund_for__allocations__category__parent",
        )
        .order_by("refund_for_id", "date", "created_at", "pk")
    )
    for allocation in allocate_refunds(refunds):
        refund, expense = allocation.refund, allocation.expense
        for basis in BASES:
            target = expense_meta[basis].get(expense.pk)
            applied = ZERO
            if target:
                expense_date, category_keys, merchant_key = target
                expense_day = payloads[basis][expense_date.replace(day=1)]["days"].setdefault(expense_date.isoformat(), _empty_day())
                for category_id, amount in allocation.category_applied:
                    category_key = category_keys.get(category_id)
                    if category_key is None:
                        continue
                    applied += amount
                    _add(expense_day["categories"][category_key], "refunds_applied", amount)
                    if category_id is None:
                        uncategorized = expense_day["uncategorized_expenses"].get(str(expense.pk))
                        if uncategorized:
                            _add(uncategorized, "refunds_applied", amount)
                _add(expense_day, "refunds_applied", applied)
                _add(expense_day["merchants"][merchant_key], "net_expense", -applied)
            extra = sum((amount for _category_id, amount in refund_extra_parts_in_basis(allocation, basis)), ZERO)
            if start <= refund.date <= end and extra:
                refund_day = payloads[basis][refund.date.replace(day=1)]["days"].setdefault(refund.date.isoformat(), _empty_day())
                _add(refund_day, "income", extra)
                _add(refund_day, "extra_income", extra)

    count = 0
    conflicts = 0
    with transaction.atomic():
        calculated_at = timezone.now()
        for basis in BASES:
            for month in months:
                days = payloads[basis][month]["days"]
                income = sum((Decimal(day["income"]) for day in days.values()), ZERO)
                gross = sum((sum((Decimal(row["gross_expense"]) for row in day["categories"].values()), ZERO) for day in days.values()), ZERO)
                refunds_applied = sum((Decimal(day["refunds_applied"]) for day in days.values()), ZERO)
                extra_income = sum((Decimal(day["extra_income"]) for day in days.values()), ZERO)
                defaults = {
                    "income": income,
                    "gross_expense": gross,
                    "refunds_applied": refunds_applied,
                    "extra_income": extra_income,
                    "payload": payloads[basis][month],
                    "dirty": False,
                    "calculated_at": calculated_at,
                }
                if expected_versions is None:
                    MonthlyFinancialAggregate.objects.update_or_create(
                        month=month,
                        basis=basis,
                        defaults=defaults,
                    )
                    count += 1
                    continue
                expected_version = expected_versions.get((month, basis))
                if expected_version is None:
                    continue
                updated = MonthlyFinancialAggregate.objects.filter(
                    month=month,
                    basis=basis,
                    dirty=True,
                    dirty_version=expected_version,
                ).update(**defaults)
                if updated:
                    count += 1
                else:
                    conflicts += 1
    if expected_versions is not None:
        return {"rebuilt": count, "conflicts": conflicts}
    return count


def rebuild_dirty_financial_aggregates(limit=24, start=None, end=None):
    """Rebuild dirty months in contiguous batches for the background worker."""
    limit = max(int(limit), 1)
    dirty_rows = MonthlyFinancialAggregate.objects.filter(dirty=True)
    if start is not None:
        dirty_rows = dirty_rows.filter(month__gte=start.replace(day=1))
    if end is not None:
        dirty_rows = dirty_rows.filter(month__lte=end.replace(day=1))
    candidate_months = list(dirty_rows.order_by("month").values_list("month", flat=True).distinct()[:limit])

    summary = {"batches": 0, "months": 0, "rebuilt": 0, "conflicts": 0}
    for batch_start, batch_end in _coalesce_months(candidate_months):
        batch_rows = list(
            MonthlyFinancialAggregate.objects.filter(
                dirty=True,
                month__gte=batch_start,
                month__lte=batch_end,
            ).values("month", "basis", "dirty_version")
        )
        if not batch_rows:
            continue
        expected_versions = {
            (row["month"], row["basis"]): row["dirty_version"]
            for row in batch_rows
        }
        result = recompute_monthly_financial_aggregates(
            start=batch_start,
            end=_month_end(batch_end),
            expected_versions=expected_versions,
        )
        summary["batches"] += 1
        summary["months"] += len({row["month"] for row in batch_rows})
        summary["rebuilt"] += result["rebuilt"]
        summary["conflicts"] += result["conflicts"]
    return summary


def _aggregate_read_model_rows(rows, start, end):
    by_date = defaultdict(lambda: {"income": ZERO, "gross_expense": ZERO, "refunds_applied": ZERO})
    category_rows = {}
    merchants = {}
    families = {}
    uncategorized_expenses = {}
    for row in rows:
        payload = row.payload or {}
        for raw_date, day in payload.get("days", {}).items():
            current_date = date.fromisoformat(raw_date)
            if not start <= current_date <= end:
                continue
            amounts = by_date[current_date]
            for field in amounts:
                amounts[field] += Decimal(day.get(field, "0.00"))
            for transaction_id, source in day.get("uncategorized_expenses", {}).items():
                target = uncategorized_expenses.setdefault(
                    transaction_id,
                    {"transaction_id": source["transaction_id"], "gross_expense": ZERO, "refunds_applied": ZERO},
                )
                target["gross_expense"] += Decimal(source.get("gross_expense", "0.00"))
                target["refunds_applied"] += Decimal(source.get("refunds_applied", "0.00"))
            for category_key, source in day.get("categories", {}).items():
                target = category_rows.setdefault(
                    category_key,
                    {
                        "category_id": source.get("category_id"),
                        "category_name": source.get("category_name", "Sin categoría"),
                        "family_id": source.get("family_id"),
                        "family_name": source.get("family_name", "Sin categoría"),
                        "color": source.get("color", "#8e8e93"),
                        "is_direct_family_expense": source.get("is_direct_family_expense", False),
                        "gross_expense": ZERO,
                        "refunds_applied": ZERO,
                    },
                )
                gross_expense = Decimal(source.get("gross_expense", "0.00"))
                refunds_applied = Decimal(source.get("refunds_applied", "0.00"))
                target["gross_expense"] += gross_expense
                target["refunds_applied"] += refunds_applied
                family = families.setdefault(
                    target["family_id"],
                    {
                        "family_id": target["family_id"],
                        "family_name": target["family_name"],
                        "net_expense": ZERO,
                        "months": defaultdict(lambda: ZERO),
                    },
                )
                family["net_expense"] += gross_expense - refunds_applied
                if category_key == str(target["category_id"] or "null"):
                    family["months"][current_date.strftime("%Y-%m")] += gross_expense - refunds_applied
            for merchant_key, source in day.get("merchants", {}).items():
                target = merchants.setdefault(
                    merchant_key,
                    {
                        "description": source["description"],
                        "net_expense": ZERO,
                        "transaction_count": 0,
                        "last_date": current_date,
                        "months": defaultdict(lambda: ZERO),
                    },
                )
                amount = Decimal(source.get("net_expense", "0.00"))
                target["net_expense"] += amount
                target["transaction_count"] += int(source.get("transaction_count", 0))
                target["last_date"] = max(target["last_date"], date.fromisoformat(source["last_date"]))
                target["months"][current_date.strftime("%Y-%m")] += amount
    expense_analysis = {
        "merchants": [{**item, "months": dict(item["months"])} for item in merchants.values()],
        "families": {key: {**value, "months": dict(value["months"])} for key, value in families.items()},
        "uncategorized_expenses": [
            {**item, "family_id": None, "net_expense": item["gross_expense"] - item["refunds_applied"]}
            for item in uncategorized_expenses.values()
        ],
    }
    return by_date, category_rows, expense_analysis


def read_model_analysis(start, end, basis):
    rows = list(
        MonthlyFinancialAggregate.objects.filter(
            basis=basis,
            month__gte=start.replace(day=1),
            month__lte=end.replace(day=1),
            dirty=False,
        )
    )
    expected = {month for month in _month_cursor(start, end)}
    if {row.month for row in rows} != expected:
        return None
    by_date, category_rows, expense_analysis = _aggregate_read_model_rows(rows, start, end)
    summary = summarize_amounts({field: sum((amounts[field] for amounts in by_date.values()), ZERO) for field in ("income", "gross_expense", "refunds_applied")})
    return {
        "summary": summary,
        "by_date": dict(by_date),
        "categories": family_categories(category_rows),
        "drilldown_ids": set(),
        "refund_attributions": {},
        "extra_income": sum((row.extra_income for row in rows), ZERO),
        "expense_rows": expense_analysis["uncategorized_expenses"],
        "precomputed_expense_analysis": expense_analysis,
    }
