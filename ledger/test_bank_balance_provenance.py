from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from .api_serializers import api_account
from .banking import sync_connection
from .banking_staging import ProviderBalance, select_balance
from .models import Account, BankAccount, BankConnection, BankTransaction


class SelectBalanceTests(SimpleTestCase):
    def test_prefers_booked_balance_with_currency_and_reference_date(self):
        selected = select_balance(
            [
                {
                    "balance_type": "CLAV",
                    "balance_amount": {"amount": "99.00", "currency": "EUR"},
                    "reference_date": "2026-10-20",
                },
                {
                    "balance_type": "CLBD",
                    "balance_amount": {"amount": "12.34", "currency": "EUR"},
                    "reference_date": "2026-10-19",
                },
            ],
            currency="EUR",
        )

        self.assertEqual(selected, ProviderBalance(Decimal("12.34"), "CLBD", "EUR", date(2026, 10, 19)))

    def test_skips_preferred_balance_with_a_different_currency(self):
        selected = select_balance(
            [
                {"balance_type": "CLBD", "balance_amount": {"amount": "500.00", "currency": "GBP"}},
                {"balance_type": "ITBD", "balance_amount": {"amount": "25.50", "currency": "EUR"}},
            ],
            currency="EUR",
        )

        self.assertEqual(selected, ProviderBalance(Decimal("25.50"), "ITBD", "EUR", None))

    def test_ignores_invalid_amounts_missing_currency_and_unknown_types(self):
        selected = select_balance(
            [
                {"balance_type": "CLBD", "balance_amount": {"amount": "NaN", "currency": "EUR"}},
                {"balance_type": "ITBD", "balance_amount": {"amount": "2.00"}},
                {"balance_type": "INFO", "balance_amount": {"amount": "7.00", "currency": "EUR"}},
                {"balance_type": "CLAV", "balance_amount": "malformed"},
            ],
            currency="EUR",
        )

        self.assertIsNone(selected)

    def test_impossible_optional_reference_date_is_unknown_not_a_failed_balance(self):
        for reference_date in ("2026-02-30", "2026-13-01"):
            with self.subTest(reference_date=reference_date):
                selected = select_balance(
                    [
                        {
                            "balance_type": "CLBD",
                            "balance_amount": {"amount": "12.34", "currency": "EUR"},
                            "reference_date": reference_date,
                        }
                    ],
                    currency="EUR",
                )

                self.assertEqual(selected, ProviderBalance(Decimal("12.34"), "CLBD", "EUR", None))


class BankBalancePersistenceTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create(name="Cuenta de balance")
        self.connection = BankConnection.objects.create(
            bank_name="Banco balance",
            session_id="balance-session",
            status=BankConnection.Status.AUTHORIZED,
        )
        self.bank_account = BankAccount.objects.create(
            connection=self.connection,
            account=self.account,
            remote_uid="balance-remote-account",
            display_name="Cuenta EUR",
            currency="EUR",
        )

    @staticmethod
    def provider_client(balances, transactions=None):
        return SimpleNamespace(
            balances=lambda _remote_uid: balances,
            transactions=lambda *_args: {"transactions": transactions or []},
        )

    def test_sync_persists_type_currency_reference_and_one_observation_instant(self):
        completed = sync_connection(
            self.connection,
            client=self.provider_client(
                [
                    {
                        "balance_type": "CLBD",
                        "balance_amount": {"amount": "0.00", "currency": "EUR"},
                        "reference_date": "2026-10-21",
                    }
                ]
            ),
        )

        self.assertEqual(completed.status, "completed")
        self.bank_account.refresh_from_db()
        self.assertEqual(self.bank_account.remote_balance, Decimal("0.00"))
        self.assertEqual(self.bank_account.remote_balance_type, "CLBD")
        self.assertEqual(self.bank_account.remote_balance_currency, "EUR")
        self.assertEqual(self.bank_account.remote_balance_reference_date, date(2026, 10, 21))
        self.assertEqual(self.bank_account.balance_provenance_updated_at, self.bank_account.balance_updated_at)

    def test_sync_with_no_compatible_balance_preserves_last_verified_sample(self):
        observed_at = timezone.now()
        self.bank_account.remote_balance = Decimal("35.00")
        self.bank_account.remote_balance_type = "CLBD"
        self.bank_account.remote_balance_currency = "EUR"
        self.bank_account.remote_balance_reference_date = date(2026, 10, 20)
        self.bank_account.balance_updated_at = observed_at
        self.bank_account.balance_provenance_updated_at = observed_at
        self.bank_account.save()

        completed = sync_connection(
            self.connection,
            client=self.provider_client(
                [{"balance_type": "CLBD", "balance_amount": {"amount": "75.00", "currency": "GBP"}}]
            ),
        )

        self.assertEqual(completed.status, "completed")
        self.bank_account.refresh_from_db()
        self.assertEqual(self.bank_account.remote_balance, Decimal("35.00"))
        self.assertEqual(self.bank_account.balance_updated_at, observed_at)
        self.assertEqual(self.bank_account.remote_balance_reference_date, date(2026, 10, 20))

    def test_impossible_optional_reference_date_does_not_abort_transaction_sync(self):
        completed = sync_connection(
            self.connection,
            client=self.provider_client(
                [
                    {
                        "balance_type": "CLBD",
                        "balance_amount": {"amount": "12.34", "currency": "EUR"},
                        "reference_date": "2026-02-30",
                    }
                ],
                transactions=[
                    {
                        "status": "BOOK",
                        "transaction_amount": {"amount": "8.00", "currency": "EUR"},
                        "credit_debit_indicator": "DBIT",
                        "booking_date": "2026-10-21",
                        "entry_reference": "valid-transaction-despite-invalid-balance-date",
                    }
                ],
            ),
        )

        self.assertEqual(completed.status, "completed")
        self.bank_account.refresh_from_db()
        self.assertEqual(self.bank_account.remote_balance, Decimal("12.34"))
        self.assertIsNone(self.bank_account.remote_balance_reference_date)
        imported = BankTransaction.objects.get(bank_account=self.bank_account)
        self.assertEqual(imported.description, "Movimiento bancario")
        self.assertEqual(imported.booking_date, date(2026, 10, 21))

    def test_api_does_not_expose_legacy_or_stale_balance_as_a_verified_zero_or_amount(self):
        observed_at = timezone.now()
        self.bank_account.remote_balance = Decimal("50.00")
        self.bank_account.balance_updated_at = observed_at
        self.bank_account.remote_balance_type = "CLBD"
        self.bank_account.remote_balance_currency = "EUR"
        self.bank_account.remote_balance_reference_date = date(2026, 10, 20)
        self.bank_account.balance_provenance_updated_at = observed_at - timedelta(seconds=1)
        self.bank_account.save()

        payload = api_account(self.account)["bank_link"]

        self.assertIsNone(payload["remote_balance"])
        self.assertEqual(payload["remote_balance_type"], "")
        self.assertEqual(payload["remote_balance_currency"], "")
        self.assertEqual(payload["remote_balance_reference_date"], "")
        self.assertEqual(payload["balance_updated_at"], "")

    def test_api_keeps_a_verified_zero_as_a_real_zero(self):
        observed_at = timezone.now()
        self.bank_account.remote_balance = Decimal("0.00")
        self.bank_account.balance_updated_at = observed_at
        self.bank_account.remote_balance_type = "CLBD"
        self.bank_account.remote_balance_currency = "EUR"
        self.bank_account.balance_provenance_updated_at = observed_at
        self.bank_account.save()

        payload = api_account(self.account)["bank_link"]

        self.assertEqual(payload["remote_balance"], 0.0)
        self.assertEqual(payload["remote_balance_type"], "CLBD")
