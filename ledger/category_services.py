"""Category-rule matching, preview, and application services."""

from decimal import Decimal

from django.db import IntegrityError, transaction

from .models import BankTransaction, Category, CategoryRule, CategoryRuleApplication, ImportRow, Transaction, normalize_match_text


def remember_category_rule(description, kind, category):
    if not description or not category:
        return None
    rule, _ = CategoryRule.objects.update_or_create(
        normalized_description=normalize_match_text(description),
        kind=kind,
        defaults={"description": description[:180], "category": category, "active": True},
    )
    return rule


def is_reopened_split_origin(row):
    transaction_id = getattr(row, "transaction_id", None)
    if not transaction_id:
        return False
    movement = getattr(row, "_state", None)
    movement = movement.fields_cache.get("transaction") if movement else None
    if movement is not None:
        if not movement.archived:
            return False
        allocations = movement._prefetched_objects_cache.get("allocations")
        return bool(allocations) if allocations is not None else movement.allocations.exists()
    return Transaction.objects.filter(
        pk=transaction_id,
        archived=True,
        allocations__isnull=False,
    ).exists()


def exclude_reopened_split_origins(queryset):
    reopened_split_ids = Transaction.objects.filter(
        archived=True,
        allocations__isnull=False,
    ).values("pk")
    return queryset.exclude(transaction_id__in=reopened_split_ids)


def apply_category_rule_historically(rule):
    affected = []
    with transaction.atomic():
        result = preview_category_rule(rule, lock_rows=True)
        for movement in result["transaction_objects"]:
            affected.append({"type": "transaction", "id": movement.pk, "previous_category": movement.category_id, "new_category": rule.category_id})
            movement.category_id = rule.category_id
            movement.save(update_fields=["category", "updated_at"])
        for row in result["bank_objects"]:
            affected.append({"type": "bank", "id": row.pk, "previous_category": row.category_id, "new_category": rule.category_id})
            row.category_id = rule.category_id
            row.save(update_fields=["category"])
        for row in result["csv_objects"]:
            affected.append({"type": "csv", "id": row.pk, "previous_category": row.category_id, "new_category": rule.category_id})
            row.category_id = rule.category_id
            row.save(update_fields=["category"])
        application = CategoryRuleApplication.objects.create(rule=rule, filters_used={"match_mode": rule.match_mode, "description": rule.description}, affected_records=affected, previous_values=affected, new_values=affected)
        rule.application_count += 1
        rule.save(update_fields=["application_count", "updated_at"])
    return {"transactions": result["transactions"], "bank_rows": result["bank_rows"], "csv_rows": result["csv_rows"], "total": result["total"], "application_id": application.pk}


def restore_category_rule_record(item):
    if not isinstance(item, dict) or not {"type", "id", "previous_category", "new_category"}.issubset(item):
        return False
    models_by_type = {
        "transaction": Transaction,
        "bank": BankTransaction,
        "csv": ImportRow,
    }
    model = models_by_type.get(item["type"])
    if model is None:
        return False

    record_query = model.objects.select_for_update().filter(
        pk=item["id"],
        category_id=item["new_category"],
    )
    if item["type"] == "bank":
        record_query = record_query.filter(
            status=BankTransaction.Status.PENDING,
            transaction__isnull=True,
            fee_transaction__isnull=True,
        )
    elif item["type"] == "csv":
        record_query = record_query.filter(
            status=ImportRow.Status.PENDING,
            transaction__isnull=True,
        )
    record = record_query.first()
    if record is None:
        return False

    previous_category_id = item["previous_category"]
    if previous_category_id is not None:
        previous_category = Category.objects.select_for_update().filter(
            pk=previous_category_id,
            kind=record.kind,
            merged_into__isnull=True,
        ).first()
        if previous_category is None:
            return False

    update_fields = ["category"]
    if isinstance(record, Transaction):
        update_fields.append("updated_at")
    try:
        # Keep FK failures inside a savepoint so one unavailable old category
        # marks the audit partial without rolling back other restored records.
        with transaction.atomic():
            record.category_id = previous_category_id
            record.save(update_fields=update_fields)
    except IntegrityError:
        return False
    return True


def _rule_matches(rule, description, amount, kind, account_id=None):
    if kind != rule.kind or (rule.account_id and rule.account_id != account_id):
        return False
    value = normalize_match_text(description)
    needle = rule.normalized_description
    mode = rule.match_mode
    if mode == CategoryRule.MatchMode.CONTAINS and needle not in value:
        return False
    if mode == CategoryRule.MatchMode.STARTS_WITH and not value.startswith(needle):
        return False
    if mode == CategoryRule.MatchMode.ENDS_WITH and not value.endswith(needle):
        return False
    if mode == CategoryRule.MatchMode.EXACT and value != needle:
        return False
    amount = Decimal(str(amount))
    return not ((rule.amount_min is not None and amount < rule.amount_min) or (rule.amount_max is not None and amount > rule.amount_max))


def iter_matching_category_rules(description, amount, kind, account_id=None, *, rules=None):
    candidates = rules if rules is not None else CategoryRule.objects.filter(active=True).select_related("category", "account").order_by("priority", "description", "pk")
    for rule in candidates:
        if rule.active and _rule_matches(rule, description, amount, kind, account_id):
            yield rule


def preview_category_rule(rule, *, lock_rows=False):
    transactions = Transaction.objects.filter(
        archived=False,
        transfer_group__isnull=True,
        kind=rule.kind,
        allocations__isnull=True,
    ).select_related("account")
    banks = exclude_reopened_split_origins(
        BankTransaction.objects.filter(status=BankTransaction.Status.PENDING, kind=rule.kind)
        .select_related("bank_account__account")
    )
    csvs = exclude_reopened_split_origins(
        ImportRow.objects.filter(status=ImportRow.Status.PENDING, kind=rule.kind)
        .select_related("batch__account")
    )
    if lock_rows:
        transactions = transactions.select_for_update(of=("self",))
        banks = banks.select_for_update(of=("self",))
        csvs = csvs.select_for_update(of=("self",))
    txs = [
        item
        for item in transactions
        if _rule_matches(rule, item.description, item.amount, item.kind, item.account_id)
    ]
    banks = [item for item in banks if _rule_matches(rule, item.description, item.amount, item.kind, item.bank_account.account_id)]
    csvs = [item for item in csvs if _rule_matches(rule, item.description, item.amount, item.kind, item.batch.account_id)]
    all_items = txs + banks + csvs
    changes = sum(1 for item in all_items if item.category_id != rule.category_id)
    return {"transactions": len(txs), "bank_rows": len(banks), "csv_rows": len(csvs), "total": len(all_items), "changes": changes, "already_categorized": len(all_items) - changes, "transaction_objects": txs, "bank_objects": banks, "csv_objects": csvs, "examples": [{"description": item.description, "amount": str(item.amount)} for item in all_items[:10]]}
