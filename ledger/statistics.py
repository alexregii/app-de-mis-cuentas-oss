"""Read-only financial reporting for the Statistics workbench.

The public functions in this module never create or reconcile recurring
occurrences.  They derive every displayed total from recorded transactions so
the summary, time series and category breakdown share one financial contract.
"""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone
from django.db.models import Q

from .calculations.ledger import allocate_refunds
from .calculations.statistics import empty_amounts as _empty_amounts
from .calculations.statistics import family_categories as _family_categories
from .calculations.statistics import ONE_DECIMAL
from .calculations.statistics import summarize_amounts as _summarize
from .calculations.statistics import sum_amounts as _sum_amounts
from .models import BankTransaction, Category, Transaction, first_day
from .financial_read_models import read_model_analysis
from .transaction_allocations import refund_extra_parts_in_basis, transaction_allocation_parts
from .services import last_day_of_month, shift_month


ZERO = Decimal("0.00")
ALLOWED_BASES = {"analytics", "all"}
ALLOWED_PERIODS = {"3", "6", "12", "custom"}
MAX_REPORT_MONTHS = 120
SQLITE_IN_CHUNK = 500


class StatisticsRangeError(ValueError):
    """Raised when a requested reporting scope is not financially valid."""


def month_start(value):
    return first_day(value)


def month_end(value):
    return last_day_of_month(value)


def validate_statistics_range(start, end, *, today=None):
    """Validate a complete, non-future range spanning at most 120 months."""
    today = today or timezone.localdate()
    if not isinstance(start, date) or not isinstance(end, date):
        raise StatisticsRangeError("Indica dos fechas completas.")
    if start > end:
        raise StatisticsRangeError("La fecha inicial no puede ser posterior a la final.")
    if end > today:
        raise StatisticsRangeError("La fecha final no puede ser posterior a hoy.")
    first_disallowed_month = shift_month(month_start(start), MAX_REPORT_MONTHS)
    if end >= first_disallowed_month:
        raise StatisticsRangeError("El periodo no puede superar 120 meses naturales.")
    if start <= date.min + (end - start):
        raise StatisticsRangeError("No existe un periodo anterior comparable para esas fechas.")
    return start, end


def preset_statistics_range(period, *, today=None):
    today = today or timezone.localdate()
    if period not in {"3", "6", "12"}:
        raise StatisticsRangeError("El periodo debe ser 3, 6, 12 o custom.")
    return shift_month(month_start(today), -(int(period) - 1)), today


def basis_scope(basis):
    if basis not in ALLOWED_BASES:
        raise StatisticsRangeError("La base debe ser analytics o all.")
    if basis == "analytics":
        return {
            "basis": basis,
            "basis_label": "Categorías analíticas",
            "basis_description": "Excluye los movimientos de categorías marcadas para no analizar.",
        }
    return {
        "basis": basis,
        "basis_label": "Todas las categorías",
        "basis_description": "Incluye también los movimientos de categorías excluidas del análisis.",
    }


def is_partial_month_range(start, end):
    return start != month_start(start) or end != month_end(end)


def _category_matches_basis(category, basis):
    if basis == "all":
        return True
    return category is None or not category.exclude_from_analytics


def _refund_allocations(refunds):
    for allocation in allocate_refunds(refunds):
        yield allocation.refund, allocation.expense, allocation.applied, allocation.extra


def _id_chunks(values):
    values = list(values)
    for offset in range(0, len(values), SQLITE_IN_CHUNK):
        yield values[offset : offset + SQLITE_IN_CHUNK]


def _statistics_refund_targets(start, end, basis):
    """Build a database-side refund target scope without a large IN list."""
    expenses = Transaction.objects.filter(
        archived=False,
        date__range=(start, end),
        kind=Transaction.Kind.EXPENSE,
    )
    if basis == "analytics":
        expenses = expenses.filter(
            (Q(allocations__isnull=True) & (Q(category__isnull=True) | Q(category__exclude_from_analytics=False)))
            | (Q(allocations__isnull=False) & (Q(allocations__category__isnull=True) | Q(allocations__category__exclude_from_analytics=False)))
        ).distinct()
    period_refunds = Transaction.objects.filter(
        archived=False,
        date__range=(start, end),
        kind=Transaction.Kind.INCOME,
        refund_for__isnull=False,
    ).values("refund_for_id")
    return expenses.order_by().values("pk").union(period_refunds.order_by())


def _analyse_period(start, end, basis):
    """Load a range once and allocate refunds to their original expenses."""
    basis_scope(basis)
    period_movements = list(
        Transaction.objects.filter(
            archived=False,
            date__range=(start, end),
            kind__in=[Transaction.Kind.INCOME, Transaction.Kind.EXPENSE],
        ).select_related(
            "category",
            "category__parent",
            "refund_for",
            "refund_for__category",
            "refund_for__category__parent",
        ).prefetch_related("allocations__category", "allocations__category__parent")
    )

    by_date = defaultdict(_empty_amounts)
    category_rows = {}
    period_expenses = {}
    drilldown_ids = set()
    refund_attributions = {}
    extra_income = ZERO
    expense_rows_by_id = {}

    for movement in period_movements:
        if movement.kind == Transaction.Kind.EXPENSE:
            parts = [part for part in transaction_allocation_parts(movement) if _category_matches_basis(part.category, basis)]
            if not parts:
                continue
            period_expenses[movement.pk] = movement
            drilldown_ids.add(movement.pk)
            gross_expense = sum((part.amount for part in parts), ZERO)
            by_date[movement.date]["gross_expense"] += gross_expense
            movement_categories = []
            rows_by_category = {}
            for part in parts:
                category = part.category
                category_id = part.category_id
                row = category_rows.setdefault(
                    category_id,
                    {
                        "category_id": category_id,
                        "category_name": category.name if category else "Sin categoría",
                        "family_id": (category.parent_id or category_id) if category else None,
                        "family_name": category.parent.name if category and category.parent_id else category.name if category else "Sin categoría",
                        "color": category.parent.color if category and category.parent_id else category.color if category else "#8e8e93",
                        "is_direct_family_expense": bool(category and not category.parent_id),
                        "gross_expense": ZERO,
                        "refunds_applied": ZERO,
                    },
                )
                row["gross_expense"] += part.amount
                movement_categories.append(row)
                rows_by_category[category_id] = {
                    "transaction_id": movement.pk,
                    "date": movement.date,
                    "month": movement.date.strftime("%Y-%m"),
                    "description": movement.description,
                    "category_id": category_id,
                    "family_id": row["family_id"],
                    "family_name": row["family_name"],
                    "net_expense": part.amount,
                    "transaction_count": 1 if not rows_by_category else 0,
                }
            families = {(item["family_id"], item["family_name"]) for item in movement_categories}
            expense_rows_by_id[movement.pk] = rows_by_category
            continue

        if movement.refund_for_id:
            continue
        parts = [part for part in transaction_allocation_parts(movement) if _category_matches_basis(part.category, basis)]
        if parts:
            by_date[movement.date]["income"] += sum((part.amount for part in parts), ZERO)
            drilldown_ids.add(movement.pk)

    refunds = (
        Transaction.objects.filter(
            archived=False,
            kind=Transaction.Kind.INCOME,
            refund_for_id__in=_statistics_refund_targets(start, end, basis),
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
    for allocation in allocate_refunds(refunds):
        refund, expense = allocation.refund, allocation.expense
        expense_categories = {
            part.category_id: part.category for part in transaction_allocation_parts(expense)
        }
        applied_parts = [
            (category_id, amount)
            for category_id, amount in allocation.category_applied
            if _category_matches_basis(expense_categories.get(category_id), basis)
        ]
        applied = sum((amount for _category_id, amount in applied_parts), ZERO)
        extra = sum(
            (amount for _category_id, amount in refund_extra_parts_in_basis(allocation, basis)),
            ZERO,
        )
        refund_attributions[refund.pk] = {"applied_amount": applied, "extra_income": extra}
        if expense.pk in period_expenses:
            by_date[expense.date]["refunds_applied"] += applied
            for category_id, amount in applied_parts:
                category_rows[category_id]["refunds_applied"] += amount
                expense_row = expense_rows_by_id[expense.pk].get(category_id)
                if expense_row:
                    expense_row["net_expense"] -= amount
            drilldown_ids.add(refund.pk)

        if start <= refund.date <= end and extra:
            # Amounts above the original purchase are not an ordinary refund;
            # preserve the existing rule that treats the excess as real income.
            by_date[refund.date]["income"] += extra
            drilldown_ids.add(refund.pk)
            extra_income += extra

    summary = _summarize(_sum_amounts(by_date.values()))
    return {
        "summary": summary,
        "by_date": dict(by_date),
        "categories": _family_categories(category_rows),
        "drilldown_ids": drilldown_ids,
        "refund_attributions": refund_attributions,
        "extra_income": extra_income,
        "expense_rows": [item for rows in expense_rows_by_id.values() for item in rows.values()],
    }


def _analysis_for_period(start, end, basis):
    """Use the persisted read model when complete and clean; otherwise fallback."""
    return read_model_analysis(start, end, basis) or _analyse_period(start, end, basis)


def annotate_statistics_drilldown(movements, basis="analytics"):
    """Attach applied/extra refund amounts and return an exact adjustment summary."""
    movements = list(movements)
    expenses = [movement for movement in movements if movement.kind == Transaction.Kind.EXPENSE]
    expense_ids = {movement.pk for movement in expenses}
    movement_by_id = {movement.pk: movement for movement in movements}
    refunds = (
        Transaction.objects.filter(
            archived=False,
            kind=Transaction.Kind.INCOME,
            refund_for_id__in=expense_ids,
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
    refunds_applied = ZERO
    extra_income = ZERO
    for allocation in allocate_refunds(refunds):
        refund, expense = allocation.refund, allocation.expense
        expense_categories = {part.category_id: part.category for part in transaction_allocation_parts(expense)}
        applied = sum((
            amount
            for category_id, amount in allocation.category_applied
            if _category_matches_basis(expense_categories.get(category_id), basis)
        ), ZERO)
        extra = sum((
            amount
            for _category_id, amount in refund_extra_parts_in_basis(allocation, basis)
        ), ZERO)
        refunds_applied += applied
        extra_income += extra
        visible_refund = movement_by_id.get(refund.pk)
        if visible_refund is not None:
            visible_refund.statistics_applied_amount = applied
            visible_refund.statistics_extra_income = extra
    gross_expense = sum((
        part.amount
        for movement in expenses
        for part in transaction_allocation_parts(movement)
        if _category_matches_basis(part.category, basis)
    ), ZERO)
    return movements, {
        "gross_expense": gross_expense,
        "refunds_applied": refunds_applied,
        "extra_income": extra_income,
        "net_expense": gross_expense - refunds_applied,
    }


def statistics_report_drilldown(start, end, basis):
    """Return movements and exact analytical totals for one report scope."""
    validate_statistics_range(start, end)
    analysis = _analyse_period(start, end, basis)
    movements = []
    for ids in _id_chunks(analysis["drilldown_ids"]):
        movements.extend(
            Transaction.objects.filter(pk__in=ids, archived=False)
            .select_related(
                "account",
                "category",
                "category__parent",
                "refund_for",
                "refund_for__category",
                "refund_for__category__parent",
            )
            .prefetch_related("tags", "attachments")
        )
    movements.sort(key=lambda movement: (movement.date, movement.created_at, movement.pk), reverse=True)
    for movement in movements:
        attribution = analysis["refund_attributions"].get(movement.pk)
        if attribution is not None:
            movement.statistics_applied_amount = attribution["applied_amount"]
            movement.statistics_extra_income = attribution["extra_income"]
    summary = analysis["summary"]
    return movements, {
        "income": summary["income"],
        "gross_expense": summary["net_expense"] + summary["refunds_applied"],
        "refunds_applied": summary["refunds_applied"],
        "extra_income": analysis["extra_income"],
        "net_expense": summary["net_expense"],
        "analytical_result": summary["analytical_result"],
        "savings_rate": summary["savings_rate"],
    }


def _summary_for_dates(analysis, start, end):
    rows = [amounts for day, amounts in analysis["by_date"].items() if start <= day <= end]
    return _summarize(_sum_amounts(rows))


def _activity_status(summary):
    """An empty movement aggregate cannot prove that the source coverage is complete."""
    return "recorded" if any(summary[key] != ZERO for key in ("income", "net_expense", "refunds_applied")) else "unknown"


def _percentage_change(current, previous):
    if previous == ZERO:
        return None
    return ((current - previous) / abs(previous) * Decimal("100")).quantize(ONE_DECIMAL)


def _category_drivers(current_categories, previous_categories, *, limit=3):
    """Return the families that explain the largest net-expense changes."""
    current_by_family = {item["family_id"]: item for item in current_categories}
    previous_by_family = {item["family_id"]: item for item in previous_categories}
    drivers = []
    for family_id in current_by_family.keys() | previous_by_family.keys():
        current = current_by_family.get(family_id)
        previous = previous_by_family.get(family_id)
        current_amount = current["net_expense"] if current else ZERO
        previous_amount = previous["net_expense"] if previous else ZERO
        change = current_amount - previous_amount
        if change == ZERO:
            continue
        drivers.append(
            {
                "family_id": family_id,
                "family_name": (current or previous)["family_name"],
                "current_net_expense": current_amount,
                "previous_net_expense": previous_amount,
                "change": change,
            }
        )
    drivers.sort(key=lambda item: (-abs(item["change"]), item["family_name"]))
    return drivers[:limit]


def _category_variations(current_categories, previous_categories):
    """Return every family change, ordered for explanation rather than alerting."""
    current_by_family = {item["family_id"]: item for item in current_categories}
    previous_by_family = {item["family_id"]: item for item in previous_categories}
    rows = []
    for family_id in current_by_family.keys() | previous_by_family.keys():
        current = current_by_family.get(family_id)
        previous = previous_by_family.get(family_id)
        current_amount = current["net_expense"] if current else ZERO
        previous_amount = previous["net_expense"] if previous else ZERO
        change = current_amount - previous_amount
        if current_amount == ZERO and previous_amount == ZERO:
            continue
        rows.append(
            {
                "family_id": family_id,
                "family_name": (current or previous)["family_name"],
                "current_net_expense": current_amount,
                "previous_net_expense": previous_amount,
                "change": change,
                "percentage": _percentage_change(current_amount, previous_amount),
            }
        )
    rows.sort(key=lambda item: (-abs(item["change"]), item["family_name"]))
    return rows


def _comparison(current, previous, previous_start, previous_end, current_categories, previous_categories):
    changes = {}
    for key in ("income", "net_expense", "analytical_result"):
        changes[key] = {
            "amount": current[key] - previous[key],
            "percentage": _percentage_change(current[key], previous[key]),
        }
    changes["savings_rate"] = {
        "percentage_points": (
            current["savings_rate"] - previous["savings_rate"]
            if current["savings_rate"] is not None and previous["savings_rate"] is not None
            else None
        )
    }
    return {
        "scope": {
            "date_from": previous_start,
            "date_to": previous_end,
            "label": f"{previous_start:%d/%m/%Y} – {previous_end:%d/%m/%Y}",
        },
        "previous": previous,
        "changes": changes,
        "category_drivers": _category_drivers(current_categories, previous_categories),
        "category_variations": _category_variations(current_categories, previous_categories),
    }


def _monthly_series(analysis, start, end):
    series = []
    cursor = month_start(start)
    while cursor <= month_start(end):
        bounded_start = max(start, cursor)
        bounded_end = min(end, month_end(cursor))
        partial = is_partial_month_range(bounded_start, bounded_end)
        summary = _summary_for_dates(analysis, bounded_start, bounded_end)
        series.append(
            {
                "month": cursor.strftime("%Y-%m"),
                "date_from": bounded_start,
                "date_to": bounded_end,
                **summary,
                "activity_status": _activity_status(summary),
                "is_partial": partial,
                "is_complete": not partial,
            }
        )
        cursor = shift_month(cursor, 1)
    return series


def _monthly_comparisons(series):
    """Only compare adjacent complete months; partial rows stay descriptive."""
    previous = None
    for item in series:
        if (
            previous is None
            or item["is_partial"]
            or previous["is_partial"]
            or item["activity_status"] == "unknown"
            or previous["activity_status"] == "unknown"
        ):
            item["result_change"] = None
            item["expense_change"] = None
        else:
            item["result_change"] = item["analytical_result"] - previous["analytical_result"]
            item["expense_change"] = item["net_expense"] - previous["net_expense"]
        previous = item
    return series


def _expense_analysis(expense_rows, series, precomputed=None):
    """Describe recorded expense patterns without deriving future commitments."""
    if precomputed is not None:
        merchants = {}
        families = {}
        total_net_expense = sum((item["net_expense"] for item in precomputed["merchants"]), ZERO)
        for source in precomputed["merchants"]:
            if source["net_expense"] <= ZERO:
                continue
            merchants[source["description"]] = {
                "description": source["description"],
                "net_expense": source["net_expense"],
                "transaction_count": source["transaction_count"],
                "last_date": source["last_date"],
                "months": defaultdict(lambda: ZERO, source["months"]),
            }
        for source in precomputed["families"].values():
            if source["net_expense"] <= ZERO:
                continue
            families[source["family_id"]] = {
                "family_id": source["family_id"],
                "family_name": source["family_name"],
                "net_expense": source["net_expense"],
                "months": defaultdict(lambda: ZERO, source["months"]),
            }
    else:
        total_net_expense = sum((item["net_expense"] for item in expense_rows), ZERO)
        merchants = {}
        families = {}
        for item in expense_rows:
            if item["net_expense"] <= ZERO:
                continue
            normalized_description = item["description"].strip() or "Sin concepto"
            merchant = merchants.setdefault(
                normalized_description,
                {"description": item["description"].strip() or "Sin concepto", "net_expense": ZERO,
                 "transaction_ids": set(), "last_date": item["date"], "months": defaultdict(lambda: ZERO)},
            )
            merchant["net_expense"] += item["net_expense"]
            merchant["transaction_ids"].add(item.get("transaction_id", (item["date"], normalized_description)))
            merchant["last_date"] = max(merchant["last_date"], item["date"])
            merchant["months"][item["month"]] += item["net_expense"]
            family = families.setdefault(
                item["family_id"],
                {"family_id": item["family_id"], "family_name": item["family_name"], "net_expense": ZERO,
                 "months": defaultdict(lambda: ZERO)},
            )
            family["net_expense"] += item["net_expense"]
            family["months"][item["month"]] += item["net_expense"]

    merchant_rows = []
    recurring = []
    for item in merchants.values():
        if "transaction_ids" in item:
            item["transaction_count"] = len(item.pop("transaction_ids"))
        item["percentage"] = (item["net_expense"] / total_net_expense * Decimal("100")).quantize(ONE_DECIMAL) if total_net_expense else ZERO
        month_values = list(item["months"].values())
        item["active_months"] = len(month_values)
        item["typical_monthly_expense"] = _median(month_values) if month_values else ZERO
        item.pop("months", None)
        merchant_rows.append(item)
        if item["active_months"] >= 3:
            recurring.append(dict(item))
    merchant_rows.sort(key=lambda item: (-item["net_expense"], item["description"]))
    recurring.sort(key=lambda item: (-item["active_months"], -item["net_expense"], item["description"]))

    matrix_rows = []
    for item in families.values():
        values = [{"month": point["month"], "net_expense": item["months"].get(point["month"], ZERO)} for point in series]
        item.pop("months", None)
        matrix_rows.append({**item, "values": values})
    matrix_rows.sort(key=lambda item: (-item["net_expense"], item["family_name"]))
    return {
        "merchants": merchant_rows[:8],
        "recurring": recurring[:8],
        "category_matrix": {
            "months": [
                {"month": item["month"], "is_partial": item["is_partial"], "activity_status": item["activity_status"]}
                for item in series
            ],
            "rows": matrix_rows[:12],
        },
    }


def _data_quality(start, end, basis, analysis):
    uncategorized = [item for item in analysis["expense_rows"] if item["family_id"] is None and item["net_expense"] > ZERO]
    uncategorized_ids = {item.get("transaction_id", index) for index, item in enumerate(uncategorized)}
    transfers = Transaction.objects.filter(
        archived=False, date__range=(start, end), kind__in=[Transaction.Kind.TRANSFER_IN, Transaction.Kind.TRANSFER_OUT],
    )
    transfer_groups = set(transfers.exclude(transfer_group__isnull=True).values_list("transfer_group", flat=True))
    possible_bank_transfers = BankTransaction.objects.filter(
        status=BankTransaction.Status.PENDING,
        possible_transfer=True,
        booking_date__range=(start, end),
    ).count()
    return {
        "uncategorized": {"count": len(uncategorized_ids), "net_expense": sum((item["net_expense"] for item in uncategorized), ZERO)},
        "transfers_excluded": {"count": len(transfer_groups)},
        "possible_bank_transfers": {"count": possible_bank_transfers},
        "basis": basis,
    }


def _median(values):
    """Return the exact median of a non-empty Decimal sequence."""
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / Decimal("2")


def _summary_difference(all_summary, analytics_summary):
    return {
        key: all_summary[key] - analytics_summary[key]
        for key in ("income", "net_expense", "analytical_result")
    }


def _basis_reconciliation(all_analysis, analytics_analysis):
    """Explain the fixed all-versus-analytics difference without changing the active basis."""
    all_by_family = {item["family_id"]: item for item in all_analysis["categories"]}
    analytics_by_family = {item["family_id"]: item for item in analytics_analysis["categories"]}
    excluded_categories = []
    for family_id, item in all_by_family.items():
        analytics_item = analytics_by_family.get(family_id)
        net_expense = item["net_expense"] - (analytics_item["net_expense"] if analytics_item else ZERO)
        if net_expense > ZERO:
            excluded_categories.append(
                {
                    "family_id": family_id,
                    "family_name": item["family_name"],
                    "net_expense": net_expense,
                }
            )
    excluded_categories.sort(key=lambda item: (-item["net_expense"], item["family_name"]))
    return {
        "excluded_summary": _summary_difference(all_analysis["summary"], analytics_analysis["summary"]),
        "excluded_categories": excluded_categories,
    }


def _accumulated_summary(analysis, start, end):
    return _summary_for_dates(analysis, start, end)


def _historical_months(selected_month):
    """The twelve complete calendar months directly before the selected month."""
    return [shift_month(selected_month, -offset) for offset in range(12, 0, -1)]


def _month_insights(selected_month, start, end, basis, current_analysis):
    """Build descriptive, non-predictive daily pace and category spike facts."""
    # A historical month is comparable only when it contains the full selected
    # interval.  This keeps custom partial ranges (for example, 20–25) aligned
    # by day-of-month instead of comparing them with a 1–25 accumulation.
    histories = []
    for historical_month in _historical_months(selected_month):
        if month_end(historical_month).day < end.day:
            continue
        histories.append((historical_month, _analysis_for_period(historical_month, month_end(historical_month), basis)))

    rhythm_points = []
    cursor = start
    while cursor <= end:
        current = _accumulated_summary(current_analysis, start, cursor)
        comparable = []
        for historical_month, analysis in histories:
            if cursor.day > month_end(historical_month).day:
                continue
            historical_start = historical_month.replace(day=start.day)
            comparable.append(_accumulated_summary(analysis, historical_start, historical_month.replace(day=cursor.day)))
        def median_for(key):
            return _median([item[key] for item in comparable]) if comparable else None
        rhythm_points.append(
            {
                "date": cursor,
                "income": current["income"],
                "net_expense": current["net_expense"],
                "analytical_result": current["analytical_result"],
                "median_income": median_for("income"),
                "median_net_expense": median_for("net_expense"),
                "median_analytical_result": median_for("analytical_result"),
            }
        )
        cursor += timedelta(days=1)

    historical_categories = []
    for historical_month, _analysis in histories:
        historical_start = historical_month.replace(day=start.day)
        historical_end = historical_month.replace(day=end.day)
        comparable_analysis = _analysis_for_period(historical_start, historical_end, basis)
        historical_categories.append(
            {item["family_id"]: item["net_expense"] for item in comparable_analysis["categories"]}
        )

    spikes = []
    available_sample_months = 0
    for family in current_analysis["categories"]:
        samples = [
            categories[family["family_id"]]
            for categories in historical_categories
            if categories.get(family["family_id"], ZERO) > ZERO
        ]
        available_sample_months = max(available_sample_months, len(samples))
        if len(samples) < 3:
            continue
        median_net_expense = _median(samples)
        current_net_expense = family["net_expense"]
        if median_net_expense <= ZERO or current_net_expense < median_net_expense * Decimal("1.5"):
            continue
        spikes.append(
            {
                "family_id": family["family_id"],
                "family_name": family["family_name"],
                "current_net_expense": current_net_expense,
                "median_net_expense": median_net_expense,
                "increase_percentage": ((current_net_expense - median_net_expense) / median_net_expense * Decimal("100")).quantize(ONE_DECIMAL),
            }
        )
    spikes.sort(key=lambda item: (-item["increase_percentage"], item["family_name"]))
    return {
        "rhythm": {"comparison_months": len(histories), "points": rhythm_points},
        "spikes": {
            "comparison_months": len(histories),
            "available_sample_months": available_sample_months,
            "minimum_sample_size": 3,
            "items": spikes,
        },
    }


def statistics_report(start, end, basis):
    """Return the read-only statistics contract for one active scope."""
    validate_statistics_range(start, end)
    basis_data = basis_scope(basis)
    current = _analysis_for_period(start, end, basis)
    alternate_basis = "all" if basis == "analytics" else "analytics"
    alternate = _analysis_for_period(start, end, alternate_basis)
    previous_end = start - timedelta(days=1)
    previous_start = previous_end - (end - start)
    previous = _analysis_for_period(previous_start, previous_end, basis)
    all_analysis = current if basis == "all" else alternate
    analytics_analysis = current if basis == "analytics" else alternate
    monthly_series = _monthly_comparisons(_monthly_series(current, start, end))
    money_nodes = [{"id": "income", "label": "Ingresos", "kind": "source", "value": current["summary"]["income"]}]
    money_links = []
    categories = sorted(current["categories"], key=lambda item: item["net_expense"], reverse=True)
    visible_categories = categories[:8]
    folded_categories = categories[8:]
    if folded_categories:
        visible_categories.append({"family_id": None, "family_name": "Otros", "net_expense": sum((item["net_expense"] for item in folded_categories), ZERO)})
    for family in visible_categories:
        node_id = (
            "category:other"
            if family["family_name"] == "Otros"
            else f"category:{family['family_id']}"
            if family["family_id"] is not None
            else "category:uncategorized"
        )
        money_nodes.append({"id": node_id, "label": family["family_name"], "kind": "category", "value": family["net_expense"]})
        money_links.append({"source": "income", "target": node_id, "value": family["net_expense"],
                            "category_family": family["family_id"], "category_families": [item["family_id"] for item in folded_categories] if family["family_name"] == "Otros" else [family["family_id"]]})
    money_nodes.append({"id": "expenses", "label": "Gasto neto", "kind": "destination", "value": current["summary"]["net_expense"]})
    money_links.extend({"source": link["target"], "target": "expenses", "value": link["value"],
                        "category_family": link["category_family"], "category_families": link["category_families"]} for link in list(money_links))
    result = current["summary"]["analytical_result"]
    if result >= ZERO:
        money_nodes.append({"id": "surplus", "label": "Margen restante", "kind": "surplus", "value": result})
        money_links.append({"source": "income", "target": "surplus", "value": result, "category_family": None, "category_families": []})
    else:
        money_nodes.append({"id": "deficit", "label": "Déficit", "kind": "deficit", "value": abs(result)})
        money_links.append({"source": "deficit", "target": "expenses", "value": abs(result), "category_family": None, "category_families": []})
    comparison = _comparison(
        current["summary"],
        previous["summary"],
        previous_start,
        previous_end,
        current["categories"],
        previous["categories"],
    )
    comparison["previous_activity_status"] = _activity_status(previous["summary"])
    previous_months = _monthly_series(previous, previous_start, previous_end)
    comparison["is_comparable"] = not any(
        item["activity_status"] == "unknown" for item in (*monthly_series, *previous_months)
    )
    return {
        "scope": {
            **basis_data,
            "date_from": start,
            "date_to": end,
            "label": f"{start:%d/%m/%Y} – {end:%d/%m/%Y}",
            "is_partial": is_partial_month_range(start, end),
        },
        "summary": current["summary"],
        "activity_status": _activity_status(current["summary"]),
        "comparison": comparison,
        "monthly_series": monthly_series,
        "categories": current["categories"],
        "basis_reconciliation": _basis_reconciliation(all_analysis, analytics_analysis),
        "analysis": _expense_analysis(current["expense_rows"], monthly_series, current.get("precomputed_expense_analysis")),
        "data_quality": _data_quality(start, end, basis, current),
        "money_map": {"nodes": money_nodes, "links": money_links, "grouping": "Familias con gasto neto positivo."},
    }


def statistics_month_report(year, month, active_start, active_end, basis):
    """Return one month restricted to its intersection with the active scope."""
    validate_statistics_range(active_start, active_end)
    basis_data = basis_scope(basis)
    try:
        selected_month = date(year, month, 1)
    except ValueError as exc:
        raise StatisticsRangeError("Mes no válido.") from exc
    start = max(selected_month, active_start)
    end = min(month_end(selected_month), active_end)
    if start > end:
        raise StatisticsRangeError("El mes no pertenece al periodo activo.")

    analysis = _analysis_for_period(start, end, basis)
    daily_series = []
    cursor = start
    while cursor <= end:
        daily_series.append({"date": cursor, **_summary_for_dates(analysis, cursor, cursor)})
        cursor += timedelta(days=1)
    return {
        "scope": {
            **basis_data,
            "selected_month": selected_month.strftime("%Y-%m"),
            "date_from": start,
            "date_to": end,
            "label": f"{start:%d/%m/%Y} – {end:%d/%m/%Y}",
            "is_partial": is_partial_month_range(start, end),
        },
        "activity_status": _activity_status(analysis["summary"]),
        "summary": analysis["summary"],
        "daily_series": daily_series,
        "categories": analysis["categories"],
        "insights": _month_insights(selected_month, start, end, basis, analysis),
    }
