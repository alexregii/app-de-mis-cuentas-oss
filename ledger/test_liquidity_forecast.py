import uuid
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.db import connection
from django.db.models.query import QuerySet
from django.http import QueryDict
from django.test import SimpleTestCase, TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone

from .calculations.liquidity import calculate_liquidity_forecast
from .models import (
    Account,
    BankAccount,
    BankConnection,
    BankTransaction,
    Category,
    RecurringOccurrence,
    RecurringRule,
    ReconciliationSnapshot,
    SavingsGoal,
    Transaction,
)
from .services import dashboard_metrics


class LiquidityCalculationTests(SimpleTestCase):
    def account(self, account_id, name):
        return SimpleNamespace(pk=account_id, name=name)

    def movement(self, pk, account_id, tx_date, kind, amount, *, transfer_group=None):
        return SimpleNamespace(
            pk=pk,
            account_id=account_id,
            date=tx_date,
            kind=kind,
            amount=Decimal(amount),
            description=f"Movimiento {pk}",
            source="manual",
            transfer_group=transfer_group,
        )

    def occurrence(self, rule_id, account_id, due_date, kind, amount, name):
        rule = SimpleNamespace(pk=rule_id, account_id=account_id, kind=kind, name=name)
        return SimpleNamespace(
            rule=rule,
            rule_id=rule_id,
            due_date=due_date,
            amount=Decimal(amount),
            status="pending",
        )

    def calculate(self, accounts, *, start, end, balances, transactions=(), forecast=(), pre_range=(), reasons=None):
        ids = [account.pk for account in accounts]
        return calculate_liquidity_forecast(
            accounts,
            date_from=start,
            date_to=end,
            starting_balances=balances,
            provenance={account_id: {"kind": "ledger", "cut_date": start - timedelta(days=1)} for account_id in ids},
            unknown_reasons=reasons or {account_id: [] for account_id in ids},
            transactions=transactions,
            forecast_occurrences=forecast,
            pre_range_occurrences=pre_range,
        )

    def test_deficit_precedes_salary_and_income_is_applied_on_its_due_date(self):
        account = self.account(1, "Principal")
        start, end = date(2026, 11, 1), date(2026, 11, 30)
        rent = self.movement(1, 1, date(2026, 11, 5), "expense", "200")
        salary = self.occurrence(2, 1, date(2026, 11, 28), "income", "3000", "Nómina")

        result = self.calculate([account], start=start, end=end, balances={1: Decimal("100")}, transactions=[rent], forecast=[salary])

        self.assertEqual(result["first_deficit_date"], date(2026, 11, 5))
        self.assertEqual(result["minimum_balance"], Decimal("-100"))
        salary_day = next(day for day in result["daily_series"] if day["date"] == date(2026, 11, 28))
        self.assertEqual(salary_day["forecast_income"], Decimal("3000"))
        self.assertEqual(salary_day["closing_balance"], Decimal("2900"))

    def test_pending_pre_range_cashflow_adjusts_the_start_once(self):
        account = self.account(1, "Principal")
        start = date(2026, 11, 3)
        rent = self.occurrence(2, 1, date(2026, 11, 2), "expense", "25", "Alquiler")

        result = self.calculate([account], start=start, end=date(2026, 11, 4), balances={1: Decimal("100")}, pre_range=[rent])

        self.assertEqual(result["starting_balance"], Decimal("75"))
        self.assertEqual(result["accounts"][0]["starting_adjustments"][0]["state"], "forecast_before_start")
        self.assertEqual(result["daily_series"][0]["closing_balance"], Decimal("75"))

    def test_internal_transfers_move_each_account_but_cancel_in_same_day_aggregate(self):
        accounts = [self.account(1, "Diaria"), self.account(2, "Ahorro")]
        group = uuid.uuid4()
        transfer_out = self.movement(1, 1, date(2026, 11, 2), "transfer_out", "25", transfer_group=group)
        transfer_in = self.movement(2, 2, date(2026, 11, 2), "transfer_in", "25", transfer_group=group)

        result = self.calculate(
            accounts,
            start=date(2026, 11, 1),
            end=date(2026, 11, 2),
            balances={1: Decimal("100"), 2: Decimal("50")},
            transactions=[transfer_out, transfer_in],
        )

        self.assertEqual(result["daily_series"][1]["confirmed_transfer_net"], Decimal("0"))
        self.assertEqual(result["daily_series"][1]["closing_balance"], Decimal("150"))
        self.assertEqual(result["accounts"][0]["daily_series"][1]["closing_balance"], Decimal("75"))
        self.assertEqual(result["accounts"][1]["daily_series"][1]["closing_balance"], Decimal("75"))

    def test_unknown_source_suppresses_balances_minimum_and_deficit(self):
        account = self.account(1, "Cuenta enlazada")
        result = self.calculate(
            [account],
            start=date(2026, 11, 1),
            end=date(2026, 11, 2),
            balances={1: Decimal("100")},
            reasons={1: ["no_verified_balance_cut"]},
        )

        self.assertEqual(result["status"], "unknown")
        self.assertIsNone(result["minimum_balance"])
        self.assertIsNone(result["first_deficit_date"])
        self.assertIsNone(result["daily_series"][0]["closing_balance"])


class LiquidityForecastApiTests(TestCase):
    def setUp(self):
        self.today = date(2026, 10, 23)
        self.account = Account.objects.create(name="Principal", opening_balance=Decimal("100"))
        self.expense = Category.objects.create(name="Hogar", kind=Category.Kind.EXPENSE)
        self.income = Category.objects.create(name="Nómina", kind=Category.Kind.INCOME)

    def forecast(self, accounts, start, end, *, today=None):
        params = QueryDict(mutable=True)
        for account_id in accounts:
            params.appendlist("account", str(account_id))
        params["date_from"] = start.isoformat()
        params["date_to"] = end.isoformat()
        with patch("ledger.planning_views.timezone.localdate", return_value=today or self.today):
            return self.client.get(reverse("api_planning_liquidity"), params)

    def transaction(self, account, kind, amount, tx_date, description, **kwargs):
        return Transaction.objects.create(
            account=account,
            kind=kind,
            amount=Decimal(amount),
            date=tx_date,
            description=description,
            category=self.income if kind == Transaction.Kind.INCOME else self.expense if kind == Transaction.Kind.EXPENSE else None,
            **kwargs,
        )

    def bank_link(self, account, *, cut_date, balance="1000", balance_type="CLBD"):
        observed_at = timezone.now() - timedelta(minutes=1)
        connection = BankConnection.objects.create(
            bank_name="Banco de pruebas",
            bank_country="ES",
            session_id=f"liquidity-{uuid.uuid4().hex}",
            status=BankConnection.Status.AUTHORIZED,
            sync_status=BankConnection.SyncStatus.IDLE,
            last_synced_at=observed_at + timedelta(seconds=1),
            authorized_until=timezone.now() + timedelta(days=30),
        )
        return BankAccount.objects.create(
            connection=connection,
            account=account,
            remote_uid=f"liquidity-{uuid.uuid4().hex}",
            display_name="Principal",
            currency="EUR",
            remote_balance=Decimal(balance),
            balance_updated_at=observed_at,
            remote_balance_type=balance_type,
            remote_balance_currency="EUR",
            remote_balance_reference_date=cut_date,
            balance_provenance_updated_at=observed_at,
        )

    def test_uses_booked_cut_and_does_not_reapply_movements_through_that_date(self):
        self.bank_link(self.account, cut_date=date(2026, 10, 22), balance="1000")
        self.transaction(self.account, Transaction.Kind.EXPENSE, "20", date(2026, 10, 22), "Ya incluido en CLBD")
        self.transaction(self.account, Transaction.Kind.EXPENSE, "30", date(2026, 10, 23), "Gasto del día")
        self.transaction(self.account, Transaction.Kind.INCOME, "50", date(2026, 10, 24), "Ingreso del día")

        response = self.forecast([self.account.pk], date(2026, 10, 23), date(2026, 10, 24))

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "known")
        self.assertEqual(payload["starting_balance"], 1000.0)
        self.assertEqual(payload["accounts"][0]["provenance"]["kind"], "bank_booked_balance")
        self.assertEqual(payload["daily_series"][0]["closing_balance"], 970.0)
        self.assertEqual(payload["daily_series"][1]["closing_balance"], 1020.0)

    def test_reconciled_statement_is_a_valid_cut_for_an_unlinked_account(self):
        self.account.opening_balance = Decimal("900")
        self.account.save(update_fields=["opening_balance"])
        ReconciliationSnapshot.objects.create(
            account=self.account,
            date=date(2026, 10, 21),
            statement_balance=Decimal("500"),
            ledger_balance=Decimal("500"),
            difference=Decimal("0"),
            status=ReconciliationSnapshot.Status.RECONCILED,
        )
        self.transaction(self.account, Transaction.Kind.EXPENSE, "25", date(2026, 10, 22), "Después del extracto")

        response = self.forecast([self.account.pk], date(2026, 10, 23), date(2026, 10, 24))

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["accounts"][0]["provenance"]["kind"], "reconciled_statement")
        self.assertEqual(payload["starting_balance"], 475.0)

    def test_future_salary_does_not_hide_an_earlier_daily_deficit(self):
        today = date(2026, 11, 1)
        rent = RecurringRule.objects.create(
            name="Alquiler",
            kind=Category.Kind.EXPENSE,
            amount=Decimal("200"),
            account=self.account,
            category=self.expense,
            frequency=RecurringRule.Frequency.MONTHLY,
            day_of_month=5,
            start_date=today,
        )
        salary = RecurringRule.objects.create(
            name="Nómina",
            kind=Category.Kind.INCOME,
            amount=Decimal("3000"),
            account=self.account,
            category=self.income,
            frequency=RecurringRule.Frequency.MONTHLY,
            day_of_month=28,
            start_date=today,
        )
        SavingsGoal.objects.create(percentage=20, minimum=Decimal("300"))

        response = self.forecast([self.account.pk], today, date(2026, 11, 30), today=today)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertGreater(dashboard_metrics(today, as_of=today)["safe_to_spend"], Decimal("0"))
        self.assertEqual(payload["first_deficit_date"], "2026-11-05")
        self.assertEqual(payload["minimum_balance"], -100.0)
        salary_day = next(day for day in payload["daily_series"] if day["date"] == "2026-11-28")
        self.assertEqual(salary_day["forecast_income"], 3000.0)
        self.assertNotIn(salary.pk, [event.get("source_id") for event in salary_day["cashflows"] if event["state"] == "confirmed"])
        self.assertEqual(RecurringOccurrence.objects.count(), 0)

    def test_pending_rows_after_bank_cut_make_balance_unknown(self):
        link = self.bank_link(self.account, cut_date=date(2026, 10, 22))
        BankTransaction.objects.create(
            bank_account=link,
            remote_id="pending-after-cut",
            booking_date=date(2026, 10, 23),
            description="Cargo sin revisar",
            amount=Decimal("20"),
            kind=Category.Kind.EXPENSE,
            currency="EUR",
            fingerprint="pending-after-cut-fingerprint",
            status=BankTransaction.Status.PENDING,
        )

        response = self.forecast([self.account.pk], date(2026, 10, 23), date(2026, 10, 24))

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "unknown")
        self.assertIsNone(payload["daily_series"][0]["closing_balance"])
        self.assertIn("bank_rows_unreviewed_after_balance_cut", payload["accounts"][0]["unknown_reasons"])

    def test_stale_bank_sync_makes_balance_unknown(self):
        link = self.bank_link(self.account, cut_date=date(2026, 10, 1))
        stale_at = timezone.now() - timedelta(days=14)
        link.connection.last_synced_at = stale_at
        link.connection.save(update_fields=["last_synced_at"])
        link.balance_updated_at = stale_at
        link.balance_provenance_updated_at = stale_at
        link.save(update_fields=["balance_updated_at", "balance_provenance_updated_at"])

        response = self.forecast([self.account.pk], self.today, self.today)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "unknown")
        self.assertIn("bank_sync_stale", response.json()["accounts"][0]["unknown_reasons"])

    def test_bank_sync_at_23_hour_expiry_is_stale(self):
        link = self.bank_link(self.account, cut_date=date(2026, 10, 22))
        synced_at = link.connection.last_synced_at
        link.connection.last_synced_at = synced_at
        link.connection.save(update_fields=["last_synced_at"])
        exact_expiry = synced_at + timedelta(hours=23)

        with patch("ledger.planning_views.timezone.now", return_value=exact_expiry):
            response = self.forecast([self.account.pk], self.today, self.today)

        self.assertEqual(response.status_code, 200)
        self.assertIn("bank_sync_stale", response.json()["accounts"][0]["unknown_reasons"])

    def test_bridge_and_range_use_one_movement_snapshot_during_date_change(self):
        self.bank_link(self.account, cut_date=date(2026, 10, 22), balance="1000")
        movement = self.transaction(
            self.account, Transaction.Kind.EXPENSE, "20", date(2026, 10, 24), "Cambio concurrente"
        )
        original_iter = QuerySet.__iter__
        state = {"changed": False}

        def change_date_after_first_transaction_read(queryset):
            rows = original_iter(queryset)
            if queryset.model is Transaction and not state["changed"]:
                state["changed"] = True
                Transaction.objects.filter(pk=movement.pk).update(date=date(2026, 10, 25))
            return rows

        with patch.object(QuerySet, "__iter__", change_date_after_first_transaction_read):
            response = self.forecast([self.account.pk], date(2026, 10, 25), date(2026, 10, 25))

        self.assertTrue(state["changed"])
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["starting_balance"], 980.0)
        self.assertEqual(payload["daily_series"][0]["closing_balance"], 980.0)
        movement.refresh_from_db()
        self.assertEqual(movement.date, date(2026, 10, 25))

    def test_skipped_and_confirmed_occurrences_are_not_projected_twice_across_leap_month(self):
        today = date(2028, 1, 31)
        month_end_rule = RecurringRule.objects.create(
            name="Servicio día 31",
            kind=Category.Kind.EXPENSE,
            amount=Decimal("10"),
            account=self.account,
            category=self.expense,
            frequency=RecurringRule.Frequency.MONTHLY,
            day_of_month=31,
            start_date=today,
        )
        skipped_rule = RecurringRule.objects.create(
            name="Pago omitido",
            kind=Category.Kind.EXPENSE,
            amount=Decimal("20"),
            account=self.account,
            category=self.expense,
            frequency=RecurringRule.Frequency.YEARLY,
            day_of_month=29,
            start_date=date(2028, 2, 29),
        )
        RecurringOccurrence.objects.create(
            rule=skipped_rule,
            due_date=date(2028, 2, 29),
            amount=Decimal("20"),
            status=RecurringOccurrence.Status.SKIPPED,
        )
        salary_rule = RecurringRule.objects.create(
            name="Ingreso confirmado",
            kind=Category.Kind.INCOME,
            amount=Decimal("50"),
            account=self.account,
            category=self.income,
            frequency=RecurringRule.Frequency.MONTHLY,
            day_of_month=31,
            start_date=today,
        )
        confirmed_occurrence = RecurringOccurrence.objects.create(
            rule=salary_rule,
            due_date=date(2028, 2, 29),
            amount=Decimal("50"),
            status=RecurringOccurrence.Status.CONFIRMED,
        )
        confirmed_transaction = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("50"),
            date=date(2028, 2, 29),
            description="Ingreso confirmado",
            category=self.income,
            source=Transaction.Source.RECURRING,
            recurring_occurrence=confirmed_occurrence,
        )
        occurrence_count = RecurringOccurrence.objects.count()

        response = self.forecast([self.account.pk], today, date(2028, 3, 31), today=today)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        forecast_events = [event for day in payload["daily_series"] for event in day["cashflows"] if event["state"] == "forecast"]
        confirmed_events = [event for day in payload["daily_series"] for event in day["cashflows"] if event["state"] == "confirmed"]
        month_end_dates = [event["date"] for event in forecast_events if event["source_id"] == month_end_rule.pk]
        self.assertEqual(month_end_dates, ["2028-01-31", "2028-02-29", "2028-03-31"])
        self.assertFalse(any(event["source_id"] == skipped_rule.pk for event in forecast_events))
        self.assertFalse(any(event["source_id"] == salary_rule.pk and event["date"] == "2028-02-29" for event in forecast_events))
        self.assertEqual(sum(event["source_id"] == confirmed_transaction.pk for event in confirmed_events), 1)
        self.assertEqual(RecurringOccurrence.objects.count(), occurrence_count)

    def test_confirmed_recurring_occurrence_without_an_active_transaction_is_unknown(self):
        today = self.today
        rule = RecurringRule.objects.create(
            name="Nómina sin ledger",
            kind=Category.Kind.INCOME,
            amount=Decimal("100"),
            account=self.account,
            category=self.income,
            frequency=RecurringRule.Frequency.MONTHLY,
            day_of_month=24,
            start_date=today,
        )
        RecurringOccurrence.objects.create(
            rule=rule,
            due_date=date(2026, 10, 24),
            amount=Decimal("100"),
            status=RecurringOccurrence.Status.CONFIRMED,
        )

        response = self.forecast([self.account.pk], today, date(2026, 10, 25))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "unknown")
        self.assertIn("confirmed_recurring_without_active_transaction", response.json()["accounts"][0]["unknown_reasons"])

    def test_available_bank_balance_is_not_used_as_a_booked_daily_cut(self):
        self.bank_link(self.account, cut_date=date(2026, 10, 22), balance_type="CLAV")

        response = self.forecast([self.account.pk], date(2026, 10, 23), date(2026, 10, 24))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "unknown")
        self.assertIsNone(response.json()["starting_balance"])

    def test_transfer_legs_follow_booking_dates_and_fee_remains_expense(self):
        savings = Account.objects.create(name="Ahorro", kind=Account.Kind.SAVINGS, opening_balance=Decimal("50"))
        group = uuid.uuid4()
        self.transaction(self.account, Transaction.Kind.TRANSFER_OUT, "25", date(2026, 10, 24), "Traspaso", transfer_group=group)
        self.transaction(savings, Transaction.Kind.TRANSFER_IN, "25", date(2026, 10, 25), "Traspaso", transfer_group=group)
        self.transaction(self.account, Transaction.Kind.EXPENSE, "2", date(2026, 10, 24), "Comisión")

        response = self.forecast([self.account.pk, savings.pk], date(2026, 10, 23), date(2026, 10, 25))

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["daily_series"][1]["confirmed_transfer_net"], -25.0)
        self.assertEqual(payload["daily_series"][1]["confirmed_expense"], 2.0)
        self.assertEqual(payload["daily_series"][1]["closing_balance"], 123.0)
        self.assertEqual(payload["daily_series"][2]["confirmed_transfer_net"], 25.0)
        self.assertEqual(payload["daily_series"][2]["closing_balance"], 148.0)

    def test_range_accounts_and_dates_are_validated(self):
        missing_accounts = self.client.get(reverse("api_planning_liquidity"), {"date_from": "2026-10-23", "date_to": "2026-10-23"})
        self.assertEqual(missing_accounts.status_code, 400)

        past = self.forecast([self.account.pk], date(2026, 10, 22), date(2026, 10, 23))
        too_long = self.forecast([self.account.pk], self.today, self.today + timedelta(days=90))
        self.assertEqual(past.status_code, 400)
        self.assertEqual(too_long.status_code, 400)

        for field in ("date_from", "date_to"):
            params = {
                "account": str(self.account.pk),
                "date_from": self.today.isoformat(),
                "date_to": self.today.isoformat(),
            }
            params[field] = "2026-02-30"
            impossible_date = self.client.get(reverse("api_planning_liquidity"), params)
            self.assertEqual(impossible_date.status_code, 400, field)

        inactive = Account.objects.create(name="Archivada", active=False)
        response = self.forecast([inactive.pk], self.today, self.today)
        self.assertEqual(response.status_code, 400)

    def test_daily_cashflow_totals_match_existing_calendar_scenario(self):
        self.transaction(self.account, Transaction.Kind.INCOME, "120", date(2026, 10, 24), "Ingreso")
        self.transaction(self.account, Transaction.Kind.EXPENSE, "35", date(2026, 10, 25), "Compra")
        RecurringRule.objects.create(
            name="Servicio",
            kind=Category.Kind.EXPENSE,
            amount=Decimal("15"),
            account=self.account,
            category=self.expense,
            frequency=RecurringRule.Frequency.MONTHLY,
            day_of_month=26,
            start_date=self.today,
        )

        response = self.forecast([self.account.pk], self.today, date(2026, 10, 31))
        calendar_response = self.client.get(reverse("api_planning_calendar"), {"month": "2026-10"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(calendar_response.status_code, 200)
        forecast_net = sum(
            (day["confirmed_net_cashflow"] + day["forecast_net_cashflow"] for day in response.json()["daily_series"]),
            0,
        )
        calendar_net = sum(
            (day["income"] - day["expense"] + day["transfer_net"] for day in calendar_response.json()["days"] if self.today.isoformat() <= day["date"] <= "2026-10-31"),
            0,
        )
        self.assertEqual(forecast_net, calendar_net)

    def test_forecast_uses_no_more_than_120_queries_for_a_90_day_window(self):
        accounts = [self.account]
        accounts.extend(Account.objects.create(name=f"Cuenta {index}", opening_balance=Decimal("10")) for index in range(2, 5))
        with patch("ledger.planning_views.timezone.localdate", return_value=self.today):
            with CaptureQueriesContext(connection) as queries:
                response = self.client.get(reverse("api_planning_liquidity"), {
                    "account": [str(account.pk) for account in accounts],
                    "date_from": self.today.isoformat(),
                    "date_to": (self.today + timedelta(days=89)).isoformat(),
                })
        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(len(queries), 120)
