"""Normalize provider data and stage it into local bank review rows."""

import hashlib
import json
import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import NamedTuple

from django.db import transaction
from django.utils.dateparse import parse_date, parse_datetime

from .models import Account, BankAccount, BankConnection, BankTransaction, Category, Transaction


def normalize_description(value):
    return re.sub(r"\s+", " ", str(value or "").strip())[:240]


def remote_description(item):
    creditor = item.get("creditor") or {}
    debtor = item.get("debtor") or {}
    pieces = [
        creditor.get("name"),
        debtor.get("name"),
        *(item.get("remittance_information") or []),
        item.get("note"),
    ]
    return normalize_description(" · ".join(str(piece) for piece in pieces if piece) or "Movimiento bancario")


def transaction_amount(item):
    raw = item.get("transaction_amount") or item.get("amount") or {}
    amount = abs(Decimal(str(raw.get("amount", "0"))))
    if item.get("credit_debit_indicator") == "DBIT":
        amount = -amount
    return amount, raw.get("currency", "EUR")


def create_connection(session_data, bank_name, bank_country):
    valid_until = session_data.get("access", {}).get("valid_until")
    connection = BankConnection.objects.create(
        bank_name=bank_name,
        bank_country=bank_country,
        session_id=session_data["session_id"],
        authorized_until=parse_datetime(valid_until) if valid_until else None,
    )
    for remote in session_data.get("accounts", []):
        if remote.get("currency", "EUR") != "EUR":
            continue
        display = remote.get("name") or remote.get("details") or f"{bank_name} {remote.get('uid', '')[-4:]}"
        candidates = Account.objects.filter(active=True, bank_link__isnull=True, name__icontains=bank_name)
        local = candidates.first() if candidates.count() == 1 else Account.objects.create(name=unique_account_name(display))
        BankAccount.objects.create(
            connection=connection,
            account=local,
            remote_uid=remote["uid"],
            display_name=display,
            currency=remote.get("currency", "EUR"),
        )
    return connection


def unique_account_name(name):
    name = normalize_description(name)[:80] or "Cuenta bancaria"
    candidate = name
    number = 2
    while Account.objects.filter(name=candidate).exists():
        candidate = f"{name[:74]} {number}"
        number += 1
    return candidate


class ProviderBalance(NamedTuple):
    amount: Decimal
    balance_type: str
    currency: str
    reference_date: date | None


def select_balance(balances, *, currency):
    preference = ("CLBD", "ITBD", "CLAV", "ITAV")
    expected_currency = str(currency or "").strip().upper()
    if not expected_currency:
        return None
    for balance_type in preference:
        for item in balances:
            if item.get("balance_type") != balance_type:
                continue
            amount_data = item.get("balance_amount") or {}
            if not isinstance(amount_data, dict):
                continue
            reported_currency = str(amount_data.get("currency") or "").strip().upper()
            if reported_currency != expected_currency:
                continue
            try:
                amount = Decimal(str(amount_data["amount"]))
            except (KeyError, InvalidOperation, TypeError):
                continue
            if not amount.is_finite():
                continue
            raw_reference_date = item.get("reference_date")
            try:
                reference_date = parse_date(raw_reference_date) if isinstance(raw_reference_date, str) else None
            except ValueError:
                reference_date = None
            return ProviderBalance(amount, balance_type, reported_currency, reference_date)
    return None


def possible_transfer(bank_account, booking_date, amount, kind):
    opposite = Category.Kind.INCOME if kind == Category.Kind.EXPENSE else Category.Kind.EXPENSE
    return BankTransaction.objects.filter(
        booking_date__range=(booking_date - timedelta(days=2), booking_date + timedelta(days=2)),
        amount=amount,
        kind=opposite,
    ).exclude(bank_account=bank_account).exists()


def _prepare_remote_transaction(bank_account, item):
    if item.get("status") != "BOOK":
        return None
    signed, currency = transaction_amount(item)
    if not signed or currency != "EUR":
        return None
    kind = Category.Kind.EXPENSE if signed < 0 else Category.Kind.INCOME
    amount = abs(signed)
    booking_date = date.fromisoformat(item.get("booking_date") or item.get("transaction_date"))
    description = remote_description(item)
    transaction_kind = Transaction.Kind.EXPENSE if kind == Category.Kind.EXPENSE else Transaction.Kind.INCOME
    fingerprint = Transaction.make_fingerprint(bank_account.account_id, booking_date, description[:180], amount, transaction_kind)
    legacy_material = f"{bank_account.remote_uid}|{booking_date}|{description.lower()}|{amount:.2f}|{kind}"
    legacy_hash = hashlib.sha256(legacy_material.encode()).hexdigest()
    legacy_remote_ids = []
    if item.get("transaction_id"):
        legacy_remote_ids.append(str(item["transaction_id"]))
    if legacy_hash not in legacy_remote_ids:
        legacy_remote_ids.append(legacy_hash)

    stable_details = {
        key: item[key]
        for key in (
            "balance_after_transaction",
            "reference_number",
            "reference_number_schema",
            "value_date",
            "transaction_date",
        )
        if item.get(key) not in (None, "", {}, [])
    }
    identity_material = (
        f"{legacy_material}|{json.dumps(stable_details, sort_keys=True, separators=(',', ':'))}"
        if stable_details
        else legacy_material
    )
    fallback_group = f"fallback:{hashlib.sha256(identity_material.encode()).hexdigest()}"

    entry_reference = str(item.get("entry_reference") or "").strip()
    if entry_reference:
        remote_id = f"entry:{hashlib.sha256(entry_reference.encode()).hexdigest()}"
        has_entry_reference = True
        for legacy_id in (legacy_hash, fallback_group):
            if legacy_id not in legacy_remote_ids:
                legacy_remote_ids.append(legacy_id)
    else:
        remote_id = fallback_group
        has_entry_reference = False

    return {
        "remote_id": remote_id,
        "_legacy_remote_ids": legacy_remote_ids,
        "_fallback_group": None if has_entry_reference else fallback_group,
        "_has_entry_reference": has_entry_reference,
        "booking_date": booking_date,
        "description": description,
        "amount": amount,
        "kind": kind,
        "currency": currency,
        "fingerprint": fingerprint,
        "raw_summary": {"bank_code": item.get("bank_transaction_code", {}), "status": item.get("status")},
    }


@transaction.atomic
def stage_remote_transactions(bank_account, items, *, chunk_size=500, fallback_occurrences=None):
    """Normalize and stage one provider page without collapsing equal-looking entries."""
    fallback_occurrences = fallback_occurrences if fallback_occurrences is not None else {}
    prepared = []
    seen_entry_references = set()
    for item in items:
        values = _prepare_remote_transaction(bank_account, item)
        if values is None:
            continue
        legacy_remote_ids = values.pop("_legacy_remote_ids")
        fallback_group = values.pop("_fallback_group")
        has_entry_reference = values.pop("_has_entry_reference")
        if fallback_group:
            # ponytail: without a provider ID, a sync-scoped ordinal preserves count and repeatability.
            occurrence = fallback_occurrences.get(fallback_group, 0) + 1
            fallback_occurrences[fallback_group] = occurrence
            if occurrence > 1:
                values["remote_id"] = f"{fallback_group}:{occurrence}"
                legacy_remote_ids = []
        elif values["remote_id"] in seen_entry_references:
            continue
        else:
            seen_entry_references.add(values["remote_id"])
        prepared.append({
            "values": values,
            "legacy_remote_ids": legacy_remote_ids,
            "has_entry_reference": has_entry_reference,
        })

    if not prepared:
        return []

    remote_ids = {row["values"]["remote_id"] for row in prepared}
    legacy_ids = {legacy_id for row in prepared for legacy_id in row["legacy_remote_ids"]}
    lookup_ids = sorted(remote_ids | legacy_ids)
    existing_by_remote_id = {}
    for offset in range(0, len(lookup_ids), chunk_size):
        rows = BankTransaction.objects.filter(
            bank_account=bank_account,
            remote_id__in=lookup_ids[offset : offset + chunk_size],
        )
        existing_by_remote_id.update({row.remote_id: row for row in rows})

    matches = {}
    claimed_ids = set()
    for index, entry in enumerate(prepared):
        row = existing_by_remote_id.get(entry["values"]["remote_id"])
        if row and row.pk not in claimed_ids:
            matches[index] = row
            claimed_ids.add(row.pk)

    for index, entry in enumerate(prepared):
        if index in matches:
            continue
        for legacy_id in entry["legacy_remote_ids"]:
            row = existing_by_remote_id.get(legacy_id)
            if row and row.pk not in claimed_ids:
                matches[index] = row
                claimed_ids.add(row.pk)
                break

    unmatched = [index for index in range(len(prepared)) if index not in matches]
    fingerprints = sorted({prepared[index]["values"]["fingerprint"] for index in unmatched})
    fingerprint_candidates = {}
    for offset in range(0, len(fingerprints), chunk_size):
        rows = BankTransaction.objects.filter(
            bank_account=bank_account,
            fingerprint__in=fingerprints[offset : offset + chunk_size],
        ).order_by("pk")
        for row in rows:
            fingerprint_candidates.setdefault(row.fingerprint, []).append(row)

    for index in unmatched:
        entry = prepared[index]
        candidates = fingerprint_candidates.get(entry["values"]["fingerprint"], [])
        row = next(
            (
                candidate
                for candidate in candidates
                if candidate.pk not in claimed_ids
                and (
                    not candidate.remote_id.startswith(("entry:", "fallback:"))
                    or entry["has_entry_reference"] and candidate.remote_id.startswith("fallback:")
                    or not entry["has_entry_reference"] and candidate.remote_id.startswith("entry:")
                )
            ),
            None,
        )
        if row:
            matches[index] = row
            claimed_ids.add(row.pk)

    upgraded = []
    for index, row in matches.items():
        remote_id = prepared[index]["values"]["remote_id"]
        if row.remote_id != remote_id:
            row.remote_id = remote_id
            upgraded.append(row)
    if upgraded:
        BankTransaction.objects.bulk_update(upgraded, ["remote_id"], batch_size=chunk_size)

    fingerprints = list({row["values"]["fingerprint"] for row in prepared})
    duplicate_fingerprints = set()
    for offset in range(0, len(fingerprints), chunk_size):
        duplicate_fingerprints.update(
            Transaction.objects.filter(
                archived=False,
                fingerprint__in=fingerprints[offset : offset + chunk_size],
            ).values_list("fingerprint", flat=True)
        )

    dates = [row["values"]["booking_date"] for row in prepared]
    amounts = list({row["values"]["amount"] for row in prepared})
    transfer_candidates = BankTransaction.objects.filter(
        booking_date__range=(min(dates) - timedelta(days=2), max(dates) + timedelta(days=2)),
        amount__in=amounts,
    ).exclude(bank_account=bank_account).values_list("booking_date", "amount", "kind")
    transfer_keys = {(booking_date, amount, kind) for booking_date, amount, kind in transfer_candidates}

    staged_rows = [None] * len(prepared)
    new_rows = []
    new_indexes = []
    for index, entry in enumerate(prepared):
        if index in matches:
            staged_rows[index] = matches[index]
            continue
        values = entry["values"]
        kind = values["kind"]
        opposite = Category.Kind.INCOME if kind == Category.Kind.EXPENSE else Category.Kind.EXPENSE
        possible_transfer_match = any(
            (values["booking_date"] + timedelta(days=delta), values["amount"], opposite) in transfer_keys
            for delta in (-2, -1, 0, 1, 2)
        )
        new_rows.append(
            BankTransaction(
                bank_account=bank_account,
                **values,
                possible_duplicate=values["fingerprint"] in duplicate_fingerprints,
                possible_transfer=possible_transfer_match,
            )
        )
        new_indexes.append(index)
    if new_rows:
        created = BankTransaction.objects.bulk_create(new_rows, batch_size=chunk_size)
        for index, row in zip(new_indexes, created):
            staged_rows[index] = row
    return staged_rows


def stage_remote_transaction(bank_account, item):
    """Compatibility wrapper for callers that stage one provider item."""
    return next(iter(stage_remote_transactions(bank_account, [item])), None)
