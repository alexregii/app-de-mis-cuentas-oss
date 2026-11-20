import json
from decimal import Decimal
from datetime import date

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.urls import reverse

from .models import Account, BankAccount, BankConnection, BankTransaction, Category, CategoryRule, ImportBatch, ImportRow, MonthlyFinancialAggregate, Transaction, TransactionAllocation
from .financial_read_models import recompute_monthly_financial_aggregates
from .statistics import statistics_report
from .services import account_balance
from .services import category_totals, transaction_totals
from .calculations.ledger import allocate_refunds
from .import_services import confirm_import_row
from .transaction_services import reopen_imported_transaction
from .bank_review_services import confirm_bank_transaction
from .banking_categorization import predict_category
from .transaction_allocations import (
    TransactionAllocationConflict,
    TransactionAllocationError,
    normalize_allocation_payload,
    replace_transaction_allocations,
)


class TransactionAllocationTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create(name="Partidas", opening_balance=Decimal("1000.00"))
        self.food = Category.objects.create(name="Alimentación", kind=Category.Kind.EXPENSE)
        self.travel = Category.objects.create(name="Transporte", kind=Category.Kind.EXPENSE)
        self.salary = Category.objects.create(name="Nómina", kind=Category.Kind.INCOME)
        self.movement = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("100.00"),
            description="Compra mixta",
            category=self.food,
        )

    def split(self):
        return [
            {"category_id": self.food.pk, "amount": "60.00"},
            {"category_id": self.travel.pk, "amount": "40.00"},
        ]

    def test_split_rows_sum_exactly_and_do_not_create_another_ledger_movement(self):
        balance_before = account_balance(self.account)

        updated, changed = replace_transaction_allocations(self.movement, self.split(), expected_revision=0)

        updated.refresh_from_db()
        rows = list(updated.allocations.order_by("position"))
        self.assertTrue(changed)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(sum((row.amount for row in rows), Decimal("0.00")), updated.amount)
        self.assertEqual([row.amount for row in rows], [Decimal("60.00"), Decimal("40.00")])
        self.assertIsNone(updated.category_id)
        self.assertEqual(updated.allocation_revision, 1)
        self.assertEqual(account_balance(self.account), balance_before)

    def test_split_edit_rejects_stale_changed_payload_but_allows_an_exact_retry(self):
        replace_transaction_allocations(self.movement, self.split(), expected_revision=0)
        exact_retry, changed = replace_transaction_allocations(self.movement, self.split(), expected_revision=0)
        changed_payload = [
            {"category_id": self.food.pk, "amount": "50.00"},
            {"category_id": self.travel.pk, "amount": "50.00"},
        ]

        with self.assertRaises(TransactionAllocationConflict):
            replace_transaction_allocations(self.movement, changed_payload, expected_revision=0)

        exact_retry.refresh_from_db()
        self.assertFalse(changed)
        self.assertEqual(exact_retry.allocation_revision, 1)
        self.assertEqual(list(exact_retry.allocations.order_by("position").values_list("amount", flat=True)), [
            Decimal("60.00"), Decimal("40.00"),
        ])

    def test_single_legacy_category_normalizes_back_to_the_existing_foreign_key(self):
        replace_transaction_allocations(self.movement, self.split(), expected_revision=0)

        updated, changed = replace_transaction_allocations(
            self.movement,
            [{"category_id": self.travel.pk, "amount": "100.00"}],
            expected_revision=1,
        )

        updated.refresh_from_db()
        self.assertTrue(changed)
        self.assertEqual(updated.category_id, self.travel.pk)
        self.assertFalse(updated.allocations.exists())
        self.assertEqual(updated.allocation_revision, 2)

    def test_split_payload_rejects_sum_duplicates_and_kind_mismatch(self):
        with self.assertRaises(TransactionAllocationError):
            normalize_allocation_payload(
                [{"category_id": self.food.pk, "amount": "99.99"}],
                kind=Transaction.Kind.EXPENSE,
                total=Decimal("100.00"),
            )
        with self.assertRaises(TransactionAllocationError):
            normalize_allocation_payload(
                [
                    {"category_id": self.food.pk, "amount": "50.00"},
                    {"category_id": self.food.pk, "amount": "50.00"},
                ],
                kind=Transaction.Kind.EXPENSE,
                total=Decimal("100.00"),
            )
        with self.assertRaises(TransactionAllocationError):
            normalize_allocation_payload(
                [{"category_id": self.salary.pk, "amount": "100.00"}],
                kind=Transaction.Kind.EXPENSE,
                total=Decimal("100.00"),
            )

    def test_database_rejects_nonpositive_allocation_amount(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            TransactionAllocation.objects.create(
                transaction=self.movement,
                category=self.food,
                amount=Decimal("0.00"),
            )

    def test_split_refunds_are_distributed_proportionally_and_capped_per_category(self):
        replace_transaction_allocations(self.movement, self.split(), expected_revision=0)
        first = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("80.00"),
            date=self.movement.date,
            description="Devolución parcial 1",
            category=self.salary,
            refund_for=self.movement,
        )
        second = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("50.00"),
            date=self.movement.date,
            description="Devolución parcial 2",
            category=self.salary,
            refund_for=self.movement,
        )

        refunds = allocate_refunds([first, second])

        self.assertEqual(refunds[0].category_applied, ((self.food.pk, Decimal("48.00")), (self.travel.pk, Decimal("32.00"))))
        self.assertEqual(refunds[1].category_applied, ((self.food.pk, Decimal("12.00")), (self.travel.pk, Decimal("8.00"))))
        self.assertEqual(refunds[0].applied, Decimal("80.00"))
        self.assertEqual(refunds[1].applied, Decimal("20.00"))
        self.assertEqual(refunds[1].extra, Decimal("30.00"))
        self.assertEqual(refunds[1].extra_by_category, ((self.salary.pk, Decimal("30.00")),))

    def test_linked_overrefund_split_follows_refund_allocations_in_every_reporting_basis(self):
        replace_transaction_allocations(self.movement, self.split(), expected_revision=0)
        self.travel.exclude_from_analytics = True
        self.travel.save(update_fields=["exclude_from_analytics"])
        excluded_income = Category.objects.create(
            name="Ingreso excluido",
            kind=Category.Kind.INCOME,
            exclude_from_analytics=True,
        )
        refund = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("130.00"),
            date=self.movement.date,
            description="Reembolso repartido",
            category=self.salary,
            refund_for=self.movement,
        )
        recompute_monthly_financial_aggregates(self.movement.date, self.movement.date)

        updated = self.client.patch(
            reverse("api_transaction_detail", args=[refund.pk]),
            data=json.dumps({
                "allocations": [
                    {"category_id": self.salary.pk, "amount": "65.00"},
                    {"category_id": excluded_income.pk, "amount": "65.00"},
                ],
                "expected_allocation_revision": 0,
            }),
            content_type="application/json",
        )

        self.assertEqual(updated.status_code, 200, updated.content)
        refund.refresh_from_db()
        self.assertEqual(
            MonthlyFinancialAggregate.objects.filter(
                month=self.movement.date.replace(day=1),
                basis__in=("analytics", "all"),
                dirty=True,
            ).count(),
            2,
        )
        allocation = allocate_refunds([refund])[0]
        self.assertEqual(allocation.category_applied, ((self.food.pk, Decimal("60.00")), (self.travel.pk, Decimal("40.00"))))
        self.assertEqual(allocation.extra_by_category, ((self.salary.pk, Decimal("15.00")), (excluded_income.pk, Decimal("15.00"))))
        self.assertTrue(allocation.extra_follows_refund_allocations)

        totals = {
            basis: transaction_totals(self.movement.date, self.movement.date, basis=basis)
            for basis in ("analytics", "excluded", "all")
        }
        self.assertEqual(
            {basis: (row["income"], row["gross_expense"], row["refunds"], row["expense"]) for basis, row in totals.items()},
            {
                "analytics": (Decimal("15.00"), Decimal("60.00"), Decimal("60.00"), Decimal("0.00")),
                "excluded": (Decimal("15.00"), Decimal("40.00"), Decimal("40.00"), Decimal("0.00")),
                "all": (Decimal("30.00"), Decimal("100.00"), Decimal("100.00"), Decimal("0.00")),
            },
        )
        reports_before = {
            basis: statistics_report(self.movement.date, self.movement.date, basis)
            for basis in ("analytics", "all")
        }
        recompute_monthly_financial_aggregates(self.movement.date, self.movement.date)
        for basis, report in reports_before.items():
            self.assertEqual(statistics_report(self.movement.date, self.movement.date, basis), report)

    def test_create_api_allows_an_explicit_split_for_a_linked_refund(self):
        other_income = Category.objects.create(name="Otra categoría de ingreso", kind=Category.Kind.INCOME)
        response = self.client.post(
            reverse("api_transactions"),
            data=json.dumps({
                "kind": Transaction.Kind.INCOME,
                "amount": "30.00",
                "account": self.account.pk,
                "date": self.movement.date.isoformat(),
                "description": "Reembolso repartido nuevo",
                "category": "",
                "refund_for": self.movement.pk,
                "allocations": [
                    {"category_id": self.salary.pk, "amount": "15.00"},
                    {"category_id": other_income.pk, "amount": "15.00"},
                ],
            }),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        refund = Transaction.objects.get(description="Reembolso repartido nuevo")
        self.assertEqual(refund.refund_for_id, self.movement.pk)
        self.assertEqual(
            list(refund.allocations.order_by("position").values_list("amount", flat=True)),
            [Decimal("15.00"), Decimal("15.00")],
        )

    def test_category_merge_collapses_matching_parts_and_undo_restores_the_split(self):
        replace_transaction_allocations(self.movement, self.split(), expected_revision=0)
        balance = account_balance(self.account)
        merge = self.client.post(
            reverse("api_category_merge"),
            data=json.dumps({"source_ids": [self.travel.pk], "destination_id": self.food.pk}),
            content_type="application/json",
        )
        operation_id = merge.json()["operation"]["id"]

        self.assertEqual(merge.status_code, 200, merge.content)
        self.movement.refresh_from_db()
        self.assertEqual(self.movement.category_id, self.food.pk)
        self.assertFalse(self.movement.allocations.exists())
        self.assertEqual(account_balance(self.account), balance)

        undone = self.client.post(reverse("api_category_merge_undo", args=[operation_id]))

        self.assertEqual(undone.status_code, 200, undone.content)
        self.movement.refresh_from_db()
        self.assertIsNone(self.movement.category_id)
        self.assertEqual(
            list(self.movement.allocations.order_by("position").values_list("category_id", "amount")),
            [(self.food.pk, Decimal("60.00")), (self.travel.pk, Decimal("40.00"))],
        )
        self.travel.refresh_from_db()
        self.assertTrue(self.travel.active)
        self.assertEqual(account_balance(self.account), balance)

    def test_category_merge_undo_skips_split_restore_after_parent_amount_changes(self):
        replace_transaction_allocations(self.movement, self.split(), expected_revision=0)
        merge = self.client.post(
            reverse("api_category_merge"),
            data=json.dumps({"source_ids": [self.travel.pk], "destination_id": self.food.pk}),
            content_type="application/json",
        )
        self.assertEqual(merge.status_code, 200, merge.content)
        operation_id = merge.json()["operation"]["id"]

        changed = self.client.patch(
            reverse("api_transaction_detail", args=[self.movement.pk]),
            data=json.dumps({"amount": "150.00"}),
            content_type="application/json",
        )
        self.assertEqual(changed.status_code, 200, changed.content)

        undone = self.client.post(reverse("api_category_merge_undo", args=[operation_id]))

        self.assertEqual(undone.status_code, 200, undone.content)
        self.assertTrue(undone.json()["partial"])
        self.movement.refresh_from_db()
        self.assertEqual(self.movement.amount, Decimal("150.00"))
        self.assertEqual(self.movement.category_id, self.food.pk)
        self.assertFalse(self.movement.allocations.exists())
        self.assertEqual(account_balance(self.account), Decimal("850.00"))

    def test_single_category_legacy_refunds_keep_the_original_attribution(self):
        refund = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("25.00"),
            date=self.movement.date,
            description="Devolución legacy",
            category=self.salary,
            refund_for=self.movement,
        )

        allocation = allocate_refunds([refund])[0]

        self.assertFalse(allocation.split_expense)
        self.assertEqual(allocation.category_applied, ((self.food.pk, Decimal("25.00")),))
        self.assertEqual(allocation.extra_by_category, ())

    def test_category_totals_and_reporting_bases_use_parts_without_double_counting(self):
        replace_transaction_allocations(self.movement, self.split(), expected_revision=0)
        self.travel.exclude_from_analytics = True
        self.travel.save(update_fields=["exclude_from_analytics"])
        date_from = date_to = self.movement.date

        all_categories = {item["category_id"]: item["total"] for item in category_totals(date_from, date_to, basis="all")}
        included = transaction_totals(date_from, date_to, basis="analytics")
        excluded = transaction_totals(date_from, date_to, basis="excluded")
        all_totals = transaction_totals(date_from, date_to, basis="all")

        self.assertEqual(all_categories, {self.food.pk: Decimal("60.00"), self.travel.pk: Decimal("40.00")})
        self.assertEqual(included["gross_expense"], Decimal("60.00"))
        self.assertEqual(excluded["gross_expense"], Decimal("40.00"))
        self.assertEqual(all_totals["gross_expense"], Decimal("100.00"))

    def test_split_refunds_follow_purchase_categories_and_respect_exclusions(self):
        replace_transaction_allocations(self.movement, self.split(), expected_revision=0)
        self.travel.exclude_from_analytics = True
        self.travel.save(update_fields=["exclude_from_analytics"])
        Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("25.00"),
            date=self.movement.date,
            description="Reembolso parcial",
            category=self.salary,
            refund_for=self.movement,
        )

        all_totals = transaction_totals(self.movement.date, self.movement.date, basis="all")
        included = transaction_totals(self.movement.date, self.movement.date, basis="analytics")
        excluded = transaction_totals(self.movement.date, self.movement.date, basis="excluded")
        all_categories = {item["category_id"]: item["total"] for item in category_totals(self.movement.date, self.movement.date, basis="all")}

        self.assertEqual(all_totals["refunds"], Decimal("25.00"))
        self.assertEqual(included["refunds"], Decimal("15.00"))
        self.assertEqual(excluded["refunds"], Decimal("10.00"))
        self.assertEqual(all_categories, {self.food.pk: Decimal("45.00"), self.travel.pk: Decimal("30.00")})

    def test_csv_reopen_archives_and_reactivates_the_same_split_transaction(self):
        self.movement.source = Transaction.Source.CSV
        self.movement.save(update_fields=["source", "updated_at"])
        replace_transaction_allocations(self.movement, self.split(), expected_revision=0)
        batch = ImportBatch.objects.create(filename="partidas.csv", account=self.account)
        row = ImportRow.objects.create(
            batch=batch,
            row_number=2,
            date=self.movement.date,
            description=self.movement.description,
            amount=self.movement.amount,
            kind=Category.Kind.EXPENSE,
            fingerprint=self.movement.fingerprint,
            status=ImportRow.Status.IMPORTED,
            transaction=self.movement,
        )
        movement_id = self.movement.pk
        balance_with_purchase = account_balance(self.account)

        reopened = reopen_imported_transaction(self.movement)
        self.movement.refresh_from_db()
        row.refresh_from_db()
        balance_without_purchase = account_balance(self.account)
        self.assertTrue(self.movement.archived)
        self.assertEqual(row.status, ImportRow.Status.PENDING)
        self.assertEqual(row.transaction_id, movement_id)
        reimported = confirm_import_row(row)

        self.assertEqual(reopened["removed"], [movement_id])
        self.assertTrue(self.movement.archived)
        self.assertEqual(row.transaction_id, movement_id)
        self.assertEqual(balance_without_purchase, balance_with_purchase + Decimal("100.00"))
        self.assertEqual(reimported.pk, movement_id)
        self.assertFalse(reimported.archived)
        self.assertEqual(Transaction.objects.count(), 1)
        row.refresh_from_db()
        self.assertEqual(row.status, ImportRow.Status.IMPORTED)
        self.assertEqual(list(reimported.allocations.order_by("position").values_list("category_id", "amount")), [
            (self.food.pk, Decimal("60.00")), (self.travel.pk, Decimal("40.00")),
        ])
        self.assertEqual(account_balance(self.account), balance_with_purchase)

    def test_bank_reopen_archives_and_reconfirms_the_same_split_transaction(self):
        self.movement.source = Transaction.Source.ENABLE_BANKING
        self.movement.save(update_fields=["source", "updated_at"])
        replace_transaction_allocations(self.movement, self.split(), expected_revision=0)
        connection = BankConnection.objects.create(bank_name="Banco partidas", session_id="partidas-bank-session")
        bank_account = BankAccount.objects.create(
            connection=connection,
            account=self.account,
            remote_uid="partidas-bank-account",
            display_name="Cuenta partidas",
        )
        row = BankTransaction.objects.create(
            bank_account=bank_account,
            remote_id="partidas-bank-row",
            booking_date=self.movement.date,
            description=self.movement.description,
            amount=self.movement.amount,
            kind=Category.Kind.EXPENSE,
            fingerprint=self.movement.fingerprint,
            status=BankTransaction.Status.IMPORTED,
            transaction=self.movement,
        )
        movement_id = self.movement.pk
        balance_with_purchase = account_balance(self.account)

        reopened = reopen_imported_transaction(self.movement)
        row.refresh_from_db()
        self.movement.refresh_from_db()
        balance_without_purchase = account_balance(self.account)
        self.assertEqual(row.status, BankTransaction.Status.PENDING)
        self.assertEqual(row.transaction_id, movement_id)
        self.assertTrue(self.movement.archived)
        reimported = confirm_bank_transaction(row)

        self.assertEqual(reopened["removed"], [movement_id])
        self.assertEqual(row.transaction_id, movement_id)
        self.assertEqual(balance_without_purchase, balance_with_purchase + Decimal("100.00"))
        self.assertEqual(reimported.pk, movement_id)
        self.assertFalse(reimported.archived)
        row.refresh_from_db()
        self.assertEqual(row.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(list(reimported.allocations.order_by("position").values_list("category_id", "amount")), [
            (self.food.pk, Decimal("60.00")), (self.travel.pk, Decimal("40.00")),
        ])
        self.assertEqual(account_balance(self.account), balance_with_purchase)

    def test_reopened_bank_split_is_described_and_reconfirmed_through_review_api(self):
        self.movement.source = Transaction.Source.ENABLE_BANKING
        self.movement.save(update_fields=["source", "updated_at"])
        replace_transaction_allocations(self.movement, self.split(), expected_revision=0)
        connection = BankConnection.objects.create(bank_name="Banco Review partidas", session_id="review-split-session")
        bank_account = BankAccount.objects.create(
            connection=connection,
            account=self.account,
            remote_uid="review-split-account",
            display_name="Cuenta partidas Review",
        )
        row = BankTransaction.objects.create(
            bank_account=bank_account,
            remote_id="review-split-row",
            booking_date=self.movement.date,
            description=self.movement.description,
            amount=self.movement.amount,
            kind=Category.Kind.EXPENSE,
            fingerprint=self.movement.fingerprint,
            status=BankTransaction.Status.IMPORTED,
            transaction=self.movement,
        )
        movement_id = self.movement.pk
        balance_with_purchase = account_balance(self.account)

        reopened = self.client.post(reverse("api_transaction_reopen", args=[movement_id]))
        bank_review = self.client.get(reverse("api_bank_review"))

        self.assertEqual(reopened.status_code, 200, reopened.content)
        self.assertEqual(bank_review.status_code, 200, bank_review.content)
        reviewed_row = next(item for item in bank_review.json()["rows"] if item["id"] == row.pk)
        self.assertEqual(reviewed_row["category"], None)
        self.assertEqual(reviewed_row["reopened_split"]["transaction_id"], movement_id)
        self.assertEqual(
            [(part["category"]["name"], part["amount"]) for part in reviewed_row["reopened_split"]["allocations"]],
            [(self.food.name, 60.0), (self.travel.name, 40.0)],
        )
        self.assertEqual(account_balance(self.account), balance_with_purchase + Decimal("100.00"))

        confirmed = self.client.post(
            reverse("api_bank_review_action", args=[row.pk, "confirm"]),
            data=json.dumps({"category": "", "refund_for": "", "remember_category": False}),
            content_type="application/json",
        )

        self.assertEqual(confirmed.status_code, 200, confirmed.content)
        self.movement.refresh_from_db()
        row.refresh_from_db()
        self.assertEqual(row.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(row.transaction_id, movement_id)
        self.assertFalse(self.movement.archived)
        self.assertEqual(self.movement.category_id, None)
        self.assertEqual(list(self.movement.allocations.order_by("position").values_list("category_id", "amount")), [
            (self.food.pk, Decimal("60.00")), (self.travel.pk, Decimal("40.00")),
        ])
        self.assertEqual(account_balance(self.account), balance_with_purchase)

    def test_reopened_bank_split_refund_preserves_its_purchase_link(self):
        self.movement.source = Transaction.Source.ENABLE_BANKING
        self.movement.save(update_fields=["source", "updated_at"])
        replace_transaction_allocations(self.movement, self.split(), expected_revision=0)
        other_income = Category.objects.create(name="Compensación", kind=Category.Kind.INCOME)
        refund = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("130.00"),
            date=self.movement.date,
            description="Reembolso bancario repartido",
            category=self.salary,
            refund_for=self.movement,
            source=Transaction.Source.ENABLE_BANKING,
        )
        replace_transaction_allocations(refund, [
            {"category_id": self.salary.pk, "amount": "65.00"},
            {"category_id": other_income.pk, "amount": "65.00"},
        ], expected_revision=0)
        connection = BankConnection.objects.create(bank_name="Banco reembolso", session_id="bank-split-refund-session")
        bank_account = BankAccount.objects.create(
            connection=connection,
            account=self.account,
            remote_uid="bank-split-refund-account",
            display_name="Cuenta reembolso",
        )
        row = BankTransaction.objects.create(
            bank_account=bank_account,
            remote_id="bank-split-refund-row",
            booking_date=refund.date,
            description=refund.description,
            amount=refund.amount,
            kind=Category.Kind.INCOME,
            fingerprint=refund.fingerprint,
            status=BankTransaction.Status.IMPORTED,
            transaction=refund,
        )
        other_purchase = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("25.00"),
            date=self.movement.date,
            description="Otra compra",
            category=self.food,
        )
        balance_before_reopen = account_balance(self.account)
        confirm_url = reverse("api_bank_review_action", args=[row.pk, "confirm"])

        def post_confirm(payload):
            return self.client.post(
                confirm_url,
                data=json.dumps(payload),
                content_type="application/json",
            )

        reopened = self.client.post(reverse("api_transaction_reopen", args=[refund.pk]))
        review = self.client.get(reverse("api_bank_review"))
        reviewed_row = next(item for item in review.json()["rows"] if item["id"] == row.pk)

        self.assertEqual(reopened.status_code, 200, reopened.content)
        self.assertEqual(review.status_code, 200, review.content)
        self.assertEqual(reviewed_row["reopened_refund"], {
            "id": self.movement.pk,
            "date": self.movement.date.isoformat(),
            "description": self.movement.description,
        })
        self.assertEqual([part["amount"] for part in reviewed_row["reopened_split"]["allocations"]], [65.0, 65.0])
        self.assertEqual(account_balance(self.account), balance_before_reopen - Decimal("130.00"))

        unlink_while_pending = post_confirm({"category": "", "refund_for": "", "remember_category": False})
        null_link_while_pending = post_confirm({"category": "", "refund_for": None, "remember_category": False})
        different_target_while_pending = post_confirm({
            "category": "",
            "refund_for": other_purchase.pk,
            "remember_category": False,
        })
        for rejected in (unlink_while_pending, null_link_while_pending, different_target_while_pending):
            self.assertEqual(rejected.status_code, 409, rejected.content)
            self.assertNotIn("removed", rejected.json())
        refund.refresh_from_db()
        row.refresh_from_db()
        self.assertTrue(refund.archived)
        self.assertEqual(row.status, BankTransaction.Status.PENDING)
        self.assertEqual(refund.refund_for_id, self.movement.pk)

        confirmed = post_confirm({"category": "", "remember_category": False})

        self.assertEqual(confirmed.status_code, 200, confirmed.content)
        refund.refresh_from_db()
        row.refresh_from_db()
        self.assertEqual(row.transaction_id, refund.pk)
        self.assertEqual(refund.refund_for_id, self.movement.pk)
        self.assertFalse(refund.archived)
        self.assertEqual(
            list(refund.allocations.order_by("position").values_list("category_id", "amount")),
            [(self.salary.pk, Decimal("65.00")), (other_income.pk, Decimal("65.00"))],
        )
        allocation = allocate_refunds([refund])[0]
        self.assertEqual(allocation.applied, Decimal("100.00"))
        self.assertEqual(allocation.extra, Decimal("30.00"))
        self.assertEqual(account_balance(self.account), balance_before_reopen)

        reopened_again = self.client.post(reverse("api_transaction_reopen", args=[refund.pk]))
        same_target_pending_retry = post_confirm({"category": "", "refund_for": str(self.movement.pk), "remember_category": False})
        self.assertEqual(reopened_again.status_code, 200, reopened_again.content)
        self.assertEqual(same_target_pending_retry.status_code, 200, same_target_pending_retry.content)
        refund.refresh_from_db()
        row.refresh_from_db()
        self.assertFalse(refund.archived)
        self.assertEqual(row.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(refund.refund_for_id, self.movement.pk)

        unlink_after_import = post_confirm({"category": "", "refund_for": "", "remember_category": False})
        null_link_after_import = post_confirm({"category": "", "refund_for": None, "remember_category": False})
        different_target_after_import = post_confirm({
            "category": "",
            "refund_for": other_purchase.pk,
            "remember_category": False,
        })
        same_target_retry = post_confirm({"category": "", "refund_for": str(self.movement.pk), "remember_category": False})
        omitted_target_retry = post_confirm({"category": "", "remember_category": False})
        for rejected in (unlink_after_import, null_link_after_import, different_target_after_import):
            self.assertEqual(rejected.status_code, 409, rejected.content)
            self.assertNotIn("removed", rejected.json())
        self.assertEqual(same_target_retry.status_code, 200, same_target_retry.content)
        self.assertEqual(omitted_target_retry.status_code, 200, omitted_target_retry.content)
        refund.refresh_from_db()
        self.assertEqual(refund.refund_for_id, self.movement.pk)

    def test_reopened_bank_split_is_ignored_by_prediction_and_category_rules_until_reconfirmed(self):
        self.movement.source = Transaction.Source.ENABLE_BANKING
        self.movement.save(update_fields=["source", "updated_at"])
        replace_transaction_allocations(self.movement, self.split(), expected_revision=0)
        connection = BankConnection.objects.create(bank_name="Banco reglas partidas", session_id="rule-split-bank")
        bank_account = BankAccount.objects.create(
            connection=connection,
            account=self.account,
            remote_uid="rule-split-bank-account",
            display_name="Cuenta reglas partidas",
        )
        row = BankTransaction.objects.create(
            bank_account=bank_account,
            remote_id="rule-split-bank-row",
            booking_date=self.movement.date,
            description=self.movement.description,
            amount=self.movement.amount,
            kind=Category.Kind.EXPENSE,
            fingerprint=self.movement.fingerprint,
            status=BankTransaction.Status.IMPORTED,
            transaction=self.movement,
        )

        reopened = self.client.post(reverse("api_transaction_reopen", args=[self.movement.pk]))
        rule = CategoryRule.objects.create(description=self.movement.description, kind=Category.Kind.EXPENSE, category=self.travel)
        row.refresh_from_db()
        predict_category(row, request_func=lambda _payload: self.fail("No debe predecirse la categoría de un reparto reabierto."))
        row.refresh_from_db()
        review = self.client.get(reverse("api_bank_review"))
        preview = self.client.post(reverse("api_category_rule_preview", args=[rule.pk]))
        applied = self.client.post(reverse("api_category_rule_apply", args=[rule.pk]))

        self.assertEqual(reopened.status_code, 200, reopened.content)
        self.assertEqual(row.category_id, None)
        self.assertEqual(preview.json()["result"]["bank_rows"], 0)
        self.assertEqual(applied.json()["result"]["bank_rows"], 0)
        reviewed_row = next(item for item in review.json()["rows"] if item["id"] == row.pk)
        self.assertIsNone(reviewed_row["category"])
        self.assertIsNone(reviewed_row["suggested_category"])
        self.assertIsNone(reviewed_row["prediction"])
        self.assertEqual(reviewed_row["category_rule_matches"], [])

        confirmed = self.client.post(
            reverse("api_bank_review_action", args=[row.pk, "confirm"]),
            data=json.dumps({"category": "", "refund_for": "", "remember_category": False}),
            content_type="application/json",
        )

        self.assertEqual(confirmed.status_code, 200, confirmed.content)
        self.movement.refresh_from_db()
        row.refresh_from_db()
        self.assertFalse(self.movement.archived)
        self.assertEqual(row.status, BankTransaction.Status.IMPORTED)
        self.assertIsNone(row.category_id)
        self.assertEqual(
            list(self.movement.allocations.order_by("position").values_list("category_id", "amount")),
            [(self.food.pk, Decimal("60.00")), (self.travel.pk, Decimal("40.00"))],
        )

    def test_reopened_csv_split_is_ignored_by_category_rules_and_reconfirmed(self):
        self.movement.source = Transaction.Source.CSV
        self.movement.save(update_fields=["source", "updated_at"])
        replace_transaction_allocations(self.movement, self.split(), expected_revision=0)
        batch = ImportBatch.objects.create(filename="reglas-partidas.csv", account=self.account)
        row = ImportRow.objects.create(
            batch=batch,
            row_number=2,
            date=self.movement.date,
            description=self.movement.description,
            amount=self.movement.amount,
            kind=Category.Kind.EXPENSE,
            fingerprint=self.movement.fingerprint,
            status=ImportRow.Status.IMPORTED,
            transaction=self.movement,
        )

        reopened = self.client.post(reverse("api_transaction_reopen", args=[self.movement.pk]))
        rule = CategoryRule.objects.create(description=self.movement.description, kind=Category.Kind.EXPENSE, category=self.travel)
        rows = self.client.get(reverse("api_import_rows", args=[batch.pk]))
        preview = self.client.post(reverse("api_category_rule_preview", args=[rule.pk]))
        applied = self.client.post(reverse("api_category_rule_apply", args=[rule.pk]))
        row.refresh_from_db()

        self.assertEqual(reopened.status_code, 200, reopened.content)
        self.assertEqual(preview.json()["result"]["csv_rows"], 0)
        self.assertEqual(applied.json()["result"]["csv_rows"], 0)
        reviewed_row = rows.json()["results"][0]
        self.assertEqual(reviewed_row["category"], None)
        self.assertEqual(reviewed_row["category_rule_matches"], [])
        self.assertEqual(reviewed_row["reopened_split"]["transaction_id"], self.movement.pk)

        confirmed = self.client.post(
            reverse("api_import_row_action", args=[row.pk, "confirm"]),
            data=json.dumps({"category": "", "new_category": "", "new_subcategory": ""}),
            content_type="application/json",
        )

        self.assertEqual(confirmed.status_code, 200, confirmed.content)
        self.movement.refresh_from_db()
        row.refresh_from_db()
        self.assertFalse(self.movement.archived)
        self.assertEqual(row.status, ImportRow.Status.IMPORTED)
        self.assertIsNone(row.category_id)
        self.assertEqual(
            list(self.movement.allocations.order_by("position").values_list("category_id", "amount")),
            [(self.food.pk, Decimal("60.00")), (self.travel.pk, Decimal("40.00"))],
        )


class TransactionAllocationApiTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create(name="Partidas API", opening_balance=Decimal("1000.00"))
        self.food = Category.objects.create(name="Alimentación API", kind=Category.Kind.EXPENSE)
        self.travel = Category.objects.create(name="Transporte API", kind=Category.Kind.EXPENSE)

    def post(self, payload):
        return self.client.post(
            reverse("api_transactions"),
            data=json.dumps(payload),
            content_type="application/json",
        )

    def create_payload(self, **overrides):
        return {
            "kind": Transaction.Kind.EXPENSE,
            "amount": "100.00",
            "account": self.account.pk,
            "date": date(2026, 10, 23).isoformat(),
            "description": "Compra por partidas",
            "category": "",
            **overrides,
        }

    def test_create_split_returns_rows_but_keeps_one_transaction_and_one_balance_effect(self):
        response = self.post(self.create_payload(allocations=[
            {"category_id": self.food.pk, "amount": "60.00"},
            {"category_id": self.travel.pk, "amount": "40.00"},
        ]))

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Transaction.objects.count(), 1)
        movement = Transaction.objects.get()
        self.assertEqual(movement.amount, Decimal("100.00"))
        self.assertIsNone(movement.category_id)
        self.assertEqual(movement.allocations.count(), 2)
        self.assertEqual(account_balance(self.account), Decimal("900.00"))
        self.assertEqual(response.json()["transaction"]["allocation_revision"], 1)
        self.assertEqual(
            [item["amount"] for item in response.json()["transaction"]["allocations"]],
            [60.0, 40.0],
        )

    def test_category_catalog_and_ledger_filter_include_split_rows_once(self):
        created = self.post(self.create_payload(allocations=[
            {"category_id": self.food.pk, "amount": "60.00"},
            {"category_id": self.travel.pk, "amount": "40.00"},
        ]))
        self.assertEqual(created.status_code, 201)

        food_catalog = self.client.get(reverse("api_categories")).json()
        food = next(item for item in food_catalog["categories"] if item["id"] == self.food.pk)
        filtered = self.client.get(reverse("api_transactions"), {"category": self.travel.pk}).json()
        unused = self.client.get(reverse("api_category_unused")).json()

        self.assertEqual(food["transaction_count"], 1)
        self.assertEqual(filtered["count"], 1)
        self.assertEqual(filtered["results"][0]["id"], created.json()["transaction"]["id"])
        self.assertNotIn(self.food.pk, {item["id"] for item in unused["categories"]})
        self.assertNotIn(self.travel.pk, {item["id"] for item in unused["categories"]})

    def test_legacy_and_single_category_requests_keep_the_legacy_response_shape(self):
        legacy = self.post(self.create_payload(category=self.food.pk))
        explicit_single = self.post(self.create_payload(
            description="Una partida",
            allocations=[{"category_id": self.travel.pk, "amount": "100.00"}],
        ))

        self.assertEqual(legacy.status_code, 201, legacy.content)
        self.assertEqual(explicit_single.status_code, 201, explicit_single.content)
        self.assertNotIn("allocations", legacy.json()["transaction"])
        self.assertNotIn("allocations", explicit_single.json()["transaction"])
        self.assertEqual(Transaction.objects.filter(allocations__isnull=False).count(), 0)
        self.assertEqual(Transaction.objects.filter(category=self.food).count(), 1)
        self.assertEqual(Transaction.objects.filter(category=self.travel).count(), 1)

    def test_invalid_split_is_rejected_before_any_ledger_write(self):
        response = self.post(self.create_payload(allocations=[
            {"category_id": self.food.pk, "amount": "99.98"},
            {"category_id": self.travel.pk, "amount": "0.01"},
        ]))
        oversized = self.post(self.create_payload(allocations=[
            {"category_id": self.food.pk, "amount": "1e1000"},
        ]))

        self.assertEqual(response.status_code, 400)
        self.assertIn("coincidir exactamente", response.json()["error"])
        self.assertEqual(oversized.status_code, 400, oversized.content)
        self.assertIn("importe positivo", oversized.json()["error"])
        self.assertEqual(Transaction.objects.count(), 0)

    def test_patch_uses_allocation_revision_and_exact_retry_is_idempotent(self):
        created = self.post(self.create_payload(allocations=[
            {"category_id": self.food.pk, "amount": "60.00"},
            {"category_id": self.travel.pk, "amount": "40.00"},
        ]))
        transaction_id = created.json()["transaction"]["id"]
        url = reverse("api_transaction_detail", args=[transaction_id])
        changed = [
            {"category_id": self.food.pk, "amount": "50.00"},
            {"category_id": self.travel.pk, "amount": "50.00"},
        ]
        payload = {"allocations": changed, "expected_allocation_revision": 1}

        accepted = self.client.patch(url, data=json.dumps(payload), content_type="application/json")
        exact_retry = self.client.patch(url, data=json.dumps(payload), content_type="application/json")
        stale_payload = {
            "allocations": [
                {"category_id": self.food.pk, "amount": "40.00"},
                {"category_id": self.travel.pk, "amount": "60.00"},
            ],
            "expected_allocation_revision": 1,
        }
        stale = self.client.patch(url, data=json.dumps(stale_payload), content_type="application/json")

        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.assertEqual(exact_retry.status_code, 200, exact_retry.content)
        self.assertEqual(exact_retry.json()["transaction"]["allocation_revision"], 2)
        self.assertEqual(stale.status_code, 409, stale.content)
        self.assertEqual(
            list(TransactionAllocation.objects.order_by("position").values_list("amount", flat=True)),
            [Decimal("50.00"), Decimal("50.00")],
        )

    def test_split_rejects_parent_amount_category_or_kind_changes_without_allocations(self):
        created = self.post(self.create_payload(allocations=[
            {"category_id": self.food.pk, "amount": "60.00"},
            {"category_id": self.travel.pk, "amount": "40.00"},
        ]))
        transaction_id = created.json()["transaction"]["id"]
        url = reverse("api_transaction_detail", args=[transaction_id])
        changed_payloads = (
            {"amount": "150.00"},
            {"category": self.travel.pk},
            {"kind": Transaction.Kind.INCOME},
        )

        for payload in changed_payloads:
            with self.subTest(payload=payload):
                response = self.client.patch(url, data=json.dumps(payload), content_type="application/json")

                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("Incluye allocations", response.json()["error"])
                movement = Transaction.objects.get(pk=transaction_id)
                self.assertEqual(movement.kind, Transaction.Kind.EXPENSE)
                self.assertEqual(movement.amount, Decimal("100.00"))
                self.assertIsNone(movement.category_id)
                self.assertEqual(
                    list(movement.allocations.order_by("position").values_list("amount", flat=True)),
                    [Decimal("60.00"), Decimal("40.00")],
                )
                self.assertEqual(account_balance(self.account), Decimal("900.00"))
