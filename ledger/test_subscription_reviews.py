import json
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.db import OperationalError
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Account, Category, SubscriptionReview, Transaction
from .dashboard_services import attention_signals
from .services import detected_subscriptions, shift_month
from .subscription_reviews import subscription_review_context


class SubscriptionReviewApiTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create(name="Principal")
        self.category = Category.objects.create(name="Servicios", kind=Category.Kind.EXPENSE)

    def _add_monthly_history(self, description="Video", amount="10.00", *, account=None):
        account = account or self.account
        today = timezone.localdate()
        current_month = today.replace(day=1)
        for offset in range(5, -1, -1):
            month = shift_month(current_month, -offset)
            day = min(5, today.day) if offset == 0 else 5
            Transaction.objects.create(
                account=account,
                kind=Transaction.Kind.EXPENSE,
                amount=Decimal(amount),
                date=month.replace(day=day),
                description=description,
                category=self.category,
            )

    def _candidate(self, description="Video", account_id=None):
        response = self.client.get(reverse("api_planning"))
        self.assertEqual(response.status_code, 200)
        candidates = response.json()["subscription_candidates"]
        return next(
            item for item in candidates
            if item["description"] == description and (account_id is None or item["account"]["id"] == account_id)
        )

    def _decision(self, candidate, *, action="accept", **overrides):
        payload = {
            "account_id": candidate["account"]["id"],
            "normalized_description": candidate["normalized_description"],
            "evidence_signature": candidate["evidence_signature"],
            "expected_revision": candidate["review_revision"],
            "action": action,
            "next_review_date": (timezone.localdate() + timedelta(days=90)).isoformat() if action == "accept" else None,
            "monthly_periodicity_confirmed": True if action == "accept" else False,
            "confirmed_annual_cost": "144.00" if action == "accept" else None,
        }
        payload.update(overrides)
        return self.client.post(
            reverse("api_subscription_review"),
            data=json.dumps(payload),
            content_type="application/json",
        )

    def test_acceptance_persists_review_date_and_confirmed_annual_cost_idempotently(self):
        self._add_monthly_history()
        candidate = self._candidate()

        response = self._decision(candidate)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(SubscriptionReview.objects.count(), 1)
        review = SubscriptionReview.objects.get()
        self.assertEqual(review.status, SubscriptionReview.Status.ACCEPTED)
        self.assertEqual(review.confirmed_annual_cost, Decimal("144.00"))
        self.assertTrue(review.monthly_periodicity_confirmed)

        refreshed = self._candidate()
        self.assertEqual(refreshed["review_status"], "accepted")
        self.assertEqual(refreshed["confirmed_annual_cost"], 144.0)
        self.assertEqual(refreshed["annual_cost"], 120.0)

        retry = self._decision(candidate)
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertTrue(retry.json()["idempotent"])
        self.assertEqual(SubscriptionReview.objects.count(), 1)

    def test_dismissal_stays_suppressed_until_material_monthly_change(self):
        self._add_monthly_history()
        candidate = self._candidate()
        response = self._decision(candidate, action="dismiss")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(self._candidate()["review_status"], "dismissed")
        dashboard_subscriptions = self.client.get(reverse("api_bootstrap")).json()["dashboard"]["subscriptions"]
        self.assertFalse(any(item["description"] == "Video" for item in dashboard_subscriptions))
        dismissed_signals = attention_signals(subscriptions=detected_subscriptions())
        self.assertFalse(any(signal["title"] == "Suscripción encarecida" and signal["label"] == "Video" for signal in dismissed_signals))

        Transaction.objects.filter(
            account=self.account,
            description="Video",
            date__gte=timezone.localdate().replace(day=1),
        ).update(amount=Decimal("13.00"))

        reopened = self._candidate()
        self.assertEqual(reopened["review_status"], "pending")
        self.assertEqual(reopened["review_reason"], "material_change")
        self.assertEqual(reopened["reviewed_status"], "dismissed")

        changed_signals = attention_signals(subscriptions=detected_subscriptions())
        self.assertTrue(any(signal["title"] == "Suscripción encarecida" and signal["label"] == "Video" for signal in changed_signals))
        reopened_dashboard = self.client.get(reverse("api_bootstrap")).json()["dashboard"]["subscriptions"]
        self.assertTrue(any(item["description"] == "Video" for item in reopened_dashboard))

    def test_late_retry_cannot_overwrite_a_newer_review_decision(self):
        self._add_monthly_history()
        original_candidate = self._candidate()
        accepted = self._decision(original_candidate, action="accept")
        self.assertEqual(accepted.status_code, 201, accepted.content)

        current_candidate = self._candidate()
        self.assertEqual(current_candidate["review_revision"], 1)
        dismissed = self._decision(current_candidate, action="dismiss")
        self.assertEqual(dismissed.status_code, 200, dismissed.content)
        self.assertEqual(dismissed.json()["review"]["revision"], 2)

        late_accept_retry = self._decision(original_candidate, action="accept")

        self.assertEqual(late_accept_retry.status_code, 409)
        self.assertEqual(late_accept_retry.json()["code"], "review_changed")
        review = SubscriptionReview.objects.get()
        self.assertEqual(review.status, SubscriptionReview.Status.DISMISSED)
        self.assertEqual(review.revision, 2)

    def test_impossible_review_date_returns_400_instead_of_server_error(self):
        self._add_monthly_history()
        candidate = self._candidate()

        response = self._decision(candidate, next_review_date="2026-02-30")

        self.assertEqual(response.status_code, 400)
        self.assertFalse(SubscriptionReview.objects.exists())

    def test_presence_change_reopens_when_pattern_still_meets_detector_thresholds(self):
        review = SubscriptionReview.objects.create(
            account=self.account,
            normalized_description="video",
            status=SubscriptionReview.Status.DISMISSED,
            evidence_signature="a" * 64,
            reviewed_monthly_amount=Decimal("10.00"),
            reviewed_months_seen=4,
        )

        context = subscription_review_context({"review_monthly_amount": Decimal("10.00"), "months_seen": 6}, review)

        self.assertEqual(context, {"status": "pending", "reason": "material_change", "stored_status": "dismissed"})

    def test_accepted_candidate_returns_to_review_on_its_next_review_date(self):
        self._add_monthly_history()
        candidate = self._candidate()
        SubscriptionReview.objects.create(
            account=self.account,
            normalized_description=candidate["normalized_description"],
            status=SubscriptionReview.Status.ACCEPTED,
            evidence_signature=candidate["evidence_signature"],
            reviewed_monthly_amount=Decimal("10.00"),
            reviewed_months_seen=candidate["months_seen"],
            next_review_date=timezone.localdate(),
        )

        due_candidate = self._candidate()

        self.assertEqual(due_candidate["review_status"], "pending")
        self.assertEqual(due_candidate["review_reason"], "review_due")
        self.assertEqual(due_candidate["reviewed_status"], "accepted")

    def test_stale_evidence_signature_is_rejected_without_a_decision(self):
        self._add_monthly_history()
        candidate = self._candidate()
        Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("10.00"),
            date=timezone.localdate(),
            description="Video",
            category=self.category,
        )

        response = self._decision(candidate)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "stale_evidence")
        self.assertFalse(SubscriptionReview.objects.exists())

    def test_acceptance_requires_a_valid_future_review_date(self):
        self._add_monthly_history()
        candidate = self._candidate()

        response = self._decision(candidate, next_review_date="")

        self.assertEqual(response.status_code, 400)
        self.assertFalse(SubscriptionReview.objects.exists())

    def test_malformed_action_is_rejected_without_server_error(self):
        self._add_monthly_history()
        candidate = self._candidate()

        response = self._decision(candidate, action=["accept"])

        self.assertEqual(response.status_code, 400)
        self.assertFalse(SubscriptionReview.objects.exists())

    def test_transient_database_lock_returns_retryable_without_partial_review(self):
        self._add_monthly_history()
        candidate = self._candidate()

        with patch("ledger.subscription_review_views.SubscriptionReview.save", side_effect=OperationalError("database is locked")):
            response = self._decision(candidate)

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "review_busy")
        self.assertFalse(SubscriptionReview.objects.exists())

    def test_same_exact_concept_on_two_accounts_has_distinct_candidates(self):
        second_account = Account.objects.create(name="Secundaria")
        self._add_monthly_history("Video", account=self.account)
        self._add_monthly_history("Video", account=second_account)

        candidates = [item for item in self.client.get(reverse("api_planning")).json()["subscription_candidates"] if item["description"] == "Video"]

        self.assertEqual(len(candidates), 2)
        self.assertEqual(len({item["key"] for item in candidates}), 2)
        self.assertEqual({item["account"]["id"] for item in candidates}, {self.account.pk, second_account.pk})

    def test_saved_dismissals_do_not_push_new_low_cost_candidates_out_of_plan(self):
        for index in range(8):
            self._add_monthly_history(f"Servicio caro {index}", f"{100 + index}.00")
        self._add_monthly_history("Servicio pendiente", "2.00")
        detected = detected_subscriptions()
        for candidate in detected:
            if candidate["description"].startswith("Servicio caro"):
                SubscriptionReview.objects.create(
                    account=candidate["account"],
                    normalized_description=candidate["normalized_description"],
                    status=SubscriptionReview.Status.DISMISSED,
                    evidence_signature=candidate["evidence_signature"],
                    reviewed_monthly_amount=candidate["review_monthly_amount"],
                    reviewed_months_seen=candidate["months_seen"],
                )

        candidates = self.client.get(reverse("api_planning")).json()["subscription_candidates"]

        self.assertEqual(len(candidates), 8)
        self.assertEqual(candidates[0]["description"], "Servicio pendiente")
        self.assertEqual(candidates[0]["review_status"], "pending")


class SubscriptionDetectorFixtureMetricsTests(TestCase):
    """Small labeled fixtures measure detector behavior, not bank-contract accuracy."""

    def test_labeled_positive_and_negative_fixture_precision_and_recall(self):
        account = Account.objects.create(name="Fixture")
        category = Category.objects.create(name="Servicios fixture", kind=Category.Kind.EXPENSE)
        today = timezone.localdate()
        current_month = today.replace(day=1)
        labels = {"positive": set(), "negative": set()}

        for index in range(3):
            description = f"Servicio estable {index}"
            labels["positive"].add((account.pk, description.lower()))
            for offset in range(5, -1, -1):
                month = shift_month(current_month, -offset)
                day = min(5, today.day) if offset == 0 else 5
                Transaction.objects.create(
                    account=account,
                    kind=Transaction.Kind.EXPENSE,
                    amount=Decimal("12.00"),
                    date=month.replace(day=day),
                    description=description,
                    category=category,
                )

        unstable = "Importe variable"
        for offset, amount in zip(range(5, -1, -1), ("10.00", "25.00", "10.00", "25.00", "10.00", "25.00")):
            month = shift_month(current_month, -offset)
            day = min(5, today.day) if offset == 0 else 5
            Transaction.objects.create(
                account=account,
                kind=Transaction.Kind.EXPENSE,
                amount=Decimal(amount),
                date=month.replace(day=day),
                description=unstable,
                category=category,
            )
        labels["negative"].add((account.pk, unstable.lower()))

        for offset in (5, 3, 1):
            month = shift_month(current_month, -offset)
            Transaction.objects.create(
                account=account,
                kind=Transaction.Kind.EXPENSE,
                amount=Decimal("42.00"),
                date=month.replace(day=5),
                description="Compra ocasional",
                category=category,
            )
        labels["negative"].add((account.pk, "compra ocasional"))

        for offset in range(5, -1, -1):
            month = shift_month(current_month, -offset)
            day = min(5, today.day) if offset == 0 else 5
            description = f"Compra de supermercado {month:%Y-%m}"
            Transaction.objects.create(
                account=account,
                kind=Transaction.Kind.EXPENSE,
                amount=Decimal("8.00"),
                date=month.replace(day=day),
                description=description,
                category=category,
            )
            labels["negative"].add((account.pk, description.lower()))

        predicted = {(item["account"].pk, item["normalized_description"]) for item in detected_subscriptions()}
        expected = labels["positive"]
        true_positive = len(predicted & expected)
        false_positive = len(predicted & labels["negative"])
        false_negative = len(expected - predicted)

        self.assertEqual((true_positive, false_positive, false_negative), (3, 0, 0))
        self.assertEqual(true_positive / (true_positive + false_positive), 1.0)
        self.assertEqual(true_positive / (true_positive + false_negative), 1.0)
