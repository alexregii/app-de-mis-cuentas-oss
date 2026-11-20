import re
from datetime import date
from decimal import Decimal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from django.db.models import Count, Max
from django.urls import reverse
from django.utils import timezone

from .banking import reconcile_connection_sync_state
from .categorization_policy import AUTO_APPLY_PROMOTION_STATUS, auto_apply_effective
from .models import Category, CategoryRule, CategoryRuleApplication, ImportRow, RecurringRule, Transaction
from .services import account_balance
from .savings_objectives import annual_reserve_details


def api_money(value):
    return float(value or Decimal("0"))


def api_date(value):
    return value.isoformat() if value else ""


def api_datetime(value):
    return timezone.localtime(value).isoformat() if value else ""


_SAFE_BANK_ERROR_MESSAGES = {
    "El banco ha alcanzado su límite de consultas. Se reintentará mañana.",
    "No se pudo sincronizar con el banco. Inténtalo de nuevo.",
    "La sincronización tardó demasiado y se ha detenido. Vuelve a intentarlo.",
    "La sincronización ha fallado.",
}


def api_bank_error(message):
    if not message:
        return ""
    if message in _SAFE_BANK_ERROR_MESSAGES or re.fullmatch(
        r"No se pudo sincronizar con el banco \(HTTP (?:[1-5]\d{2}|desconocido)\)\.", message
    ):
        return message
    return "No se pudo sincronizar con el banco. Inténtalo de nuevo."


def api_attention_signal(signal):
    detail = signal["detail"]
    serialized_detail = {key: api_money(value) if isinstance(value, Decimal) else value for key, value in detail.items()}
    return {
        "title": signal["title"],
        "label": signal["label"],
        "value": api_money(signal["value"]) if signal["value_kind"] == "money" else signal["value"],
        "value_kind": signal["value_kind"],
        "detail": serialized_detail,
        "url": signal["url"],
        "severity": api_money(signal["severity"]),
        "filters": signal["filters"],
    }


def api_errors(form):
    return {field: [str(error) for error in errors] for field, errors in form.errors.items()}


def merge_query_params(url, **params):
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    for key, value in params.items():
        if value is None:
            continue
        query[key] = value
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query, doseq=True), parts.fragment))


def api_category(category, *, category_cache=None):
    if not category:
        return None
    cached = category_cache.get(category.pk) if category_cache else None
    category = cached or category
    if not all(hasattr(category, field) for field in ("transaction_count", "child_count", "last_used_at", "allocation_last_used_at")):
        category = category_catalog_queryset().filter(pk=category.pk).first() or category
    transaction_count = getattr(category, "transaction_count", None)
    child_count = getattr(category, "child_count", None)
    last_used_at = max(
        (value for value in (getattr(category, "last_used_at", None), getattr(category, "allocation_last_used_at", None)) if value),
        default=None,
    )
    return {
        "id": category.pk,
        "name": category.name,
        "display_name": category.display_name,
        "kind": category.kind,
        "color": category.color,
        "icon": category.icon,
        "active": category.active,
        "parent_id": category.parent_id,
        "exclude_from_analytics": category.exclude_from_analytics,
        "sort_order": category.sort_order,
        "is_favorite": category.is_favorite,
        "merged_into": category.merged_into_id,
        "deactivated_at": api_datetime(category.deactivated_at),
        "transaction_count": transaction_count if transaction_count is not None else category.transactions.count() + category.transaction_allocations.count(),
        "child_count": child_count if child_count is not None else category.children.count(),
        "last_used_at": api_date(last_used_at),
    }


def api_account(account, balance=None):
    payload = {
        "id": account.pk,
        "name": account.name,
        "kind": account.kind,
        "kind_display": account.get_kind_display(),
        "balance": api_money(account_balance(account) if balance is None else balance),
        "opening_balance": api_money(account.opening_balance),
        "color": account.color,
        "active": account.active,
    }
    bank_link = getattr(account, "bank_link", None)
    if bank_link:
        provenance_current = (
            bank_link.remote_balance is not None
            and bool(bank_link.remote_balance_type)
            and bank_link.remote_balance_currency == bank_link.currency
            and bank_link.balance_provenance_updated_at is not None
            and bank_link.balance_provenance_updated_at == bank_link.balance_updated_at
        )
        payload["bank_link"] = {
            "id": bank_link.pk,
            "display_name": bank_link.display_name,
            "remote_balance": api_money(bank_link.remote_balance) if provenance_current else None,
            "remote_balance_type": bank_link.remote_balance_type if provenance_current else "",
            "remote_balance_currency": bank_link.remote_balance_currency if provenance_current else "",
            "remote_balance_reference_date": api_date(bank_link.remote_balance_reference_date) if provenance_current else "",
            "balance_updated_at": api_datetime(bank_link.balance_updated_at) if provenance_current else "",
            "last_transaction_date": api_date(bank_link.last_transaction_date),
            "connection_id": bank_link.connection_id,
        }
    else:
        payload["bank_link"] = None
    return payload


def api_transaction(movement, *, category_cache=None, can_reopen=None, can_allocate=None):
    if can_reopen is None:
        can_reopen = movement.source in {"csv", "enable_banking"}
    prefetched = getattr(movement, "_prefetched_objects_cache", {})
    allocation_rows = prefetched.get("allocations")
    if allocation_rows is None:
        allocation_rows = list(movement.allocations.select_related("category", "category__parent").all())
    category_ids = {row.category_id for row in allocation_rows if row.category_id}
    if movement.category_id:
        category_ids.add(movement.category_id)
    category_cache = dict(category_cache or {})
    missing_category_ids = category_ids - category_cache.keys()
    if missing_category_ids:
        category_cache.update(category_api_cache(missing_category_ids))
    payload = {
        "id": movement.pk,
        "kind": movement.kind,
        "kind_display": movement.get_kind_display(),
        "amount": api_money(movement.amount),
        "signed_amount": api_money(movement.signed_amount),
        "date": api_date(movement.date),
        "description": movement.description,
        "notes": movement.notes,
        "account": api_account(movement.account, balance=Decimal("0")),
        "category": api_category(movement.category, category_cache=category_cache),
        "source": movement.source,
        "source_display": movement.get_source_display(),
        "refund_for_id": movement.refund_for_id,
        "is_refund": movement.is_refund,
        "is_transfer": bool(movement.transfer_group),
        "can_reopen": can_reopen,
        "tags": [tag.name for tag in movement.tags.all()],
        "attachments": [
            {"id": attachment.pk, "name": attachment.original_name, "url": reverse("attachment_download", args=[attachment.pk])}
            for attachment in movement.attachments.all()
        ],
    }
    if allocation_rows:
        payload["allocations"] = [
            {
                "category": api_category(row.category, category_cache=category_cache),
                "amount": api_money(row.amount),
                "position": row.position,
            }
            for row in allocation_rows
        ]
    if movement.allocation_revision:
        payload["allocation_revision"] = movement.allocation_revision
    if can_allocate is False:
        payload["can_allocate"] = False
    if hasattr(movement, "statistics_applied_amount"):
        payload["statistics_attribution"] = {
            "applied_amount": api_money(movement.statistics_applied_amount),
            "extra_income": api_money(movement.statistics_extra_income),
        }
    return payload


def api_refund_candidate(movement):
    """Small, intentionally separate payload used only by the refund picker."""
    return {
        "id": movement.pk,
        "kind": movement.kind,
        "amount": api_money(movement.amount),
        "date": api_date(movement.date),
        "description": movement.description,
    }


def category_catalog_queryset(*, active=None):
    queryset = Category.objects.select_related("parent").annotate(
        transaction_count=Count("transactions", distinct=True) + Count("transaction_allocations__transaction", distinct=True),
        child_count=Count("children", distinct=True),
        last_used_at=Max("transactions__date"),
        allocation_last_used_at=Max("transaction_allocations__transaction__date"),
    )
    if active is not None:
        queryset = queryset.filter(active=active)
    return queryset


def category_api_cache(category_ids):
    """Load complete category payload facts once for a response."""

    ids = {category_id for category_id in category_ids if category_id}
    if not ids:
        return {}
    return {category.pk: category for category in category_catalog_queryset().filter(pk__in=ids)}


def api_budget_item(item, *, category_cache=None):
    return {
        "id": item["budget"].pk,
        "category": api_category(item["budget"].category, category_cache=category_cache),
        "limit": api_money(item["budget"].limit),
        "spent": api_money(item["spent"]),
        "remaining": api_money(item["remaining"]),
        "percent": api_money(item["percent"]),
        "actual_percent": api_money(item["actual_percent"]),
        "projected_percent": api_money(item["projected_percent"]),
        "pace": item["pace"],
    }


def api_budget(budget):
    return {
        "id": budget.pk,
        "month": budget.month.strftime("%Y-%m"),
        "category": api_category(budget.category),
        "limit": api_money(budget.limit),
    }


def api_savings_objective(objective):
    reserve = annual_reserve_details(objective)
    target_amount = reserve["target_amount"] if reserve else objective.target_amount
    target_date = reserve["due_date"] if reserve and reserve["due_date"] else objective.target_date
    result = {
        "id": objective.pk,
        "name": objective.name,
        "target_amount": api_money(target_amount),
        "target_date": api_date(target_date),
        "priority": objective.priority,
        "assigned_amount": api_money(objective.assigned_amount),
        "remaining_amount": api_money(max(target_amount - objective.assigned_amount, Decimal("0"))),
        "archived": objective.archived,
        "achieved": objective.assigned_amount >= target_amount,
        "revision": objective.revision,
        "recurring_rule_id": objective.recurring_rule_id,
        "annual_reserve": None,
    }
    if reserve:
        result["annual_reserve"] = {
            "rule_id": reserve["rule_id"],
            "rule_name": reserve["rule_name"],
            "status": reserve["status"],
            "due_date": api_date(reserve["due_date"]),
            "months_remaining": reserve["months_remaining"],
            "remaining_amount": api_money(reserve["remaining_amount"]),
            "monthly_amount": api_money(reserve["monthly_amount"]) if reserve["monthly_amount"] is not None else None,
        }
    return result

def api_savings_objective_summary(summary):
    return {
        "ledger_balance": api_money(summary["ledger_balance"]),
        "eligible_balance": api_money(summary["eligible_balance"]),
        "assigned_total": api_money(summary["assigned_total"]),
        "free_to_assign": api_money(summary["free_to_assign"]),
        "overallocated": summary["overallocated"],
        "overallocated_by": api_money(summary["overallocated_by"]),
        "confirmation_token": summary["confirmation_token"],
    }


def api_recurring_rule(rule, *, period_start=None, period_end=None, as_of=None):
    as_of = as_of or timezone.localdate()
    period_start = period_start or as_of.replace(day=1)
    period_end = period_end or period_start
    lifecycle = "paused" if not rule.active else "expired" if rule.end_date and rule.end_date < as_of else "active"
    return {
        "id": rule.pk,
        "name": rule.name,
        "kind": rule.kind,
        "amount": api_money(rule.amount),
        "account": api_account(rule.account, balance=Decimal("0")),
        "category": api_category(rule.category),
        "frequency": rule.frequency,
        "frequency_display": rule.get_frequency_display(),
        "day_of_month": rule.day_of_month,
        "start_date": api_date(rule.start_date),
        "end_date": api_date(rule.end_date),
        "notes": rule.notes,
        "active": rule.active,
        "lifecycle": lifecycle,
        "affects_selected_month": bool(
            rule.active
            and rule.start_date <= period_end
            and (not rule.end_date or rule.end_date >= period_start)
        ),
    }


def api_occurrence(occurrence):
    return {
        "id": occurrence.pk,
        "due_date": api_date(occurrence.due_date),
        "amount": api_money(occurrence.amount),
        "status": occurrence.status,
        "status_display": occurrence.get_status_display(),
        "rule": api_recurring_rule(occurrence.rule),
    }


def api_category_rule(rule):
    return {
        "id": rule.pk,
        "description": rule.description,
        "kind": rule.kind,
        "category": api_category(rule.category),
        "active": rule.active,
        "updated_at": api_datetime(rule.updated_at),
        "priority": rule.priority,
        "match_mode": rule.match_mode,
        "account": api_account(rule.account, balance=Decimal("0")) if rule.account_id else None,
        "amount_min": api_money(rule.amount_min) if rule.amount_min is not None else None,
        "amount_max": api_money(rule.amount_max) if rule.amount_max is not None else None,
        "last_tested_at": api_datetime(rule.last_tested_at),
        "last_test_result": rule.last_test_result,
        "application_count": rule.application_count,
    }


def api_category_rule_application(application):
    counts = {"transactions": 0, "bank_rows": 0, "csv_rows": 0}
    record_types = {"transaction": "transactions", "bank": "bank_rows", "csv": "csv_rows"}
    records = application.affected_records or []
    for record in records:
        key = record_types.get(record.get("type"))
        if key:
            counts[key] += 1
    filters = application.filters_used or {}
    target_category_id = filters.get("category_id")
    if target_category_id is None and records:
        target_category_id = records[0].get("new_category")
    return {
        "id": application.pk,
        "rule_id": application.rule_id,
        "rule_description": filters.get("description") or (application.rule.description if application.rule_id else "Regla eliminada"),
        "applied_at": api_datetime(application.applied_at),
        "status": application.status,
        "reversible": bool(application.reversible and application.status == CategoryRuleApplication.Status.COMPLETED),
        "target_category_id": target_category_id,
        **counts,
        "total": sum(counts.values()),
    }


def api_import_profile(profile):
    return {
        "id": profile.pk,
        "name": profile.name,
        "delimiter": profile.delimiter,
        "date_format": profile.date_format,
        "date_column": profile.date_column,
        "description_column": profile.description_column,
        "amount_column": profile.amount_column,
        "category_column": profile.category_column,
        "subcategory_column": profile.subcategory_column,
    }


def api_import_batch_payload(batch):
    pending_count = batch.rows.filter(status=ImportRow.Status.PENDING).count()
    total_count = batch.rows.count()
    return {
        "id": batch.pk,
        "filename": batch.filename,
        "account": api_account(batch.account, balance=Decimal("0")),
        "profile": api_import_profile(batch.profile) if batch.profile else None,
        "status": batch.status,
        "status_display": batch.get_status_display(),
        "created_at": api_datetime(batch.created_at),
        "pending_count": pending_count,
        "row_count": total_count,
    }


def api_category_rule_match(rule, *, category_cache=None):
    return {
        "id": rule.pk,
        "description": rule.description,
        "kind": rule.kind,
        "category": api_category(rule.category, category_cache=category_cache),
        "priority": rule.priority,
        "match_mode": rule.match_mode,
        "account_id": rule.account_id,
        "amount_min": api_money(rule.amount_min) if rule.amount_min is not None else None,
        "amount_max": api_money(rule.amount_max) if rule.amount_max is not None else None,
    }


def api_import_row(row, *, category_rule_matches=(), category_cache=None):
    movement = getattr(row, "transaction", None) if row.transaction_id else None
    reopened_allocations = (
        list(movement.allocations.all())
        if movement and movement.archived and movement.source == Transaction.Source.CSV
        else []
    )
    preserves_split = len(reopened_allocations) > 1
    payload = {
        "id": row.pk,
        "batch_id": row.batch_id,
        "row_number": row.row_number,
        "date": api_date(row.date),
        "description": row.description,
        "amount": api_money(row.amount),
        "kind": row.kind,
        "category": api_category(None if preserves_split else row.category, category_cache=category_cache),
        "category_rule_matches": [] if preserves_split else [api_category_rule_match(rule, category_cache=category_cache) for rule in category_rule_matches],
        "possible_duplicate": row.possible_duplicate,
        "status": row.status,
        "status_display": row.get_status_display(),
        "transaction_id": row.transaction_id,
    }
    if preserves_split:
        payload["reopened_split"] = {
            "transaction_id": movement.pk,
            "allocations": [
                {
                    "category": api_category(item.category, category_cache=category_cache),
                    "amount": api_money(item.amount),
                    "position": item.position,
                }
                for item in reopened_allocations
            ],
        }
    if movement and movement.archived and movement.refund_for_id:
        payload["reopened_refund"] = {
            "id": movement.refund_for_id,
            "date": api_date(movement.refund_for.date),
            "description": movement.refund_for.description,
        }
    return payload


def api_bank_review_row(row, *, category_cache=None, category_rule_matches=()):
    prediction = getattr(row, "prediction", None)
    movement = getattr(row, "transaction", None) if row.transaction_id else None
    reopened_allocations = list(movement.allocations.all()) if movement and movement.archived else []
    preserves_split = bool(
        movement
        and movement.archived
        and movement.source == Transaction.Source.ENABLE_BANKING
        and len(reopened_allocations) > 1
    )
    suggested_category = None if preserves_split else row.category or getattr(prediction, "category", None)
    payload = {
        "id": row.pk,
        "bank_account": {
            "id": row.bank_account_id,
            "display_name": row.bank_account.display_name,
            "account": api_account(row.bank_account.account, balance=Decimal("0")),
        },
        "booking_date": api_date(row.booking_date),
        "description": row.description,
        "amount": api_money(row.amount),
        "kind": row.kind,
        "currency": row.currency,
        "category": api_category(None if preserves_split else row.category, category_cache=category_cache),
        "category_rule_matches": [] if preserves_split else [api_category_rule_match(rule, category_cache=category_cache) for rule in category_rule_matches],
        "suggested_category": api_category(suggested_category, category_cache=category_cache),
        "prediction": {
            "model_name": prediction.model_name,
            "category": api_category(prediction.category, category_cache=category_cache),
            "confidence": api_money(prediction.confidence),
            "reason": prediction.reason,
            "status": prediction.status,
        }
        if prediction and not preserves_split
        else None,
        "possible_duplicate": row.possible_duplicate,
        "possible_transfer": row.possible_transfer,
        "fee_transaction_id": row.fee_transaction_id,
        "status": row.status,
    }
    if preserves_split:
        payload["reopened_split"] = {
            "transaction_id": movement.pk,
            "allocations": [
                {
                    "category": api_category(item.category, category_cache=category_cache),
                    "amount": api_money(item.amount),
                    "position": item.position,
                }
                for item in reopened_allocations
            ],
        }
    if movement and movement.archived and movement.refund_for_id:
        payload["reopened_refund"] = {
            "id": movement.refund_for_id,
            "date": api_date(movement.refund_for.date),
            "description": movement.refund_for.description,
        }
    return payload


def api_automation(automation):
    return {
        "id": automation.pk,
        "llm_enabled": automation.llm_enabled,
        "auto_apply_enabled": automation.auto_apply_enabled,
        "auto_apply_effective": auto_apply_effective(automation.auto_apply_enabled, automation.confidence_threshold),
        "promotion_status": AUTO_APPLY_PROMOTION_STATUS,
        "confidence_threshold": api_money(automation.confidence_threshold),
        "updated_at": api_datetime(automation.updated_at),
    }


def api_projection(projection):
    return {
        "actual_expense": api_money(projection["actual_expense"]),
        "projected_expense": api_money(projection["projected_expense"]),
        "projected_savings": api_money(projection["projected_savings"]),
        "expense_median": api_money(projection["expense_median"]),
        "delta_vs_median": api_money(projection["delta_vs_median"]),
        "normalized_income": api_money(projection["normalized_income"]),
        "normalized_savings": api_money(projection["normalized_savings"]),
        "normalized_savings_rate": api_money(projection["normalized_savings_rate"]),
        "expense_expected_to_date": api_money(projection["expense_expected_to_date"]),
        "expense_delta_vs_pace": api_money(projection["expense_delta_vs_pace"]),
        "method": projection["method"],
        "as_of": api_date(projection["as_of"]),
        "sufficient": projection["sufficient"],
        "category_watchlist": [
            {
                "label": item["label"],
                "projected": api_money(item["projected"]),
                "baseline": api_money(item["baseline"]),
                "difference": api_money(item["difference"]),
                "filters": item["filters"],
            }
            for item in projection["category_watchlist"]
        ],
    }


def api_metrics(metrics):
    payload = {
        key: api_money(value)
        for key, value in metrics.items()
        if isinstance(value, Decimal)
    }
    payload["start"] = api_date(metrics["start"])
    payload["end"] = api_date(metrics["end"])
    if "savings_goal_progress" in metrics:
        payload["savings_goal_progress"] = metrics["savings_goal_progress"]
    if "projection" in metrics:
        payload["projection"] = api_projection(metrics["projection"])
    return payload


def api_subscription(subscription, *, category_cache=None, balance_cache=None):
    return {
        "description": subscription["description"],
        "median_amount": api_money(subscription["median_amount"]),
        "annual_cost": api_money(subscription["annual_cost"]),
        "months_seen": subscription["months_seen"],
        "typical_day": subscription["typical_day"],
        "last_date": api_date(subscription["last_date"]),
        "category": api_category(subscription["category"], category_cache=category_cache) if subscription.get("category") else None,
        "account": api_account(subscription["account"], balance=(balance_cache or {}).get(subscription["account"].pk)) if subscription.get("account") else None,
        "filters": subscription["filters"],
        "url": subscription.get("url", ""),
        "rule_prefill": subscription.get("rule_prefill", ""),
        "recurring_prefill": subscription.get("recurring_prefill", ""),
    }


def api_planning_subscription_candidate(
    subscription,
    *,
    review=None,
    review_context=None,
    has_category_rule=False,
    has_recurring_rule=False,
):
    median_amount = subscription["median_amount"].quantize(Decimal("0.01"))
    lower_amount = (median_amount * Decimal("0.85")).quantize(Decimal("0.01"))
    upper_amount = (median_amount * Decimal("1.15")).quantize(Decimal("0.01"))
    account = subscription["account"]
    category = subscription["category"]
    review_context = review_context or {"status": "pending", "reason": "new", "stored_status": None}
    return {
        "key": f"{account.pk}:{subscription['normalized_description']}",
        "normalized_description": subscription["normalized_description"],
        "evidence_signature": subscription["evidence_signature"],
        "description": subscription["description"],
        "median_amount": api_money(median_amount),
        "annual_cost": api_money(subscription["annual_cost"]),
        "confirmed_annual_cost": api_money(review.confirmed_annual_cost) if review and review.confirmed_annual_cost is not None else None,
        "monthly_periodicity_confirmed": bool(review and review.monthly_periodicity_confirmed),
        "months_seen": subscription["months_seen"],
        "typical_day": subscription["typical_day"],
        "last_date": api_date(subscription["last_date"]),
        "latest_amount": api_money(subscription["latest_amount"]),
        "latest_month_median": api_money(subscription["latest_month_median"]),
        "previous_median": api_money(subscription["previous_median"]),
        "exceptional_charge": subscription["exceptional_charge"],
        "confirmed_step_change": subscription["confirmed_step_change"],
        "has_category_rule": has_category_rule,
        "has_recurring_rule": has_recurring_rule,
        "review_status": review_context["status"],
        "review_reason": review_context["reason"],
        "reviewed_status": review_context["stored_status"],
        "review_revision": review.revision if review else 0,
        "next_review_date": review.next_review_date.isoformat() if review and review.next_review_date else None,
        "reviewed_at": api_datetime(review.reviewed_at) if review else None,
        "account": {"id": account.pk, "name": account.name},
        "category": {
            "id": category.pk,
            "name": category.name,
            "display_name": category.display_name,
        },
        "movements_url": react_transactions_url(subscription["filters"]),
        "category_rule_input": {
            "description": subscription["description"],
            "kind": Category.Kind.EXPENSE,
            "category": category.pk,
            "priority": 100,
            "match_mode": CategoryRule.MatchMode.EXACT,
            "account": account.pk,
            "amount_min": api_money(lower_amount),
            "amount_max": api_money(upper_amount),
            "active": True,
        },
        "recurring_rule_input": {
            "name": subscription["description"],
            "kind": Category.Kind.EXPENSE,
            "amount": api_money(median_amount),
            "account": account.pk,
            "category": category.pk,
            "frequency": RecurringRule.Frequency.MONTHLY,
            "day_of_month": subscription["typical_day"],
            "start_date": timezone.localdate().isoformat(),
            "end_date": "",
            "notes": "Candidato detectado a partir de movimientos confirmados.",
            "active": True,
        },
    }


def api_review(review):
    return {
        **{
            key: value
            for key, value in review.items()
            if not isinstance(value, (Decimal, date)) and not hasattr(value, "isoformat")
        },
        "bank_pending_amount": api_money(review.get("bank_pending_amount")),
        "csv_pending_amount": api_money(review.get("csv_pending_amount")),
        "pending_net_amount": api_money(review.get("pending_net_amount")),
        "last_bank_sync_at": api_datetime(review.get("last_bank_sync_at")),
        "last_bank_imported_date": api_date(review.get("last_bank_imported_date")),
    }


def connection_payload(connection, *, reconcile=False):
    # A serialized connection must be a snapshot.  Reconciliation is a state
    # transition and belongs to an explicit sync operation, never to a GET.
    if reconcile:
        reconcile_connection_sync_state(connection)
    last_synced_at = timezone.localtime(connection.last_synced_at) if connection.last_synced_at else None
    sync_started_at = timezone.localtime(connection.sync_started_at) if connection.sync_started_at else None
    return {
        "id": connection.pk,
        "status": connection.status,
        "status_display": connection.get_status_display(),
        "sync_status": connection.sync_status,
        "sync_status_display": connection.get_sync_status_display(),
        "reconnect_required": connection.status == connection.Status.NEEDS_RECONNECT,
        "sync_started_at": sync_started_at.isoformat() if sync_started_at else "",
        "sync_started_at_display": sync_started_at.strftime("%H:%M") if sync_started_at else "",
        "last_synced_at": last_synced_at.isoformat() if last_synced_at else "",
        "last_synced_at_display": last_synced_at.strftime("%d/%m/%Y %H:%M") if last_synced_at else "Nunca",
        "last_error": api_bank_error(connection.last_error),
    }


def api_connection(connection, *, reconcile=False):
    payload = connection_payload(connection, reconcile=reconcile)
    payload.update(
        {
            "bank_name": connection.bank_name,
            "bank_country": connection.bank_country,
            "authorized_until": api_datetime(connection.authorized_until),
            "accounts": [api_account(link.account) for link in connection.bank_accounts.select_related("account")],
        }
    )
    return payload


def api_choice_list(choices):
    return [{"value": value, "label": label} for value, label in choices]


def react_transactions_url(filters):
    query = urlencode(
        {
            "tab": "transactions",
            **{key: value for key, value in filters.items() if value not in (None, "")},
        }
    )
    return f"/?{query}"
