"""Human review state for locally detected subscription candidates."""

from decimal import Decimal

from django.utils import timezone

from .models import SubscriptionReview


MATERIAL_COST_CHANGE = Decimal("0.15")


def subscription_review_context(candidate, review=None, *, today=None):
    """Return the read-only presentation state without mutating the review row."""
    today = today or timezone.localdate()
    if review is None:
        return {"status": "pending", "reason": "new", "stored_status": None}

    reviewed_amount = review.reviewed_monthly_amount
    current_amount = candidate["review_monthly_amount"]
    material_cost_change = bool(
        reviewed_amount is None
        or (reviewed_amount == 0 and current_amount != 0)
        or (reviewed_amount and abs(current_amount - reviewed_amount) / reviewed_amount > MATERIAL_COST_CHANGE)
    )
    material_presence_change = (
        review.reviewed_months_seen is not None
        and abs(candidate["months_seen"] - review.reviewed_months_seen) >= 2
    )
    if material_cost_change or material_presence_change:
        return {"status": "pending", "reason": "material_change", "stored_status": review.status}
    if review.status == SubscriptionReview.Status.ACCEPTED and (
        review.next_review_date is None or review.next_review_date <= today
    ):
        return {"status": "pending", "reason": "review_due", "stored_status": review.status}
    return {"status": review.status, "reason": "", "stored_status": review.status}


def subscription_review_map(candidates):
    identities = {
        (candidate["account"].pk, candidate["normalized_description"])
        for candidate in candidates
    }
    account_ids = {account_id for account_id, _ in identities}
    rows = SubscriptionReview.objects.filter(account_id__in=account_ids)
    return {
        (row.account_id, row.normalized_description): row
        for row in rows
        if (row.account_id, row.normalized_description) in identities
    }


def pending_subscription_candidates(candidates, *, today=None):
    reviews = subscription_review_map(candidates)
    return [
        candidate
        for candidate in candidates
        if subscription_review_context(
            candidate,
            reviews.get((candidate["account"].pk, candidate["normalized_description"])),
            today=today,
        )["status"] == "pending"
    ]
