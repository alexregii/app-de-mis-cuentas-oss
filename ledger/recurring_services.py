"""Recurring occurrence materialization and reconciliation lifecycle."""

from datetime import date, timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .calculations.recurrence import occurrence_dates

from .models import Category, RecurringOccurrence, RecurringRule, Transaction, normalize_match_text
from .services import month_bounds
from .savings_objectives import consume_annual_reserve, sync_annual_reserve


def materialize_recurring_occurrences(start, end):
    """Create the actionable rows for a requested range, without reconciling."""
    created = 0
    for rule in RecurringRule.objects.filter(active=True, start_date__lte=end).filter(
        Q(end_date__isnull=True) | Q(end_date__gte=start)
    ):
        for due in occurrence_dates(rule, start, end):
            _, was_created = RecurringOccurrence.objects.get_or_create(
                rule=rule,
                due_date=due,
                defaults={"amount": rule.amount},
            )
            created += int(was_created)
    return created


@transaction.atomic
def refresh_recurring_rule_schedule(rule, *, as_of=None):
    """Rebuild only future pending rows after a rule edit; keep overdue decisions."""
    today = as_of or timezone.localdate()
    future = RecurringOccurrence.objects.filter(
        rule=rule, status=RecurringOccurrence.Status.PENDING, due_date__gte=today
    )
    existing_end = future.order_by("-due_date").values_list("due_date", flat=True).first()
    horizon_year = max(today.year, rule.start_date.year) + 1
    end = max(date(horizon_year, 12, 31), existing_end or today)
    future.delete()
    if rule.active and rule.start_date <= end:
        for due in occurrence_dates(rule, today, end):
            RecurringOccurrence.objects.get_or_create(
                rule=rule, due_date=due, defaults={"amount": rule.amount}
            )
    sync_annual_reserve(rule, as_of=today)

def generate_recurring_occurrences(start=None, end=None):
    start, end = (start, end) if start and end else month_bounds()
    created = materialize_recurring_occurrences(start, end)
    reconcile_recurring_occurrences(start, end)
    return created


@transaction.atomic
def match_recurring_occurrence(movement, *, date_tolerance_days=7):
    """Link a real movement to one unambiguous pending recurring forecast."""
    materialize_recurring_occurrences(
        movement.date - timedelta(days=date_tolerance_days),
        movement.date + timedelta(days=date_tolerance_days),
    )
    movement = Transaction.objects.select_for_update().get(pk=movement.pk)
    if (
        movement.archived
        or movement.transfer_group
        or movement.recurring_occurrence_id
        or movement.kind not in {Transaction.Kind.INCOME, Transaction.Kind.EXPENSE}
    ):
        return None

    rule_kind = Category.Kind.INCOME if movement.kind == Transaction.Kind.INCOME else Category.Kind.EXPENSE
    window_start = movement.date - timedelta(days=date_tolerance_days)
    window_end = movement.date + timedelta(days=date_tolerance_days)
    candidates = list(
        RecurringOccurrence.objects.select_for_update()
        .select_related("rule", "rule__category")
        .filter(
            status=RecurringOccurrence.Status.PENDING,
            rule__active=True,
            rule__account_id=movement.account_id,
            rule__kind=rule_kind,
            amount=movement.amount,
            due_date__range=(window_start, window_end),
        )
    )
    if not candidates:
        return None

    nearest_distance = min(abs((item.due_date - movement.date).days) for item in candidates)
    nearest = [item for item in candidates if abs((item.due_date - movement.date).days) == nearest_distance]
    if len(nearest) > 1:
        description = normalize_match_text(movement.description)
        named = [
            item
            for item in nearest
            if normalize_match_text(item.rule.name) in description
            or description in normalize_match_text(item.rule.name)
        ]
        if len(named) != 1:
            return None
        nearest = named

    occurrence = nearest[0]
    movement.recurring_occurrence = occurrence
    update_fields = ["recurring_occurrence", "updated_at"]
    if movement.category_id is None:
        movement.category = occurrence.rule.category
        update_fields.append("category")
    movement.save(update_fields=update_fields)
    occurrence.status = RecurringOccurrence.Status.CONFIRMED
    occurrence.save(update_fields=["status"])
    consume_annual_reserve(occurrence)
    return occurrence


def reconcile_recurring_occurrences(start=None, end=None):
    """Match pending forecasts against real, already-recorded movements."""
    start, end = (start, end) if start and end else month_bounds()
    pending = list(
        RecurringOccurrence.objects.filter(
            status=RecurringOccurrence.Status.PENDING,
            rule__active=True,
            due_date__range=(start - timedelta(days=7), end + timedelta(days=7)),
        ).values("rule__account_id", "rule__kind", "amount")
    )
    if not pending:
        return 0

    matched = 0
    movements = Transaction.objects.filter(
        archived=False,
        transfer_group__isnull=True,
        recurring_occurrence__isnull=True,
        kind__in=[Transaction.Kind.INCOME, Transaction.Kind.EXPENSE],
        account_id__in={item["rule__account_id"] for item in pending},
        amount__in={item["amount"] for item in pending},
        date__range=(start - timedelta(days=7), end + timedelta(days=7)),
    ).order_by("date", "created_at")
    for movement in movements.iterator():
        matched += int(match_recurring_occurrence(movement) is not None)
    return matched


def confirm_occurrence(occurrence):
    """Legacy action: reconcile an occurrence, but never create a movement."""
    if occurrence.status != RecurringOccurrence.Status.PENDING:
        return getattr(occurrence, "transaction", None)
    reconcile_recurring_occurrences(occurrence.due_date, occurrence.due_date)
    occurrence.refresh_from_db()
    return getattr(occurrence, "transaction", None) if occurrence.status == RecurringOccurrence.Status.CONFIRMED else None
