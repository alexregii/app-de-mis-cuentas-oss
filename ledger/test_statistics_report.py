import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from urllib.parse import parse_qs, urlparse

from django.core.exceptions import ValidationError
from django.db import connection
from django.test import SimpleTestCase, TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone

from .models import (
    Account,
    BankAccount,
    BankConnection,
    BankTransaction,
    Category,
    CategoryRule,
    ImportBatch,
    ImportProfile,
    ImportRow,
    RecurringRule,
    Transaction,
)
from .services import last_day_of_month, month_bounds, shift_month
from .statistics import (
    StatisticsRangeError,
    month_end,
    month_start,
    shift_month as statistics_shift_month,
    statistics_month_report,
    statistics_report,
    statistics_report_drilldown,
    validate_statistics_range,
)
from .transaction_services import create_transfer


class MonthBoundaryHelperTests(SimpleTestCase):
    def test_month_boundaries_match_for_leap_and_calendar_month_lengths(self):
        cases = (
            (date(2024, 2, 15), date(2024, 2, 1), date(2024, 2, 29)),
            (date(2025, 2, 15), date(2025, 2, 1), date(2025, 2, 28)),
            (date(2025, 4, 15), date(2025, 4, 1), date(2025, 4, 30)),
            (date(2025, 1, 15), date(2025, 1, 1), date(2025, 1, 31)),
        )
        for value, expected_start, expected_end in cases:
            with self.subTest(value=value):
                self.assertEqual(month_start(value), expected_start)
                self.assertEqual(month_end(value), expected_end)
                self.assertEqual(month_bounds(value), (expected_start, expected_end))
                self.assertEqual(last_day_of_month(value), expected_end)

    def test_month_boundaries_preserve_datetime_type_and_time(self):
        value = datetime(2024, 2, 15, 12, 34, 56)

        self.assertEqual(month_start(value), datetime(2024, 2, 1, 12, 34, 56))
        self.assertEqual(month_end(value), datetime(2024, 2, 29, 12, 34, 56))


class StatisticsFixtureMixin:
    @classmethod
    def setUpTestData(cls):
        cls.account = Account.objects.create(name="Principal", opening_balance=Decimal("1000"))
        cls.savings = Account.objects.create(
            name="Ahorro",
            kind=Account.Kind.SAVINGS,
            opening_balance=Decimal("500"),
        )
        cls.expense_family = Category.objects.create(
            name="Hogar",
            kind=Category.Kind.EXPENSE,
            color="#336699",
        )
        cls.expense_child = Category.objects.create(
            name="Supermercado",
            kind=Category.Kind.EXPENSE,
            parent=cls.expense_family,
            color="#6688aa",
        )
        cls.other_expense = Category.objects.create(name="Ocio", kind=Category.Kind.EXPENSE)
        cls.income = Category.objects.create(name="Nómina", kind=Category.Kind.INCOME)
        cls.refund = Category.objects.create(name="Reembolsos", kind=Category.Kind.INCOME)

    def movement(self, *, kind, amount, tx_date, description, category=None, refund_for=None):
        return Transaction.objects.create(
            account=self.account,
            kind=kind,
            amount=Decimal(amount),
            date=tx_date,
            description=description,
            category=category,
            refund_for=refund_for,
        )


class StatisticsServiceTests(StatisticsFixtureMixin, TestCase):
    def test_empty_month_without_source_coverage_is_unknown_not_zero_spend(self):
        self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="40",
            tx_date=date(2026, 1, 10),
            description="Gasto registrado",
            category=self.expense_child,
        )

        report = statistics_report(date(2026, 1, 1), date(2026, 3, 31), "analytics")
        by_month = {point["month"]: point for point in report["monthly_series"]}

        self.assertEqual(report["activity_status"], "recorded")
        self.assertFalse(report["comparison"]["is_comparable"])
        self.assertEqual(by_month["2026-01"]["activity_status"], "recorded")
        self.assertEqual(by_month["2026-01"]["net_expense"], Decimal("40"))
        for month in ("2026-02", "2026-03"):
            self.assertEqual(by_month[month]["activity_status"], "unknown")
            self.assertEqual(by_month[month]["net_expense"], Decimal("0"))
            self.assertIsNone(by_month[month]["expense_change"])

        self.assertEqual(
            [point["activity_status"] for point in report["analysis"]["category_matrix"]["months"]],
            ["recorded", "unknown", "unknown"],
        )
        month_detail = statistics_month_report(2026, 2, date(2026, 1, 1), date(2026, 3, 31), "analytics")
        self.assertEqual(month_detail["activity_status"], "unknown")

    def test_period_without_reportable_activity_is_unknown_for_both_comparison_sides(self):
        report = statistics_report(date(2026, 2, 1), date(2026, 2, 28), "analytics")

        self.assertEqual(report["activity_status"], "unknown")
        self.assertEqual(report["comparison"]["previous_activity_status"], "unknown")
        self.assertFalse(report["comparison"]["is_comparable"])

    def test_drilldown_order_is_stable_with_identical_dates(self):
        first = self.movement(
            kind=Transaction.Kind.EXPENSE, amount="10", tx_date=date(2026, 1, 10),
            description="Primero", category=self.other_expense,
        )
        second = self.movement(
            kind=Transaction.Kind.EXPENSE, amount="20", tx_date=date(2026, 1, 10),
            description="Segundo", category=self.other_expense,
        )
        Transaction.objects.filter(pk__in=[first.pk, second.pk]).update(created_at=first.created_at)

        movements, summary = statistics_report_drilldown(date(2026, 1, 1), date(2026, 1, 31), "analytics")

        self.assertEqual([movement.pk for movement in movements], [second.pk, first.pk])
        self.assertEqual(summary["net_expense"], Decimal("30"))

    def test_split_archive_and_transfer_metamorphisms_preserve_expected_statistics(self):
        start, end = date(2026, 1, 1), date(2026, 1, 31)
        original = self.movement(
            kind=Transaction.Kind.EXPENSE, amount="100", tx_date=date(2026, 1, 10),
            description="Original", category=self.expense_child,
        )
        baseline = statistics_report(start, end, "analytics")["summary"]
        original.archived = True
        original.save(update_fields=["archived"])
        self.movement(kind=Transaction.Kind.EXPENSE, amount="40", tx_date=date(2026, 1, 10), description="Parte A", category=self.expense_child)
        self.movement(kind=Transaction.Kind.EXPENSE, amount="60", tx_date=date(2026, 1, 10), description="Parte B", category=self.expense_child)
        split = statistics_report(start, end, "analytics")["summary"]
        create_transfer(
            source_account=self.account, target_account=self.savings, amount=Decimal("25"),
            tx_date=date(2026, 1, 15), description="Neutral",
        )
        transferred = statistics_report(start, end, "analytics")["summary"]

        self.assertEqual(split, baseline)
        self.assertEqual(transferred, baseline)

    def test_report_keeps_transfers_neutral_and_uses_one_explicit_summary_contract(self):
        start = date(2026, 1, 1)
        end = date(2026, 1, 31)
        self.movement(
            kind=Transaction.Kind.INCOME,
            amount="2000",
            tx_date=start,
            description="Nómina",
            category=self.income,
        )
        self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="500",
            tx_date=start,
            description="Compra",
            category=self.expense_child,
        )
        create_transfer(
            source_account=self.account,
            target_account=self.savings,
            amount=Decimal("700"),
            tx_date=end,
            description="Traspaso neutral",
        )

        report = statistics_report(start, end, "analytics")

        self.assertEqual(
            report["summary"],
            {
                "income": Decimal("2000"),
                "net_expense": Decimal("500"),
                "refunds_applied": Decimal("0"),
                "analytical_result": Decimal("1500"),
                "savings_rate": Decimal("75.0"),
            },
        )
        self.assertNotIn("balance", report)
        self.assertNotIn("projection", report)

    def test_later_partial_refunds_are_capped_and_restate_original_purchase(self):
        purchase = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="100",
            tx_date=date(2026, 1, 10),
            description="Compra devuelta",
            category=self.expense_child,
        )
        self.movement(
            kind=Transaction.Kind.INCOME,
            amount="40",
            tx_date=date(2026, 2, 5),
            description="Reembolso parcial",
            category=self.refund,
            refund_for=purchase,
        )
        self.movement(
            kind=Transaction.Kind.INCOME,
            amount="70",
            tx_date=date(2026, 3, 5),
            description="Reembolso final y exceso",
            category=self.refund,
            refund_for=purchase,
        )

        purchase_month = statistics_report(date(2026, 1, 1), date(2026, 1, 31), "analytics")
        refund_month = statistics_report(date(2026, 3, 1), date(2026, 3, 31), "analytics")

        self.assertEqual(purchase_month["summary"]["refunds_applied"], Decimal("100"))
        self.assertEqual(purchase_month["summary"]["net_expense"], Decimal("0"))
        self.assertEqual(purchase_month["categories"], [])
        self.assertEqual(refund_month["summary"]["income"], Decimal("10"))
        self.assertEqual(refund_month["summary"]["refunds_applied"], Decimal("0"))

    def test_legacy_refund_of_archived_purchase_remains_an_ordinary_refund(self):
        purchase = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="100",
            tx_date=date(2026, 1, 10),
            description="Compra después archivada",
            category=self.expense_child,
        )
        refund = self.movement(
            kind=Transaction.Kind.INCOME,
            amount="40",
            tx_date=date(2026, 2, 10),
            description="Reembolso todavía activo",
            category=self.refund,
            refund_for=purchase,
        )
        Transaction.objects.filter(pk=purchase.pk).update(archived=True)

        report = statistics_report(date(2026, 2, 1), date(2026, 2, 28), "analytics")

        self.assertFalse(Transaction.objects.get(pk=refund.pk).archived)
        self.assertEqual(report["summary"]["income"], Decimal("0"))
        self.assertEqual(report["summary"]["refunds_applied"], Decimal("0"))
        self.assertEqual(report["summary"]["analytical_result"], Decimal("0"))

    def test_refund_before_purchase_is_rejected_and_invalid_history_degrades_to_income(self):
        purchase = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="100",
            tx_date=date(2026, 2, 15),
            description="Compra posterior",
            category=self.expense_child,
        )
        invalid_refund = Transaction(
            account=self.account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("40"),
            date=date(2026, 1, 10),
            description="Reembolso imposible",
            category=self.refund,
            refund_for=purchase,
        )
        with self.assertRaises(ValidationError):
            invalid_refund.full_clean()

        # save() intentionally does not run full_clean: this simulates a legacy
        # row and proves the report remains deterministic instead of returning 500.
        invalid_refund.save()
        refund_month = statistics_report(date(2026, 1, 1), date(2026, 1, 31), "analytics")
        purchase_month = statistics_report(date(2026, 2, 1), date(2026, 2, 28), "analytics")

        self.assertEqual(refund_month["summary"]["income"], Decimal("40"))
        self.assertEqual(purchase_month["summary"]["net_expense"], Decimal("100"))
        self.assertEqual(purchase_month["summary"]["refunds_applied"], Decimal("0"))
        self.assertEqual(purchase_month["categories"][0]["gross_expense"], Decimal("100"))

    def test_legacy_refund_target_with_wrong_kind_degrades_to_income(self):
        purchase = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="100",
            tx_date=date(2026, 1, 10),
            description="Target histórico corrupto",
            category=self.expense_child,
        )
        self.movement(
            kind=Transaction.Kind.INCOME,
            amount="40",
            tx_date=date(2026, 2, 10),
            description="Reembolso del target corrupto",
            category=self.refund,
            refund_for=purchase,
        )
        Transaction.objects.filter(pk=purchase.pk).update(kind=Transaction.Kind.INCOME, category=self.income)

        report = statistics_report(date(2026, 2, 1), date(2026, 2, 28), "analytics")

        self.assertEqual(report["summary"]["income"], Decimal("40"))
        self.assertEqual(report["summary"]["refunds_applied"], Decimal("0"))

    def test_categories_are_grouped_by_family_with_subcategory_net_amounts(self):
        child_purchase = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="100",
            tx_date=date(2026, 4, 3),
            description="Compra hija",
            category=self.expense_child,
        )
        self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="20",
            tx_date=date(2026, 4, 4),
            description="Compra directa",
            category=self.expense_family,
        )
        self.movement(
            kind=Transaction.Kind.INCOME,
            amount="30",
            tx_date=date(2026, 5, 1),
            description="Reembolso posterior",
            category=self.refund,
            refund_for=child_purchase,
        )

        report = statistics_report(date(2026, 4, 1), date(2026, 4, 30), "analytics")
        family = report["categories"][0]
        subcategories = {item["name"]: item for item in family["subcategories"]}

        self.assertEqual(family["family_id"], self.expense_family.pk)
        self.assertEqual(family["family_name"], "Hogar")
        self.assertEqual(family["color"], "#336699")
        self.assertEqual(family["gross_expense"], Decimal("120"))
        self.assertEqual(family["refunds_applied"], Decimal("30"))
        self.assertEqual(family["net_expense"], Decimal("90"))
        self.assertEqual(subcategories["Supermercado"]["net_expense"], Decimal("70"))
        self.assertEqual(subcategories["Sin subcategoría"]["net_expense"], Decimal("20"))

    def test_uncategorized_refund_keeps_category_sum_equal_to_summary(self):
        purchase = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="80",
            tx_date=date(2026, 4, 8),
            description="Compra sin categoría",
        )
        self.movement(
            kind=Transaction.Kind.INCOME,
            amount="25",
            tx_date=date(2026, 5, 2),
            description="Reembolso sin categoría",
            category=self.refund,
            refund_for=purchase,
        )

        report = statistics_report(date(2026, 4, 1), date(2026, 4, 30), "analytics")

        self.assertEqual(report["summary"]["net_expense"], Decimal("55"))
        self.assertEqual(sum(item["net_expense"] for item in report["categories"]), Decimal("55"))
        self.assertEqual(report["categories"][0]["family_id"], None)

    def test_analytics_basis_excludes_marked_categories_everywhere(self):
        excluded = Category.objects.create(
            name="Fuera de análisis",
            kind=Category.Kind.EXPENSE,
            exclude_from_analytics=True,
        )
        tx_date = date(2026, 5, 10)
        self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="90",
            tx_date=tx_date,
            description="Excluido",
            category=excluded,
        )
        self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="10",
            tx_date=tx_date,
            description="Incluido",
            category=self.other_expense,
        )

        analytics = statistics_report(date(2026, 5, 1), date(2026, 5, 31), "analytics")
        complete = statistics_report(date(2026, 5, 1), date(2026, 5, 31), "all")

        self.assertEqual(analytics["summary"]["net_expense"], Decimal("10"))
        self.assertEqual(analytics["monthly_series"][0]["net_expense"], Decimal("10"))
        self.assertEqual(sum(item["net_expense"] for item in analytics["categories"]), Decimal("10"))
        self.assertEqual(complete["summary"]["net_expense"], Decimal("100"))

    def test_savings_rate_and_comparison_percentages_are_null_without_a_base(self):
        report = statistics_report(date(2026, 6, 1), date(2026, 6, 10), "analytics")

        self.assertIsNone(report["summary"]["savings_rate"])
        self.assertIsNone(report["comparison"]["previous"]["savings_rate"])
        self.assertIsNone(report["comparison"]["changes"]["income"]["percentage"])
        self.assertIsNone(report["comparison"]["changes"]["savings_rate"]["percentage_points"])
        self.assertEqual(report["comparison"]["scope"]["date_from"], date(2026, 5, 22))
        self.assertEqual(report["comparison"]["scope"]["date_to"], date(2026, 5, 31))

    def test_analysis_details_keep_refunds_and_transfers_neutral(self):
        for month, amount in ((1, "40"), (2, "50"), (3, "60")):
            self.movement(
                kind=Transaction.Kind.EXPENSE, amount=amount, tx_date=date(2026, month, 10),
                description="Mercado Central", category=self.expense_child,
            )
        uncategorized = self.movement(
            kind=Transaction.Kind.EXPENSE, amount="20", tx_date=date(2026, 3, 12),
            description="Sin clasificar", category=None,
        )
        self.movement(
            kind=Transaction.Kind.INCOME, amount="100", tx_date=date(2026, 3, 1),
            description="Nómina", category=self.income,
        )
        create_transfer(
            source_account=self.account, target_account=self.savings, amount=Decimal("80"),
            tx_date=date(2026, 3, 15), description="Traspaso neutral",
        )

        report = statistics_report(date(2026, 1, 1), date(2026, 3, 31), "analytics")
        analysis = report["analysis"]

        self.assertEqual([item["month"] for item in report["monthly_series"]], ["2026-01", "2026-02", "2026-03"])
        self.assertEqual(report["monthly_series"][1]["expense_change"], Decimal("10"))
        self.assertEqual(report["monthly_series"][2]["result_change"], Decimal("70"))
        self.assertEqual(analysis["merchants"][0]["description"], "Mercado Central")
        self.assertEqual(analysis["merchants"][0]["net_expense"], Decimal("150"))
        self.assertEqual(analysis["recurring"][0]["active_months"], 3)
        self.assertEqual(analysis["category_matrix"]["rows"][0]["net_expense"], Decimal("150"))
        self.assertEqual(report["data_quality"]["uncategorized"], {"count": 1, "net_expense": Decimal("20")})
        self.assertEqual(report["data_quality"]["transfers_excluded"]["count"], 1)
        self.assertNotIn(uncategorized.pk, [item.get("transaction_id") for item in analysis["merchants"]])

    def test_category_drivers_explain_net_change_with_refunds_and_keep_transfers_neutral(self):
        self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="50",
            tx_date=date(2026, 1, 8),
            description="Hogar anterior",
            category=self.expense_child,
        )
        self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="90",
            tx_date=date(2026, 1, 9),
            description="Ocio anterior",
            category=self.other_expense,
        )
        current_purchase = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="180",
            tx_date=date(2026, 2, 8),
            description="Hogar actual",
            category=self.expense_child,
        )
        self.movement(
            kind=Transaction.Kind.INCOME,
            amount="30",
            tx_date=date(2026, 3, 1),
            description="Reembolso posterior",
            category=self.refund,
            refund_for=current_purchase,
        )
        self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="40",
            tx_date=date(2026, 2, 9),
            description="Ocio actual",
            category=self.other_expense,
        )
        create_transfer(
            source_account=self.account,
            target_account=self.savings,
            amount=Decimal("700"),
            tx_date=date(2026, 2, 20),
            description="Traspaso neutral",
        )

        report = statistics_report(date(2026, 2, 1), date(2026, 2, 28), "analytics")
        drivers = report["comparison"]["category_drivers"]

        self.assertEqual(
            drivers,
            [
                {
                    "family_id": self.expense_family.pk,
                    "family_name": "Hogar",
                    "current_net_expense": Decimal("150"),
                    "previous_net_expense": Decimal("50"),
                    "change": Decimal("100"),
                },
                {
                    "family_id": self.other_expense.pk,
                    "family_name": "Ocio",
                    "current_net_expense": Decimal("40"),
                    "previous_net_expense": Decimal("90"),
                    "change": Decimal("-50"),
                },
            ],
        )
        self.assertEqual(sum(item["change"] for item in drivers), Decimal("50"))

    def test_range_validation_rejects_future_reversed_and_more_than_120_months(self):
        today = timezone.localdate()
        with self.assertRaises(StatisticsRangeError):
            validate_statistics_range(today, today + timedelta(days=1))
        with self.assertRaises(StatisticsRangeError):
            validate_statistics_range(today, today - timedelta(days=1))
        with self.assertRaises(StatisticsRangeError):
            validate_statistics_range(date(2016, 1, 1), date(2026, 1, 1), today=date(2026, 1, 1))
        with self.assertRaises(StatisticsRangeError):
            validate_statistics_range(date.min, date.min, today=date(2026, 1, 1))

    def test_statistics_shift_month_keeps_shared_alias_and_year_boundaries(self):
        self.assertIs(statistics_shift_month, shift_month)
        self.assertEqual(statistics_shift_month(date(2026, 12, 1), 1), date(2027, 1, 1))
        self.assertEqual(statistics_shift_month(date(2027, 1, 1), -1), date(2026, 12, 1))


class StatisticsApiTests(StatisticsFixtureMixin, TestCase):
    def test_category_driver_links_preserve_scope_basis_and_family(self):
        self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="30",
            tx_date=date(2026, 1, 10),
            description="Anterior",
            category=self.expense_child,
        )
        self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="80",
            tx_date=date(2026, 2, 10),
            description="Actual",
            category=self.expense_child,
        )

        payload = self.client.get(
            reverse("api_statistics"),
            {
                "period": "custom",
                "basis": "analytics",
                "date_from": "2026-02-01",
                "date_to": "2026-02-28",
            },
        ).json()
        driver = payload["comparison"]["category_drivers"][0]
        current_query = parse_qs(urlparse(driver["current_movements_url"]).query)
        previous_query = parse_qs(urlparse(driver["previous_movements_url"]).query)

        self.assertEqual(current_query["date_from"], ["2026-02-01"])
        self.assertEqual(current_query["date_to"], ["2026-02-28"])
        self.assertEqual(previous_query["date_from"], ["2026-01-04"])
        self.assertEqual(previous_query["date_to"], ["2026-01-31"])
        self.assertEqual(current_query["analytics"], ["included"])
        self.assertEqual(current_query["category_family"], [str(self.expense_family.pk)])
        self.assertEqual(current_query["statistics_attribution"], ["purchase"])

    def test_analysis_contract_exposes_exact_category_and_concept_drilldowns(self):
        purchases = []
        for month in (1, 2, 3):
            purchases.append(self.movement(
                kind=Transaction.Kind.EXPENSE, amount="25", tx_date=date(2026, month, 8),
                description="Mercado habitual", category=self.expense_child,
            ))
        self.movement(
            kind=Transaction.Kind.INCOME, amount="5", tx_date=date(2026, 4, 3),
            description="Reembolso mercado", category=self.refund, refund_for=purchases[-1],
        )
        self.movement(
            kind=Transaction.Kind.EXPENSE, amount="10", tx_date=date(2026, 3, 12),
            description="Sin categoría", category=None,
        )

        payload = self.client.get(
            reverse("api_statistics"),
            {"period": "custom", "basis": "analytics", "date_from": "2026-01-01", "date_to": "2026-03-31"},
        ).json()

        self.assertEqual(payload["analysis"]["recurring"][0]["description"], "Mercado habitual")
        recurring_query = parse_qs(urlparse(payload["analysis"]["recurring"][0]["movements_url"]).query)
        self.assertEqual(recurring_query["description"], ["Mercado habitual"])
        self.assertEqual(recurring_query["statistics_attribution"], ["purchase"])
        recurring_params = {key: values[-1] for key, values in recurring_query.items() if key != "tab"}
        recurring_drilldown = self.client.get(reverse("api_transactions"), recurring_params).json()
        self.assertIn("Reembolso mercado", [item["description"] for item in recurring_drilldown["results"]])
        matrix_query = parse_qs(urlparse(payload["analysis"]["category_matrix"]["rows"][0]["values"][0]["movements_url"]).query)
        self.assertEqual(matrix_query["statistics_attribution"], ["purchase"])
        quality_query = parse_qs(urlparse(payload["data_quality"]["uncategorized"]["movements_url"]).query)
        self.assertEqual(quality_query["category_family"], ["uncategorized"])

    def test_root_contract_has_only_decision_first_sections_and_no_writes(self):
        start = date(2026, 1, 1)
        end = date(2026, 1, 31)
        rule = RecurringRule.objects.create(
            name="Pendiente no generada",
            kind=Category.Kind.EXPENSE,
            amount=Decimal("30"),
            account=self.account,
            category=self.other_expense,
            day_of_month=15,
            start_date=start,
        )
        self.assertFalse(rule.occurrences.exists())

        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(
                reverse("api_statistics"),
                {"period": "custom", "basis": "analytics", "date_from": start, "date_to": end},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(
            set(payload),
            {"scope", "summary", "activity_status", "comparison", "monthly_series", "categories", "coverage", "basis_reconciliation", "analysis", "data_quality", "money_map"},
        )
        self.assertEqual(
            set(payload["summary"]),
            {"income", "net_expense", "refunds_applied", "analytical_result", "savings_rate"},
        )
        for removed in (
            "metrics",
            "projection",
            "signals",
            "subscriptions",
            "line_chart",
            "category_chart",
            "balance",
            "net_worth",
        ):
            self.assertNotIn(removed, payload)
        self.assertIsNone(payload["summary"]["savings_rate"])
        self.assertFalse(rule.occurrences.exists())
        write_queries = [
            query["sql"]
            for query in queries.captured_queries
            if query["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE", "REPLACE"))
        ]
        self.assertEqual(write_queries, [])

    def test_presets_include_today_and_mark_current_month_partial(self):
        today = timezone.localdate()
        response = self.client.get(reverse("api_statistics"), {"period": "3", "basis": "analytics"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["scope"]["date_to"], today.isoformat())
        self.assertEqual(payload["scope"]["period"], "3")
        self.assertEqual(payload["monthly_series"][-1]["month"], today.strftime("%Y-%m"))
        self.assertEqual(
            payload["monthly_series"][-1]["is_partial"],
            today != shift_month(today.replace(day=1), 1) - timedelta(days=1),
        )
        for item in payload["monthly_series"]:
            self.assertEqual(item["is_complete"], not item["is_partial"])

    def test_statistics_exposes_source_coverage_and_basis_reconciliation(self):
        excluded = Category.objects.create(
            name="No analizable", kind=Category.Kind.EXPENSE, exclude_from_analytics=True,
        )
        self.movement(
            kind=Transaction.Kind.EXPENSE, amount="40", tx_date=date(2026, 1, 10),
            description="Excluido", category=excluded,
        )
        batch = ImportBatch.objects.create(filename="pendiente.csv", account=self.account)
        ImportRow.objects.create(
            batch=batch, row_number=1, date=date(2026, 1, 11), description="Fila pendiente",
            amount=Decimal("12"), kind=Category.Kind.EXPENSE, fingerprint="import-pending",
        )
        connection = BankConnection.objects.create(bank_name="Banco", session_id="stats-coverage")
        bank_account = BankAccount.objects.create(
            connection=connection, account=self.account, remote_uid="stats-coverage-account", display_name="Principal",
        )
        BankTransaction.objects.create(
            bank_account=bank_account, remote_id="pending", booking_date=date(2026, 1, 12),
            description="Banco pendiente", amount=Decimal("15"), kind=Category.Kind.EXPENSE, fingerprint="bank-pending",
        )

        payload = self.client.get(
            reverse("api_statistics"),
            {"period": "custom", "basis": "analytics", "date_from": "2026-01-01", "date_to": "2026-01-31"},
        ).json()

        self.assertEqual(payload["coverage"]["imports"]["status"], "pending")
        self.assertEqual(payload["coverage"]["imports"]["pending_count"], 1)
        self.assertEqual(payload["coverage"]["banking"]["status"], "attention")
        self.assertEqual(payload["coverage"]["banking"]["pending_count"], 1)
        self.assertEqual(payload["basis_reconciliation"]["excluded_summary"]["net_expense"], 40)
        category = payload["basis_reconciliation"]["excluded_categories"][0]
        self.assertEqual(category["family_name"], "No analizable")
        self.assertIn("analytics=excluded", category["movements_url"])
        drilldown_params = {
            key: values[-1]
            for key, values in parse_qs(urlparse(category["movements_url"]).query).items()
            if key != "tab"
        }
        drilldown = self.client.get(reverse("api_transactions"), drilldown_params)
        self.assertEqual(drilldown.status_code, 200)
        self.assertEqual([item["description"] for item in drilldown.json()["results"]], ["Excluido"])

    def test_statistics_coverage_requires_a_recent_bank_sync_before_reporting_current(self):
        connection = BankConnection.objects.create(bank_name="Banco", session_id="stats-freshness")
        payload = self.client.get(
            reverse("api_statistics"),
            {"period": "custom", "basis": "analytics", "date_from": "2026-01-01", "date_to": "2026-01-31"},
        ).json()
        self.assertEqual(payload["coverage"]["banking"]["status"], "attention")

        connection.last_synced_at = timezone.now()
        connection.save(update_fields=["last_synced_at"])
        refreshed = self.client.get(
            reverse("api_statistics"),
            {"period": "custom", "basis": "analytics", "date_from": "2026-01-01", "date_to": "2026-01-31"},
        ).json()
        self.assertEqual(refreshed["coverage"]["banking"]["status"], "current")

    def test_month_insights_use_historical_median_and_keep_transfers_neutral(self):
        for month in (7, 8, 10):
            self.movement(
                kind=Transaction.Kind.EXPENSE, amount="100", tx_date=date(2025, month, 10),
                description=f"Historia {month}", category=self.expense_child,
            )
        self.movement(
            kind=Transaction.Kind.EXPENSE, amount="200", tx_date=date(2026, 1, 10),
            description="Pico", category=self.expense_child,
        )
        payload = self.client.get(
            reverse("api_statistics_month", args=[2026, 1]),
            {"basis": "analytics", "date_from": "2026-01-01", "date_to": "2026-01-31"},
        ).json()
        point = next(item for item in payload["insights"]["rhythm"]["points"] if item["date"] == "2026-01-10")
        spike = payload["insights"]["spikes"]["items"][0]

        self.assertEqual(point["net_expense"], 200)
        self.assertEqual(point["median_net_expense"], 0)
        self.assertEqual(payload["insights"]["spikes"]["comparison_months"], 7)
        # Only three populated months are sufficient; zero months remain legitimate comparison facts.
        self.assertEqual(spike["family_id"], self.expense_family.pk)
        self.assertEqual(spike["median_net_expense"], 100)

    def test_month_insights_align_custom_partial_ranges_and_skip_short_months(self):
        selected_month = date(2026, 1, 1)
        for offset in range(1, 13):
            historical_month = shift_month(selected_month, -offset)
            if historical_month.month in {2, 4, 6, 9, 11}:
                continue
            self.movement(
                kind=Transaction.Kind.EXPENSE, amount="90", tx_date=historical_month.replace(day=1),
                description=f"No comparable {offset}", category=self.expense_child,
            )
            self.movement(
                kind=Transaction.Kind.EXPENSE, amount="10", tx_date=historical_month.replace(day=20),
                description=f"Comparable {offset}", category=self.expense_child,
            )
        self.movement(
            kind=Transaction.Kind.EXPENSE, amount="10", tx_date=date(2026, 1, 20),
            description="Actual", category=self.expense_child,
        )

        payload = self.client.get(
            reverse("api_statistics_month", args=[2026, 1]),
            {"basis": "analytics", "date_from": "2026-01-20", "date_to": "2026-01-31"},
        ).json()
        first_point = payload["insights"]["rhythm"]["points"][0]

        self.assertEqual(payload["insights"]["rhythm"]["comparison_months"], 7)
        self.assertEqual(first_point["net_expense"], 10)
        self.assertEqual(first_point["median_net_expense"], 10)

    def test_invalid_custom_ranges_return_400_instead_of_falling_back(self):
        invalid_requests = [
            {"period": "custom", "date_from": "2026-01", "date_to": "2026-01-31"},
            {"period": "custom", "date_from": "2026-02-01", "date_to": "2026-01-01"},
            {"period": "24"},
            {"period": "3", "basis": "unknown"},
        ]
        for params in invalid_requests:
            with self.subTest(params=params):
                self.assertEqual(self.client.get(reverse("api_statistics"), params).status_code, 400)

    def test_month_contract_is_bounded_to_active_scope_and_has_no_movements(self):
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(
                reverse("api_statistics_month", args=[2026, 1]),
                {"basis": "analytics", "date_from": "2026-01-15", "date_to": "2026-02-10"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(set(payload), {"scope", "activity_status", "summary", "daily_series", "categories", "movements_url", "insights"})
        self.assertEqual(payload["scope"]["selected_month"], "2026-01")
        self.assertEqual(payload["scope"]["date_from"], "2026-01-15")
        self.assertEqual(payload["scope"]["date_to"], "2026-01-31")
        self.assertEqual(len(payload["daily_series"]), 17)
        self.assertNotIn("movements", payload)
        write_queries = [
            query["sql"]
            for query in queries.captured_queries
            if query["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE", "REPLACE"))
        ]
        self.assertEqual(write_queries, [])
        outside = self.client.get(
            reverse("api_statistics_month", args=[2025, 12]),
            {"basis": "analytics", "date_from": "2026-01-15", "date_to": "2026-02-10"},
        )
        self.assertEqual(outside.status_code, 400)

    def test_api_rejects_early_refund_and_invalid_edits_of_refunded_purchase(self):
        purchase = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="100",
            tx_date=date(2026, 1, 15),
            description="Compra protegida",
            category=self.expense_child,
        )
        early_refund = self.client.post(
            reverse("api_transactions"),
            data=json.dumps(
                {
                    "kind": Transaction.Kind.INCOME,
                    "amount": "20",
                    "account": self.account.pk,
                    "date": "2026-01-10",
                    "description": "Reembolso demasiado pronto",
                    "category": self.refund.pk,
                    "refund_for": purchase.pk,
                    "notes": "",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(early_refund.status_code, 400)
        self.assertFalse(Transaction.objects.filter(description="Reembolso demasiado pronto").exists())

        self.movement(
            kind=Transaction.Kind.INCOME,
            amount="40",
            tx_date=date(2026, 2, 10),
            description="Reembolso válido",
            category=self.refund,
            refund_for=purchase,
        )
        kind_edit = self.client.patch(
            reverse("api_transaction_detail", args=[purchase.pk]),
            data=json.dumps({"kind": Transaction.Kind.INCOME, "category": self.income.pk}),
            content_type="application/json",
        )
        date_edit = self.client.patch(
            reverse("api_transaction_detail", args=[purchase.pk]),
            data=json.dumps({"date": "2026-03-01"}),
            content_type="application/json",
        )

        self.assertEqual(kind_edit.status_code, 400)
        self.assertIn("kind", kind_edit.json()["errors"])
        self.assertEqual(date_edit.status_code, 400)
        self.assertIn("date", date_edit.json()["errors"])
        purchase.refresh_from_db()
        self.assertEqual(purchase.kind, Transaction.Kind.EXPENSE)
        self.assertEqual(purchase.date, date(2026, 1, 15))

    def test_archiving_refunded_purchase_is_blocked_in_api(self):
        purchase = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="100",
            tx_date=date(2026, 1, 15),
            description="Compra con reembolso activo",
            category=self.expense_child,
        )
        refund = self.movement(
            kind=Transaction.Kind.INCOME,
            amount="40",
            tx_date=date(2026, 2, 10),
            description="Reembolso activo",
            category=self.refund,
            refund_for=purchase,
        )

        api_response = self.client.post(reverse("api_transaction_archive", args=[purchase.pk]))

        self.assertEqual(api_response.status_code, 400)
        self.assertIn("Archiva primero", api_response.json()["error"])
        purchase.refresh_from_db()
        self.assertFalse(purchase.archived)

        self.assertEqual(
            self.client.post(reverse("api_transaction_archive", args=[refund.pk])).status_code,
            200,
        )
        self.assertEqual(
            self.client.post(reverse("api_transaction_archive", args=[purchase.pk])).status_code,
            200,
        )

    def test_model_validation_blocks_archiving_purchase_with_active_refunds(self):
        purchase = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="100",
            tx_date=date(2026, 1, 15),
            description="Compra validada por modelo",
            category=self.expense_child,
        )
        refund = self.movement(
            kind=Transaction.Kind.INCOME,
            amount="40",
            tx_date=date(2026, 2, 10),
            description="Reembolso validado por modelo",
            category=self.refund,
            refund_for=purchase,
        )

        purchase.archived = True
        with self.assertRaises(ValidationError) as context:
            purchase.full_clean()
        self.assertIn("archived", context.exception.message_dict)

        refund.archived = True
        refund.save(update_fields=["archived", "updated_at"])
        purchase.full_clean()

    def test_reopen_imported_purchase_with_any_refund_is_atomic_for_csv_and_bank(self):
        connection_record = BankConnection.objects.create(
            bank_name="Banco sintético",
            session_id="statistics-reopen-session",
        )
        bank_account = BankAccount.objects.create(
            connection=connection_record,
            account=self.account,
            remote_uid="statistics-reopen-account",
            display_name="Cuenta sintética",
        )
        profile = ImportProfile.objects.create(name="Perfil sintético")

        def create_imported_purchase(source, suffix):
            movement = Transaction.objects.create(
                account=self.account,
                kind=Transaction.Kind.EXPENSE,
                amount=Decimal("100"),
                date=date(2026, 1, 15),
                description=f"Compra importada {suffix}",
                category=self.expense_child,
                source=source,
            )
            if source == Transaction.Source.CSV:
                batch = ImportBatch.objects.create(
                    filename=f"{suffix}.csv",
                    account=self.account,
                    profile=profile,
                    status=ImportBatch.Status.COMPLETED,
                )
                row = ImportRow.objects.create(
                    batch=batch,
                    row_number=1,
                    date=movement.date,
                    description=movement.description,
                    amount=movement.amount,
                    kind=Category.Kind.EXPENSE,
                    category=self.expense_child,
                    fingerprint=f"csv-{suffix}",
                    status=ImportRow.Status.IMPORTED,
                    transaction=movement,
                )
                return movement, row, batch
            row = BankTransaction.objects.create(
                bank_account=bank_account,
                remote_id=f"bank-{suffix}",
                booking_date=movement.date,
                description=movement.description,
                amount=movement.amount,
                kind=Category.Kind.EXPENSE,
                category=self.expense_child,
                fingerprint=f"bank-{suffix}",
                status=BankTransaction.Status.IMPORTED,
                transaction=movement,
            )
            return movement, row, None

        for source in (Transaction.Source.CSV, Transaction.Source.ENABLE_BANKING):
            for refund_archived in (False, True):
                suffix = f"{source}-{refund_archived}-api"
                purchase, row, batch = create_imported_purchase(source, suffix)
                refund = self.movement(
                    kind=Transaction.Kind.INCOME,
                    amount="40",
                    tx_date=date(2026, 2, 10),
                    description=f"Reembolso {suffix}",
                    category=self.refund,
                    refund_for=purchase,
                )
                if refund_archived:
                    refund.archived = True
                    refund.save(update_fields=["archived", "updated_at"])

                response = self.client.post(reverse("api_transaction_reopen", args=[purchase.pk]))

                with self.subTest(source=source, refund_archived=refund_archived):
                    self.assertEqual(response.status_code, 400, response.content)
                    self.assertIn("incluso archivados", response.json()["error"])
                    self.assertTrue(Transaction.objects.filter(pk=purchase.pk).exists())
                    self.assertTrue(Transaction.objects.filter(pk=refund.pk).exists())
                    row.refresh_from_db()
                    self.assertEqual(row.status, row.Status.IMPORTED)
                    self.assertEqual(row.transaction_id, purchase.pk)
                    if batch is not None:
                        batch.refresh_from_db()
                        self.assertEqual(batch.status, ImportBatch.Status.COMPLETED)

    def test_legacy_refund_linked_to_archived_purchase_can_be_edited_and_archived(self):
        purchase = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="100",
            tx_date=date(2026, 1, 15),
            description="Compra archivada legacy",
            category=self.expense_child,
        )
        refund = self.movement(
            kind=Transaction.Kind.INCOME,
            amount="40",
            tx_date=date(2026, 2, 10),
            description="Reembolso legacy",
            category=self.refund,
            refund_for=purchase,
        )
        Transaction.objects.filter(pk=purchase.pk).update(archived=True)

        edit_response = self.client.patch(
            reverse("api_transaction_detail", args=[refund.pk]),
            data=json.dumps({"notes": "Revisado sin cambiar el vínculo"}),
            content_type="application/json",
        )

        self.assertEqual(edit_response.status_code, 200, edit_response.content)
        self.assertEqual(edit_response.json()["transaction"]["refund_for_id"], purchase.pk)
        self.assertEqual(
            self.client.post(reverse("api_transaction_archive", args=[refund.pk])).status_code,
            200,
        )

    def test_monthly_drilldown_uses_original_category_basis_for_refund_extra(self):
        excluded_refund_category = Category.objects.create(
            name="Reembolso excluido",
            kind=Category.Kind.INCOME,
            exclude_from_analytics=True,
        )
        purchase = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="100",
            tx_date=date(2026, 1, 10),
            description="Compra incluida",
            category=self.expense_child,
        )
        refund = self.movement(
            kind=Transaction.Kind.INCOME,
            amount="120",
            tx_date=date(2026, 3, 10),
            description="Reembolso con exceso incluido por origen",
            category=excluded_refund_category,
            refund_for=purchase,
        )
        payload = self.client.get(
            reverse("api_statistics"),
            {
                "period": "custom",
                "basis": "analytics",
                "date_from": "2026-03-01",
                "date_to": "2026-03-31",
            },
        ).json()
        movement_query = {
            key: values[-1]
            for key, values in parse_qs(urlparse(payload["monthly_series"][0]["movements_url"]).query).items()
            if key != "tab"
        }
        movements = self.client.get(reverse("api_transactions"), movement_query).json()["results"]

        self.assertEqual(payload["summary"]["income"], 20)
        self.assertEqual({item["id"] for item in movements}, {refund.pk})

    def test_monthly_drilldown_matches_report_and_attributes_later_refund(self):
        income = self.movement(
            kind=Transaction.Kind.INCOME,
            amount="200",
            tx_date=date(2026, 1, 5),
            description="Ingreso real enero",
            category=self.income,
        )
        purchase = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="100",
            tx_date=date(2026, 1, 10),
            description="Compra reembolsada después",
            category=self.expense_child,
        )
        refund = self.movement(
            kind=Transaction.Kind.INCOME,
            amount="40",
            tx_date=date(2026, 3, 10),
            description="Reembolso cobrado después",
            category=self.refund,
            refund_for=purchase,
        )
        transfer_out, transfer_in = create_transfer(
            source_account=self.account,
            target_account=self.savings,
            amount=Decimal("50"),
            tx_date=date(2026, 1, 20),
            description="Traspaso que no pertenece al informe",
        )
        january = self.client.get(
            reverse("api_statistics"),
            {
                "period": "custom",
                "basis": "analytics",
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
            },
        ).json()
        january_query = {
            key: values[-1]
            for key, values in parse_qs(urlparse(january["monthly_series"][0]["movements_url"]).query).items()
            if key != "tab"
        }

        drilldown = self.client.get(reverse("api_transactions"), january_query).json()
        ignored_filter = self.client.get(
            reverse("api_transactions"),
            {**january_query, "description": income.description},
        )

        self.assertEqual({item["id"] for item in drilldown["results"]}, {income.pk, purchase.pk, refund.pk})
        self.assertEqual(ignored_filter.status_code, 400)
        self.assertIn("filtros adicionales", ignored_filter.json()["error"])
        self.assertNotIn(transfer_out.pk, {item["id"] for item in drilldown["results"]})
        self.assertNotIn(transfer_in.pk, {item["id"] for item in drilldown["results"]})
        self.assertEqual(
            drilldown["statistics_attribution"],
            {
                "income": 200.0,
                "gross_expense": 100.0,
                "refunds_applied": 40.0,
                "extra_income": 0.0,
                "net_expense": 60.0,
                "analytical_result": 140.0,
                "savings_rate": 70.0,
            },
        )
        self.assertEqual(january["summary"]["analytical_result"], 140)

        march = self.client.get(
            reverse("api_statistics"),
            {
                "period": "custom",
                "basis": "analytics",
                "date_from": "2026-03-01",
                "date_to": "2026-03-31",
            },
        ).json()
        march_query = {
            key: values[-1]
            for key, values in parse_qs(urlparse(march["monthly_series"][0]["movements_url"]).query).items()
            if key != "tab"
        }
        march_drilldown = self.client.get(reverse("api_transactions"), march_query).json()
        self.assertEqual(march["summary"]["income"], 0)
        self.assertEqual(march_drilldown["results"], [])

    def test_statistics_drilldowns_reject_ambiguous_or_silently_ignored_filters(self):
        report_params = {
            "statistics_attribution": "report",
            "date_from": "2026-01-01",
            "date_to": "2026-01-31",
            "analytics": "included",
        }
        report_incompatible = {
            "q": "compra",
            "description": "Compra exacta",
            "month": "2026-01",
            "kind": Transaction.Kind.EXPENSE,
            "account": str(self.account.pk),
            "category": str(self.expense_child.pk),
            "category_family": str(self.expense_family.pk),
            "source": Transaction.Source.MANUAL,
            "statistics_basis": "original_purchase",
        }
        for key, value in report_incompatible.items():
            with self.subTest(mode="report", incompatible=key):
                response = self.client.get(reverse("api_transactions"), {**report_params, key: value})
                self.assertEqual(response.status_code, 400, response.content)
        response = self.client.get(
            reverse("api_transactions"),
            {**report_params, "analytics": "excluded"},
        )
        self.assertEqual(response.status_code, 400, response.content)
        report_with_spaced_date = self.client.get(
            reverse("api_transactions"),
            {**report_params, "date_from": " 2026-01-01 "},
        )
        self.assertEqual(report_with_spaced_date.status_code, 400, report_with_spaced_date.content)
        for invalid_attribution in ("unknown", "original_purchase", " report ", "   "):
            with self.subTest(invalid_attribution=invalid_attribution):
                response = self.client.get(
                    reverse("api_transactions"),
                    {"statistics_attribution": invalid_attribution},
                )
                self.assertEqual(response.status_code, 400, response.content)

        purchase_params = {
            "statistics_attribution": "purchase",
            "category_family": str(self.expense_family.pk),
            "date_from": "2026-01-01",
            "date_to": "2026-01-31",
            "analytics": "included",
        }
        purchase_incompatible = {
            "q": "compra",
            "description": "Compra exacta",
            "month": "2026-01",
            "kind": Transaction.Kind.EXPENSE,
            "account": str(self.account.pk),
            "source": Transaction.Source.MANUAL,
            "statistics_basis": "original_purchase",
        }
        for key, value in purchase_incompatible.items():
            with self.subTest(mode="purchase", incompatible=key):
                response = self.client.get(reverse("api_transactions"), {**purchase_params, key: value})
                self.assertEqual(response.status_code, 400, response.content)

        invalid_purchase_params = (
            {key: value for key, value in purchase_params.items() if key != "category_family"},
            {**purchase_params, "category": str(self.expense_child.pk)},
            {key: value for key, value in purchase_params.items() if key != "date_from"},
            {**purchase_params, "date_from": "2026-01"},
            {**purchase_params, "date_from": " 2026-01-01 "},
            {**purchase_params, "date_from": "2026-02-01"},
        )
        for params in invalid_purchase_params:
            with self.subTest(mode="purchase", params=params):
                response = self.client.get(reverse("api_transactions"), params)
                self.assertEqual(response.status_code, 400, response.content)

        invalid_selectors = {
            "category": ("x", "0", "-1", "01", " 1 ", "999999", str(self.income.pk)),
            "category_family": (
                "x",
                "0",
                "-1",
                "01",
                " 1 ",
                "999999",
                str(self.expense_child.pk),
                str(self.income.pk),
            ),
        }
        for selector, values in invalid_selectors.items():
            for value in values:
                with self.subTest(mode="purchase", selector=selector, value=value):
                    params = {
                        **{key: item for key, item in purchase_params.items() if key != "category_family"},
                        selector: value,
                    }
                    response = self.client.get(reverse("api_transactions"), params)
                    self.assertEqual(response.status_code, 400, response.content)

    def test_category_family_filter_includes_parent_and_children_without_text_search(self):
        tx_date = date(2026, 1, 10)
        parent = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="10",
            tx_date=tx_date,
            description="Directo",
            category=self.expense_family,
        )
        child = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="20",
            tx_date=tx_date,
            description="Hijo",
            category=self.expense_child,
        )
        sibling_category = Category.objects.create(
            name="Suministros",
            kind=Category.Kind.EXPENSE,
            parent=self.expense_family,
        )
        sibling = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="7",
            tx_date=tx_date,
            description="Hermana",
            category=sibling_category,
        )
        refund = self.movement(
            kind=Transaction.Kind.INCOME,
            amount="5",
            tx_date=date(2026, 3, 10),
            description="Ajuste posterior del hijo",
            category=self.refund,
            refund_for=child,
        )
        self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="30",
            tx_date=tx_date,
            description="Otra familia",
            category=self.other_expense,
        )

        payload = self.client.get(
            reverse("api_transactions"),
            {"category_family": self.expense_family.pk},
        ).json()

        self.assertEqual({item["id"] for item in payload["results"]}, {parent.pk, child.pk, sibling.pk})

        parent_filter = self.client.get(
            reverse("api_transactions"),
            {"category": self.expense_family.pk},
        ).json()
        child_filter = self.client.get(
            reverse("api_transactions"),
            {"category": self.expense_child.pk},
        ).json()
        self.assertEqual(
            {item["id"] for item in parent_filter["results"]},
            {parent.pk, child.pk, sibling.pk},
        )
        self.assertEqual({item["id"] for item in child_filter["results"]}, {child.pk})

        statistics_payload = self.client.get(
            reverse("api_statistics"),
            {
                "period": "custom",
                "basis": "analytics",
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
            },
        ).json()
        family = next(
            item for item in statistics_payload["categories"] if item["family_id"] == self.expense_family.pk
        )
        family_query = parse_qs(urlparse(family["movements_url"]).query)
        child_row = next(item for item in family["subcategories"] if item["category_id"] == self.expense_child.pk)
        child_query = parse_qs(urlparse(child_row["movements_url"]).query)
        self.assertEqual(family_query["category_family"], [str(self.expense_family.pk)])
        self.assertEqual(family_query["statistics_attribution"], ["purchase"])
        self.assertEqual(child_query["category"], [str(self.expense_child.pk)])

        drilldown_params = {
            key: values[-1]
            for key, values in parse_qs(urlparse(family["movements_url"]).query).items()
            if key != "tab"
        }
        drilldown_payload = self.client.get(reverse("api_transactions"), drilldown_params).json()
        drilldown = drilldown_payload["results"]
        self.assertEqual({item["id"] for item in drilldown}, {parent.pk, child.pk, sibling.pk, refund.pk})
        gross_expense = sum(item["amount"] for item in drilldown if item["kind"] == Transaction.Kind.EXPENSE)
        self.assertEqual(family["gross_expense"], gross_expense)
        self.assertEqual(family["refunds_applied"], drilldown_payload["statistics_attribution"]["refunds_applied"])
        self.assertEqual(drilldown_payload["statistics_attribution"]["net_expense"], family["net_expense"])

        month_payload = self.client.get(statistics_payload["monthly_series"][0]["detail_url"]).json()
        month_family = next(
            item for item in month_payload["categories"] if item["family_id"] == self.expense_family.pk
        )
        self.assertIn("category_family=", month_family["movements_url"])

    def test_category_drilldown_caps_over_refund_and_exposes_extra_income(self):
        first_purchase = self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="100",
            tx_date=date(2026, 1, 10),
            description="Compra con sobre-reembolso",
            category=self.expense_child,
        )
        self.movement(
            kind=Transaction.Kind.EXPENSE,
            amount="50",
            tx_date=date(2026, 1, 11),
            description="Segunda compra de la familia",
            category=self.expense_family,
        )
        refund = self.movement(
            kind=Transaction.Kind.INCOME,
            amount="120",
            tx_date=date(2026, 3, 10),
            description="Reembolso superior a la compra",
            category=self.refund,
            refund_for=first_purchase,
        )
        statistics_payload = self.client.get(
            reverse("api_statistics"),
            {
                "period": "custom",
                "basis": "analytics",
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
            },
        ).json()
        family = next(
            item for item in statistics_payload["categories"] if item["family_id"] == self.expense_family.pk
        )
        params = {
            key: values[-1]
            for key, values in parse_qs(urlparse(family["movements_url"]).query).items()
            if key != "tab"
        }

        drilldown = self.client.get(reverse("api_transactions"), params).json()
        refund_row = next(item for item in drilldown["results"] if item["id"] == refund.pk)

        self.assertEqual(family["gross_expense"], 150)
        self.assertEqual(family["refunds_applied"], 100)
        self.assertEqual(family["net_expense"], 50)
        self.assertEqual(
            drilldown["statistics_attribution"],
            {"gross_expense": 150.0, "refunds_applied": 100.0, "extra_income": 20.0, "net_expense": 50.0},
        )
        self.assertEqual(
            refund_row["statistics_attribution"],
            {"applied_amount": 100.0, "extra_income": 20.0},
        )



class PlanningStatisticsMoveTests(StatisticsFixtureMixin, TestCase):
    def test_planning_exposes_projection_and_actionable_subscription_inputs(self):
        today = timezone.localdate()
        current_month = today.replace(day=1)
        for offset in range(5, -1, -1):
            tx_date = shift_month(current_month, -offset)
            self.movement(
                kind=Transaction.Kind.EXPENSE,
                amount="12.00",
                tx_date=tx_date,
                description="Servicio estable",
                category=self.other_expense,
            )

        response = self.client.get(reverse("api_planning"))

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["projection"], payload["metrics"]["projection"])
        candidate = next(
            item
            for item in payload["subscription_candidates"]
            if item["description"] == "Servicio estable"
        )
        self.assertEqual(candidate["category_rule_input"]["category"], self.other_expense.pk)
        self.assertEqual(candidate["recurring_rule_input"]["account"], self.account.pk)
        self.assertEqual(candidate["recurring_rule_input"]["frequency"], RecurringRule.Frequency.MONTHLY)

        category_response = self.client.post(
            reverse("api_category_rules"),
            data=json.dumps(candidate["category_rule_input"]),
            content_type="application/json",
        )
        recurring_response = self.client.post(
            reverse("api_recurring_rules"),
            data=json.dumps(candidate["recurring_rule_input"]),
            content_type="application/json",
        )

        self.assertEqual(category_response.status_code, 201, category_response.content)
        self.assertEqual(recurring_response.status_code, 201, recurring_response.content)
        self.assertTrue(CategoryRule.objects.filter(description="Servicio estable").exists())
        self.assertTrue(RecurringRule.objects.filter(name="Servicio estable").exists())
