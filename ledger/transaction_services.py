"""Transaction lifecycle operations shared by API and fixtures."""

import uuid

from django.db import transaction

from .calculations.ledger import is_valid_transfer_pair
from .models import BankTransaction, ImportBatch, ImportRow, RecurringOccurrence, Transaction
from .savings_objectives import restore_annual_reserve


@transaction.atomic
def _reopen_transfer(movement, *, fee_origin=None):
    group_id = movement.transfer_group
    if not group_id and fee_origin and fee_origin.transaction_id:
        group_id = fee_origin.transaction.transfer_group
    if not group_id:
        raise ValueError("El movimiento no pertenece a un traspaso bancario enlazado.")

    initial_leg_ids = list(Transaction.objects.filter(transfer_group=group_id).order_by("pk").values_list("pk", flat=True))
    if len(initial_leg_ids) != 2:
        raise ValueError("El par de traspaso ya no es válido.")
    origins = list(
        BankTransaction.objects.select_for_update()
        .filter(transaction_id__in=initial_leg_ids)
        .order_by("pk")
    )
    if not origins:
        raise ValueError("El traspaso no tiene filas bancarias enlazadas para reabrir.")
    if fee_origin and fee_origin.pk not in {row.pk for row in origins}:
        raise ValueError("La comisión ya no pertenece al origen bancario de este traspaso.")

    legs = list(Transaction.objects.select_for_update().filter(transfer_group=group_id).order_by("pk"))
    outgoing = next((leg for leg in legs if leg.kind == Transaction.Kind.TRANSFER_OUT), None)
    incoming = next((leg for leg in legs if leg.kind == Transaction.Kind.TRANSFER_IN), None)
    leg_ids = [leg.pk for leg in legs]
    if len(legs) != 2 or set(leg_ids) != set(initial_leg_ids) or not outgoing or not incoming or not is_valid_transfer_pair(outgoing, incoming):
        raise ValueError("El par de traspaso ya no es válido.")
    if any(leg.archived for leg in legs):
        raise ValueError("No se puede reabrir un traspaso archivado.")
    if len({leg.source for leg in legs}) != 1:
        raise ValueError("El par de traspaso tiene orígenes incompatibles.")
    current_origin_ids = set(
        BankTransaction.objects.filter(transaction_id__in=leg_ids).values_list("pk", flat=True)
    )
    if current_origin_ids != {row.pk for row in origins}:
        raise ValueError("El origen bancario cambió durante la reapertura.")

    fee_ids = sorted({row.fee_transaction_id for row in origins if row.fee_transaction_id})
    fees = list(Transaction.objects.select_for_update().filter(pk__in=fee_ids).order_by("pk"))
    if len(fees) != len(fee_ids):
        raise ValueError("La comisión enlazada ya no está disponible.")
    if fee_ids and Transaction.objects.filter(refund_for_id__in=fee_ids).exists():
        raise ValueError("No se puede reabrir la comisión mientras conserve reembolsos asociados.")

    for row in origins:
        row.transaction = None
        row.fee_transaction = None
        row.status = BankTransaction.Status.PENDING
        row.possible_transfer = False
        row.save(update_fields=["transaction", "fee_transaction", "status", "possible_transfer"])

    removed = list(fee_ids)
    if fee_ids:
        Transaction.objects.filter(pk__in=fee_ids).delete()
    if all(leg.source == Transaction.Source.ENABLE_BANKING for leg in legs):
        Transaction.objects.filter(pk__in=leg_ids).delete()
        removed.extend(leg_ids)

    return {"source": "bank", "target": origins[0].pk, "removed": sorted(removed)}


def _restore_recurring_reserve_for_transaction(movement):
    if not movement.recurring_occurrence_id:
        return
    occurrence = RecurringOccurrence.objects.select_for_update().get(pk=movement.recurring_occurrence_id)
    restore_annual_reserve(occurrence)
    movement.recurring_occurrence = None

@transaction.atomic
def reopen_imported_transaction(movement):
    if movement.transfer_group:
        return _reopen_transfer(movement)
    fee_origin = (
        BankTransaction.objects.select_related("transaction")
        .filter(fee_transaction=movement)
        .first()
    )
    if fee_origin and fee_origin.transaction_id and fee_origin.transaction.transfer_group:
        return _reopen_transfer(movement, fee_origin=fee_origin)
    if movement.source == Transaction.Source.CSV:
        row = ImportRow.objects.select_for_update().select_related("batch").get(transaction_id=movement.pk)
        movement = Transaction.objects.select_for_update().filter(pk=movement.pk).first()
        if not movement:
            raise ValueError("El movimiento cambió antes de reabrirse.")
        if movement.kind == Transaction.Kind.EXPENSE and movement.refunds.exists():
            raise ValueError(
                "No se puede reabrir un gasto importado mientras conserve reembolsos asociados, incluso archivados."
            )
        _restore_recurring_reserve_for_transaction(movement)
        movement.archived = True
        movement.save(update_fields=["archived", "recurring_occurrence", "updated_at"])
        row.status = ImportRow.Status.PENDING
        row.category = movement.category
        row.save(update_fields=["status", "category"])
        row.batch.status = ImportBatch.Status.REVIEW
        row.batch.save(update_fields=["status"])
        return {"source": "csv", "target": row.batch_id, "removed": [movement.pk]}
    if movement.source == Transaction.Source.ENABLE_BANKING:
        row = BankTransaction.objects.select_for_update().get(transaction_id=movement.pk)
        movement = Transaction.objects.select_for_update().filter(pk=movement.pk).first()
        if not movement:
            raise ValueError("El movimiento cambió antes de reabrirse.")
        if movement.kind == Transaction.Kind.EXPENSE and movement.refunds.exists():
            raise ValueError(
                "No se puede reabrir un gasto importado mientras conserve reembolsos asociados, incluso archivados."
            )
        _restore_recurring_reserve_for_transaction(movement)
        movement.archived = True
        movement.save(update_fields=["archived", "recurring_occurrence", "updated_at"])
        row.status = BankTransaction.Status.PENDING
        row.category = movement.category
        row.save(update_fields=["category", "status"])
        return {"source": "bank", "target": row.pk, "removed": [movement.pk]}
    raise ValueError("Solo se pueden reabrir movimientos importados desde banco o CSV.")


@transaction.atomic
def create_transfer(*, source_account, target_account, amount, tx_date, description, notes="", target_tx_date=None, source=Transaction.Source.MANUAL):
    if source_account.pk == target_account.pk:
        raise ValueError("Las cuentas de origen y destino deben ser diferentes.")
    if amount <= 0:
        raise ValueError("El importe debe ser positivo.")
    group = uuid.uuid4()
    common = {"amount": amount, "description": description, "notes": notes, "transfer_group": group, "source": source}
    outgoing = Transaction.objects.create(account=source_account, kind=Transaction.Kind.TRANSFER_OUT, date=tx_date, **common)
    incoming = Transaction.objects.create(account=target_account, kind=Transaction.Kind.TRANSFER_IN, date=target_tx_date or tx_date, **common)
    if not is_valid_transfer_pair(outgoing, incoming):
        raise RuntimeError("No se pudo crear un traspaso interno simétrico.")
    return outgoing, incoming


@transaction.atomic
def archive_transaction(movement):
    group_id = movement.transfer_group
    fee_origin_id = None
    if not group_id:
        origin = BankTransaction.objects.select_related("transaction").filter(fee_transaction=movement).first()
        if origin and origin.transaction_id and origin.transaction.transfer_group:
            group_id = origin.transaction.transfer_group
            fee_origin_id = origin.pk
    if group_id:
        initial_leg_ids = list(Transaction.objects.filter(transfer_group=group_id).values_list("pk", flat=True))
        bank_rows = list(
            BankTransaction.objects.select_for_update()
            .filter(transaction_id__in=initial_leg_ids)
            .order_by("pk")
        )
        if fee_origin_id and fee_origin_id not in {row.pk for row in bank_rows}:
            raise ValueError("La comisión ya no pertenece al origen bancario del traspaso.")
        legs = list(Transaction.objects.select_for_update().filter(transfer_group=group_id).order_by("pk"))
        leg_ids = [leg.pk for leg in legs]
        if not leg_ids or set(leg_ids) != set(initial_leg_ids):
            raise ValueError("El traspaso cambió antes de archivarse.")
        if set(BankTransaction.objects.filter(transaction_id__in=leg_ids).values_list("pk", flat=True)) != {
            row.pk for row in bank_rows
        }:
            raise ValueError("El origen bancario cambió antes de archivarse.")
        fee_ids = sorted({row.fee_transaction_id for row in bank_rows if row.fee_transaction_id})
        fees = list(Transaction.objects.select_for_update().filter(pk__in=fee_ids).order_by("pk"))
        if len(fees) != len(fee_ids):
            raise ValueError("La comisión enlazada ya no está disponible.")
        if Transaction.objects.filter(refund_for_id__in=fee_ids, archived=False).exists():
            raise ValueError("Archiva primero los reembolsos asociados a la comisión.")
        Transaction.objects.filter(pk__in=leg_ids + fee_ids).update(archived=True)
    else:
        movement = Transaction.objects.select_for_update().filter(pk=movement.pk, archived=False).first()
        if not movement:
            raise ValueError("El movimiento ya no está disponible para archivar.")
        if movement.kind == Transaction.Kind.EXPENSE and movement.refunds.filter(archived=False).exists():
            raise ValueError("Archiva primero los reembolsos asociados a este gasto.")
        _restore_recurring_reserve_for_transaction(movement)
        movement.archived = True
        movement.save(update_fields=["archived", "recurring_occurrence", "updated_at"])
    return leg_ids + fee_ids if group_id else [movement.pk]
