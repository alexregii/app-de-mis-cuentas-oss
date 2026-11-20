"""Exact validation and replacement for a transaction's category split."""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from django.db import transaction as db_transaction

from .models import Category, Transaction, TransactionAllocation

ZERO = Decimal("0.00")
CENT = Decimal("0.01")
MAX_ALLOCATIONS = 20


class TransactionAllocationError(ValueError):
    """A proposed category split is malformed or financially inconsistent."""


class TransactionAllocationConflict(TransactionAllocationError):
    """The transaction's split changed after the client loaded it."""


@dataclass(frozen=True)
class AllocationPart:
    category_id: int | None
    amount: Decimal
    position: int = 0
    category: object | None = None


def normalize_allocation_payload(payload, *, kind, total):
    total = Decimal(str(total))
    if kind not in {Transaction.Kind.INCOME, Transaction.Kind.EXPENSE}:
        raise TransactionAllocationError("Los traspasos no admiten partidas por categoría.")
    if not isinstance(payload, list) or not 1 <= len(payload) <= MAX_ALLOCATIONS:
        raise TransactionAllocationError(f"Indica entre 1 y {MAX_ALLOCATIONS} partidas.")

    parts = []
    seen_categories = set()
    category_ids = set()
    for item in payload:
        if not isinstance(item, dict) or set(item) != {"category_id", "amount"}:
            raise TransactionAllocationError("Cada partida requiere category_id e importe.")
        raw_category_id = item["category_id"]
        if raw_category_id is None or raw_category_id == "":
            category_id = None
        elif isinstance(raw_category_id, bool):
            raise TransactionAllocationError("Una categoría de partida no es válida.")
        else:
            try:
                category_id = int(raw_category_id)
            except (TypeError, ValueError) as exc:
                raise TransactionAllocationError("Una categoría de partida no es válida.") from exc
            if category_id <= 0 or str(category_id) != str(raw_category_id):
                raise TransactionAllocationError("Una categoría de partida no es válida.")
            category_ids.add(category_id)
        if category_id in seen_categories:
            raise TransactionAllocationError("No repitas una categoría; combina sus importes en una partida.")
        seen_categories.add(category_id)
        try:
            amount = Decimal(str(item["amount"]))
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise TransactionAllocationError("El importe de una partida no es válido.") from exc
        try:
            rounded_amount = amount.quantize(CENT)
        except InvalidOperation as exc:
            raise TransactionAllocationError("Cada partida debe ser un importe positivo con hasta dos decimales.") from exc
        if not amount.is_finite() or amount <= ZERO or amount != rounded_amount:
            raise TransactionAllocationError("Cada partida debe ser un importe positivo con hasta dos decimales.")
        parts.append(AllocationPart(category_id=category_id, amount=amount))

    if sum((part.amount for part in parts), ZERO) != total:
        raise TransactionAllocationError("La suma de las partidas debe coincidir exactamente con el importe del movimiento.")

    categories = {item.pk: item for item in Category.objects.filter(pk__in=category_ids)}
    if len(categories) != len(category_ids):
        raise TransactionAllocationError("Una categoría de partida ya no está disponible.")
    expected_kind = Category.Kind.INCOME if kind == Transaction.Kind.INCOME else Category.Kind.EXPENSE
    if any(category.kind != expected_kind for category in categories.values()):
        raise TransactionAllocationError("Las categorías de las partidas deben corresponder al tipo del movimiento.")
    return parts


def _current_parts(movement, rows):
    if rows:
        return [AllocationPart(row.category_id, row.amount, row.position, row.category) for row in rows]
    return [AllocationPart(movement.category_id, movement.amount, 0, getattr(movement, "category", None))]


def allocation_rows_for(movement):
    prefetched = getattr(movement, "_prefetched_objects_cache", {})
    if "allocations" in prefetched:
        return prefetched["allocations"]
    relation = getattr(movement, "allocations", None)
    return list(relation.select_related("category", "category__parent").all()) if relation is not None else []


def transaction_allocation_parts(movement):
    rows = allocation_rows_for(movement)
    if rows:
        return [AllocationPart(row.category_id, Decimal(row.amount), row.position, row.category) for row in rows]
    return [AllocationPart(movement.category_id, Decimal(movement.amount), 0, getattr(movement, "category", None))]


def category_in_reporting_basis(category, basis):
    if basis == "all":
        return True
    excluded = bool(category and category.exclude_from_analytics)
    if basis == "excluded":
        return excluded
    return not excluded


def refund_extra_parts_in_basis(refund_allocation, basis):
    """Filter excess-income category parts using their actual allocation source."""
    if not refund_allocation.extra_by_category:
        return ()
    if refund_allocation.extra_follows_refund_allocations:
        refund_categories = {
            part.category_id: part.category
            for part in transaction_allocation_parts(refund_allocation.refund)
        }
        return tuple(
            (category_id, amount)
            for category_id, amount in refund_allocation.extra_by_category
            if category_in_reporting_basis(refund_categories.get(category_id), basis)
        )
    category = (
        refund_allocation.refund.category
        if refund_allocation.split_expense
        else refund_allocation.expense.category
    )
    return refund_allocation.extra_by_category if category_in_reporting_basis(category, basis) else ()


def transaction_amount_in_reporting_basis(movement, basis):
    return sum(
        (part.amount for part in transaction_allocation_parts(movement) if category_in_reporting_basis(part.category, basis)),
        Decimal("0.00"),
    )


def _same_parts(left, right):
    return len(left) == len(right) and all(
        old.category_id == new.category_id and old.amount == new.amount
        for old, new in zip(left, right)
    )


def replace_transaction_allocations(movement, payload, *, expected_revision=None):
    parts = normalize_allocation_payload(payload, kind=movement.kind, total=movement.amount)
    with db_transaction.atomic():
        current = Transaction.objects.select_for_update().get(pk=movement.pk)
        rows = list(
            TransactionAllocation.objects.select_for_update()
            .filter(transaction=current)
            .order_by("position", "pk")
        )
        desired_revision = current.allocation_revision
        if expected_revision is not None:
            if type(expected_revision) is not int or expected_revision < 0:
                raise TransactionAllocationError("expected_allocation_revision no es válido.")
            if expected_revision != current.allocation_revision and not _same_parts(_current_parts(current, rows), parts):
                raise TransactionAllocationConflict("Las partidas cambiaron; vuelve a cargar el movimiento.")
        if _same_parts(_current_parts(current, rows), parts):
            return current, False

        TransactionAllocation.objects.filter(transaction=current).delete()
        if len(parts) == 1:
            current.category_id = parts[0].category_id
        else:
            current.category_id = None
            TransactionAllocation.objects.bulk_create([
                TransactionAllocation(
                    transaction=current,
                    category_id=part.category_id,
                    amount=part.amount,
                    position=position,
                )
                for position, part in enumerate(parts)
            ])
        current.allocation_revision = desired_revision + 1
        current.save(update_fields=["category", "allocation_revision", "updated_at"])
        return current, True
