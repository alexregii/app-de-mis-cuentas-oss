from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase

from .financial_read_models import (
    _coalesce_months,
    rebuild_dirty_financial_aggregates,
    recompute_monthly_financial_aggregates,
)
from .models import Account, Category, MonthlyFinancialAggregate, Transaction
from .services import transaction_totals
from .statistics import statistics_report
from .transaction_allocations import replace_transaction_allocations


class FinancialReadModelTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create(name="Read model account")
        self.expense_family = Category.objects.create(name="Casa", kind=Category.Kind.EXPENSE, color="#ff0000")
        self.food = Category.objects.create(name="Comida", kind=Category.Kind.EXPENSE, parent=self.expense_family, color="#00ff00")
        self.excluded = Category.objects.create(name="Privado", kind=Category.Kind.EXPENSE, exclude_from_analytics=True)
        self.income = Category.objects.create(name="Salario", kind=Category.Kind.INCOME, color="#0000ff")
        for index in range(36):
            current_date = date(2025, 1, 1) + timedelta(days=index * 12)
            Transaction.objects.create(
                account=self.account,
                kind=Transaction.Kind.INCOME if index % 4 == 0 else Transaction.Kind.EXPENSE,
                amount=Decimal("100.00") + index,
                date=current_date,
                description=f"Movimiento {index}",
                category=self.income if index % 4 == 0 else self.food if index % 3 else self.excluded,
            )
        self.expense = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("75.00"),
            date=date(2025, 6, 5),
            description="Compra con devolución",
            category=self.food,
        )
        Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("25.00"),
            date=date(2025, 6, 20),
            description="Devolución",
            category=self.income,
            refund_for=self.expense,
        )

    def test_read_model_matches_fallback_for_both_bases(self):
        for basis in ("analytics", "all"):
            baseline = statistics_report(date(2025, 1, 1), date(2026, 6, 15), basis)
            recompute_monthly_financial_aggregates(date(2024, 1, 1), date(2026, 6, 15))
            self.assertEqual(baseline, statistics_report(date(2025, 1, 1), date(2026, 6, 15), basis))

    def test_transaction_change_marks_affected_month_dirty(self):
        recompute_monthly_financial_aggregates(date(2024, 1, 1), date(2026, 6, 15))
        aggregate = MonthlyFinancialAggregate.objects.get(month=date(2025, 6, 1), basis="analytics")
        Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("12.00"),
            date=date(2025, 6, 8),
            description="Cambio posterior",
            category=self.food,
        )

        aggregate.refresh_from_db()
        self.assertTrue(aggregate.dirty)
        self.assertEqual(aggregate.dirty_version, 1)

    def test_split_categories_and_partial_refunds_match_fallback_for_both_bases(self):
        split_expense = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("100.00"),
            date=date(2025, 6, 12),
            description="Compra repartida",
            category=None,
        )
        other = Category.objects.create(name="Transporte", kind=Category.Kind.EXPENSE)
        replace_transaction_allocations(split_expense, [
            {"category_id": self.food.pk, "amount": "60.00"},
            {"category_id": self.excluded.pk, "amount": "25.00"},
            {"category_id": other.pk, "amount": "15.00"},
        ], expected_revision=0)
        Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("25.00"),
            date=date(2025, 6, 20),
            description="Devolución repartida",
            category=self.income,
            refund_for=split_expense,
        )
        expected = {
            basis: statistics_report(date(2025, 6, 1), date(2025, 6, 30), basis)
            for basis in ("analytics", "all")
        }

        recompute_monthly_financial_aggregates(date(2025, 6, 1), date(2025, 6, 30))

        for basis in ("analytics", "all"):
            actual = statistics_report(date(2025, 6, 1), date(2025, 6, 30), basis)
            self.assertEqual(expected[basis]["summary"], actual["summary"], msg=f"summary mismatch for {basis}")
            self.assertEqual(expected[basis]["categories"], actual["categories"], msg=f"category mismatch for {basis}")
            differing = [key for key in expected[basis] if expected[basis][key] != actual[key]]
            self.assertFalse(differing, msg=f"full report mismatch for {basis}: {differing}")

    def test_late_multiple_split_refunds_restate_purchase_month_and_put_excess_in_refund_month(self):
        transport = Category.objects.create(name="Transporte tardío", kind=Category.Kind.EXPENSE)
        purchase = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("100.00"),
            date=date(2025, 6, 25),
            description="Compra junio repartida",
        )
        replace_transaction_allocations(purchase, [
            {"category_id": self.food.pk, "amount": "60.00"},
            {"category_id": transport.pk, "amount": "40.00"},
        ])
        for tx_date, amount, description in (
            (date(2025, 7, 2), "30.00", "Reembolso parcial tardío"),
            (date(2025, 7, 9), "80.00", "Reembolso con exceso"),
        ):
            Transaction.objects.create(
                account=self.account,
                kind=Transaction.Kind.INCOME,
                amount=Decimal(amount),
                date=tx_date,
                description=description,
                category=self.income,
                refund_for=purchase,
            )
        june_range = (date(2025, 6, 1), date(2025, 6, 30))
        july_range = (date(2025, 7, 1), date(2025, 7, 31))
        expected = {
            "june": statistics_report(*june_range, "all"),
            "july": statistics_report(*july_range, "all"),
        }
        recompute_monthly_financial_aggregates(date(2025, 6, 1), date(2025, 7, 31))

        self.assertEqual(expected["june"], statistics_report(*june_range, "all"))
        self.assertEqual(expected["july"], statistics_report(*july_range, "all"))
        self.assertEqual(expected["june"]["summary"]["net_expense"], Decimal("392.00"))
        self.assertEqual(expected["july"]["summary"]["income"], Decimal("126.00"))

    def test_split_refund_excess_follows_refund_category_and_allocation_edits_dirty_refund_month(self):
        private_food = Category.objects.create(
            name="Privado comida devolución",
            kind=Category.Kind.EXPENSE,
            exclude_from_analytics=True,
        )
        private_travel = Category.objects.create(
            name="Privado transporte devolución",
            kind=Category.Kind.EXPENSE,
            exclude_from_analytics=True,
        )
        included_travel = Category.objects.create(name="Transporte devolución", kind=Category.Kind.EXPENSE)
        private_income = Category.objects.create(
            name="Ingreso privado devolución",
            kind=Category.Kind.INCOME,
            exclude_from_analytics=True,
        )
        june = (date(2026, 6, 1), date(2026, 6, 30))
        july = (date(2026, 7, 1), date(2026, 7, 31))
        all_excluded_purchase = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("100.00"),
            date=date(2026, 6, 12),
            description="Compra excluida repartida",
        )
        replace_transaction_allocations(all_excluded_purchase, [
            {"category_id": private_food.pk, "amount": "60.00"},
            {"category_id": private_travel.pk, "amount": "40.00"},
        ], expected_revision=0)
        Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("130.00"),
            date=date(2026, 7, 2),
            description="Reembolso incluido de compra excluida",
            category=self.income,
            refund_for=all_excluded_purchase,
        )
        all_included_purchase = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("100.00"),
            date=date(2026, 6, 18),
            description="Compra incluida repartida",
        )
        replace_transaction_allocations(all_included_purchase, [
            {"category_id": self.food.pk, "amount": "60.00"},
            {"category_id": included_travel.pk, "amount": "40.00"},
        ], expected_revision=0)
        Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("130.00"),
            date=date(2026, 7, 3),
            description="Reembolso excluido de compra incluida",
            category=private_income,
            refund_for=all_included_purchase,
        )

        fallback_before = {
            basis: statistics_report(*july, basis)
            for basis in ("analytics", "all")
        }
        self.assertEqual(
            {basis: transaction_totals(*july, basis=basis)["income"] for basis in ("analytics", "excluded", "all")},
            {"analytics": Decimal("30.00"), "excluded": Decimal("30.00"), "all": Decimal("60.00")},
        )
        recompute_monthly_financial_aggregates(june[0], july[1])
        for basis in ("analytics", "all"):
            self.assertEqual(fallback_before[basis], statistics_report(*july, basis))

        replace_transaction_allocations(
            all_excluded_purchase,
            [{"category_id": private_food.pk, "amount": "100.00"}],
            expected_revision=1,
        )

        july_aggregates = {
            basis: MonthlyFinancialAggregate.objects.get(month=july[0], basis=basis)
            for basis in ("analytics", "all")
        }
        self.assertTrue(all(aggregate.dirty for aggregate in july_aggregates.values()))
        fallback_after = {
            basis: statistics_report(*july, basis)
            for basis in ("analytics", "all")
        }
        self.assertEqual(
            {basis: transaction_totals(*july, basis=basis)["income"] for basis in ("analytics", "excluded", "all")},
            {"analytics": Decimal("0.00"), "excluded": Decimal("60.00"), "all": Decimal("60.00")},
        )
        recompute_monthly_financial_aggregates(june[0], july[1])
        for basis in ("analytics", "all"):
            self.assertEqual(fallback_after[basis], statistics_report(*july, basis))

    def test_dirty_worker_coalesces_adjacent_months_and_restores_exact_read_model(self):
        start = date(2024, 1, 1)
        end = date(2026, 6, 15)
        recompute_monthly_financial_aggregates(start, end)
        Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("12.00"),
            date=date(2025, 7, 8),
            description="Julio nuevo",
            category=self.food,
        )
        Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("13.00"),
            date=date(2025, 8, 8),
            description="Agosto nuevo",
            category=self.food,
        )
        expected_reports = {
            basis: statistics_report(date(2025, 1, 1), date(2026, 6, 15), basis)
            for basis in ("analytics", "all")
        }

        result = rebuild_dirty_financial_aggregates(limit=24)

        self.assertEqual(result["batches"], 1)
        self.assertEqual(result["months"], 2)
        self.assertEqual(result["rebuilt"], 4)
        self.assertEqual(result["conflicts"], 0)
        self.assertFalse(
            MonthlyFinancialAggregate.objects.filter(month__in=[date(2025, 7, 1), date(2025, 8, 1)], dirty=True).exists()
        )
        for basis in ("analytics", "all"):
            self.assertEqual(expected_reports[basis], statistics_report(date(2025, 1, 1), date(2026, 6, 15), basis))

    def test_dirty_worker_leaves_row_dirty_when_source_version_changes_during_rebuild(self):
        start = date(2024, 1, 1)
        end = date(2026, 6, 15)
        recompute_monthly_financial_aggregates(start, end)
        aggregate = MonthlyFinancialAggregate.objects.get(month=date(2025, 6, 1), basis="analytics")
        expected = {(aggregate.month, aggregate.basis): aggregate.dirty_version}
        aggregate.dirty = True
        aggregate.dirty_version += 1
        aggregate.save(update_fields=["dirty", "dirty_version"])

        result = recompute_monthly_financial_aggregates(
            aggregate.month,
            aggregate.month,
            expected_versions=expected,
        )

        self.assertEqual(result["rebuilt"], 0)
        self.assertEqual(result["conflicts"], 1)
        aggregate.refresh_from_db()
        self.assertTrue(aggregate.dirty)

    def test_coalesce_months_only_merges_contiguous_months(self):
        self.assertEqual(
            _coalesce_months(
                [date(2025, 1, 15), date(2025, 2, 1), date(2025, 4, 20), date(2025, 6, 1)]
            ),
            [(date(2025, 1, 1), date(2025, 2, 1)), (date(2025, 4, 1), date(2025, 4, 1)), (date(2025, 6, 1), date(2025, 6, 1))],
        )
