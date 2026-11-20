from datetime import date
from decimal import Decimal

from django.test import TestCase
from django.urls import reverse

from .models import Account, BankAccount, BankConnection, BankTransaction, Category, CategoryRule, ImportBatch, ImportRow


class ReviewRuleMatchPayloadTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create(name="Review test account")
        self.other_account = Account.objects.create(name="Other review account")
        self.connection = BankConnection.objects.create(bank_name="Test Bank", session_id="review-rule-test")
        self.bank_account = BankAccount.objects.create(
            connection=self.connection,
            account=self.account,
            remote_uid="review-rule-test-account",
            display_name="Test current account",
        )
        self.food = Category.objects.create(name="Food test", kind=Category.Kind.EXPENSE)
        self.home = Category.objects.create(name="Home test", kind=Category.Kind.EXPENSE)

    def test_bank_review_returns_all_matching_active_rules_in_precedence_order_without_mutation(self):
        leading = CategoryRule.objects.create(
            description="Supermercado",
            kind=Category.Kind.EXPENSE,
            category=self.food,
            priority=1,
            match_mode=CategoryRule.MatchMode.EXACT,
        )
        conflicting = CategoryRule.objects.create(
            description="Super",
            kind=Category.Kind.EXPENSE,
            category=self.home,
            priority=5,
            match_mode=CategoryRule.MatchMode.CONTAINS,
        )
        CategoryRule.objects.create(
            description="Superm",
            kind=Category.Kind.EXPENSE,
            category=self.home,
            priority=0,
            match_mode=CategoryRule.MatchMode.CONTAINS,
            active=False,
        )
        CategoryRule.objects.create(
            description="Supe",
            kind=Category.Kind.EXPENSE,
            category=self.home,
            priority=0,
            match_mode=CategoryRule.MatchMode.CONTAINS,
            account=self.other_account,
        )
        CategoryRule.objects.create(
            description="Super range",
            kind=Category.Kind.EXPENSE,
            category=self.home,
            priority=0,
            match_mode=CategoryRule.MatchMode.CONTAINS,
            amount_min=Decimal("50.00"),
        )
        row = BankTransaction.objects.create(
            bank_account=self.bank_account,
            remote_id="review-rule-row",
            booking_date=date(2026, 10, 20),
            description="Supermercado",
            amount=Decimal("12.00"),
            kind=Category.Kind.EXPENSE,
            fingerprint="review-rule-row",
        )

        response = self.client.get(reverse("api_bank_review"))

        self.assertEqual(response.status_code, 200)
        matched = response.json()["rows"][0]["category_rule_matches"]
        self.assertEqual([rule["id"] for rule in matched], [leading.pk, conflicting.pk])
        self.assertEqual([rule["category"]["id"] for rule in matched], [self.food.pk, self.home.pk])
        row.refresh_from_db()
        self.assertEqual(row.status, BankTransaction.Status.PENDING)
        self.assertIsNone(row.category_id)
        self.assertIsNone(row.transaction_id)

    def test_csv_review_matches_rules_with_batch_account_and_keeps_the_row_pending(self):
        rule = CategoryRule.objects.create(
            description="Super",
            kind=Category.Kind.EXPENSE,
            category=self.food,
            match_mode=CategoryRule.MatchMode.CONTAINS,
            account=self.account,
        )
        batch = ImportBatch.objects.create(filename="review.csv", account=self.account)
        row = ImportRow.objects.create(
            batch=batch,
            row_number=1,
            date=date(2026, 10, 20),
            description="Supermercado",
            amount=Decimal("12.00"),
            kind=Category.Kind.EXPENSE,
            fingerprint="review-csv-rule-row",
        )

        response = self.client.get(reverse("api_import_rows", args=[batch.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"][0]["category_rule_matches"][0]["id"], rule.pk)
        self.assertEqual(response.json()["results"][0]["category_rule_matches"][0]["account_id"], self.account.pk)
        row.refresh_from_db()
        self.assertEqual(row.status, ImportRow.Status.PENDING)
        self.assertIsNone(row.category_id)
        self.assertIsNone(row.transaction_id)

        batch_other = ImportBatch.objects.create(filename="other.csv", account=self.other_account)
        row_other = ImportRow.objects.create(
            batch=batch_other,
            row_number=1,
            date=date(2026, 10, 20),
            description="Supermercado",
            amount=Decimal("12.00"),
            kind=Category.Kind.EXPENSE,
            fingerprint="other-review-csv-rule-row",
        )
        other_response = self.client.get(reverse("api_import_rows", args=[batch_other.pk]))
        self.assertEqual(other_response.json()["results"][0]["category_rule_matches"], [])
        row_other.refresh_from_db()
        self.assertEqual(row_other.status, ImportRow.Status.PENDING)
