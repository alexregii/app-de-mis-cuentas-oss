from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from threading import Event
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

import requests

from django.core import signing
from django.db import close_old_connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .banking import claim_next_bank_sync, enqueue_connection_sync, sync_connection
from .banking_reconnect import reconnect_connection
from .models import Account, BankAccount, BankConnection, BankSyncRun, BankTransaction, Transaction


class BankReconnectServiceTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create(name="Cuenta Imagin")
        self.connection = BankConnection.objects.create(
            bank_name="imagin",
            bank_country="ES",
            session_id="old-session",
            status=BankConnection.Status.NEEDS_RECONNECT,
            sync_status=BankConnection.SyncStatus.ERROR,
            last_error="Enable Banking respondió HTTP 401.",
        )
        self.balance_observed_at = timezone.now()
        self.link = BankAccount.objects.create(
            connection=self.connection,
            account=self.account,
            remote_uid="old-remote-uid",
            display_name="Titular",
            remote_balance=Decimal("123.45"),
            balance_updated_at=self.balance_observed_at,
            remote_balance_type="CLBD",
            remote_balance_currency="EUR",
            remote_balance_reference_date=date(2026, 9, 9),
            balance_provenance_updated_at=self.balance_observed_at,
            last_transaction_date=date(2026, 9, 10),
        )
        self.movement = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("12.34"),
            date=date(2026, 9, 9),
            description="Histórico",
        )
        self.staged = BankTransaction.objects.create(
            bank_account=self.link,
            remote_id="old-transaction",
            booking_date=date(2026, 9, 9),
            description="Histórico",
            amount=Decimal("12.34"),
            kind="expense",
            fingerprint="f" * 64,
            status=BankTransaction.Status.IMPORTED,
            transaction=self.movement,
        )

    def new_session(self, **overrides):
        data = {
            "session_id": "new-session",
            "aspsp": {"name": "imagin", "country": "ES"},
            "access": {"valid_until": "2026-12-17T12:00:00+00:00"},
            "accounts": [{"uid": "new-remote-uid", "name": "Titular", "currency": "EUR"}],
        }
        data.update(overrides)
        return data

    def test_reconnect_rotates_remote_identity_and_preserves_financial_history(self):
        reconnect_connection(self.connection, self.new_session())

        self.connection.refresh_from_db()
        self.link.refresh_from_db()
        self.assertEqual(self.connection.session_id, "new-session")
        self.assertEqual(self.connection.status, BankConnection.Status.AUTHORIZED)
        self.assertEqual(self.connection.sync_status, BankConnection.SyncStatus.IDLE)
        self.assertEqual(self.connection.last_error, "")
        self.assertEqual(self.link.pk, self.staged.bank_account_id)
        self.assertEqual(self.link.account_id, self.account.pk)
        self.assertEqual(self.link.remote_uid, "new-remote-uid")
        self.assertIsNone(self.link.remote_balance)
        self.assertIsNone(self.link.balance_updated_at)
        self.assertEqual(self.link.remote_balance_type, "")
        self.assertEqual(self.link.remote_balance_currency, "")
        self.assertIsNone(self.link.remote_balance_reference_date)
        self.assertIsNone(self.link.balance_provenance_updated_at)
        self.assertEqual(self.link.last_transaction_date, date(2026, 9, 10))
        self.assertTrue(Transaction.objects.filter(pk=self.movement.pk, account=self.account).exists())
        self.assertTrue(BankTransaction.objects.filter(pk=self.staged.pk, bank_account=self.link).exists())

    def test_reconnect_with_stable_remote_uid_preserves_verified_balance(self):
        session = self.new_session(accounts=[{"uid": "old-remote-uid", "name": "Titular", "currency": "EUR"}])

        reconnect_connection(self.connection, session)

        self.link.refresh_from_db()
        self.assertEqual(self.link.remote_balance, Decimal("123.45"))
        self.assertEqual(self.link.balance_updated_at, self.balance_observed_at)
        self.assertEqual(self.link.remote_balance_type, "CLBD")
        self.assertEqual(self.link.remote_balance_currency, "EUR")
        self.assertEqual(self.link.remote_balance_reference_date, date(2026, 9, 9))
        self.assertEqual(self.link.balance_provenance_updated_at, self.balance_observed_at)

    def test_reconnect_rejects_a_different_bank_without_mutating_connection(self):
        with self.assertRaisesMessage(ValueError, "banco distinto"):
            reconnect_connection(
                self.connection,
                self.new_session(aspsp={"name": "BBVA", "country": "ES"}),
            )

        self.connection.refresh_from_db()
        self.link.refresh_from_db()
        self.assertEqual(self.connection.session_id, "old-session")
        self.assertEqual(self.link.remote_uid, "old-remote-uid")

    def test_reconnect_rejects_ambiguous_account_mapping_atomically(self):
        second_account = Account.objects.create(name="Cuenta Imagin secundaria")
        BankAccount.objects.create(
            connection=self.connection,
            account=second_account,
            remote_uid="old-secondary",
            display_name="Secundaria",
        )
        session = self.new_session(
            accounts=[
                {"uid": "new-a", "name": "Sin coincidencia A", "currency": "EUR"},
                {"uid": "new-b", "name": "Sin coincidencia B", "currency": "EUR"},
            ]
        )

        with self.assertRaisesMessage(ValueError, "inequívoca"):
            reconnect_connection(self.connection, session)

        self.connection.refresh_from_db()
        self.link.refresh_from_db()
        self.assertEqual(self.connection.session_id, "old-session")
        self.assertEqual(self.link.remote_uid, "old-remote-uid")


@override_settings(
    ENABLE_BANKING_APP_ID="test-app",
    ENABLE_BANKING_REDIRECT_URL="https://testserver/bancos/enable-banking/callback/",
    ENABLE_BANKING_PRIVATE_KEY_PATH=__file__,
)
class BankReconnectApiTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create(name="Cuenta Imagin")
        self.connection = BankConnection.objects.create(
            bank_name="imagin",
            bank_country="ES",
            session_id="old-session",
            status=BankConnection.Status.NEEDS_RECONNECT,
            sync_status=BankConnection.SyncStatus.ERROR,
            last_error="Enable Banking respondió HTTP 401.",
        )
        self.link = BankAccount.objects.create(
            connection=self.connection,
            account=self.account,
            remote_uid="old-remote-uid",
            display_name="Titular",
            last_transaction_date=date(2026, 9, 10),
        )

    @patch("ledger.banking_views.EnableBankingClient.start_authorization")
    def test_reconnect_endpoint_signs_existing_connection_identity(self, start_authorization):
        start_authorization.return_value = {"url": "https://auth.example/reconnect"}

        response = self.client.post(
            reverse("api_bank_reconnect", args=[self.connection.pk]),
            data='{"return_to":"https://testserver/?tab=accounts"}',
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["url"], "https://auth.example/reconnect")
        _, _, state = start_authorization.call_args.args
        payload = signing.loads(state, salt="enable-banking-auth")
        self.assertEqual(payload["reconnect_connection_id"], self.connection.pk)
        self.assertEqual(payload["name"], "imagin")
        self.assertEqual(payload["country"], "ES")

    @patch("ledger.banking_views.sync_connection")
    def test_sync_requires_reconnect_instead_of_calling_provider(self, sync_connection):
        response = self.client.post(reverse("api_bank_sync", args=[self.connection.pk]))

        self.assertEqual(response.status_code, 409)
        self.assertTrue(response.json()["reconnect_required"])
        sync_connection.assert_not_called()

    @patch("ledger.banking_views.enqueue_connection_sync")
    def test_async_sync_requires_reconnect_instead_of_enqueuing(self, enqueue_connection_sync):
        response = self.client.post(reverse("api_bank_sync_async", args=[self.connection.pk]))

        self.assertEqual(response.status_code, 409)
        self.assertTrue(response.json()["reconnect_required"])
        enqueue_connection_sync.assert_not_called()

    @patch("ledger.banking_callback_views.sync_connection")
    @patch("ledger.banking_callback_views.EnableBankingClient.create_session")
    def test_callback_reconnects_existing_connection_without_creating_local_account(self, create_session, sync_connection):
        create_session.return_value = {
            "session_id": "renewed-session",
            "aspsp": {"name": "imagin", "country": "ES"},
            "access": {"valid_until": "2026-12-17T12:00:00+00:00"},
            "accounts": [{"uid": "renewed-uid", "name": "Titular", "currency": "EUR"}],
        }
        sync_connection.return_value = SimpleNamespace(status=BankSyncRun.Status.COMPLETED, error="")
        state = signing.dumps(
            {
                "name": "imagin",
                "country": "ES",
                "reconnect_connection_id": self.connection.pk,
                "next_url": "https://testserver/?tab=accounts",
            },
            salt="enable-banking-auth",
            compress=True,
        )

        response = self.client.get(reverse("bank_callback"), {"state": state, "code": "authorization-code"})

        self.assertEqual(response.status_code, 302)
        self.assertIn("bank_notice=reconnected", response["Location"])
        self.assertEqual(BankConnection.objects.count(), 1)
        self.assertEqual(Account.objects.count(), 1)
        self.connection.refresh_from_db()
        self.link.refresh_from_db()
        self.assertEqual(self.connection.session_id, "renewed-session")
        self.assertEqual(self.connection.status, BankConnection.Status.AUTHORIZED)
        self.assertEqual(self.link.account_id, self.account.pk)
        self.assertEqual(self.link.remote_uid, "renewed-uid")
        sync_connection.assert_called_once()


class BankDisconnectViewTests(TransactionTestCase):
    def setUp(self):
        self.account = Account.objects.create(name="Cuenta bancaria")
        self.connection = BankConnection.objects.create(
            bank_name="imagin",
            bank_country="ES",
            session_id="disconnect-session",
            status=BankConnection.Status.AUTHORIZED,
        )
        self.link = BankAccount.objects.create(
            connection=self.connection,
            account=self.account,
            remote_uid="disconnect-account",
            display_name="Cuenta conectada",
        )
        self.transaction = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("24.50"),
            date=date(2026, 10, 20),
            description="Compra importada",
        )
        self.bank_transaction = BankTransaction.objects.create(
            bank_account=self.link,
            remote_id="disconnect-transaction",
            booking_date=date(2026, 10, 20),
            description="Compra importada",
            amount=Decimal("24.50"),
            kind="expense",
            fingerprint="d" * 64,
            status=BankTransaction.Status.IMPORTED,
            transaction=self.transaction,
        )

    @staticmethod
    def provider_http_error(status_code):
        response = requests.Response()
        response.status_code = status_code
        return requests.HTTPError(response=response)

    def assert_history_preserved(self):
        self.connection.refresh_from_db()
        self.assertEqual(self.connection.status, BankConnection.Status.AUTHORIZED)
        self.assertTrue(BankAccount.objects.filter(pk=self.link.pk, account=self.account).exists())
        self.assertTrue(Transaction.objects.filter(pk=self.transaction.pk, description="Compra importada").exists())
        self.assertTrue(BankTransaction.objects.filter(pk=self.bank_transaction.pk, transaction=self.transaction).exists())

    @patch("ledger.banking_views.EnableBankingClient.delete_session")
    def test_provider_rate_limit_and_server_errors_keep_connection_and_history(self, delete_session):
        for exception, expected_status in (
            (self.provider_http_error(429), 429),
            (self.provider_http_error(503), 503),
            (requests.Timeout("provider timeout"), 503),
        ):
            with self.subTest(exception=type(exception).__name__, status=expected_status):
                delete_session.side_effect = exception
                response = self.client.post(reverse("api_bank_disconnect", args=[self.connection.pk]))
                self.assertEqual(response.status_code, expected_status)
                self.assertFalse(response.json()["ok"])
                self.assertIn("estado local no ha cambiado", response.json()["error"])
                self.assert_history_preserved()

    @patch("ledger.banking_views.EnableBankingClient.delete_session")
    def test_active_sync_blocks_disconnect_without_provider_call(self, delete_session):
        BankSyncRun.objects.create(
            connection=self.connection,
            status=BankSyncRun.Status.RUNNING,
        )

        response = self.client.post(reverse("api_bank_disconnect", args=[self.connection.pk]))

        self.assertEqual(response.status_code, 409)
        self.assertFalse(response.json()["ok"])
        delete_session.assert_not_called()
        self.assert_history_preserved()

    @patch("ledger.banking_views.EnableBankingClient.delete_session", return_value={})
    def test_confirmed_remote_revoke_disconnects_locally_and_preserves_history(self, delete_session):
        response = self.client.post(reverse("api_bank_disconnect", args=[self.connection.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(response.json()["connection"]["status"], BankConnection.Status.DISCONNECTED)
        self.connection.refresh_from_db()
        self.assertEqual(self.connection.status, BankConnection.Status.DISCONNECTED)
        self.assertTrue(BankAccount.objects.filter(pk=self.link.pk, account=self.account).exists())
        self.assertTrue(Transaction.objects.filter(pk=self.transaction.pk, description="Compra importada").exists())
        self.assertTrue(BankTransaction.objects.filter(pk=self.bank_transaction.pk, transaction=self.transaction).exists())
        delete_session.assert_called_once_with("disconnect-session")

    @patch("ledger.banking_views.EnableBankingClient.delete_session")
    def test_sync_page_returning_after_confirmed_disconnect_cannot_write(self, delete_session):
        page_requested = Event()
        return_page = Event()
        claimed_runs = []
        worker_results = []

        class DelayedClient:
            @staticmethod
            def balances(_remote_uid):
                return []

            @staticmethod
            def transactions(_remote_uid, _date_from, _continuation):
                page_requested.set()
                if not return_page.wait(timeout=10):
                    raise TimeoutError("The test did not release the bank page")
                return {
                    "transactions": [
                        {
                            "status": "BOOK",
                            "transaction_amount": {"amount": "3.14", "currency": "EUR"},
                            "credit_debit_indicator": "DBIT",
                            "booking_date": "2026-10-22",
                            "entry_reference": "late-sync-after-disconnect",
                        }
                    ]
                }

        def run_claimed_sync(run):
            close_old_connections()
            try:
                return sync_connection(run.connection, client=DelayedClient(), run=run)
            finally:
                close_old_connections()

        def enqueue_and_claim_during_delete(_session_id):
            enqueue_connection_sync(self.connection)
            run = claim_next_bank_sync()
            claimed_runs.append(run)
            worker_results.append(worker_pool.submit(run_claimed_sync, run))
            if not page_requested.wait(timeout=10):
                raise TimeoutError("The worker did not fetch the bank page")

        with ThreadPoolExecutor(max_workers=1) as worker_pool:
            delete_session.side_effect = enqueue_and_claim_during_delete
            response = self.client.post(reverse("api_bank_disconnect", args=[self.connection.pk]))

            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(claimed_runs), 1)
            claimed = claimed_runs[0]
            self.assertIsNotNone(claimed)
            self.connection.refresh_from_db()
            claimed.refresh_from_db()
            self.assertEqual(self.connection.status, BankConnection.Status.DISCONNECTED)
            self.assertEqual(claimed.status, BankSyncRun.Status.FAILED)
            return_page.set()
            result = worker_results[0].result(timeout=10)

        self.assertEqual(result.status, BankSyncRun.Status.FAILED)
        active_runs = BankSyncRun.objects.filter(
            connection=self.connection,
            status__in=(BankSyncRun.Status.QUEUED, BankSyncRun.Status.RUNNING),
        )
        self.assertEqual(active_runs.count(), 0)
        self.connection.refresh_from_db()
        self.assertEqual(self.connection.status, BankConnection.Status.DISCONNECTED)
        self.assertEqual(BankTransaction.objects.filter(bank_account=self.link).count(), 1)

    @patch("ledger.banking_views.EnableBankingClient.delete_session")
    def test_late_delete_for_old_session_preserves_a_reconnected_session_and_run(self, delete_session):
        current_runs = []

        def reconnect_and_start_sync_during_delete(_old_session_id):
            reconnect_connection(
                self.connection,
                {
                    "session_id": "disconnect-session-new",
                    "aspsp": {"name": "imagin", "country": "ES"},
                    "accounts": [
                        {
                            "uid": "disconnect-account-new",
                            "name": "Cuenta conectada",
                            "currency": "EUR",
                        }
                    ],
                },
            )
            connection = BankConnection.objects.get(pk=self.connection.pk)
            enqueue_connection_sync(connection)
            current_runs.append(claim_next_bank_sync())
            return {}

        delete_session.side_effect = reconnect_and_start_sync_during_delete
        response = self.client.post(reverse("api_bank_disconnect", args=[self.connection.pk]))

        self.assertEqual(response.status_code, 409)
        self.assertFalse(response.json()["ok"])
        self.assertEqual(len(current_runs), 1)
        current_runs[0].refresh_from_db()
        self.connection.refresh_from_db()
        self.link.refresh_from_db()
        self.assertEqual(self.connection.session_id, "disconnect-session-new")
        self.assertEqual(self.connection.status, BankConnection.Status.AUTHORIZED)
        self.assertEqual(current_runs[0].status, BankSyncRun.Status.RUNNING)
        self.assertEqual(self.link.remote_uid, "disconnect-account-new")
        self.assertTrue(Transaction.objects.filter(pk=self.transaction.pk).exists())
        self.assertTrue(BankTransaction.objects.filter(pk=self.bank_transaction.pk).exists())
        delete_session.assert_called_once_with("disconnect-session")

    def test_async_sync_rejects_disconnected_connection(self):
        self.connection.status = BankConnection.Status.DISCONNECTED
        self.connection.save(update_fields=["status"])

        response = self.client.post(reverse("api_bank_sync_async", args=[self.connection.pk]))

        self.assertEqual(response.status_code, 409)
        self.assertFalse(response.json()["ok"])
        self.assertEqual(BankSyncRun.objects.filter(connection=self.connection).count(), 0)

        response = self.client.post(reverse("api_bank_sync", args=[self.connection.pk]))

        self.assertEqual(response.status_code, 409)
        self.assertFalse(response.json()["ok"])
        self.assertEqual(BankSyncRun.objects.filter(connection=self.connection).count(), 0)



@override_settings(
    ENABLE_BANKING_APP_ID="test-app",
    ENABLE_BANKING_REDIRECT_URL="https://testserver/bancos/enable-banking/callback/",
    ENABLE_BANKING_PRIVATE_KEY_PATH=__file__,
)
class BankErrorSanitizationTests(TestCase):
    def setUp(self):
        self.connection = BankConnection.objects.create(
            bank_name="imagin",
            bank_country="ES",
            session_id="sanitize-session",
            status=BankConnection.Status.NEEDS_RECONNECT,
        )

    def assert_no_provider_details(self, response):
        self.assertNotIn("SECRET_TOKEN", response.content.decode())
        self.assertNotIn("provider.internal", response.content.decode())
        self.assertNotIn("Enable Banking respondeu", response.content.decode())

    @patch("ledger.banking_views.EnableBankingClient.banks", side_effect=RuntimeError("Bearer SECRET_TOKEN https://provider.internal/private"))
    def test_bank_directory_failure_is_sanitized(self, _banks):
        response = self.client.get(reverse("api_bank_connect"))

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"], "No se pudo consultar el listado de bancos. Inténtalo de nuevo.")
        self.assert_no_provider_details(response)

    @patch("ledger.banking_views.EnableBankingClient.start_authorization", side_effect=RuntimeError("Bearer SECRET_TOKEN https://provider.internal/private"))
    def test_bank_authorization_failure_is_sanitized(self, _start_authorization):
        response = self.client.post(
            reverse("api_bank_connect"),
            data='{"bank_name":"imagin","bank_country":"ES"}',
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"], "No se pudo iniciar la autorización bancaria. Inténtalo de nuevo.")
        self.assert_no_provider_details(response)

    @patch("ledger.banking_views.EnableBankingClient.start_authorization", side_effect=RuntimeError("Bearer SECRET_TOKEN https://provider.internal/private"))
    def test_reconnect_failure_is_sanitized(self, _start_authorization):
        response = self.client.post(
            reverse("api_bank_reconnect", args=[self.connection.pk]),
            data="{}",
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"], "No se pudo iniciar la reconexión bancaria. Inténtalo de nuevo.")
        self.assert_no_provider_details(response)

    def test_callback_does_not_echo_provider_error_description(self):
        state = signing.dumps({"name": "imagin", "country": "ES"}, salt="enable-banking-auth")
        response = self.client.get(
            reverse("bank_callback"),
            {"state": state, "error": "access_denied", "error_description": "Bearer SECRET_TOKEN https://provider.internal/private"},
        )

        self.assertEqual(response.status_code, 302)
        self.assertIn("La autorización bancaria no se completó.", parse_qs(urlsplit(response["Location"]).query)["bank_message"][0])
        self.assertNotIn("SECRET_TOKEN", response["Location"])
        self.assertNotIn("provider.internal", response["Location"])

    @patch("ledger.banking_callback_views.EnableBankingClient.create_session", side_effect=RuntimeError("Bearer SECRET_TOKEN https://provider.internal/private"))
    def test_callback_session_failure_is_sanitized(self, _create_session):
        state = signing.dumps({"name": "imagin", "country": "ES"}, salt="enable-banking-auth")
        response = self.client.get(reverse("bank_callback"), {"state": state, "code": "authorization-code"})

        self.assertEqual(response.status_code, 302)
        self.assertIn("No se pudo completar la conexión bancaria.", parse_qs(urlsplit(response["Location"]).query)["bank_message"][0])
        self.assertNotIn("SECRET_TOKEN", response["Location"])
        self.assertNotIn("provider.internal", response["Location"])

    def test_status_endpoints_sanitize_legacy_connection_and_sync_errors(self):
        raw_error = "Bearer SECRET_TOKEN from provider.internal"
        self.connection.last_error = "Enable Banking respondió HTTP 401."
        self.connection.save(update_fields=["last_error"])
        connection_response = self.client.get(reverse("api_bank_connection_status", args=[self.connection.pk]))

        self.assertEqual(connection_response.json()["connection"]["last_error"], "No se pudo sincronizar con el banco. Inténtalo de nuevo.")
        self.assertNotIn("Enable Banking", connection_response.content.decode())
        self.assertNotIn("SECRET_TOKEN", connection_response.content.decode())
        BankSyncRun.objects.create(connection=self.connection, status=BankSyncRun.Status.FAILED, error=raw_error)
        sync_response = self.client.get(reverse("api_bank_sync_status", args=[self.connection.pk]))

        self.assertEqual(sync_response.json()["error"], "No se pudo sincronizar con el banco. Inténtalo de nuevo.")
        self.assertNotIn("SECRET_TOKEN", sync_response.content.decode())

    def test_safe_sync_errors_remain_actionable(self):
        for message in (
            "El banco ha alcanzado su límite de consultas. Se reintentará mañana.",
            "No se pudo sincronizar con el banco (HTTP 503).",
        ):
            with self.subTest(message=message):
                self.connection.last_error = message
                self.connection.save(update_fields=["last_error"])
                response = self.client.get(reverse("api_bank_connection_status", args=[self.connection.pk]))
                self.assertEqual(response.json()["connection"]["last_error"], message)
