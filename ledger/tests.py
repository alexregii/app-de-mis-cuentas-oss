import json
import tempfile
from datetime import date, timedelta
from decimal import Decimal
from io import BytesIO, StringIO
from unittest.mock import patch

import requests
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from openpyxl import load_workbook

from .models import (
    Account,
    AutomationSettings,
    BankAccount,
    BankConnection,
    BankSyncRun,
    BankTransaction,
    Budget,
    Category,
    CategoryPrediction,
    CategoryRule,
    DashboardPreferences,
    ImportBatch,
    ImportProfile,
    ImportRow,
    RecurringOccurrence,
    RecurringRule,
    ReconciliationSnapshot,
    SavingsGoal,
    SavingsObjective,
    Transaction,
)
from .banking import (
    claim_next_bank_sync,
    enqueue_connection_sync,
    sync_all_connections,
    sync_connection,
)
from .banking_categorization import category_prompt, predict_category
from .banking_staging import (
    create_connection,
    stage_remote_transaction,
    stage_remote_transactions,
)
from .bank_review_services import confirm_bank_transaction
from .category_services import apply_category_rule_historically, preview_category_rule
from .dashboard_services import attention_signals, dashboard_review_summary
from .services import (
    account_balance,
    analytics_transactions,
    build_projection_summary,
    budget_progress,
    category_totals,
    dashboard_metrics,
    detected_subscriptions,
    shift_month,
    transaction_totals,
)
from .recurring_services import confirm_occurrence, generate_recurring_occurrences
from .transaction_services import create_transfer
from .import_services import confirm_import_row, parse_csv_upload
from .statistics import statistics_report


class FinanceFixtureMixin:
    @classmethod
    def setUpTestData(cls):
        cls.current = Account.objects.create(name="Principal", opening_balance=Decimal("1000"))
        cls.savings = Account.objects.create(name="Ahorro", kind=Account.Kind.SAVINGS, opening_balance=Decimal("500"))
        cls.food = Category.objects.create(name="Comida", kind=Category.Kind.EXPENSE)
        cls.salary = Category.objects.create(name="Nómina", kind=Category.Kind.INCOME)
        SavingsGoal.objects.create(percentage=20, minimum=Decimal("300"))


class FinancialRulesTests(FinanceFixtureMixin, TestCase):
    def test_account_balance_applies_signs(self):
        Transaction.objects.create(
            account=self.current, kind=Transaction.Kind.INCOME, amount=500, date=date.today(), description="Ingreso"
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=125,
            date=date.today(),
            description="Compra",
            category=self.food,
        )
        self.assertEqual(account_balance(self.current), Decimal("1375"))

    def test_transfer_is_atomic_and_neutral_for_income_and_expense(self):
        metrics_before = dashboard_metrics()
        outgoing, incoming = create_transfer(
            source_account=self.current,
            target_account=self.savings,
            amount=Decimal("250"),
            tx_date=date.today(),
            description="Ahorro mensual",
        )
        self.assertEqual(outgoing.transfer_group, incoming.transfer_group)
        totals = transaction_totals(date.today(), date.today())
        self.assertEqual(totals["income"], 0)
        self.assertEqual(totals["expense"], 0)
        metrics = dashboard_metrics()
        self.assertEqual(metrics["savings_contributions"], Decimal("250"))
        self.assertEqual(metrics["safe_to_spend"], metrics_before["safe_to_spend"])
        self.assertEqual(metrics["budgets"], metrics_before["budgets"])
        self.assertEqual(metrics["projection"]["projected_savings"], metrics_before["projection"]["projected_savings"])

    def test_new_standalone_transfer_is_rejected(self):
        with self.assertRaises(ValidationError):
            Transaction.objects.create(
                account=self.current,
                kind=Transaction.Kind.TRANSFER_OUT,
                amount=Decimal("10"),
                date=date.today(),
                description="No válido",
            )

    def test_early_legacy_refund_is_income_in_dashboard_and_statistics(self):
        purchase = Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("100"),
            date=date.today(),
            description="Compra",
            category=self.food,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("30"),
            date=date.today() - timedelta(days=1),
            description="Legado temprano",
            category=self.salary,
            refund_for=purchase,
        )
        start = date.today().replace(day=1)
        end = date.today()
        totals = transaction_totals(start, end, basis="all")
        report = statistics_report(start, end, "all")
        self.assertEqual(totals["income"], report["summary"]["income"])
        self.assertEqual(totals["expense"], report["summary"]["net_expense"])
        self.assertEqual(totals["refunds"], report["summary"]["refunds_applied"])

    def test_finance_audit_reconciles_without_exposing_values(self):
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("10"),
            date=date.today(),
            description="Prueba",
            category=self.salary,
        )
        output = StringIO()
        call_command("audit_finances", "--all-history", "--fail-on-drift", stdout=output)
        report = output.getvalue()
        self.assertIn("account_balance_drift:0", report)
        self.assertIn("service_month_drift:0", report)
        self.assertIn("statistics_month_drift:0", report)
        self.assertNotIn("Prueba", report)

    def test_pending_recurring_waits_for_a_real_matching_movement(self):
        rule = RecurringRule.objects.create(
            name="Gimnasio",
            kind=Category.Kind.EXPENSE,
            amount=Decimal("30"),
            account=self.current,
            category=self.food,
            day_of_month=timezone.localdate().day,
        )
        generate_recurring_occurrences()
        occurrence = rule.occurrences.get()
        self.assertEqual(account_balance(self.current), Decimal("1000"))
        self.assertIsNone(confirm_occurrence(occurrence))
        self.assertEqual(account_balance(self.current), Decimal("1000"))
        real_movement = Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("30"),
            date=timezone.localdate(),
            description="Cargo gimnasio",
            source=Transaction.Source.MANUAL,
        )
        generate_recurring_occurrences()
        real_movement.refresh_from_db()
        occurrence.refresh_from_db()
        self.assertEqual(account_balance(self.current), Decimal("970"))
        self.assertEqual(occurrence.status, RecurringOccurrence.Status.CONFIRMED)
        self.assertEqual(real_movement.recurring_occurrence, occurrence)
        self.assertEqual(real_movement.source, Transaction.Source.MANUAL)

    def test_savings_goal_uses_greater_of_percentage_and_minimum(self):
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("1000"),
            date=timezone.localdate(),
            description="Nómina",
            category=self.salary,
        )
        self.assertEqual(dashboard_metrics()["savings_goal"], Decimal("300"))
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("1000"),
            date=timezone.localdate(),
            description="Extra",
            category=self.salary,
        )
        self.assertEqual(dashboard_metrics()["savings_goal"], Decimal("400"))

    def test_savings_goal_progress_is_clamped_for_chart(self):
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("50"),
            date=timezone.localdate(),
            description="Gasto sin ingresos",
            category=self.food,
        )
        self.assertEqual(dashboard_metrics()["savings_goal_progress"], 0)
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("1000"),
            date=timezone.localdate(),
            description="Ingreso",
            category=self.salary,
        )
        self.assertEqual(dashboard_metrics()["savings_goal_progress"], 100)

    def test_budget_progress_does_not_roll_over(self):
        month = timezone.localdate().replace(day=1)
        Budget.objects.create(month=month, category=self.food, limit=Decimal("350"))
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("230"),
            date=timezone.localdate(),
            description="Compra",
            category=self.food,
        )
        progress = budget_progress()[0]
        self.assertEqual(progress["remaining"], Decimal("120"))

    def test_budget_progress_uses_net_expense_after_refund(self):
        month = timezone.localdate().replace(day=1)
        Budget.objects.create(month=month, category=self.food, limit=Decimal("350"))
        purchase = Transaction.objects.create(
            account=self.current, kind=Transaction.Kind.EXPENSE, amount=Decimal("230"),
            date=timezone.localdate(), description="Compra", category=self.food,
        )
        Transaction.objects.create(
            account=self.current, kind=Transaction.Kind.INCOME, amount=Decimal("80"),
            date=timezone.localdate(), description="Reembolso", category=self.salary, refund_for=purchase,
        )
        progress = budget_progress()[0]
        self.assertEqual(progress["spent"], Decimal("150"))
        self.assertEqual(progress["remaining"], Decimal("200"))

    def test_refund_keeps_balance_but_reduces_net_expense(self):
        lodging = Category.objects.create(name="Alojamiento", kind=Category.Kind.EXPENSE)
        refund_category = Category.objects.create(name="Reembolsos", kind=Category.Kind.INCOME)
        expense = Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("6000"),
            date=timezone.localdate(),
            description="Casa rural grupo",
            category=lodging,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("5400"),
            date=timezone.localdate(),
            description="Bizum alojamiento",
            category=refund_category,
            refund_for=expense,
        )

        totals = transaction_totals(timezone.localdate().replace(day=1), timezone.localdate())
        self.assertEqual(account_balance(self.current), Decimal("400"))
        self.assertEqual(totals["income"], Decimal("0"))
        self.assertEqual(totals["gross_expense"], Decimal("6000"))
        self.assertEqual(totals["refunds"], Decimal("5400"))
        self.assertEqual(totals["expense"], Decimal("600"))

    def test_refunds_reduce_category_totals_of_original_expense(self):
        travel = Category.objects.create(name="Viajes", kind=Category.Kind.EXPENSE)
        refund_category = Category.objects.create(name="Reembolsos", kind=Category.Kind.INCOME)
        expense = Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("900"),
            date=timezone.localdate(),
            description="Apartamento",
            category=travel,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("300"),
            date=timezone.localdate(),
            description="Reembolso apto",
            category=refund_category,
            refund_for=expense,
        )

        rows = category_totals(timezone.localdate().replace(day=1), timezone.localdate())

        self.assertEqual(rows[0]["label"], "Viajes")
        self.assertEqual(rows[0]["total"], Decimal("600"))


    def test_multiple_refunds_only_apply_until_expense_is_fully_refunded(self):
        refund_category = Category.objects.create(name="Reembolsos", kind=Category.Kind.INCOME)
        expense = Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("50"),
            date=timezone.localdate(),
            description="Cena",
            category=self.food,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("40"),
            date=timezone.localdate(),
            description="Primer bizum",
            category=refund_category,
            refund_for=expense,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("20"),
            date=timezone.localdate(),
            description="Segundo bizum",
            category=refund_category,
            refund_for=expense,
        )

        totals = transaction_totals(timezone.localdate().replace(day=1), timezone.localdate())

        self.assertEqual(totals["income"], Decimal("10"))
        self.assertEqual(totals["refunds"], Decimal("50"))
        self.assertEqual(totals["expense"], Decimal("0"))

    def test_refund_reduces_original_expense_month_not_refund_month(self):
        refund_category = Category.objects.create(name="Reembolsos", kind=Category.Kind.INCOME)
        expense_month = timezone.localdate().replace(day=1)
        refund_month = shift_month(expense_month, 1)
        expense_month_end = shift_month(expense_month, 1) - timedelta(days=1)
        refund_month_end = shift_month(refund_month, 1) - timedelta(days=1)
        expense = Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("120"),
            date=expense_month,
            description="Compra reembolsada",
            category=self.food,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("80"),
            date=refund_month,
            description="Reembolso posterior",
            category=refund_category,
            refund_for=expense,
        )

        expense_month_totals = transaction_totals(expense_month, expense_month_end)
        refund_month_totals = transaction_totals(refund_month, refund_month_end)
        rows = category_totals(expense_month, expense_month_end)

        self.assertEqual(expense_month_totals["gross_expense"], Decimal("120"))
        self.assertEqual(expense_month_totals["refunds"], Decimal("80"))
        self.assertEqual(expense_month_totals["expense"], Decimal("40"))
        self.assertEqual(refund_month_totals["income"], Decimal("0"))
        self.assertEqual(refund_month_totals["refunds"], Decimal("0"))
        self.assertEqual(refund_month_totals["expense"], Decimal("0"))
        self.assertEqual(rows[0]["label"], "Comida")
        self.assertEqual(rows[0]["total"], Decimal("40"))

    def test_refund_extra_income_stays_in_refund_month(self):
        refund_category = Category.objects.create(name="Reembolsos", kind=Category.Kind.INCOME)
        expense_month = timezone.localdate().replace(day=1)
        refund_month = shift_month(expense_month, 1)
        expense_month_end = shift_month(expense_month, 1) - timedelta(days=1)
        refund_month_end = shift_month(refund_month, 1) - timedelta(days=1)
        expense = Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("50"),
            date=expense_month,
            description="Compra con extra",
            category=self.food,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("60"),
            date=refund_month,
            description="Reembolso con extra",
            category=refund_category,
            refund_for=expense,
        )

        expense_month_totals = transaction_totals(expense_month, expense_month_end)
        refund_month_totals = transaction_totals(refund_month, refund_month_end)

        self.assertEqual(expense_month_totals["income"], Decimal("0"))
        self.assertEqual(expense_month_totals["refunds"], Decimal("50"))
        self.assertEqual(expense_month_totals["expense"], Decimal("0"))
        self.assertEqual(refund_month_totals["income"], Decimal("10"))
        self.assertEqual(refund_month_totals["refunds"], Decimal("0"))
        self.assertEqual(refund_month_totals["expense"], Decimal("0"))

    def test_analytics_excluded_categories_stay_out_of_analytics_metrics(self):
        hidden = Category.objects.create(name="Ahorro interno", kind=Category.Kind.EXPENSE, exclude_from_analytics=True)
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("1000"),
            date=timezone.localdate(),
            description="Nómina",
            category=self.salary,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("200"),
            date=timezone.localdate(),
            description="Compra real",
            category=self.food,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("150"),
            date=timezone.localdate(),
            description="Mover a ahorro",
            category=hidden,
        )

        analytics_totals = transaction_totals(
            timezone.localdate().replace(day=1), timezone.localdate(), basis="analytics"
        )
        all_totals = transaction_totals(
            timezone.localdate().replace(day=1), timezone.localdate(), basis="all"
        )

        self.assertEqual(analytics_totals["expense"], Decimal("200"))
        self.assertEqual(all_totals["expense"], Decimal("350"))
        self.assertEqual(analytics_transactions(basis="analytics").count(), 2)
        self.assertEqual(analytics_transactions(basis="excluded").count(), 1)

    def test_projection_uses_previous_median_before_day_seven(self):
        patch_day = date(2026, 6, 5)
        month_payloads = [
            (date(2026, 3, 10), Decimal("100")),
            (date(2026, 4, 10), Decimal("200")),
            (date(2026, 5, 10), Decimal("300")),
            (date(2026, 6, 3), Decimal("40")),
        ]
        for movement_date, amount in month_payloads:
            Transaction.objects.create(
                account=self.current,
                kind=Transaction.Kind.EXPENSE,
                amount=amount,
                date=movement_date,
                description=f"Gasto {movement_date.month}",
                category=self.food,
            )

        with patch("ledger.services.timezone.localdate", return_value=patch_day):
            projection = build_projection_summary(date(2026, 6, 1))

        self.assertEqual(projection["actual_expense"], Decimal("40"))
        self.assertEqual(projection["projected_expense"], Decimal("81.67"))
        self.assertIn("Previsión combinada", projection["method"])

    def test_projection_category_watchlist_uses_the_category_filter_not_free_text(self):
        current_day = date(2026, 6, 10)
        for month in range(1, 6):
            Transaction.objects.create(
                account=self.current,
                kind=Transaction.Kind.EXPENSE,
                amount=Decimal("100"),
                date=date(2026, month, 10),
                description=f"Comida {month}",
                category=self.food,
            )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("100"),
            date=current_day,
            description="Comida actual",
            category=self.food,
        )

        with patch("ledger.services.timezone.localdate", return_value=current_day):
            projection = build_projection_summary(current_day.replace(day=1))

        self.assertEqual(projection["category_watchlist"][0]["filters"], {
            "category": self.food.pk,
            "kind": Transaction.Kind.EXPENSE,
            "analytics": "included",
        })

    def test_projection_exposes_normalized_savings_without_changing_real_savings(self):
        for month_date, income, expense in [
            (date(2026, 3, 10), Decimal("1000"), Decimal("500")),
            (date(2026, 4, 10), Decimal("1000"), Decimal("500")),
            (date(2026, 5, 10), Decimal("1000"), Decimal("500")),
        ]:
            Transaction.objects.create(account=self.current, kind=Transaction.Kind.INCOME, amount=income, date=month_date, description=f"Nómina {month_date.month}", category=self.salary)
            Transaction.objects.create(account=self.current, kind=Transaction.Kind.EXPENSE, amount=expense, date=month_date, description=f"Gasto {month_date.month}", category=self.food)
        current_day = date(2026, 6, 10)
        Transaction.objects.create(account=self.current, kind=Transaction.Kind.EXPENSE, amount=Decimal("100"), date=current_day, description="Gasto actual", category=self.food)
        with patch("ledger.services.timezone.localdate", return_value=current_day):
            projection = build_projection_summary(current_day.replace(day=1))
        self.assertEqual(projection["normalized_income"], Decimal("1000"))
        self.assertEqual(projection["normalized_savings"], Decimal("733.33"))
        self.assertEqual(projection["expense_delta_vs_pace"], Decimal("-66.67"))

    def test_detected_subscriptions_and_attention_signals_are_conservative(self):
        other = Category.objects.create(name="Otros gastos", kind=Category.Kind.EXPENSE)
        months = [date(2026, 1, 5), date(2026, 2, 5), date(2026, 3, 5), date(2026, 4, 5), date(2026, 5, 5), date(2026, 6, 5)]
        for month_date in months:
            Transaction.objects.create(
                account=self.current,
                kind=Transaction.Kind.EXPENSE,
                amount=Decimal("19.99"),
                date=month_date,
                description="APPLE.COM/BILL",
                category=other,
            )
        for month in range(1, 6):
            Transaction.objects.create(
                account=self.current,
                kind=Transaction.Kind.INCOME,
                amount=Decimal("1500"),
                date=date(2026, month, 1),
                description="NOMINA ACME",
                category=self.salary,
            )

        with patch("ledger.services.timezone.localdate", return_value=date(2026, 6, 14)):
            subscriptions = detected_subscriptions()
            signals = attention_signals()
            start, end = date(2026, 6, 1), date(2026, 6, 30)
            optimized_signals = attention_signals(
                totals=transaction_totals(start, end),
                projection=build_projection_summary(start),
                subscriptions=subscriptions,
                current_category_rows=category_totals(start, end),
            )

        self.assertTrue(any(item["description"] == "APPLE.COM/BILL" for item in subscriptions))
        self.assertTrue(any(item["title"] == "Categoría demasiado genérica" for item in signals))
        self.assertTrue(any(item["title"] == "Cobro recurrente ausente" for item in signals))
        self.assertEqual(optimized_signals, signals)

    def test_dashboard_review_summary_combines_bank_and_csv_pending(self):
        connection = BankConnection.objects.create(bank_name="Banco", session_id="session-summary")
        bank_account = BankAccount.objects.create(
            connection=connection,
            account=self.current,
            remote_uid="remote-summary",
            display_name="Cuenta principal",
        )
        BankTransaction.objects.create(
            bank_account=bank_account,
            remote_id="bank-pending",
            booking_date=timezone.localdate(),
            description="Cobro pendiente",
            amount=Decimal("120"),
            kind=Category.Kind.INCOME,
            currency="EUR",
            fingerprint="bank-pending",
        )
        batch = ImportBatch.objects.create(filename="lote.csv", account=self.current, status=ImportBatch.Status.REVIEW)
        ImportRow.objects.create(
            batch=batch,
            row_number=1,
            date=timezone.localdate(),
            description="Compra CSV",
            amount=Decimal("20"),
            kind=Category.Kind.EXPENSE,
            fingerprint="csv-pending",
        )

        summary = dashboard_review_summary()

        self.assertEqual(summary["bank_pending_count"], 1)
        self.assertEqual(summary["csv_pending_count"], 1)
        self.assertEqual(summary["total_pending_count"], 2)
        self.assertEqual(summary["pending_net_amount"], Decimal("100"))
        self.assertTrue(summary["has_pending_review"])


class ImportTests(FinanceFixtureMixin, TestCase):
    def setUp(self):
        self.profile = ImportProfile.objects.create(name="Banco", date_format="%Y-%m-%d")

    def upload(self):
        return SimpleUploadedFile(
            "extracto.csv",
            b"date,description,amount\n2026-06-10,Supermercado,-42.50\n2026-06-10,Nomina,1500\n",
            content_type="text/csv",
        )

    def categorized_upload(self):
        return SimpleUploadedFile(
            "categorias.csv",
            (
                "date,description,amount,category,subcategory\n"
                "2026-06-10,Compra,-42.50,Comida,Supermercado\n"
                "2026-06-10,Extra,1500,Ingresos profesionales,Proyecto\n"
            ).encode(),
            content_type="text/csv",
        )

    def test_csv_goes_to_review_and_can_be_confirmed(self):
        batch = parse_csv_upload(self.upload(), self.current, self.profile)
        self.assertEqual(batch.rows.count(), 2)
        row = batch.rows.get(description="Supermercado")
        row.category = self.food
        row.save()
        movement = confirm_import_row(row)
        self.assertEqual(movement.kind, Transaction.Kind.EXPENSE)
        self.assertEqual(movement.source, Transaction.Source.CSV)

    def test_invalid_csv_rolls_back_batch_and_generated_categories(self):
        before_batches = ImportBatch.objects.count()
        before_categories = Category.objects.count()
        upload = SimpleUploadedFile(
            "invalido.csv",
            b"date,description,amount,category\n2026-06-10,Correcta,-10,Nueva\nfecha-invalida,Rota,-5,Nueva\n",
            content_type="text/csv",
        )
        with self.assertRaises(ValueError):
            parse_csv_upload(upload, self.current, self.profile)
        self.assertEqual(ImportBatch.objects.count(), before_batches)
        self.assertEqual(Category.objects.count(), before_categories)

    def test_csv_confirmation_matches_recurring_without_duplicate_movement(self):
        rule = RecurringRule.objects.create(
            name="Supermercado",
            kind=Category.Kind.EXPENSE,
            amount=Decimal("42.50"),
            account=self.current,
            category=self.food,
            day_of_month=10,
            start_date=date(2026, 6, 1),
        )
        occurrence = RecurringOccurrence.objects.create(rule=rule, due_date=date(2026, 6, 10), amount=Decimal("42.50"))
        row = parse_csv_upload(self.upload(), self.current, self.profile).rows.get(description="Supermercado")

        movement = confirm_import_row(row)

        occurrence.refresh_from_db()
        movement.refresh_from_db()
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(movement.source, Transaction.Source.CSV)
        self.assertEqual(movement.recurring_occurrence, occurrence)
        self.assertEqual(occurrence.status, RecurringOccurrence.Status.CONFIRMED)

    def test_second_csv_marks_existing_transaction_as_duplicate(self):
        first = parse_csv_upload(self.upload(), self.current, self.profile)
        row = first.rows.get(description="Supermercado")
        confirm_import_row(row)
        second = parse_csv_upload(self.upload(), self.current, self.profile)
        self.assertTrue(second.rows.get(description="Supermercado").possible_duplicate)

    def test_csv_creates_and_assigns_categories(self):
        batch = parse_csv_upload(self.categorized_upload(), self.current, self.profile)
        expense = batch.rows.get(description="Compra")
        income = batch.rows.get(description="Extra")
        self.assertEqual(expense.category.display_name, "Comida · Supermercado")
        self.assertEqual(expense.category.kind, Category.Kind.EXPENSE)
        self.assertEqual(income.category.display_name, "Ingresos profesionales · Proyecto")
        self.assertEqual(income.category.kind, Category.Kind.INCOME)


class ViewTests(FinanceFixtureMixin, TestCase):
    def test_automation_get_is_read_only_when_settings_are_absent(self):
        self.assertFalse(AutomationSettings.objects.exists())
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(reverse("api_automation_settings"))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(AutomationSettings.objects.exists())
        self.assertEqual(
            [query["sql"] for query in queries if query["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))],
            [],
        )

    def test_api_bootstrap_returns_dashboard_payload(self):
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("1000"),
            date=timezone.localdate(),
            description="Nómina",
            category=self.salary,
        )

        response = self.client.get(reverse("api_bootstrap"))

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("csrf_token", payload)
        self.assertEqual(payload["metrics"]["savings_goal_progress"], 100)
        self.assertEqual(payload["accounts"][0]["name"], "Ahorro")
        self.assertEqual(payload["recent"][0]["description"], "Nómina")
        self.assertIn("connections", payload)
        self.assertTrue(payload["activation"]["has_active_account"])
        self.assertTrue(payload["activation"]["has_reviewed_movement"])
        self.assertEqual(payload["activation"]["distinct_activity_months"], 1)
        self.assertIsInstance(payload["activation"]["time_to_first_reviewed_movement_seconds"], int)

    def test_bootstrap_activation_progress_comes_from_real_records_without_financial_details(self):
        batch = ImportBatch.objects.create(filename="primer.csv", account=self.current, status=ImportBatch.Status.REVIEW)
        ImportRow.objects.create(
            batch=batch,
            row_number=1,
            date=timezone.localdate(),
            description="Pendiente de revisar",
            amount=Decimal("12.00"),
            kind=Category.Kind.EXPENSE,
            fingerprint="activation-pending-row",
        )

        activation = self.client.get(reverse("api_bootstrap")).json()["activation"]
        self.assertTrue(activation["has_active_account"])
        self.assertFalse(activation["has_reviewed_movement"])
        self.assertFalse(activation["has_savings_objective"])
        self.assertEqual(activation["pending_review_count"], 1)
        self.assertEqual(activation["distinct_activity_months"], 0)
        self.assertFalse(activation["is_mature"])
        self.assertIsNone(activation["time_to_first_reviewed_movement_seconds"])
        self.assertNotIn("amount", activation)
        self.assertNotIn("description", activation)

        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("12.00"),
            date=timezone.localdate(),
            description="Compra revisada",
            category=self.food,
        )
        activation = self.client.get(reverse("api_bootstrap")).json()["activation"]
        self.assertTrue(activation["has_reviewed_movement"])
        self.assertEqual(activation["pending_review_count"], 1)
        self.assertEqual(activation["distinct_activity_months"], 1)
        first_account = Account.objects.order_by("created_at", "pk").first()
        first_movement = Transaction.objects.filter(kind__in=[Transaction.Kind.INCOME, Transaction.Kind.EXPENSE]).order_by("created_at", "pk").first()
        expected_elapsed = max(0, int((first_movement.created_at - first_account.created_at).total_seconds()))
        first_account.active = False
        first_account.save(update_fields=["active"])
        activation = self.client.get(reverse("api_bootstrap")).json()["activation"]
        self.assertTrue(activation["has_active_account"])
        self.assertEqual(activation["time_to_first_reviewed_movement_seconds"], expected_elapsed)

        SavingsObjective.objects.create(
            name="Colchón",
            target_amount=Decimal("100.00"),
            target_date=timezone.localdate() + timedelta(days=90),
        )
        self.assertTrue(self.client.get(reverse("api_bootstrap")).json()["activation"]["has_savings_objective"])

    def test_bootstrap_activation_maturity_counts_distinct_income_expense_months_only(self):
        current_month = timezone.localdate().replace(day=1)
        previous_month = (current_month - timedelta(days=1)).replace(day=1)
        oldest_month = (previous_month - timedelta(days=1)).replace(day=1)
        Transaction.objects.create(account=self.current, kind=Transaction.Kind.INCOME, amount=100, date=current_month, description="Ingreso A", category=self.salary)
        Transaction.objects.create(account=self.current, kind=Transaction.Kind.EXPENSE, amount=10, date=current_month, description="Gasto A", category=self.food)
        Transaction.objects.create(account=self.current, kind=Transaction.Kind.EXPENSE, amount=10, date=previous_month, description="Gasto B", category=self.food)
        create_transfer(source_account=self.current, target_account=self.savings, amount=5, tx_date=oldest_month, description="Traspaso")

        activation = self.client.get(reverse("api_bootstrap")).json()["activation"]
        self.assertEqual(activation["distinct_activity_months"], 2)
        self.assertFalse(activation["is_mature"])

        Transaction.objects.create(account=self.current, kind=Transaction.Kind.INCOME, amount=100, date=oldest_month, description="Ingreso C", category=self.salary)
        activation = self.client.get(reverse("api_bootstrap")).json()["activation"]
        self.assertEqual(activation["distinct_activity_months"], 3)
        self.assertTrue(activation["is_mature"])

    def test_dashboard_preferences_accept_and_persist_activation_widget(self):
        url = reverse("api_dashboard_preferences")
        initial = self.client.get(url).json()["preferences"]
        self.assertIn("activation", initial["widget_order"])
        response = self.client.put(
            url,
            data=json.dumps({"widget_order": initial["widget_order"], "hidden_widgets": ["activation"]}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("activation", response.json()["preferences"]["widget_order"])
        self.assertIn("activation", response.json()["preferences"]["hidden_widgets"])

    def test_api_account_detail_is_read_only_and_keeps_transfers_out_of_period_totals(self):
        Transaction.objects.create(
            account=self.current, kind=Transaction.Kind.INCOME, amount=Decimal("1200"),
            date=timezone.localdate(), description="Nómina", category=self.salary,
        )
        Transaction.objects.create(
            account=self.current, kind=Transaction.Kind.EXPENSE, amount=Decimal("200"),
            date=timezone.localdate(), description="Compra", category=self.food,
        )
        create_transfer(
            source_account=self.current, target_account=self.savings, amount=Decimal("50"),
            tx_date=timezone.localdate(), description="Ahorro",
        )

        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(reverse("api_account_detail", args=[self.current.pk]))

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["account"]["id"], self.current.pk)
        self.assertEqual(payload["period"]["income"], 1200.0)
        self.assertEqual(payload["period"]["expense"], 200.0)
        self.assertIn("Compra", [row["description"] for row in payload["recent"]])
        writes = [query["sql"] for query in queries if query["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))]
        self.assertEqual(writes, [])

    def test_api_account_reconciliations_creates_a_reconciled_snapshot(self):
        response = self.client.post(
            reverse("api_account_reconciliations", args=[self.current.pk]),
            data=json.dumps({"date": timezone.localdate().isoformat(), "statement_balance": "1000.00"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        snapshot = response.json()["snapshot"]
        self.assertEqual(snapshot["status"], ReconciliationSnapshot.Status.RECONCILED)
        self.assertEqual(snapshot["ledger_balance"], 1000.0)
        self.assertEqual(snapshot["difference"], 0.0)

    def test_api_account_reconciliations_keeps_a_difference_without_mutating_movements(self):
        movement = Transaction.objects.create(
            account=self.current, kind=Transaction.Kind.EXPENSE, amount=Decimal("40"),
            date=timezone.localdate(), description="Compra", category=self.food,
        )

        response = self.client.post(
            reverse("api_account_reconciliations", args=[self.current.pk]),
            data=json.dumps({"date": timezone.localdate().isoformat(), "statement_balance": "970.00"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        snapshot = response.json()["snapshot"]
        self.assertEqual(snapshot["status"], ReconciliationSnapshot.Status.DIFFERENCE)
        self.assertEqual(snapshot["ledger_balance"], 960.0)
        self.assertEqual(snapshot["difference"], 10.0)
        self.assertEqual(Transaction.objects.get(pk=movement.pk).amount, Decimal("40"))
        self.assertEqual(Transaction.objects.count(), 1)

    def test_api_account_reconciliations_keeps_history_for_the_same_date(self):
        url = reverse("api_account_reconciliations", args=[self.current.pk])
        payload = {"date": timezone.localdate().isoformat(), "statement_balance": "1000.00"}
        first = self.client.post(url, data=json.dumps(payload), content_type="application/json").json()["snapshot"]
        payload["statement_balance"] = "1020.00"
        second_response = self.client.post(url, data=json.dumps(payload), content_type="application/json")

        self.assertEqual(second_response.status_code, 201)
        second = second_response.json()["snapshot"]
        self.assertEqual(ReconciliationSnapshot.objects.count(), 2)
        self.assertNotEqual(second["id"], first["id"])
        self.assertEqual(second["statement_balance"], 1020.0)
        self.assertEqual(second["status"], ReconciliationSnapshot.Status.DIFFERENCE)

    def test_api_account_reconciliations_rejects_future_dates_and_invalid_amounts(self):
        url = reverse("api_account_reconciliations", args=[self.current.pk])
        invalid_payloads = [
            {"date": (timezone.localdate() + timedelta(days=1)).isoformat(), "statement_balance": "1000"},
            {"date": timezone.localdate().isoformat(), "statement_balance": "NaN"},
            {"date": timezone.localdate().isoformat(), "statement_balance": "Infinity"},
            {"date": timezone.localdate().isoformat(), "statement_balance": "1.001"},
            {"date": timezone.localdate().isoformat(), "statement_balance": "1000000000000"},
        ]

        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                response = self.client.post(url, data=json.dumps(payload), content_type="application/json")
                self.assertEqual(response.status_code, 400)
        self.assertFalse(ReconciliationSnapshot.objects.exists())

    def test_api_account_reconciliations_includes_transfers_in_ledger_balance(self):
        create_transfer(
            source_account=self.current, target_account=self.savings, amount=Decimal("50"),
            tx_date=timezone.localdate(), description="Ahorro",
        )

        response = self.client.post(
            reverse("api_account_reconciliations", args=[self.current.pk]),
            data=json.dumps({"date": timezone.localdate().isoformat(), "statement_balance": "950.00"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["snapshot"]["ledger_balance"], 950.0)
        self.assertEqual(response.json()["snapshot"]["status"], ReconciliationSnapshot.Status.RECONCILED)

    def test_reconciliation_is_stale_after_historical_ledger_change(self):
        statement_date = timezone.localdate()
        response = self.client.post(
            reverse("api_account_reconciliations", args=[self.current.pk]),
            data=json.dumps({"date": statement_date.isoformat(), "statement_balance": "1000"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        Transaction.objects.create(account=self.current, kind=Transaction.Kind.EXPENSE, amount=Decimal("25"), date=statement_date, description="Cambio posterior", category=self.food)
        response = self.client.get(reverse("api_account_reconciliations", args=[self.current.pk]))
        snapshot = response.json()["snapshots"][0]
        self.assertEqual(snapshot["status"], "stale")
        self.assertEqual(snapshot["ledger_change"], -25)

    def test_api_bootstrap_keeps_attention_amounts_structured(self):
        structured_signal = {
            "title": "Subida por categoría",
            "label": "Comida",
            "value": Decimal("249.83"),
            "value_kind": "money",
            "detail": {"kind": "projection_vs_median", "projected": Decimal("371.81"), "baseline": Decimal("121.98")},
            "filters": {"kind": Transaction.Kind.EXPENSE},
            "severity": Decimal("249.83"),
        }
        with patch("ledger.dashboard_views.attention_signals", return_value=[structured_signal]):
            payload = self.client.get(reverse("api_bootstrap")).json()

        signal = payload["signals"][0]
        self.assertEqual(signal["value"], 249.83)
        self.assertEqual(signal["detail"], {"kind": "projection_vs_median", "projected": 371.81, "baseline": 121.98})
        self.assertNotIn("€", json.dumps(signal))

    def test_api_options_keeps_refund_picker_compact_without_relation_queries(self):
        for index in range(3):
            Transaction.objects.create(
                account=self.current,
                kind=Transaction.Kind.EXPENSE,
                amount=Decimal("10"),
                date=timezone.localdate(),
                description=f"Compra {index}",
                category=self.food,
            )

        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(reverse("api_options"))

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["accounts"])
        self.assertTrue(response.json()["categories"])
        candidate = response.json()["refund_candidates"][0]
        self.assertEqual(set(candidate), {"id", "kind", "amount", "date", "description"})
        self.assertNotIn("tags", candidate)
        self.assertNotIn("attachments", candidate)
        self.assertLessEqual(len(queries), 7)

    def test_financial_gets_are_read_only_and_preferences_are_virtual_until_written(self):
        self.assertFalse(DashboardPreferences.objects.exists())
        with CaptureQueriesContext(connection) as queries:
            bootstrap = self.client.get(reverse("api_bootstrap"))
            planning = self.client.get(reverse("api_planning"))
        self.assertEqual(bootstrap.status_code, 200)
        self.assertEqual(planning.status_code, 200)
        writes = [query["sql"] for query in queries if query["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))]
        self.assertEqual(writes, [])
        self.assertFalse(DashboardPreferences.objects.exists())

    def test_planning_prepare_materializes_rows_explicitly(self):
        month = timezone.localdate().replace(day=1)
        RecurringRule.objects.create(
            name="Seguro", kind=Category.Kind.EXPENSE, amount=Decimal("20"), account=self.current,
            category=self.food, frequency=RecurringRule.Frequency.MONTHLY, day_of_month=month.day,
            start_date=month,
        )
        self.assertFalse(self.client.get(reverse("api_planning")).json()["occurrences"])
        response = self.client.post(
            reverse("api_planning_prepare"), data=json.dumps({"month": month.strftime("%Y-%m")}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["created"], 1)
        self.assertEqual(len(self.client.get(reverse("api_planning")).json()["occurrences"]), 1)

    def test_api_bootstrap_routes_pending_csv_to_react_settings(self):
        batch = ImportBatch.objects.create(filename="pendiente.csv", account=self.current, status=ImportBatch.Status.REVIEW)
        ImportRow.objects.create(
            batch=batch,
            row_number=1,
            date=timezone.localdate(),
            description="Pendiente",
            amount=Decimal("10"),
            kind=Category.Kind.EXPENSE,
            fingerprint="react-csv-priority",
        )

        payload = self.client.get(reverse("api_bootstrap")).json()
        csv_task = next(task for task in payload["dashboard"]["priority_tasks"] if task["id"] == "csv")

        self.assertEqual(csv_task["url"], "/?tab=settings&focus=csv")

    def test_api_transactions_supports_filters_create_patch_and_archive(self):
        existing = Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("12.50"),
            date=timezone.localdate(),
            description="Supermercado",
            category=self.food,
        )

        response = self.client.get(reverse("api_transactions"), {"q": "super"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["page_size"], 50)
        self.assertEqual(response.json()["results"][0]["id"], existing.pk)

        create_response = self.client.post(
            reverse("api_transactions"),
            data=json.dumps(
                {
                    "kind": Transaction.Kind.INCOME,
                    "amount": "42.00",
                    "account": self.current.pk,
                    "date": timezone.localdate().isoformat(),
                    "description": "Venta",
                    "category": self.salary.pk,
                    "notes": "",
                    "tag_names": "extra",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(create_response.status_code, 201)
        created_id = create_response.json()["transaction"]["id"]

        patch_response = self.client.patch(
            reverse("api_transaction_detail", args=[created_id]),
            data=json.dumps({"description": "Venta corregida", "amount": "45.00"}),
            content_type="application/json",
        )
        self.assertEqual(patch_response.status_code, 200)
        self.assertEqual(patch_response.json()["transaction"]["description"], "Venta corregida")

        archive_response = self.client.post(reverse("api_transaction_archive", args=[created_id]))
        self.assertEqual(archive_response.status_code, 200)
        self.assertTrue(Transaction.objects.get(pk=created_id).archived)

    def test_api_transaction_bulk_category_updates_only_compatible_selected_movements(self):
        other_food = Category.objects.create(name="Hogar", kind=Category.Kind.EXPENSE)
        first = Transaction.objects.create(account=self.current, kind=Transaction.Kind.EXPENSE, amount=Decimal("10"), date=timezone.localdate(), description="Primero", category=self.food)
        second = Transaction.objects.create(account=self.current, kind=Transaction.Kind.EXPENSE, amount=Decimal("20"), date=timezone.localdate(), description="Segundo", category=self.food)
        create_transfer(source_account=self.current, target_account=self.savings, amount=Decimal("5"), tx_date=timezone.localdate(), description="No categorizar")

        response = self.client.post(reverse("api_transaction_bulk_category"), data=json.dumps({"rows": [first.pk, second.pk], "category": other_food.pk}), content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["updated"], sorted([first.pk, second.pk]))
        self.assertEqual(Transaction.objects.get(pk=first.pk).category, other_food)
        self.assertEqual(Transaction.objects.get(pk=second.pk).category, other_food)

        transfer = Transaction.objects.filter(transfer_group__isnull=False, account=self.current).first()
        blocked = self.client.post(reverse("api_transaction_bulk_category"), data=json.dumps({"rows": [first.pk, transfer.pk], "category": self.food.pk}), content_type="application/json")
        self.assertEqual(blocked.status_code, 400)
        self.assertEqual(Transaction.objects.get(pk=first.pk).category, other_food)

    def test_api_transaction_create_returns_validation_errors(self):
        response = self.client.post(
            reverse("api_transactions"),
            data=json.dumps({"kind": Transaction.Kind.EXPENSE, "amount": "0"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("errors", response.json())

    def test_api_transaction_accepts_multipart_attachment(self):
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                upload = SimpleUploadedFile("ticket.jpg", b"fakejpeg", content_type="image/jpeg")

                response = self.client.post(
                    reverse("api_transactions"),
                    {
                        "kind": Transaction.Kind.EXPENSE,
                        "amount": "12.00",
                        "account": self.current.pk,
                        "date": timezone.localdate().isoformat(),
                        "description": "Compra con ticket",
                        "category": self.food.pk,
                        "notes": "",
                        "tag_names": "ticket",
                        "attachment": upload,
                    },
                )

                self.assertEqual(response.status_code, 201)
                self.assertEqual(response.json()["transaction"]["attachments"][0]["name"], "ticket.jpg")

    def test_api_accounts_statistics_and_savings_goal(self):
        BankConnection.objects.create(bank_name="Banco", session_id="session-api")
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("24.00"),
            date=timezone.localdate(),
            description="Comida API stats",
            category=self.food,
        )

        accounts = self.client.get(reverse("api_accounts")).json()
        self.assertEqual(len(accounts["accounts"]), 2)
        self.assertEqual(accounts["connections"][0]["bank_name"], "Banco")

        statistics = self.client.get(reverse("api_statistics")).json()
        self.assertEqual(
            set(statistics),
            {"scope", "summary", "activity_status", "comparison", "monthly_series", "categories", "coverage", "basis_reconciliation", "analysis", "data_quality", "money_map"},
        )
        self.assertEqual(statistics["summary"]["net_expense"], 24)
        self.assertTrue(statistics["categories"][0]["movements_url"])
        self.assertNotIn("projection", statistics)
        self.assertNotIn("signals", statistics)
        self.assertNotIn("subscriptions", statistics)

        goal = self.client.get(reverse("api_savings_goal")).json()["goal"]
        self.assertEqual(goal["minimum"], 300.0)

        update = self.client.put(
            reverse("api_savings_goal"),
            data=json.dumps({"percentage": "25", "minimum": "125.00", "active": True}),
            content_type="application/json",
        )
        self.assertEqual(update.status_code, 200)
        self.assertEqual(update.json()["goal"]["percentage"], 25.0)

    def test_api_bank_connection_status_uses_existing_payload(self):
        connection = BankConnection.objects.create(bank_name="Banco", session_id="session-status")

        response = self.client.get(reverse("api_bank_connection_status", args=[connection.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["connection"]["bank_name"], "Banco")

    @patch("ledger.banking_views.banking_configured", return_value=True)
    @patch("ledger.banking_views.EnableBankingClient.start_authorization")
    @patch("ledger.banking_views.EnableBankingClient.banks")
    def test_api_bank_connect_lists_banks_and_starts_authorization(self, mocked_banks, mocked_start_authorization, mocked_configured):
        mocked_banks.return_value = [
            {"name": "Sabadell", "country": "ES"},
            {"name": "imagin", "country": "ES"},
        ]
        mocked_start_authorization.return_value = {"url": "https://bank.example/authorize"}

        listing = self.client.get(reverse("api_bank_connect"))

        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json()["banks"][0]["name"], "imagin")

        response = self.client.post(
            reverse("api_bank_connect"),
            data=json.dumps(
                {
                    "bank_name": "imagin",
                    "bank_country": "ES",
                    "return_to": "https://your-domain.example/?tab=accounts",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["url"], "https://bank.example/authorize")
        state = mocked_start_authorization.call_args.args[2]
        payload = signing.loads(state, salt="enable-banking-auth", max_age=30 * 60)
        self.assertEqual(payload["name"], "imagin")
        self.assertEqual(payload["next_url"], "https://your-domain.example/?tab=accounts")

    def test_api_transfer_planning_and_occurrence_flows(self):
        transfer_response = self.client.post(
            reverse("api_transfer_create"),
            data=json.dumps(
                {
                    "source_account": self.current.pk,
                    "target_account": self.savings.pk,
                    "amount": "25.00",
                    "date": timezone.localdate().isoformat(),
                    "description": "Ahorro",
                    "notes": "",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(transfer_response.status_code, 201)
        self.assertEqual(len(transfer_response.json()["transactions"]), 2)

        rule_response = self.client.post(
            reverse("api_recurring_rules"),
            data=json.dumps(
                {
                    "name": "Gimnasio API",
                    "kind": Category.Kind.EXPENSE,
                    "amount": "30.00",
                    "account": self.current.pk,
                    "category": self.food.pk,
                    "frequency": RecurringRule.Frequency.MONTHLY,
                    "day_of_month": timezone.localdate().day,
                    "start_date": timezone.localdate().replace(day=1).isoformat(),
                    "end_date": "",
                    "notes": "",
                    "active": True,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(rule_response.status_code, 201)
        self.client.post(
            reverse("api_planning_prepare"),
            data=json.dumps({"month": timezone.localdate().strftime("%Y-%m")}),
            content_type="application/json",
        )
        planning = self.client.get(reverse("api_planning")).json()
        self.assertTrue(planning["occurrences"])
        occurrence_id = planning["occurrences"][0]["id"]

        confirm = self.client.post(reverse("api_occurrence_action", args=[occurrence_id, "confirm"]))
        self.assertEqual(confirm.status_code, 409)
        self.assertFalse(Transaction.objects.filter(source=Transaction.Source.RECURRING).exists())

        movement_response = self.client.post(
            reverse("api_transactions"),
            data=json.dumps(
                {
                    "kind": Transaction.Kind.EXPENSE,
                    "amount": "30.00",
                    "account": self.current.pk,
                    "date": timezone.localdate().isoformat(),
                    "description": "Cargo Gimnasio API",
                    "category": self.food.pk,
                    "notes": "",
                    "tag_names": "",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(movement_response.status_code, 201)
        self.assertEqual(movement_response.json()["transaction"]["source"], Transaction.Source.MANUAL)
        self.assertFalse(self.client.get(reverse("api_planning")).json()["occurrences"])

    def test_api_planning_contract_scopes_month_and_exposes_lifecycle(self):
        selected = shift_month(timezone.localdate().replace(day=1), 1)
        Budget.objects.create(month=selected, category=self.food, limit=Decimal("250"))
        Budget.objects.create(month=shift_month(selected, 1), category=self.food, limit=Decimal("300"))
        paused = RecurringRule.objects.create(
            name="Pausada",
            kind=Category.Kind.EXPENSE,
            amount=Decimal("20"),
            account=self.current,
            category=self.food,
            frequency=RecurringRule.Frequency.MONTHLY,
            day_of_month=5,
            start_date=selected,
            active=False,
        )
        RecurringRule.objects.create(
            name="Caducada",
            kind=Category.Kind.EXPENSE,
            amount=Decimal("10"),
            account=self.current,
            category=self.food,
            frequency=RecurringRule.Frequency.MONTHLY,
            day_of_month=5,
            start_date=shift_month(selected, -3),
            end_date=shift_month(selected, -2),
            active=True,
        )

        with patch("ledger.planning_views.generate_recurring_occurrences", wraps=generate_recurring_occurrences) as generate:
            response = self.client.get(reverse("api_planning"), {"month": selected.strftime("%Y-%m")})

        self.assertEqual(response.status_code, 200)
        planning = response.json()
        self.assertEqual(planning["period"]["month"], selected.strftime("%Y-%m"))
        self.assertEqual(planning["period"]["status"], "future")
        self.assertIn("as_of", planning["period"])
        self.assertEqual([item["limit"] for item in planning["budgets"]], [250.0])
        self.assertEqual(planning["margin"]["available"], planning["metrics"]["safe_to_spend"])
        self.assertTrue(planning["goal"]["configured"])
        lifecycles = {item["name"]: item["lifecycle"] for item in planning["rules"]}
        self.assertEqual(lifecycles[paused.name], "paused")
        self.assertEqual(lifecycles["Caducada"], "expired")
        self.assertEqual(generate.call_count, 0)

    def test_api_planning_rejects_invalid_month_without_financial_payload(self):
        response = self.client.get(reverse("api_planning"), {"month": "not-a-month"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.json()), {"ok", "error"})
        self.assertEqual(response.json()["error"], "El mes debe usar el formato AAAA-MM.")

        calendar_response = self.client.get(reverse("api_planning_calendar"), {"month": "not-a-month"})
        self.assertEqual(calendar_response.status_code, 400)
        self.assertEqual(calendar_response.json(), {"ok": False, "error": "El mes debe usar el formato AAAA-MM."})

        prepare_response = self.client.post(
            reverse("api_planning_prepare"),
            data=json.dumps({"month": "not-a-month"}),
            content_type="application/json",
        )
        self.assertEqual(prepare_response.status_code, 400)
        self.assertEqual(prepare_response.json(), {"ok": False, "error": "El mes debe usar el formato AAAA-MM."})

    def test_api_planning_has_a_bounded_query_budget(self):
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(reverse("api_planning"))
        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(len(queries), 66)
        self.assertLessEqual(len(response.json()["subscription_candidates"]), 8)

    def test_api_categories_rules_accounts_and_settings(self):
        account_response = self.client.post(
            reverse("api_accounts"),
            data=json.dumps({"name": "Broker", "kind": Account.Kind.CHECKING, "opening_balance": "12.00", "color": "#123456", "active": True}),
            content_type="application/json",
        )
        self.assertEqual(account_response.status_code, 201)
        account_id = account_response.json()["account"]["id"]
        patch_account = self.client.patch(
            reverse("api_account_detail", args=[account_id]),
            data=json.dumps({"active": False}),
            content_type="application/json",
        )
        self.assertEqual(patch_account.status_code, 200)
        self.assertFalse(patch_account.json()["account"]["active"])

        category_response = self.client.post(
            reverse("api_categories"),
            data=json.dumps(
                {
                    "name": "Transporte API",
                    "kind": Category.Kind.EXPENSE,
                    "parent": "",
                    "color": "#654321",
                    "icon": "bus",
                    "active": True,
                    "exclude_from_analytics": False,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(category_response.status_code, 201)
        category_id = category_response.json()["category"]["id"]

        rule_response = self.client.post(
            reverse("api_category_rules"),
            data=json.dumps({"description": "METRO", "kind": Category.Kind.EXPENSE, "category": category_id, "active": True}),
            content_type="application/json",
        )
        self.assertEqual(rule_response.status_code, 201)
        apply_response = self.client.post(reverse("api_category_rule_apply", args=[rule_response.json()["rule"]["id"]]))
        self.assertEqual(apply_response.status_code, 200)

        automation = self.client.put(
            reverse("api_automation_settings"),
            data=json.dumps({"llm_enabled": False, "auto_apply_enabled": False, "confidence_threshold": "0.750"}),
            content_type="application/json",
        )
        self.assertEqual(automation.status_code, 200)
        self.assertFalse(automation.json()["automation"]["llm_enabled"])

    def test_api_category_order_rejects_self_and_descendant_cycles(self):
        child = Category.objects.create(
            name="Subcategoría protegida",
            kind=Category.Kind.EXPENSE,
            parent=self.food,
        )

        self_response = self.client.put(
            reverse("api_category_order"),
            data=json.dumps({"order": [{"id": self.food.pk, "parent_id": self.food.pk}]}),
            content_type="application/json",
        )
        descendant_response = self.client.put(
            reverse("api_category_order"),
            data=json.dumps({"order": [{"id": self.food.pk, "parent_id": child.pk}]}),
            content_type="application/json",
        )

        self.assertEqual(self_response.status_code, 400)
        self.assertEqual(descendant_response.status_code, 400)
        self.food.refresh_from_db()
        self.assertIsNone(self.food.parent_id)

    def test_api_import_review_and_bank_review_flows(self):
        profile = ImportProfile.objects.create(name="API CSV", date_format="%Y-%m-%d")
        upload = SimpleUploadedFile(
            "api.csv",
            b"date,description,amount\n2026-06-10,Compra API,-10\n",
            content_type="text/csv",
        )
        upload_response = self.client.post(
            reverse("api_import_upload"),
            {"account": self.current.pk, "profile": profile.pk, "file": upload},
        )
        self.assertEqual(upload_response.status_code, 201)
        batch_id = upload_response.json()["batch"]["id"]
        rows_response = self.client.get(reverse("api_import_rows", args=[batch_id]))
        row_id = rows_response.json()["results"][0]["id"]
        confirm_row = self.client.post(
            reverse("api_import_row_action", args=[row_id, "confirm"]),
            data=json.dumps({"category": self.food.pk}),
            content_type="application/json",
        )
        self.assertEqual(confirm_row.status_code, 200)

        connection = BankConnection.objects.create(bank_name="Banco API", session_id="session-bank-review")
        bank_account = BankAccount.objects.create(
            connection=connection,
            account=self.current,
            remote_uid="remote-bank-review",
            display_name="Cuenta API",
        )
        bank_row = BankTransaction.objects.create(
            bank_account=bank_account,
            remote_id="remote-row-review",
            booking_date=timezone.localdate(),
            description="Banco pendiente API",
            amount=Decimal("12"),
            kind=Category.Kind.EXPENSE,
            currency="EUR",
            fingerprint="bank-review-api",
        )
        review = self.client.get(reverse("api_bank_review"))
        self.assertEqual(review.status_code, 200)
        self.assertEqual(review.json()["rows"][0]["id"], bank_row.pk)
        confirm_bank = self.client.post(
            reverse("api_bank_review_action", args=[bank_row.pk, "confirm"]),
            data=json.dumps({"category": self.food.pk, "remember_category": True}),
            content_type="application/json",
        )
        self.assertEqual(confirm_bank.status_code, 200)
        self.assertFalse(BankTransaction.objects.filter(pk=bank_row.pk, status=BankTransaction.Status.PENDING).exists())

    def test_api_bank_review_force_imports_a_signalled_row(self):
        connection = BankConnection.objects.create(bank_name="Banco API force", session_id="session-bank-review-force")
        bank_account = BankAccount.objects.create(
            connection=connection,
            account=self.current,
            remote_uid="remote-bank-review-force",
            display_name="Cuenta API force",
        )
        bank_row = BankTransaction.objects.create(
            bank_account=bank_account,
            remote_id="remote-row-review-force",
            booking_date=timezone.localdate(),
            description="Banco señalado API",
            amount=Decimal("12"),
            kind=Category.Kind.EXPENSE,
            currency="EUR",
            category=self.food,
            fingerprint="bank-review-api-force",
            possible_duplicate=True,
        )

        response = self.client.post(
            reverse("api_bank_review_action", args=[bank_row.pk, "force"]),
            data=json.dumps({"category": self.food.pk}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        bank_row.refresh_from_db()
        self.assertEqual(bank_row.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(bank_row.transaction.category, self.food)

    def test_api_import_batch_confirm_and_new_category_flow(self):
        profile = ImportProfile.objects.create(name="API CSV nuevo", date_format="%Y-%m-%d")
        upload = SimpleUploadedFile(
            "api-new.csv",
            b"date,description,amount\n2026-06-10,Libreria,-18\n2026-06-11,Cafe,-4\n",
            content_type="text/csv",
        )
        upload_response = self.client.post(
            reverse("api_import_upload"),
            {"account": self.current.pk, "profile": profile.pk, "file": upload},
        )
        batch_id = upload_response.json()["batch"]["id"]
        rows = self.client.get(reverse("api_import_rows", args=[batch_id])).json()["results"]
        category_response = self.client.post(
            reverse("api_import_row_action", args=[rows[0]["id"], "category"]),
            data=json.dumps({"new_category": "Compras personales", "new_subcategory": "Libros"}),
            content_type="application/json",
        )
        self.assertEqual(category_response.status_code, 200)
        self.assertEqual(category_response.json()["row"]["category"]["display_name"], "Compras personales · Libros")

        confirm_response = self.client.post(reverse("api_import_batch_confirm", args=[batch_id]))
        self.assertEqual(confirm_response.status_code, 200)
        self.assertEqual(confirm_response.json()["imported"], 2)
        self.assertEqual(Transaction.objects.filter(source=Transaction.Source.CSV).count(), 2)

    def test_api_import_batch_delete_pending_and_block_imported(self):
        removable = ImportBatch.objects.create(filename="borrar.csv", account=self.current, status=ImportBatch.Status.REVIEW)
        ImportRow.objects.create(
            batch=removable,
            row_number=1,
            date=timezone.localdate(),
            description="Pendiente borrable",
            amount=Decimal("12.00"),
            kind=Category.Kind.EXPENSE,
            fingerprint="pending-delete-row",
        )
        delete_response = self.client.delete(reverse("api_import_batch", args=[removable.pk]))
        self.assertEqual(delete_response.status_code, 200)
        self.assertFalse(ImportBatch.objects.filter(pk=removable.pk).exists())

        blocked = ImportBatch.objects.create(filename="bloqueado.csv", account=self.current, status=ImportBatch.Status.REVIEW)
        movement = Transaction.objects.create(
            account=self.current,
            date=timezone.localdate(),
            description="Ya importado",
            amount=Decimal("8.00"),
            kind=Category.Kind.EXPENSE,
            category=self.food,
            source=Transaction.Source.CSV,
        )
        ImportRow.objects.create(
            batch=blocked,
            row_number=1,
            date=timezone.localdate(),
            description="Fila importada",
            amount=Decimal("8.00"),
            kind=Category.Kind.EXPENSE,
            category=self.food,
            fingerprint="blocked-delete-row",
            transaction=movement,
        )
        blocked_response = self.client.delete(reverse("api_import_batch", args=[blocked.pk]))
        self.assertEqual(blocked_response.status_code, 400)
        self.assertTrue(ImportBatch.objects.filter(pk=blocked.pk).exists())














    def test_statistics_supports_period_and_basis_filters(self):
        excluded = Category.objects.create(name="Transferencia interna", kind=Category.Kind.EXPENSE, exclude_from_analytics=True)
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("50"),
            date=timezone.localdate(),
            description="Gasto visible",
            category=self.food,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("25"),
            date=timezone.localdate(),
            description="Gasto excluido",
            category=excluded,
        )

        analytics_payload = self.client.get(
            reverse("api_statistics"), {"period": "3", "basis": "analytics"}
        ).json()
        all_payload = self.client.get(
            reverse("api_statistics"), {"period": "3", "basis": "all"}
        ).json()

        self.assertEqual(len(analytics_payload["monthly_series"]), 3)
        self.assertEqual(analytics_payload["scope"]["basis"], "analytics")
        self.assertEqual(all_payload["scope"]["basis"], "all")
        self.assertEqual(analytics_payload["summary"]["net_expense"], 50)
        self.assertEqual(all_payload["summary"]["net_expense"], 75)

    def test_api_statistics_category_chart_uses_selected_period(self):
        current_month = timezone.localdate().replace(day=1)
        old_month = shift_month(current_month, -4)
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("50"),
            date=current_month,
            description="Gasto dentro del periodo",
            category=self.food,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("900"),
            date=old_month,
            description="Gasto fuera del periodo",
            category=self.food,
        )

        response = self.client.get(reverse("api_statistics"), {"period": "3", "basis": "analytics"})
        payload = response.json()

        self.assertEqual(sum(item["net_expense"] for item in payload["monthly_series"]), 50)
        self.assertEqual(sum(item["net_expense"] for item in payload["categories"]), 50)
        self.assertIn("date_from=", payload["categories"][0]["movements_url"])
        self.assertIn("date_to=", payload["categories"][0]["movements_url"])

    def test_api_statistics_excludes_unreliable_balance_history_and_keeps_transfers_neutral(self):
        current_month = timezone.localdate().replace(day=1)
        previous_month = shift_month(current_month, -1)
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("100"),
            date=previous_month,
            description="Ingreso para saldo histórico",
        )
        create_transfer(
            source_account=self.current,
            target_account=self.savings,
            amount=Decimal("250"),
            tx_date=current_month,
            description="Traspaso neutral en serie",
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("40"),
            date=current_month,
            description="Gasto para saldo histórico",
            category=self.food,
        )

        payload = self.client.get(reverse("api_statistics"), {"period": "3"}).json()
        by_month = {item["month"]: item for item in payload["monthly_series"]}

        self.assertEqual(by_month[previous_month.strftime("%Y-%m")]["income"], 100)
        self.assertEqual(by_month[current_month.strftime("%Y-%m")]["net_expense"], 40)
        self.assertNotIn("balance", payload["summary"])
        self.assertNotIn("balance", by_month[current_month.strftime("%Y-%m")])

    def test_api_statistics_accepts_custom_date_range(self):
        today = timezone.localdate()
        start = today.replace(day=1)
        previous_month = shift_month(start, -1)
        outside_month = shift_month(start, -3)
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("500"),
            date=previous_month,
            description="Ingreso dentro del rango",
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("80"),
            date=today,
            description="Gasto dentro del rango",
            category=self.food,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("900"),
            date=outside_month,
            description="Gasto fuera del rango",
            category=self.food,
        )

        response = self.client.get(
            reverse("api_statistics"),
            {
                "period": "custom",
                "date_from": previous_month.isoformat(),
                "date_to": today.isoformat(),
                "basis": "analytics",
            },
        )
        payload = response.json()

        self.assertEqual(payload["scope"]["period"], "custom")
        self.assertEqual(payload["scope"]["date_from"], previous_month.isoformat())
        self.assertEqual(payload["scope"]["date_to"], today.isoformat())
        self.assertEqual(sum(item["income"] for item in payload["monthly_series"]), 500)
        self.assertEqual(sum(item["net_expense"] for item in payload["monthly_series"]), 80)
        self.assertEqual(sum(item["net_expense"] for item in payload["categories"]), 80)
        self.assertIn("date_from=", payload["categories"][0]["movements_url"])
        self.assertIn("date_to=", payload["categories"][0]["movements_url"])

    def test_api_statistics_includes_period_and_year_comparisons(self):
        today = timezone.localdate()
        current_start = today.replace(day=1)
        current_previous_start = (current_start - timedelta(days=1)) - (today - current_start)
        previous_year_date = today.replace(year=today.year - 1)
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("1000"),
            date=current_start,
            description="Ingreso actual",
            category=self.salary,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("200"),
            date=current_start,
            description="Gasto actual",
            category=self.food,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("700"),
            date=current_previous_start,
            description="Ingreso anterior",
            category=self.salary,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("300"),
            date=current_previous_start,
            description="Gasto anterior",
            category=self.food,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("600"),
            date=previous_year_date,
            description="Ingreso año anterior",
            category=self.salary,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("100"),
            date=previous_year_date,
            description="Gasto año anterior",
            category=self.food,
        )

        response = self.client.get(
            reverse("api_statistics"),
            {"period": "custom", "date_from": current_start.isoformat(), "date_to": today.isoformat(), "basis": "analytics"},
        )
        payload = response.json()
        comparison = payload["comparison"]

        self.assertEqual(payload["summary"]["income"], 1000)
        self.assertEqual(comparison["previous"]["income"], 700)
        self.assertEqual(comparison["changes"]["income"]["amount"], 300)
        self.assertEqual(comparison["changes"]["net_expense"]["amount"], -100)
        self.assertEqual(comparison["changes"]["analytical_result"]["amount"], 400)
        self.assertNotIn("year", comparison)

    def test_statistics_category_donut_includes_all_positive_categories(self):
        categories = [
            Category.objects.create(name=f"Categoria {index}", kind=Category.Kind.EXPENSE)
            for index in range(12)
        ]
        for index, category in enumerate(categories, start=1):
            Transaction.objects.create(
                account=self.current,
                kind=Transaction.Kind.EXPENSE,
                amount=Decimal(str(index)),
                date=timezone.localdate(),
                description=f"Gasto {index}",
                category=category,
            )

        payload = self.client.get(reverse("api_statistics")).json()

        self.assertEqual(len(payload["categories"]), 12)

    def test_month_statistics_category_donut_includes_all_positive_categories(self):
        categories = [
            Category.objects.create(name=f"Mes {index}", kind=Category.Kind.EXPENSE)
            for index in range(11)
        ]
        for index, category in enumerate(categories, start=1):
            Transaction.objects.create(
                account=self.current,
                kind=Transaction.Kind.EXPENSE,
                amount=Decimal(str(index)),
                date=date(2026, 5, min(index, 28)),
                description=f"Mensual {index}",
                category=category,
            )

        payload = self.client.get(reverse("api_statistics_month", args=[2026, 5])).json()

        self.assertEqual(len(payload["categories"]), 11)







    def test_month_statistics_drill_down_uses_selected_month(self):
        selected = date(2026, 5, 10)
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("800"),
            date=selected,
            description="Ingreso mayo",
            category=self.salary,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("200"),
            date=selected,
            description="Gasto mayo",
            category=self.food,
        )
        response = self.client.get(reverse("api_statistics_month", args=[2026, 5]))
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["summary"]["income"], 800)
        self.assertEqual(payload["summary"]["net_expense"], 200)
        self.assertEqual(payload["summary"]["savings_rate"], 75.0)
        self.assertNotIn("movements", payload)

    def test_month_statistics_shows_every_movement(self):
        for number in range(25):
            Transaction.objects.create(
                account=self.current,
                kind=Transaction.Kind.EXPENSE,
                amount=Decimal("1"),
                date=date(2026, 5, (number % 25) + 1),
                description=f"Movimiento mensual {number}",
                category=self.food,
            )

        response = self.client.get(reverse("api_statistics_month", args=[2026, 5]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["summary"]["net_expense"], 25)
        self.assertNotIn("movements", response.json())
        self.assertIn("tab=transactions", response.json()["movements_url"])

    def test_invalid_statistics_month_returns_404(self):
        self.assertEqual(self.client.get("/estadisticas/2026/13/").status_code, 404)











    def test_api_import_batch_confirm_returns_processed_ids_and_leaves_duplicates_pending(self):
        profile = ImportProfile.objects.create(name="Lote API", date_format="%Y-%m-%d")
        duplicate = Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("20"),
            date=date(2026, 6, 10),
            description="Duplicada API",
        )
        batch = parse_csv_upload(
            SimpleUploadedFile(
                "lote-api.csv",
                b"date,description,amount\n2026-06-10,Valida API,-10\n2026-06-10,Duplicada API,-20\n",
                content_type="text/csv",
            ),
            self.current,
            profile,
        )

        response = self.client.post(reverse("api_import_batch_confirm", args=[batch.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["removed"], [batch.rows.get(description="Valida API").pk])
        duplicate_row = batch.rows.get(description="Duplicada API")
        duplicate_row.refresh_from_db()
        self.assertEqual(duplicate_row.status, ImportRow.Status.PENDING)








    def test_excel_export_contains_expected_sheets(self):
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("1"),
            date=timezone.localdate(),
            description="=SUM(1,1)",
            category=self.food,
        )
        response = self.client.get(reverse("export_excel"))
        self.assertEqual(response.status_code, 200)
        self.assertIn("spreadsheetml", response["Content-Type"])
        workbook = load_workbook(BytesIO(response.content), read_only=True)
        self.assertEqual(
            workbook.sheetnames,
            ["Resumen", "Movimientos", "Cuentas", "Presupuestos", "Recurrentes"],
        )
        summary = dict(workbook["Resumen"].iter_rows(min_row=2, values_only=True))
        metrics = dashboard_metrics()
        self.assertIn("Saldo registrado", summary)
        self.assertIn("Resultado del mes", summary)
        self.assertIn("Margen mensual previsto", summary)
        self.assertNotIn("Gasto seguro", summary)
        self.assertEqual(summary["Saldo registrado"], float(metrics["total_balance"]))
        self.assertEqual(summary["Resultado del mes"], float(metrics["net_savings"]))
        self.assertEqual(summary["Margen mensual previsto"], float(metrics["safe_to_spend"]))
        self.assertEqual(workbook["Movimientos"]["D2"].value, "'=SUM(1,1)")

    def test_excel_export_can_be_limited_to_selected_transactions(self):
        selected = Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("15"),
            date=timezone.localdate(),
            description="Movimiento seleccionado",
            category=self.food,
        )
        Transaction.objects.create(
            account=self.current,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("25"),
            date=timezone.localdate(),
            description="Movimiento no seleccionado",
            category=self.food,
        )

        response = self.client.get(reverse("export_excel"), {"transaction_ids": str(selected.pk)})

        self.assertEqual(response.status_code, 200)
        workbook = load_workbook(BytesIO(response.content), read_only=True)
        self.assertEqual(workbook.sheetnames, ["Resumen", "Movimientos"])
        descriptions = [row[3] for row in workbook["Movimientos"].iter_rows(min_row=2, values_only=True)]
        self.assertEqual(descriptions, ["Movimiento seleccionado"])


class BankingTests(FinanceFixtureMixin, TestCase):
    def setUp(self):
        self.connection = BankConnection.objects.create(bank_name="Banco", session_id="session-test")
        self.bank_account = BankAccount.objects.create(
            connection=self.connection,
            account=self.current,
            remote_uid="remote-account",
            display_name="Cuenta",
        )

    def remote_item(self, **overrides):
        item = {
            "status": "BOOK",
            "transaction_id": "remote-transaction",
            "booking_date": "2026-06-10",
            "transaction_amount": {"amount": "-42.50", "currency": "EUR"},
            "credit_debit_indicator": "DBIT",
            "remittance_information": ["Supermercado"],
        }
        item.update(overrides)
        return item

    def test_staging_only_imports_booked_eur_and_is_idempotent(self):
        row = stage_remote_transaction(self.bank_account, self.remote_item())
        again = stage_remote_transaction(self.bank_account, self.remote_item())
        self.assertEqual(row.pk, again.pk)
        self.assertEqual(BankTransaction.objects.count(), 1)
        self.assertIsNone(stage_remote_transaction(self.bank_account, self.remote_item(status="PDNG")))
        self.assertIsNone(
            stage_remote_transaction(
                self.bank_account,
                self.remote_item(transaction_id="usd", transaction_amount={"amount": "-5", "currency": "USD"}),
            )
        )

    def test_staging_uses_entry_reference_when_transaction_id_is_not_unique(self):
        first = self.remote_item(
            transaction_id="details-id",
            entry_reference="aspsp-entry-a",
            booking_date="2026-09-27",
            transaction_amount={"amount": "-18.99", "currency": "EUR"},
            remittance_information=["NEW YORK BURGER"],
        )
        second = self.remote_item(
            transaction_id="details-id",
            entry_reference="aspsp-entry-b",
            booking_date="2026-09-27",
            transaction_amount={"amount": "-18.99", "currency": "EUR"},
            remittance_information=["NEW YORK BURGER"],
        )

        staged = stage_remote_transactions(self.bank_account, [first, second])
        repeated = stage_remote_transactions(self.bank_account, [first, second])

        self.assertEqual(len(staged), 2)
        self.assertNotEqual(staged[0].remote_id, staged[1].remote_id)
        self.assertEqual([row.pk for row in staged], [row.pk for row in repeated])
        self.assertEqual(BankTransaction.objects.count(), 2)

    def test_staging_upgrades_legacy_row_and_preserves_distinct_balances(self):
        legacy_item = self.remote_item(
            transaction_id=None,
            entry_reference=None,
            booking_date="2026-09-27",
            transaction_amount={"amount": "-18.99", "currency": "EUR"},
            remittance_information=["NEW YORK BURGER"],
        )
        legacy_row = stage_remote_transaction(self.bank_account, legacy_item)
        legacy_row.remote_id = legacy_row.remote_id.removeprefix("fallback:")
        legacy_row.save(update_fields=["remote_id"])
        movement = confirm_bank_transaction(legacy_row, category=self.food)
        first = self.remote_item(
            transaction_id=None,
            entry_reference=None,
            booking_date="2026-09-27",
            transaction_amount={"amount": "-18.99", "currency": "EUR"},
            remittance_information=["NEW YORK BURGER"],
            balance_after_transaction={"amount": "6611.75", "currency": "EUR"},
        )
        second = self.remote_item(
            transaction_id=None,
            entry_reference=None,
            booking_date="2026-09-27",
            transaction_amount={"amount": "-18.99", "currency": "EUR"},
            remittance_information=["NEW YORK BURGER"],
            balance_after_transaction={"amount": "6630.74", "currency": "EUR"},
        )

        staged = stage_remote_transactions(self.bank_account, [first, second])
        repeated = stage_remote_transactions(self.bank_account, [first, second])
        legacy_row.refresh_from_db()

        self.assertEqual(len(staged), 2)
        self.assertEqual(len({row.pk for row in staged}), 2)
        self.assertIn(legacy_row.pk, {row.pk for row in staged})
        self.assertEqual(legacy_row.transaction, movement)
        self.assertTrue(any(row.possible_duplicate and row.status == BankTransaction.Status.PENDING for row in staged))
        self.assertEqual({row.pk for row in staged}, {row.pk for row in repeated})
        self.assertEqual(BankTransaction.objects.count(), 2)
        self.assertEqual(Transaction.objects.filter(source=Transaction.Source.ENABLE_BANKING).count(), 1)

    def test_sync_preserves_identical_fallback_rows_across_pages_and_retries(self):
        item = self.remote_item(
            transaction_id=None,
            entry_reference=None,
            booking_date="2026-09-27",
            transaction_amount={"amount": "-18.99", "currency": "EUR"},
            remittance_information=["NEW YORK BURGER"],
        )

        class PaginatedClient:
            def balances(self, uid):
                return []

            def transactions(self, uid, date_from, continuation_key=None):
                if continuation_key:
                    return {"transactions": [item]}
                return {"transactions": [item], "continuation_key": "next-page"}

        first_run = sync_connection(self.connection, client=PaginatedClient())
        first_page_ids = list(BankTransaction.objects.order_by("remote_id").values_list("pk", flat=True))

        self.assertEqual(first_run.status, first_run.Status.COMPLETED)
        self.assertEqual(BankTransaction.objects.count(), 2)
        self.assertNotEqual(first_page_ids[0], first_page_ids[1])

        second_run = sync_connection(self.connection, client=PaginatedClient())
        replay_ids = list(BankTransaction.objects.order_by("remote_id").values_list("pk", flat=True))

        self.assertEqual(second_run.status, second_run.Status.COMPLETED)
        self.assertEqual(first_page_ids, replay_ids)
        self.assertEqual(BankTransaction.objects.count(), 2)

    def test_bank_confirmation_matches_recurring_without_duplicate_movement(self):
        rule = RecurringRule.objects.create(
            name="Supermercado",
            kind=Category.Kind.EXPENSE,
            amount=Decimal("42.50"),
            account=self.current,
            category=self.food,
            day_of_month=10,
            start_date=date(2026, 6, 1),
        )
        occurrence = RecurringOccurrence.objects.create(rule=rule, due_date=date(2026, 6, 10), amount=Decimal("42.50"))
        row = stage_remote_transaction(self.bank_account, self.remote_item())

        movement = confirm_bank_transaction(row, category=self.food)

        occurrence.refresh_from_db()
        movement.refresh_from_db()
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(movement.source, Transaction.Source.ENABLE_BANKING)
        self.assertEqual(movement.recurring_occurrence, occurrence)
        self.assertEqual(occurrence.status, RecurringOccurrence.Status.CONFIRMED)

    def test_staging_accepts_null_parties_and_remittance(self):
        row = stage_remote_transaction(
            self.bank_account,
            self.remote_item(
                transaction_id="sparse-transaction",
                creditor=None,
                debtor=None,
                remittance_information=None,
                note="Compra con tarjeta",
            ),
        )

        self.assertEqual(row.description, "Compra con tarjeta")

    def test_connection_reuses_single_matching_local_account(self):
        imagin = Account.objects.create(name="Cuenta Imagin")
        connection = create_connection(
            {
                "session_id": "matching-session",
                "accounts": [{"uid": "matching-remote", "name": "Titular", "currency": "EUR"}],
            },
            "imagin",
            "ES",
        )

        self.assertEqual(connection.bank_accounts.get().account, imagin)

    def test_sync_records_unexpected_errors_as_failed(self):
        client = type("BrokenClient", (), {"balances": lambda self, uid: (_ for _ in ()).throw(ValueError())})()

        run = sync_connection(self.connection, client=client)
        self.connection.refresh_from_db()

        self.assertEqual(run.status, run.Status.FAILED)
        self.assertEqual(run.error, "No se pudo sincronizar con el banco. Inténtalo de nuevo.")
        self.assertEqual(self.connection.sync_status, BankConnection.SyncStatus.ERROR)
        self.assertIsNone(self.connection.sync_started_at)

    def test_sync_connection_marks_persistent_state(self):
        class EmptyClient:
            def balances(self, uid):
                return []

            def transactions(self, uid, date_from, continuation_key=None):
                return {"transactions": []}

        run = sync_connection(self.connection, client=EmptyClient())
        self.connection.refresh_from_db()

        self.assertEqual(run.status, run.Status.COMPLETED)
        self.assertEqual(self.connection.sync_status, BankConnection.SyncStatus.IDLE)
        self.assertIsNone(self.connection.sync_started_at)
        self.assertIsNotNone(self.connection.last_synced_at)

    def test_sync_connection_keeps_active_run_visible(self):
        active_run = BankSyncRun.objects.create(connection=self.connection)

        run = sync_connection(self.connection, client=object())
        self.connection.refresh_from_db()

        self.assertEqual(run, active_run)
        self.assertEqual(self.connection.sync_status, BankConnection.SyncStatus.SYNCING)
        self.assertEqual(self.connection.sync_started_at, active_run.started_at)



    def test_async_bank_sync_enqueues_without_provider_io_and_can_be_claimed(self):
        response = self.client.post(reverse("api_bank_sync_async", args=[self.connection.pk]))

        self.assertEqual(response.status_code, 202)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["job_status"], BankSyncRun.Status.QUEUED)
        self.assertEqual(payload["status_url"], reverse("api_bank_sync_status", args=[self.connection.pk]))
        self.assertEqual(BankSyncRun.objects.filter(connection=self.connection).count(), 1)
        self.connection.refresh_from_db()
        self.assertEqual(self.connection.sync_status, BankConnection.SyncStatus.SYNCING)

        claimed = claim_next_bank_sync()
        self.assertEqual(claimed.pk, payload["job_id"])
        self.assertEqual(claimed.status, BankSyncRun.Status.RUNNING)

    def test_enqueue_connection_sync_is_idempotent_while_queued(self):
        first = enqueue_connection_sync(self.connection)
        second = enqueue_connection_sync(self.connection)

        self.assertEqual(first.pk, second.pk)
        self.assertEqual(BankSyncRun.objects.filter(connection=self.connection).count(), 1)




    def test_sync_keeps_connection_authorized_when_bank_rate_limits(self):
        response = requests.Response()
        response.status_code = 429
        client = type("LimitedClient", (), {"balances": lambda self, uid: (_ for _ in ()).throw(requests.HTTPError(response=response))})()

        run = sync_connection(self.connection, client=client)
        self.connection.refresh_from_db()

        self.assertEqual(run.status, run.Status.FAILED)
        self.assertEqual(self.connection.status, BankConnection.Status.AUTHORIZED)
        self.assertIn("reintentará mañana", run.error)

    @patch("ledger.banking.sync_connection")
    def test_daily_sync_skips_recently_synchronized_connections(self, mocked_sync):
        self.connection.last_synced_at = timezone.now()
        self.connection.save(update_fields=["last_synced_at"])

        runs = sync_all_connections()

        self.assertEqual(runs, [])
        mocked_sync.assert_not_called()

    @patch("ledger.banking.sync_connection")
    def test_daily_sync_does_not_repeat_recent_failed_attempts(self, mocked_sync):
        BankSyncRun.objects.create(connection=self.connection, status=BankSyncRun.Status.FAILED)

        runs = sync_all_connections()

        self.assertEqual(runs, [])
        mocked_sync.assert_not_called()

    def test_unattended_sync_fetches_backlog_and_keeps_everything_pending(self):
        self.bank_account.last_transaction_date = timezone.localdate() - timedelta(days=60)
        self.bank_account.save(update_fields=["last_transaction_date"])
        first_page = [
            self.remote_item(transaction_id=f"backlog-{number}", booking_date="2026-05-01")
            for number in range(20)
        ]
        second_page = [
            self.remote_item(transaction_id=f"backlog-{number}", booking_date="2026-06-01")
            for number in range(20, 35)
        ]

        class BacklogClient:
            def balances(self, uid):
                return []

            def transactions(self, uid, date_from, continuation_key=None):
                if continuation_key:
                    return {"transactions": second_page}
                return {"transactions": first_page, "continuation_key": "next-page"}

        run = sync_connection(self.connection, client=BacklogClient())

        self.assertEqual(run.status, run.Status.COMPLETED)
        self.assertEqual(BankTransaction.objects.filter(status=BankTransaction.Status.PENDING).count(), 35)
        self.assertEqual(Transaction.objects.filter(source=Transaction.Source.ENABLE_BANKING).count(), 0)

    def test_llm_prediction_is_validated_and_does_not_auto_apply_by_default(self):
        row = stage_remote_transaction(self.bank_account, self.remote_item())
        prediction = predict_category(
            row,
            request_func=lambda payload: {
                "response": '{"category_id": %s, "confidence": 0.99, "reason": "Compra habitual"}' % self.food.pk
            },
        )
        self.assertEqual(prediction.category, self.food)
        self.assertEqual(row.status, BankTransaction.Status.PENDING)
        self.assertFalse(AutomationSettings.objects.get().auto_apply_enabled)

    def test_category_rule_preselects_category_when_ai_is_disabled_and_keeps_row_pending(self):
        AutomationSettings.objects.create(llm_enabled=False)
        CategoryRule.objects.create(description="Supermercado", kind=Category.Kind.EXPENSE, category=self.food)
        row = stage_remote_transaction(self.bank_account, self.remote_item())

        result = predict_category(
            row,
            request_func=lambda payload: self.fail("No debería llamar al modelo cuando existe una regla exacta."),
        )

        row.refresh_from_db()
        self.assertIsNone(result)
        self.assertEqual(row.category, self.food)
        self.assertEqual(row.status, BankTransaction.Status.PENDING)
        self.assertIsNone(row.transaction_id)
        self.assertFalse(Transaction.objects.filter(source=Transaction.Source.ENABLE_BANKING).exists())

    def test_rule_match_uses_saved_conditions_and_precedence_when_llm_is_disabled(self):
        AutomationSettings.objects.all().delete()
        AutomationSettings.objects.create(llm_enabled=False, auto_apply_enabled=True, confidence_threshold=Decimal("0.900"))
        other_account = Account.objects.create(name="Otra cuenta")
        home = Category.objects.create(name="Hogar", kind=Category.Kind.EXPENSE)
        leisure = Category.objects.create(name="Ocio", kind=Category.Kind.EXPENSE)
        row = stage_remote_transaction(self.bank_account, self.remote_item(remittance_information=["Compra Supermercado Mercado Otro"]))
        CategoryRule.objects.create(description="A Compra", kind=Category.Kind.EXPENSE, category=leisure, priority=1, match_mode=CategoryRule.MatchMode.CONTAINS, active=False)
        CategoryRule.objects.create(description="Otro", kind=Category.Kind.EXPENSE, category=home, priority=1, match_mode=CategoryRule.MatchMode.CONTAINS, account=other_account)
        CategoryRule.objects.create(description="Mercado", kind=Category.Kind.EXPENSE, category=home, priority=1, match_mode=CategoryRule.MatchMode.CONTAINS, account=self.current, amount_min=Decimal("50.00"), amount_max=Decimal("60.00"))
        CategoryRule.objects.create(description="Supermercado", kind=Category.Kind.EXPENSE, category=self.food, priority=3, match_mode=CategoryRule.MatchMode.CONTAINS, account=self.current, amount_min=Decimal("42.00"), amount_max=Decimal("43.00"))
        selected = CategoryRule.objects.create(description="Compra", kind=Category.Kind.EXPENSE, category=leisure, priority=2, match_mode=CategoryRule.MatchMode.CONTAINS, account=self.current, amount_min=Decimal("42.00"), amount_max=Decimal("43.00"))
        CategoryRule.objects.create(description="Co", kind=Category.Kind.EXPENSE, category=self.food, priority=4, match_mode=CategoryRule.MatchMode.CONTAINS, account=self.current, amount_min=Decimal("42.00"), amount_max=Decimal("43.00"))

        result = predict_category(row, request_func=lambda payload: self.fail("La IA está desactivada y hay una regla coincidente."))

        row.refresh_from_db()
        self.assertIsNone(result)
        self.assertEqual(row.category, selected.category, "La prioridad numéricamente menor gana entre reglas coincidentes.")
        self.assertEqual(row.status, BankTransaction.Status.PENDING)
        self.assertEqual(Transaction.objects.count(), 0)

        row.amount = Decimal("50.00")
        row.save(update_fields=["amount"])
        predict_category(row, request_func=lambda payload: self.fail("La regla con rango debe clasificarse sin consultar IA."))
        row.refresh_from_db()
        self.assertEqual(row.category, home, "La regla coincidente cambia al entrar en el rango de importe.")
        self.assertEqual(row.status, BankTransaction.Status.PENDING)

    def test_disabled_llm_does_not_create_a_prediction_when_no_rule_matches(self):
        AutomationSettings.objects.all().delete()
        AutomationSettings.objects.create(llm_enabled=False, auto_apply_enabled=False)
        row = stage_remote_transaction(self.bank_account, self.remote_item(remittance_information=["Sin coincidencia"]))
        result = predict_category(row, request_func=lambda payload: self.fail("La IA está desactivada."))

        self.assertIsNone(result)
        self.assertEqual(row.status, BankTransaction.Status.PENDING)
        self.assertFalse(CategoryPrediction.objects.filter(bank_transaction=row).exists())

    def test_historical_rule_account_scope_uses_csv_batch_account(self):
        rule = CategoryRule.objects.create(
            description="super",
            kind=Category.Kind.EXPENSE,
            category=self.food,
            match_mode=CategoryRule.MatchMode.CONTAINS,
            account=self.current,
        )
        matching_batch = ImportBatch.objects.create(filename="matching.csv", account=self.current)
        other_batch = ImportBatch.objects.create(filename="other.csv", account=self.savings)
        matching_row = ImportRow.objects.create(
            batch=matching_batch, row_number=1, date=date(2026, 6, 10), description="Supermercado",
            amount=Decimal("12.00"), kind=Category.Kind.EXPENSE, fingerprint="csv-scope-match",
        )
        other_row = ImportRow.objects.create(
            batch=other_batch, row_number=1, date=date(2026, 6, 10), description="Supermercado",
            amount=Decimal("12.00"), kind=Category.Kind.EXPENSE, fingerprint="csv-scope-other",
        )

        preview = preview_category_rule(rule)
        self.assertEqual(preview["csv_rows"], 1)
        self.assertEqual([row.pk for row in preview["csv_objects"]], [matching_row.pk])

        result = apply_category_rule_historically(rule)
        matching_row.refresh_from_db()
        other_row.refresh_from_db()
        self.assertEqual(result["csv_rows"], 1)
        self.assertEqual(matching_row.category, self.food)
        self.assertIsNone(other_row.category)
        self.assertEqual(matching_row.status, ImportRow.Status.PENDING)






    def test_llm_rejects_incompatible_category_and_redacts_identifiers(self):
        row = stage_remote_transaction(
            self.bank_account,
            self.remote_item(remittance_information=["ES8200000000000000000000 123456789"]),
        )
        prompt = category_prompt(row, [self.food])
        self.assertNotIn("ES8200000000000000000000", prompt)
        self.assertNotIn("123456789", prompt)
        result = predict_category(
            row,
            request_func=lambda payload: {
                "response": '{"category_id": %s, "confidence": 0.99, "reason": "No compatible"}' % self.salary.pk
            },
        )
        self.assertIsNone(result)
        self.assertEqual(row.prediction.status, row.prediction.Status.FAILED)

    @patch("ledger.banking_callback_views.sync_connection")
    @patch("ledger.banking_callback_views.EnableBankingClient.create_session")
    def test_callback_uses_signed_state_without_browser_session(self, create_session, sync_connection):
        create_session.return_value = {
            "session_id": "authorized-session",
            "access": {},
            "accounts": [],
        }
        state = signing.dumps({"name": "imagin", "country": "ES"}, salt="enable-banking-auth", compress=True)

        response = self.client.get(reverse("bank_callback"), {"state": state, "code": "authorization-code"})

        self.assertEqual(response.status_code, 302)
        self.assertIn("/?tab=accounts", response["Location"])
        self.assertIn("bank_notice=connected", response["Location"])
        self.assertTrue(BankConnection.objects.filter(session_id="authorized-session", bank_name="imagin").exists())
        sync_connection.assert_called_once()

    @patch("ledger.banking_callback_views.sync_connection")
    @patch("ledger.banking_callback_views.EnableBankingClient.create_session")
    def test_callback_returns_to_react_when_next_url_is_present(self, create_session, sync_connection):
        create_session.return_value = {
            "session_id": "authorized-session-react",
            "access": {},
            "accounts": [],
        }
        state = signing.dumps(
            {
                "name": "imagin",
                "country": "ES",
                "next_url": "https://testserver/?tab=accounts",
            },
            salt="enable-banking-auth",
            compress=True,
        )

        response = self.client.get(reverse("bank_callback"), {"state": state, "code": "authorization-code"})

        self.assertEqual(response.status_code, 302)
        self.assertTrue(response["Location"].startswith("/?tab=accounts"))
        self.assertIn("bank_notice=connected", response["Location"])
        self.assertIn("bank_message=Cuenta+bancaria+conectada+y+sincronizada.", response["Location"])
        sync_connection.assert_called_once()

    def test_callback_rejects_invalid_signed_state(self):
        existing = BankConnection.objects.count()
        response = self.client.get(reverse("bank_callback"), {"state": "invalid", "code": "unused"})

        self.assertEqual(response.status_code, 302)
        self.assertTrue(response["Location"].startswith("/?tab=accounts"))
        self.assertIn("bank_notice=error", response["Location"])
        self.assertEqual(BankConnection.objects.count(), existing)

    @patch("ledger.banking_callback_views.sync_connection")
    @patch("ledger.banking_callback_views.EnableBankingClient.create_session")
    def test_callback_rejects_external_return_target(self, create_session, sync_connection):
        create_session.return_value = {
            "session_id": "authorized-session-safe-return",
            "access": {},
            "accounts": [],
        }
        state = signing.dumps(
            {"name": "imagin", "country": "ES", "next_url": "https://example.invalid/phish"},
            salt="enable-banking-auth",
            compress=True,
        )

        response = self.client.get(reverse("bank_callback"), {"state": state, "code": "authorization-code"})

        self.assertEqual(response.status_code, 302)
        self.assertTrue(response["Location"].startswith("/?tab=accounts"))
        self.assertNotIn("example.invalid", response["Location"])
        sync_connection.assert_called_once()
