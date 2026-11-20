"""Pure recurrence calendar helpers."""

import calendar
from datetime import date


def safe_day(year: int, month: int, preferred: int) -> int:
    return min(preferred, calendar.monthrange(year, month)[1])


def occurrence_dates(rule, start: date, end: date):
    """Yield dates where a rule is effective in the requested interval."""
    cursor = max(start.replace(day=1), rule.start_date.replace(day=1))
    while cursor <= end:
        if rule.frequency != "yearly" or cursor.month == rule.start_date.month:
            due = cursor.replace(day=safe_day(cursor.year, cursor.month, rule.day_of_month))
            if start <= due <= end and rule.start_date <= due and (not rule.end_date or due <= rule.end_date):
                yield due
        cursor = date(cursor.year + (cursor.month == 12), 1 if cursor.month == 12 else cursor.month + 1, 1)
