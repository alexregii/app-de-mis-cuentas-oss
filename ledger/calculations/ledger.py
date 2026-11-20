"""Canonical, side-effect-free ledger calculations.

This module deliberately depends on duck-typed movement objects instead of Django
models.  It can therefore be exercised with simple fixtures and reused by the
service and reporting adapters without creating a second financial definition.
"""

from dataclasses import dataclass
from decimal import ROUND_DOWN, Decimal
from typing import Iterable


ZERO = Decimal("0.00")
NEGATIVE_KINDS = frozenset({"expense", "transfer_out"})


def signed_amount(kind: str, amount: Decimal) -> Decimal:
    """Return the ledger sign for an already-positive stored amount."""
    amount = Decimal(amount)
    return -amount if kind in NEGATIVE_KINDS else amount


def is_valid_transfer_pair(outgoing: object, incoming: object) -> bool:
    """Check the invariant of one internal transfer without touching storage."""
    return bool(
        outgoing.transfer_group
        and outgoing.transfer_group == incoming.transfer_group
        and outgoing.kind == "transfer_out"
        and incoming.kind == "transfer_in"
        and Decimal(outgoing.amount) == Decimal(incoming.amount)
        and outgoing.account_id != incoming.account_id
        and outgoing.archived == incoming.archived
    )


@dataclass(frozen=True)
class RefundAllocation:
    refund: object
    expense: object
    applied: Decimal
    extra: Decimal
    category_applied: tuple[tuple[int | None, Decimal], ...] = ()
    extra_by_category: tuple[tuple[int | None, Decimal], ...] = ()
    split_expense: bool = False
    extra_follows_refund_allocations: bool = False


def _refund_sort_key(refund):
    expense = refund.refund_for
    return (
        expense.pk,
        refund.date,
        getattr(refund, "created_at", None),
        refund.pk,
    )


def _stored_allocation_rows(transaction):
    prefetched = getattr(transaction, "_prefetched_objects_cache", {})
    if "allocations" in prefetched:
        return prefetched["allocations"]
    relation = getattr(transaction, "allocations", None)
    return list(relation.all()) if relation is not None else []


def _proportional_parts(target, remaining_parts):
    total_remaining = sum((amount for _, amount, _ in remaining_parts), ZERO)
    if target <= ZERO or total_remaining <= ZERO:
        return []
    exact = [target * amount / total_remaining for _, amount, _ in remaining_parts]
    rounded = [value.quantize(Decimal("0.01"), rounding=ROUND_DOWN) for value in exact]
    cents_left = int((target - sum(rounded, ZERO)) * 100)
    order = sorted(
        range(len(remaining_parts)),
        key=lambda index: (-(exact[index] - rounded[index]), remaining_parts[index][2]),
    )
    for index in order[:cents_left]:
        rounded[index] += Decimal("0.01")
    return [
        (remaining_parts[index][0], rounded[index])
        for index in range(len(remaining_parts))
        if rounded[index] > ZERO
    ]


def _extra_parts_for_refund(refund, extra, fallback_category_id):
    refund_rows = _stored_allocation_rows(refund)
    if extra <= ZERO:
        return (), bool(refund_rows)
    if not refund_rows:
        return ((fallback_category_id, extra),), False
    refund_parts = [
        [row.category_id, Decimal(row.amount), row.position]
        for row in refund_rows
    ]
    return tuple(_proportional_parts(extra, refund_parts)), True


def allocate_refunds(refunds: Iterable[object]) -> list[RefundAllocation]:
    """Allocate linked refunds chronologically without exceeding a purchase.

    Invalid legacy links (a non-expense target or a refund dated before its
    purchase) are real, unallocated income.  They do not consume the remaining
    refundable amount of an otherwise valid purchase.
    """
    remaining_by_expense: dict[int, Decimal] = {}
    remaining_by_category: dict[int, list[list[object]]] = {}
    allocations: list[RefundAllocation] = []
    for refund in sorted(refunds, key=_refund_sort_key):
        expense = refund.refund_for
        if expense.kind != "expense" or refund.date < expense.date:
            extra = Decimal(refund.amount)
            extra_parts, follows_refund_allocations = _extra_parts_for_refund(refund, extra, expense.category_id)
            allocations.append(RefundAllocation(
                refund,
                expense,
                ZERO,
                extra,
                (),
                extra_parts,
                extra_follows_refund_allocations=follows_refund_allocations,
            ))
            continue
        rows = _stored_allocation_rows(expense)
        if not rows:
            remaining = remaining_by_expense.setdefault(expense.pk, Decimal(expense.amount))
            applied = min(Decimal(refund.amount), max(remaining, ZERO))
            remaining_by_expense[expense.pk] = remaining - applied
            extra = Decimal(refund.amount) - applied
            category_applied = ((expense.category_id, applied),) if applied else ()
            extra_parts, follows_refund_allocations = _extra_parts_for_refund(refund, extra, expense.category_id)
            allocations.append(RefundAllocation(
                refund,
                expense,
                applied,
                extra,
                category_applied,
                extra_parts,
                False,
                follows_refund_allocations,
            ))
            continue

        remaining_parts = remaining_by_category.setdefault(
            expense.pk,
            [[row.category_id, Decimal(row.amount), row.position] for row in rows],
        )
        remaining_total = sum((part[1] for part in remaining_parts), ZERO)
        applied = min(Decimal(refund.amount), max(remaining_total, ZERO))
        category_applied = _proportional_parts(applied, remaining_parts)
        applied_by_category = dict(category_applied)
        for part in remaining_parts:
            part[1] -= applied_by_category.get(part[0], ZERO)
        extra = Decimal(refund.amount) - applied
        extra_parts, follows_refund_allocations = _extra_parts_for_refund(refund, extra, refund.category_id)
        allocations.append(RefundAllocation(
            refund,
            expense,
            applied,
            extra,
            tuple(category_applied),
            extra_parts,
            True,
            follows_refund_allocations,
        ))
    return allocations


def period_totals(*, income: Decimal, gross_expense: Decimal, refunds_applied: Decimal) -> dict[str, Decimal]:
    """Return the canonical exact totals for one reporting period."""
    income = Decimal(income)
    gross_expense = Decimal(gross_expense)
    refunds_applied = Decimal(refunds_applied)
    net_expense = gross_expense - refunds_applied
    return {
        "income": income,
        "gross_expense": gross_expense,
        "refunds_applied": refunds_applied,
        "net_expense": net_expense,
        "analytical_result": income - net_expense,
    }
