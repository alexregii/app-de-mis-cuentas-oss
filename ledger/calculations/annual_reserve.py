"""Pure calendar and money calculations for annual expense reserves."""

from datetime import date
from decimal import Decimal, ROUND_UP

from .recurrence import occurrence_dates

CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def next_annual_due_date(rule, after: date, *, strictly_after=False):
    """Return the next valid annual due date using the recurring rule safe day."""
    if rule.frequency != "yearly" or rule.kind != "expense":
        return None
    start = after
    if strictly_after:
        start = date.fromordinal(after.toordinal() + 1)
    horizon_year = max(start.year, rule.start_date.year) + 2
    horizon = date(horizon_year, 12, 31)
    if rule.end_date:
        horizon = min(horizon, rule.end_date)
    return next(occurrence_dates(rule, start, horizon), None)


def reserve_progress(target_amount, assigned_amount, due_date, *, as_of: date):
    """Calculate a due-date-based monthly suggestion without creating cash flow."""
    target = Decimal(target_amount)
    assigned = Decimal(assigned_amount)
    remaining = max(target - assigned, ZERO)
    if due_date is None:
        return {"status": "ended", "due_date": None, "months_remaining": None,
                "remaining_amount": remaining, "monthly_amount": None}
    if due_date < as_of:
        return {"status": "overdue", "due_date": due_date, "months_remaining": 0,
                "remaining_amount": remaining, "monthly_amount": ZERO}

    months = (due_date.year - as_of.year) * 12 + due_date.month - as_of.month
    months = max(1, months)
    monthly = (remaining / Decimal(months)).quantize(CENT, rounding=ROUND_UP)
    return {"status": "active", "due_date": due_date, "months_remaining": months,
            "remaining_amount": remaining, "monthly_amount": monthly}