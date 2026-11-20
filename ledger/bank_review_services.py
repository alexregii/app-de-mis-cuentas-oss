"""Bank review mutation services."""

from datetime import timedelta
from decimal import Decimal
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from .calculations.ledger import is_valid_transfer_pair
from .models import BankTransaction, Category, Transaction, TransactionAllocation
from .recurring_services import match_recurring_occurrence
from .transaction_services import create_transfer

TRANSFER_CANDIDATE_WINDOW = timedelta(days=7)


class BankTransferConflict(ValueError):
    """A bank row or transfer pair changed after its preview was loaded."""


class BankReviewConflict(ValueError):
    """A reviewed bank row no longer matches its archived movement."""


def _reviewable_transfer_row(row):
    return row.status == BankTransaction.Status.PENDING or (
        row.status == BankTransaction.Status.SKIPPED and row.possible_transfer
    )


def _transfer_pair(group_id, *, lock=False):
    queryset = Transaction.objects.filter(transfer_group=group_id).select_related("account")
    if lock:
        queryset = queryset.select_for_update()
    legs = list(queryset)
    outgoing = next((leg for leg in legs if leg.kind == Transaction.Kind.TRANSFER_OUT), None)
    incoming = next((leg for leg in legs if leg.kind == Transaction.Kind.TRANSFER_IN), None)
    if len(legs) != 2 or not outgoing or not incoming or not is_valid_transfer_pair(outgoing, incoming):
        raise BankTransferConflict("El par de traspaso ya no es válido.")
    if outgoing.archived or incoming.archived:
        raise BankTransferConflict("No se puede enlazar un traspaso archivado.")
    return outgoing, incoming


def _transfer_side(*, account, date, description, amount, bank_transaction_id=None, transaction_id=None):
    return {
        "bank_transaction_id": bank_transaction_id,
        "transaction_id": transaction_id,
        "account_id": account.pk,
        "account_name": account.name,
        "date": date,
        "description": description,
        "amount": Decimal(amount),
    }


def _candidate(*, candidate_type, candidate_id, source, outgoing, incoming, fee_amount, days_apart):
    return {
        "candidate_type": candidate_type,
        "candidate_id": str(candidate_id),
        "source": source,
        "outgoing": outgoing,
        "incoming": incoming,
        "transfer_amount": Decimal(incoming["amount"]),
        "fee_amount": Decimal(fee_amount),
        "requires_fee_confirmation": bool(fee_amount),
        "days_apart": days_apart,
    }


def bank_transfer_candidates(bank_transaction_id):
    row = BankTransaction.objects.select_related("bank_account__account").get(pk=bank_transaction_id)
    if not _reviewable_transfer_row(row):
        raise BankTransferConflict("La fila ya no está pendiente de enlazar.")
    if row.currency != "EUR":
        return []

    start = row.booking_date - TRANSFER_CANDIDATE_WINDOW
    end = row.booking_date + TRANSFER_CANDIDATE_WINDOW
    opposite_kind = Category.Kind.INCOME if row.kind == Category.Kind.EXPENSE else Category.Kind.EXPENSE
    amount_filter = {"amount__lte": row.amount} if row.kind == Category.Kind.EXPENSE else {"amount__gte": row.amount}
    bank_rows = (
        BankTransaction.objects.select_related("bank_account__account")
        .filter(
            bank_account__account__active=True,
            booking_date__range=(start, end),
            currency=row.currency,
            kind=opposite_kind,
            **amount_filter,
        )
        .filter(Q(status=BankTransaction.Status.PENDING) | Q(status=BankTransaction.Status.SKIPPED, possible_transfer=True))
        .exclude(pk=row.pk)
        .exclude(bank_account__account_id=row.bank_account.account_id)
        .filter(transaction__isnull=True, fee_transaction__isnull=True)
    )

    candidates = []
    for other in bank_rows:
        outgoing_row, incoming_row = (row, other) if row.kind == Category.Kind.EXPENSE else (other, row)
        fee_amount = Decimal(outgoing_row.amount) - Decimal(incoming_row.amount)
        if fee_amount < 0:
            continue
        outgoing = _transfer_side(
            account=outgoing_row.bank_account.account,
            date=outgoing_row.booking_date,
            description=outgoing_row.description,
            amount=outgoing_row.amount,
            bank_transaction_id=outgoing_row.pk,
            transaction_id=outgoing_row.transaction_id,
        )
        incoming = _transfer_side(
            account=incoming_row.bank_account.account,
            date=incoming_row.booking_date,
            description=incoming_row.description,
            amount=incoming_row.amount,
            bank_transaction_id=incoming_row.pk,
            transaction_id=incoming_row.transaction_id,
        )
        candidates.append(_candidate(
            candidate_type="bank_row",
            candidate_id=other.pk,
            source="bank",
            outgoing=outgoing,
            incoming=incoming,
            fee_amount=fee_amount,
            days_apart=abs((outgoing_row.booking_date - incoming_row.booking_date).days),
        ))

    transfer_kind = Transaction.Kind.TRANSFER_OUT if row.kind == Category.Kind.EXPENSE else Transaction.Kind.TRANSFER_IN
    transfer_legs = (
        Transaction.objects.select_related("account")
        .filter(
            account_id=row.bank_account.account_id,
            kind=transfer_kind,
            transfer_group__isnull=False,
            archived=False,
            date__range=(start, end),
            **({"amount__lte": row.amount} if row.kind == Category.Kind.EXPENSE else {"amount": row.amount}),
        )
        .order_by("-date", "-pk")
    )
    seen_groups = set()
    for leg in transfer_legs:
        if leg.transfer_group in seen_groups:
            continue
        seen_groups.add(leg.transfer_group)
        outgoing_tx, incoming_tx = _transfer_pair(leg.transfer_group)
        matched_leg = outgoing_tx if row.kind == Category.Kind.EXPENSE else incoming_tx
        if BankTransaction.objects.filter(transaction_id=matched_leg.pk).exclude(pk=row.pk).exists():
            continue
        if abs((row.booking_date - matched_leg.date).days) > TRANSFER_CANDIDATE_WINDOW.days:
            continue
        fee_amount = Decimal(row.amount) - Decimal(outgoing_tx.amount) if row.kind == Category.Kind.EXPENSE else Decimal("0.00")
        if fee_amount < 0:
            continue
        candidates.append(_candidate(
            candidate_type="transfer_group",
            candidate_id=leg.transfer_group,
            source="existing_pair",
            outgoing=_transfer_side(
                account=outgoing_tx.account,
                date=outgoing_tx.date,
                description=outgoing_tx.description,
                amount=outgoing_tx.amount,
                transaction_id=outgoing_tx.pk,
            ),
            incoming=_transfer_side(
                account=incoming_tx.account,
                date=incoming_tx.date,
                description=incoming_tx.description,
                amount=incoming_tx.amount,
                transaction_id=incoming_tx.pk,
            ),
            fee_amount=fee_amount,
            days_apart=abs((outgoing_tx.date - incoming_tx.date).days),
        ))
    return sorted(candidates, key=lambda item: (item["fee_amount"] > 0, item["days_apart"], item["fee_amount"], item["candidate_type"], item["candidate_id"]))


def _create_transfer_fee(outgoing_row, amount, transfer_description):
    if amount <= 0:
        return None
    fee = Transaction(
        account_id=outgoing_row.bank_account.account_id,
        kind=Transaction.Kind.EXPENSE,
        amount=amount,
        date=outgoing_row.booking_date,
        description=(f"Comisión del traspaso: {transfer_description}" if transfer_description else "Comisión del traspaso")[:180],
        source=Transaction.Source.ENABLE_BANKING,
    )
    fee.full_clean()
    fee.save()
    return fee


def _link_bank_row(row, movement, *, fee_transaction=None):
    row.transaction = movement
    row.fee_transaction = fee_transaction
    row.status = BankTransaction.Status.IMPORTED
    row.possible_transfer = False
    row.save(update_fields=["transaction", "fee_transaction", "status", "possible_transfer"])


def _link_to_existing_pair(row, group_id, *, confirm_fee):
    outgoing, incoming = _transfer_pair(group_id, lock=True)
    matched = outgoing if row.kind == Category.Kind.EXPENSE else incoming
    if matched.account_id != row.bank_account.account_id:
        raise BankTransferConflict("El par no corresponde a la cuenta de esta fila.")
    if abs((row.booking_date - matched.date).days) > TRANSFER_CANDIDATE_WINDOW.days:
        raise BankTransferConflict("La fecha de la fila cambió y el par salió de la ventana de preview.")
    if row.kind == Category.Kind.INCOME and Decimal(row.amount) != Decimal(incoming.amount):
        raise ValueError("El importe del abono no coincide con el par manual.")
    if row.kind == Category.Kind.EXPENSE and Decimal(row.amount) < Decimal(outgoing.amount):
        raise ValueError("La salida bancaria es menor que la pierna del par manual.")
    if BankTransaction.objects.filter(transaction_id=matched.pk).exclude(pk=row.pk).exists():
        raise BankTransferConflict("La pierna del par ya está enlazada a otra fila bancaria.")
    fee_amount = Decimal(row.amount) - Decimal(outgoing.amount) if row.kind == Category.Kind.EXPENSE else Decimal("0.00")
    if row.transaction_id == matched.pk and row.status == BankTransaction.Status.IMPORTED:
        if row.fee_transaction_id and (not fee_amount or Decimal(row.fee_transaction.amount) != fee_amount):
            raise BankTransferConflict("La comisión enlazada ya no coincide con el preview.")
        if fee_amount and not row.fee_transaction_id:
            raise BankTransferConflict("El preview actual difiere de la comisión ya enlazada.")
        return {"removed": [row.pk], "message": "El traspaso ya estaba enlazado."}
    if row.transaction_id and row.transaction_id != matched.pk:
        raise BankTransferConflict("La fila ya está enlazada a otro movimiento.")
    if fee_amount and not confirm_fee:
        raise ValueError("Confirma que la diferencia de la salida es una comisión bancaria.")
    if row.fee_transaction_id:
        if not fee_amount or Decimal(row.fee_transaction.amount) != fee_amount:
            raise BankTransferConflict("La comisión ya enlazada no coincide con el preview.")
        fee = row.fee_transaction
    else:
        fee = _create_transfer_fee(row, fee_amount, row.description)
    _link_bank_row(row, matched, fee_transaction=fee)
    return {"removed": [row.pk], "message": "Origen bancario enlazado al traspaso existente."}


@transaction.atomic
def confirm_bank_transfer(bank_transaction_id, *, candidate_type, candidate_id, confirm_fee=False):
    origin = BankTransaction.objects.select_for_update().select_related("bank_account__account").get(pk=bank_transaction_id)
    if not _reviewable_transfer_row(origin):
        if origin.status == BankTransaction.Status.IMPORTED and origin.transaction_id and origin.transaction.transfer_group:
            group_id = origin.transaction.transfer_group
            outgoing, incoming = _transfer_pair(group_id, lock=True)
            origin_leg = outgoing if origin.kind == Category.Kind.EXPENSE else incoming
            if origin.transaction_id != origin_leg.pk or origin_leg.account_id != origin.bank_account.account_id:
                raise BankTransferConflict("La fila importada no corresponde a la pierna del par.")
            if candidate_type == "transfer_group" and str(group_id) == str(candidate_id):
                return {"removed": [origin.pk], "message": "El traspaso ya estaba enlazado."}
            if candidate_type == "bank_row":
                other_id = int(candidate_id)
                other = BankTransaction.objects.select_for_update().select_related("bank_account__account", "transaction").filter(pk=other_id).first()
                if not other:
                    raise BankTransferConflict("La contrapartida ya no está disponible.")
                if other.status == BankTransaction.Status.IMPORTED and other.transaction_id:
                    other_leg = outgoing if other.kind == Category.Kind.EXPENSE else incoming
                    if other.transaction_id == other_leg.pk and other_leg.account_id == other.bank_account.account_id:
                        return {"removed": [origin.pk, other.pk], "message": "El traspaso ya estaba enlazado."}
        raise BankTransferConflict("La fila ya no está pendiente de enlazar.")
    if origin.currency != "EUR":
        raise ValueError("Solo se pueden enlazar traspasos en EUR.")

    if candidate_type == "transfer_group":
        try:
            group_id = UUID(str(candidate_id))
        except (TypeError, ValueError, AttributeError) as exc:
            raise ValueError("El par de traspaso seleccionado no es válido.") from exc
        return _link_to_existing_pair(origin, group_id, confirm_fee=confirm_fee)
    if candidate_type != "bank_row":
        raise ValueError("Selecciona un origen bancario o un par existente.")
    try:
        other_id = int(candidate_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("La fila bancaria seleccionada no es válida.") from exc
    if other_id == origin.pk:
        raise ValueError("Selecciona una fila bancaria distinta.")
    locked_rows = list(
        BankTransaction.objects.select_for_update()
        .select_related("bank_account__account", "transaction")
        .filter(pk__in=(origin.pk, other_id))
        .order_by("pk")
    )
    if len(locked_rows) != 2:
        raise BankTransferConflict("La fila candidata ya no está disponible.")
    origin, other = (locked_rows[0], locked_rows[1]) if locked_rows[0].pk == origin.pk else (locked_rows[1], locked_rows[0])

    if origin.transaction_id and other.transaction_id:
        if origin.transaction.transfer_group and origin.transaction.transfer_group == other.transaction.transfer_group:
            outgoing, incoming = _transfer_pair(origin.transaction.transfer_group, lock=True)
            origin_leg = outgoing if origin.kind == Category.Kind.EXPENSE else incoming
            other_leg = outgoing if other.kind == Category.Kind.EXPENSE else incoming
            if origin.transaction_id == origin_leg.pk and origin_leg.account_id == origin.bank_account.account_id and other.transaction_id == other_leg.pk and other_leg.account_id == other.bank_account.account_id:
                return {"removed": [origin.pk, other.pk], "message": "El traspaso ya estaba enlazado."}
        raise BankTransferConflict("Las filas ya están enlazadas a otros movimientos.")
    if origin.transaction_id or other.transaction_id:
        existing = origin if origin.transaction_id else other
        pending = other if origin.transaction_id else origin
        if not existing.transaction.transfer_group:
            raise BankTransferConflict("Una de las filas ya está importada como movimiento individual.")
        _transfer_pair(existing.transaction.transfer_group, lock=True)
        result = _link_to_existing_pair(pending, existing.transaction.transfer_group, confirm_fee=confirm_fee)
        return {
            **result,
            "removed": [origin.pk, other.pk],
            "message": "Las dos filas quedaron enlazadas al par existente.",
        }

    if not _reviewable_transfer_row(origin) or not _reviewable_transfer_row(other):
        raise BankTransferConflict("Una de las filas ya no está pendiente de revisión.")
    if origin.currency != "EUR" or other.currency != "EUR":
        raise ValueError("Solo se pueden enlazar traspasos en EUR.")
    if origin.kind == other.kind or origin.bank_account.account_id == other.bank_account.account_id:
        raise ValueError("Selecciona filas de cuentas distintas con sentidos opuestos.")
    if abs((origin.booking_date - other.booking_date).days) > TRANSFER_CANDIDATE_WINDOW.days:
        raise ValueError("Las fechas quedan fuera de la ventana de candidatos.")
    outgoing_row, incoming_row = (origin, other) if origin.kind == Category.Kind.EXPENSE else (other, origin)
    fee_amount = Decimal(outgoing_row.amount) - Decimal(incoming_row.amount)
    if fee_amount < 0:
        raise ValueError("El abono supera a la salida; no se puede asumir que la diferencia sea una comisión.")
    if fee_amount and not confirm_fee:
        raise ValueError("Confirma que la diferencia de la salida es una comisión bancaria.")

    outgoing, incoming = create_transfer(
        source_account=outgoing_row.bank_account.account,
        target_account=incoming_row.bank_account.account,
        amount=incoming_row.amount,
        tx_date=outgoing_row.booking_date,
        target_tx_date=incoming_row.booking_date,
        description=outgoing_row.description[:180],
        source=Transaction.Source.ENABLE_BANKING,
    )
    fee = _create_transfer_fee(outgoing_row, fee_amount, outgoing_row.description)
    _link_bank_row(outgoing_row, outgoing, fee_transaction=fee)
    _link_bank_row(incoming_row, incoming)
    return {
        "removed": [origin.pk, other.pk],
        "message": "Traspaso bancario enlazado." if not fee_amount else "Traspaso enlazado; comisión registrada como gasto.",
    }


@transaction.atomic
def confirm_bank_transaction(row, category=None, force=False, refund_for=None, *, preserve_existing_refund=True):
    row.refresh_from_db()
    if row.status == BankTransaction.Status.IMPORTED:
        if not row.transaction_id:
            raise ValueError("El movimiento importado no tiene una transacción asociada.")
        movement = row.transaction
        if category and category.pk != movement.category_id:
            raise ValueError("La categoría no coincide con el movimiento ya importado.")
        if refund_for and refund_for.pk != movement.refund_for_id:
            raise BankReviewConflict("El reembolso no coincide con el movimiento ya importado.")
        if refund_for is None and not preserve_existing_refund and movement.refund_for_id:
            raise BankReviewConflict("El reembolso ya está importado con otro gasto vinculado.")
        return movement
    if row.status != BankTransaction.Status.PENDING:
        raise ValueError("El movimiento ya no está pendiente.")
    if (row.possible_duplicate or row.possible_transfer) and not force:
        raise ValueError("El movimiento requiere revisión manual.")
    kind = Transaction.Kind.EXPENSE if row.kind == Category.Kind.EXPENSE else Transaction.Kind.INCOME
    has_allocations = False
    persisted_refund_for = None
    effective_refund_for = refund_for
    if row.transaction_id:
        movement = Transaction.objects.select_for_update().filter(pk=row.transaction_id).first()
        if not movement or not movement.archived or movement.source != Transaction.Source.ENABLE_BANKING:
            raise BankReviewConflict("El movimiento reabierto ya no está disponible para esta fila bancaria.")
        has_allocations = TransactionAllocation.objects.filter(transaction=movement).exists()
        persisted_refund_for = movement.refund_for
        if has_allocations and (
            movement.account_id != row.bank_account.account_id
            or movement.kind != kind
            or movement.amount != row.amount
            or movement.date != row.booking_date
            or movement.description != row.description[:180]
        ):
            raise BankReviewConflict("La fila bancaria cambió; no se pueden conservar las partidas del movimiento reabierto.")
        if has_allocations and category is not None:
            raise BankReviewConflict("Un movimiento repartido debe reconfirmarse sin asignar una categoría única.")
        if persisted_refund_for and has_allocations:
            if refund_for is None and not preserve_existing_refund:
                raise BankReviewConflict("El reembolso repartido debe reconfirmarse con su gasto vinculado.")
            if refund_for is not None and persisted_refund_for.pk != refund_for.pk:
                raise BankReviewConflict("El reembolso repartido debe conservar el gasto vinculado.")
            effective_refund_for = persisted_refund_for
        elif persisted_refund_for and refund_for is None and preserve_existing_refund:
            effective_refund_for = persisted_refund_for
    if effective_refund_for and row.kind != Category.Kind.INCOME:
        raise ValueError("Solo un ingreso puede marcarse como reembolso.")
    category = None if has_allocations else (category or row.category)
    if category and category.kind != row.kind:
        raise ValueError("La categoría no corresponde al tipo de movimiento.")
    if row.transaction_id:
        movement.account = row.bank_account.account
        movement.kind = kind
        movement.amount = row.amount
        movement.date = row.booking_date
        movement.description = row.description[:180]
        movement.category = None if has_allocations else category
        movement.refund_for = effective_refund_for
        movement.fingerprint = row.fingerprint
        movement.archived = False
    else:
        movement = Transaction(
            account=row.bank_account.account,
            kind=kind,
            amount=row.amount,
            date=row.booking_date,
            description=row.description[:180],
            category=category,
            refund_for=effective_refund_for,
            source=Transaction.Source.ENABLE_BANKING,
            fingerprint=row.fingerprint,
        )
    try:
        movement.full_clean()
    except ValidationError as exc:
        raise ValueError("; ".join(exc.messages)) from exc
    movement.save()
    match_recurring_occurrence(movement)
    row.transaction = movement
    row.category = category
    row.status = BankTransaction.Status.IMPORTED
    row.save(update_fields=["transaction", "category", "status"])
    return movement
