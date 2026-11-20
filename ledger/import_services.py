"""CSV import parsing, categorization, and confirmation services."""

import csv
import io
from datetime import datetime
from decimal import Decimal

from django.db import transaction

from .models import Category, ImportBatch, ImportRow, Transaction, TransactionAllocation
from .recurring_services import match_recurring_occurrence


@transaction.atomic
def parse_csv_upload(upload, account, profile):
    text = upload.read().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text), delimiter=profile.delimiter)
    batch = ImportBatch.objects.create(filename=upload.name, account=account, profile=profile)
    for row_number, row in enumerate(reader, start=2):
        raw_amount = row[profile.amount_column].strip().replace("€", "").replace(" ", "")
        if "," in raw_amount and "." not in raw_amount:
            raw_amount = raw_amount.replace(",", ".")
        amount = Decimal(raw_amount)
        kind = Category.Kind.EXPENSE if amount < 0 else Category.Kind.INCOME
        amount = abs(amount)
        tx_date = datetime.strptime(row[profile.date_column].strip(), profile.date_format).date()
        description = row[profile.description_column].strip()[:180]
        category_name = row.get(profile.category_column, "").strip() if profile.category_column else ""
        subcategory_name = row.get(profile.subcategory_column, "").strip() if profile.subcategory_column else ""
        category = get_or_create_import_category(kind, category_name, subcategory_name)
        tx_kind = Transaction.Kind.EXPENSE if kind == Category.Kind.EXPENSE else Transaction.Kind.INCOME
        fingerprint = Transaction.make_fingerprint(account.pk, tx_date, description, amount, tx_kind)
        ImportRow.objects.create(
            batch=batch,
            row_number=row_number,
            date=tx_date,
            description=description,
            amount=amount,
            kind=kind,
            category=category,
            fingerprint=fingerprint,
            possible_duplicate=Transaction.objects.filter(fingerprint=fingerprint, archived=False).exists(),
        )
    return batch


def normalized_category_name(value):
    return " ".join(str(value or "").split())[:80]


def get_or_create_category(name, kind, parent=None):
    name = normalized_category_name(name)
    if not name:
        return None
    existing = Category.objects.filter(name__iexact=name, kind=kind, parent=parent).first()
    if existing:
        return existing
    color = parent.color if parent else "#8E8E93"
    return Category.objects.create(name=name, kind=kind, parent=parent, color=color)


def get_or_create_import_category(kind, category_name, subcategory_name=""):
    parent = get_or_create_category(category_name, kind)
    if not parent:
        return None
    return get_or_create_category(subcategory_name, kind, parent) or parent


@transaction.atomic
def confirm_import_row(row):
    if row.status != ImportRow.Status.PENDING:
        return row.transaction
    if row.possible_duplicate:
        raise ValueError("La fila está marcada como posible duplicado.")
    kind = Transaction.Kind.EXPENSE if row.kind == Category.Kind.EXPENSE else Transaction.Kind.INCOME
    has_allocations = False
    if row.transaction_id:
        movement = Transaction.objects.select_for_update().filter(pk=row.transaction_id).first()
        if not movement or not movement.archived or movement.source != Transaction.Source.CSV:
            raise ValueError("El movimiento reabierto ya no está disponible para esta fila CSV.")
        has_allocations = TransactionAllocation.objects.filter(transaction=movement).exists()
        if has_allocations and (
            movement.account_id != row.batch.account_id
            or movement.kind != kind
            or movement.amount != row.amount
            or movement.date != row.date
            or movement.description != row.description
        ):
            raise ValueError("La fila CSV cambió; no se pueden conservar las partidas del movimiento reabierto.")
    if row.category_id and not has_allocations and row.category.kind != row.kind:
        raise ValueError("La categoría seleccionada no corresponde al tipo de movimiento.")
    if row.transaction_id:
        movement.account = row.batch.account
        movement.kind = kind
        movement.amount = row.amount
        movement.date = row.date
        movement.description = row.description
        movement.category = None if has_allocations else row.category
        movement.fingerprint = row.fingerprint
        movement.archived = False
        movement.full_clean()
        movement.save()
    else:
        movement = Transaction.objects.create(
            account=row.batch.account,
            kind=kind,
            amount=row.amount,
            date=row.date,
            description=row.description,
            category=row.category,
            source=Transaction.Source.CSV,
            fingerprint=row.fingerprint,
        )
    match_recurring_occurrence(movement)
    row.transaction = movement
    row.status = ImportRow.Status.IMPORTED
    if has_allocations:
        row.category = None
    row.save(update_fields=["transaction", "status"] + (["category"] if has_allocations else []))
    return movement
