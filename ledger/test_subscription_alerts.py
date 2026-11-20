from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase

from .dashboard_services import attention_signals
from .models import Account, Category, Transaction
from .services import detected_subscriptions


class SubscriptionRiseAlertTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create(name="Principal")
        self.category = Category.objects.create(name="Servicios", kind=Category.Kind.EXPENSE)

    def _add_payment(self, year, month, amount, description="Servicio streaming"):
        Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal(amount),
            date=date(year, month, 5),
            description=description,
            category=self.category,
        )

    def _candidates_and_signals(self):
        with patch("ledger.services.timezone.localdate", return_value=date(2026, 6, 14)), patch(
            "ledger.dashboard_services.timezone.localdate", return_value=date(2026, 6, 14)
        ), patch("ledger.dashboard_services.month_bounds", return_value=(date(2026, 6, 1), date(2026, 6, 30))):
            candidates = detected_subscriptions()
            signals = attention_signals(subscriptions=candidates)
        return candidates, signals

    def test_current_payment_increase_does_not_hide_stable_subscription(self):
        for month in range(1, 6):
            self._add_payment(2026, month, "10.00")
        self._add_payment(2026, 6, "13.00")

        candidates, signals = self._candidates_and_signals()

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["median_amount"], Decimal("10.00"))
        self.assertEqual(candidates[0]["latest_amount"], Decimal("13.00"))
        rise = next(item for item in signals if item["title"] == "Suscripción encarecida")
        self.assertEqual(rise["value"], Decimal("13.00"))

    def test_twenty_percent_increase_is_reported(self):
        for month in range(1, 6):
            self._add_payment(2026, month, "10.00")
        self._add_payment(2026, 6, "12.00")

        candidates, signals = self._candidates_and_signals()

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["median_amount"], Decimal("10.00"))
        rise = next(item for item in signals if item["title"] == "Suscripción encarecida")
        self.assertEqual(rise["value"], Decimal("12.00"))
        self.assertEqual(rise["detail"]["latest_amount"], Decimal("12.00"))
        self.assertEqual(rise["detail"]["baseline"], Decimal("10.00"))
        self.assertEqual(rise["detail"]["date"], "2026-06-05")

    def test_decrease_is_not_reported_as_a_price_increase(self):
        for month in range(1, 6):
            self._add_payment(2026, month, "10.00")
        self._add_payment(2026, 6, "8.00")

        candidates, signals = self._candidates_and_signals()

        self.assertEqual(len(candidates), 1)
        self.assertFalse(any(item["title"] == "Suscripción encarecida" for item in signals))

    def test_historical_outlier_and_nonrecurrent_purchase_remain_filtered(self):
        for month, amount in enumerate(("10.00", "15.00", "10.00", "10.00", "10.00"), start=1):
            self._add_payment(2026, month, amount)
        for month in (1, 3, 5):
            self._add_payment(2026, month, "20.00", description="Compra ocasional")

        candidates, signals = self._candidates_and_signals()

        self.assertEqual(candidates, [])
        self.assertFalse(any(item["title"] == "Suscripción encarecida" for item in signals))

    def test_baseline_excludes_the_latest_paid_month_when_current_month_is_missing(self):
        for month in range(1, 5):
            self._add_payment(2026, month, "10.00")
        self._add_payment(2026, 5, "13.00")

        candidates, signals = self._candidates_and_signals()

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["median_amount"], Decimal("10.00"))
        self.assertEqual(candidates[0]["latest_amount"], Decimal("13.00"))
        self.assertFalse(any(item["title"] == "Suscripción encarecida" for item in signals))


    def test_public_median_and_annual_cost_keep_the_full_window_semantics(self):
        for month, amount in enumerate(("10.00", "10.20", "10.40", "10.60", "10.80", "11.00"), start=1):
            self._add_payment(2026, month, amount)

        candidates, _ = self._candidates_and_signals()

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["median_amount"], Decimal("10.50"))
        self.assertEqual(candidates[0]["annual_cost"], Decimal("126.00"))
        self.assertEqual(candidates[0]["previous_median"], Decimal("10.40"))

    def test_heterogeneous_payments_in_the_latest_month_do_not_trigger_a_rise(self):
        for month in range(1, 7):
            self._add_payment(2026, month, "10.00")
        self._add_payment(2026, 6, "100.00")

        candidates, signals = self._candidates_and_signals()

        self.assertEqual(len(candidates), 1)
        self.assertTrue(candidates[0]["exceptional_charge"])
        self.assertFalse(any(item["title"] == "Suscripción encarecida" for item in signals))

    def test_two_consecutive_stable_months_at_a_new_price_confirm_a_step_change(self):
        for month in range(1, 5):
            self._add_payment(2026, month, "10.00")
        self._add_payment(2026, 5, "13.00")
        self._add_payment(2026, 6, "13.00")

        candidates, signals = self._candidates_and_signals()

        self.assertEqual(len(candidates), 1)
        self.assertTrue(candidates[0]["confirmed_step_change"])
        self.assertFalse(candidates[0]["exceptional_charge"])
        self.assertEqual(candidates[0]["previous_median"], Decimal("10.00"))
        rise = next(item for item in signals if item["title"] == "Suscripción encarecida")
        self.assertEqual(rise["detail"]["date"], "2026-06-05")
        self.assertEqual(rise["detail"]["latest_amount"], Decimal("13.00"))

    def test_two_large_current_month_payments_are_not_mislabeled_as_one_exception(self):
        for month in range(1, 6):
            self._add_payment(2026, month, "10.00")
        self._add_payment(2026, 6, "10.00")
        self._add_payment(2026, 6, "100.00")
        self._add_payment(2026, 6, "100.00")

        candidates, signals = self._candidates_and_signals()

        self.assertEqual(candidates, [])
        self.assertFalse(any(item["title"] == "Suscripción encarecida" for item in signals))
