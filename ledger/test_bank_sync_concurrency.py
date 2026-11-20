from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from threading import Barrier, Event
from unittest.mock import patch

import requests

from django.db import IntegrityError, close_old_connections, transaction
from django.test import TransactionTestCase
from django.utils import timezone

from .banking import claim_next_bank_sync, enqueue_connection_sync, sync_connection
from .models import Account, BankAccount, BankConnection, BankSyncRun, BankTransaction


class BankSyncConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.account = Account.objects.create(name="Concurrency account")
        self.connection = BankConnection.objects.create(
            bank_name="Concurrent bank",
            session_id="concurrency-session",
        )

    def _run_in_thread(self, callback):
        close_old_connections()
        try:
            return callback()
        finally:
            close_old_connections()

    def test_concurrent_enqueue_creates_one_active_run(self):
        barrier = Barrier(2)
        connections = [BankConnection.objects.get(pk=self.connection.pk) for _ in range(2)]

        def enqueue(connection):
            return self._run_in_thread(
                lambda: (
                    barrier.wait(),
                    enqueue_connection_sync(connection).pk,
                )[1]
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            run_ids = list(executor.map(enqueue, connections))

        self.assertEqual(run_ids[0], run_ids[1])
        self.assertEqual(
            BankSyncRun.objects.filter(
                connection=self.connection,
                status__in=[BankSyncRun.Status.QUEUED, BankSyncRun.Status.RUNNING],
            ).count(),
            1,
        )

    def test_concurrent_claim_uses_compare_and_set(self):
        queued = BankSyncRun.objects.create(
            connection=self.connection,
            status=BankSyncRun.Status.QUEUED,
        )
        barrier = Barrier(2)

        def claim():
            def operation():
                barrier.wait()
                run = claim_next_bank_sync()
                return run.pk if run else None

            return self._run_in_thread(operation)

        with ThreadPoolExecutor(max_workers=2) as executor:
            claimed_ids = list(executor.map(lambda _: claim(), range(2)))

        self.assertEqual(claimed_ids.count(queued.pk), 1)
        self.assertEqual(claimed_ids.count(None), 1)
        queued.refresh_from_db()
        self.assertEqual(queued.status, BankSyncRun.Status.RUNNING)

    def test_claim_skips_a_run_for_a_disconnected_connection(self):
        self.connection.status = BankConnection.Status.DISCONNECTED
        self.connection.save(update_fields=["status"])
        queued = BankSyncRun.objects.create(
            connection=self.connection,
            status=BankSyncRun.Status.QUEUED,
        )

        self.assertIsNone(claim_next_bank_sync())
        queued.refresh_from_db()
        self.assertEqual(queued.status, BankSyncRun.Status.QUEUED)

    def test_partial_unique_constraint_allows_terminal_history_but_not_two_active_runs(self):
        BankSyncRun.objects.create(
            connection=self.connection,
            status=BankSyncRun.Status.RUNNING,
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                BankSyncRun.objects.create(
                    connection=self.connection,
                    status=BankSyncRun.Status.QUEUED,
                )

        completed = BankSyncRun.objects.create(
            connection=self.connection,
            status=BankSyncRun.Status.COMPLETED,
            finished_at=timezone.now() - timedelta(seconds=1),
        )
        self.assertEqual(completed.status, BankSyncRun.Status.COMPLETED)


class BankSyncStaleWorkerRaceTests(TransactionTestCase):
    def setUp(self):
        self.account = Account.objects.create(name="Stale sync account")
        self.connection = BankConnection.objects.create(
            bank_name="Stale sync bank",
            session_id="stale-sync-session",
            status=BankConnection.Status.AUTHORIZED,
            sync_status=BankConnection.SyncStatus.SYNCING,
            sync_started_at=timezone.now() - timedelta(minutes=11),
        )
        self.bank_account = BankAccount.objects.create(
            connection=self.connection,
            account=self.account,
            remote_uid="stale-sync-remote-account",
            display_name="Cuenta obsoleta",
            last_transaction_date=date(2026, 10, 20),
        )
        self.stale_run = BankSyncRun.objects.create(
            connection=self.connection,
            status=BankSyncRun.Status.RUNNING,
        )
        self.stale_run.started_at = timezone.now() - timedelta(minutes=11)
        self.stale_run.save(update_fields=["started_at"])
        self.connection.sync_started_at = self.stale_run.started_at
        self.connection.save(update_fields=["sync_started_at"])

    @staticmethod
    def provider_http_error(status_code):
        response = requests.Response()
        response.status_code = status_code
        return requests.HTTPError(response=response)

    def _run_stale_response_after_new_run(self, *, late_error=False):
        page_requested = Event()
        return_page = Event()

        class StaleClient:
            @staticmethod
            def balances(_remote_uid):
                return [
                    {
                        "balance_type": "CLBD",
                        "balance_amount": {"amount": "12.00", "currency": "EUR"},
                    }
                ]

            @staticmethod
            def transactions(_remote_uid, _date_from, _continuation):
                page_requested.set()
                if not return_page.wait(timeout=10):
                    raise TimeoutError("The test did not release the stale bank page")
                if late_error:
                    raise BankSyncStaleWorkerRaceTests.provider_http_error(401)
                return {
                    "transactions": [
                        {
                            "status": "BOOK",
                            "transaction_amount": {"amount": "8.00", "currency": "EUR"},
                            "credit_debit_indicator": "DBIT",
                            "booking_date": "2026-10-20",
                            "entry_reference": "stale-run-result",
                        }
                    ]
                }

        class CurrentClient:
            @staticmethod
            def balances(_remote_uid):
                return [
                    {
                        "balance_type": "CLBD",
                        "balance_amount": {"amount": "99.00", "currency": "EUR"},
                    }
                ]

            @staticmethod
            def transactions(_remote_uid, _date_from, _continuation):
                return {
                    "transactions": [
                        {
                            "status": "BOOK",
                            "transaction_amount": {"amount": "21.00", "currency": "EUR"},
                            "credit_debit_indicator": "DBIT",
                            "booking_date": "2026-10-22",
                            "entry_reference": "current-run-result",
                        }
                    ]
                }

        def run_stale_worker():
            close_old_connections()
            try:
                return sync_connection(self.connection, client=StaleClient(), run=self.stale_run)
            finally:
                close_old_connections()

        def controlled_localdate():
            from threading import current_thread

            if current_thread().name.startswith("stale-bank-sync"):
                return date(2026, 10, 20)
            return date(2026, 10, 22)

        with patch("ledger.banking.timezone.localdate", side_effect=controlled_localdate):
            with ThreadPoolExecutor(max_workers=1, thread_name_prefix="stale-bank-sync") as executor:
                stale_result = executor.submit(run_stale_worker)
                self.assertTrue(page_requested.wait(timeout=10))

                enqueue_connection_sync(self.connection)
                replacement = claim_next_bank_sync()
                self.assertIsNotNone(replacement)
                self.assertEqual(replacement.status, BankSyncRun.Status.RUNNING)
                completed = sync_connection(replacement.connection, client=CurrentClient(), run=replacement)
                self.assertEqual(completed.status, BankSyncRun.Status.COMPLETED)
                completed.refresh_from_db()
                last_synced_at = BankConnection.objects.get(pk=self.connection.pk).last_synced_at
                return_page.set()
                stale_result = stale_result.result(timeout=10)

        self.stale_run.refresh_from_db()
        self.connection.refresh_from_db()
        self.bank_account.refresh_from_db()
        self.assertEqual(stale_result.status, BankSyncRun.Status.FAILED)
        self.assertEqual(self.stale_run.status, BankSyncRun.Status.FAILED)
        self.assertIn("tardó demasiado", self.stale_run.error)
        self.assertEqual(completed.status, BankSyncRun.Status.COMPLETED)
        self.assertEqual(self.connection.status, BankConnection.Status.AUTHORIZED)
        self.assertEqual(self.connection.sync_status, BankConnection.SyncStatus.IDLE)
        self.assertEqual(self.connection.last_error, "")
        self.assertEqual(self.connection.last_synced_at, last_synced_at)
        self.assertEqual(self.bank_account.remote_balance, Decimal("99.00"))
        self.assertEqual(self.bank_account.remote_balance_type, "CLBD")
        self.assertEqual(self.bank_account.remote_balance_currency, "EUR")
        self.assertEqual(self.bank_account.balance_provenance_updated_at, self.bank_account.balance_updated_at)
        self.assertEqual(self.bank_account.last_transaction_date, date(2026, 10, 22))
        rows = BankTransaction.objects.filter(bank_account=self.bank_account)
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.get().booking_date, date(2026, 10, 22))

    def test_late_success_from_reconciled_run_cannot_overwrite_replacement_run(self):
        self._run_stale_response_after_new_run()

    def test_late_provider_error_from_reconciled_run_cannot_overwrite_replacement_state(self):
        self._run_stale_response_after_new_run(late_error=True)
