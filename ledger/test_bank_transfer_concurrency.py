import json
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier, Event
from types import SimpleNamespace
from unittest.mock import patch

from django.conf import settings
from django.core.management import call_command
from django.db import close_old_connections, connections
from django.test import Client, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .bank_review_services import confirm_bank_transfer
from .models import Account, BankAccount, BankConnection, BankTransaction, Category, Transaction, TransactionAllocation
from .services import account_balance


class BankTransferLifecycleConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        super().setUp()
        self._database_temp = TemporaryDirectory()
        databases = deepcopy(settings.DATABASES)
        databases["default"]["NAME"] = Path(self._database_temp.name) / "m08-races.sqlite3"
        databases["default"]["OPTIONS"] = {
            **databases["default"].get("OPTIONS", {}),
            "timeout": 20,
            "transaction_mode": "IMMEDIATE",
        }
        connections.close_all()
        self._database_override = override_settings(DATABASES=databases)
        self._database_override.enable()
        connections.__dict__.pop("settings", None)
        connections._settings = None
        try:
            del connections["default"]
        except AttributeError:
            pass
        call_command("migrate", database="default", interactive=False, verbosity=0)
        self.assertEqual(
            Path(connections["default"].settings_dict["NAME"]),
            Path(self._database_temp.name) / "m08-races.sqlite3",
        )

        self.outgoing_account = Account.objects.create(name="Origen carrera")
        self.incoming_account = Account.objects.create(name="Destino carrera")
        connection = BankConnection.objects.create(bank_name="Banco carrera", session_id="m08-race-session")
        self.outgoing_bank_account = BankAccount.objects.create(
            connection=connection,
            account=self.outgoing_account,
            remote_uid="m08-race-out",
            display_name="Origen carrera",
        )
        self.incoming_bank_account = BankAccount.objects.create(
            connection=connection,
            account=self.incoming_account,
            remote_uid="m08-race-in",
            display_name="Destino carrera",
        )
        self.booking_date = timezone.localdate()
        self._row_number = 0

    def tearDown(self):
        connections.close_all()
        self._database_override.disable()
        connections.__dict__.pop("settings", None)
        connections._settings = None
        try:
            del connections["default"]
        except AttributeError:
            pass
        connections.close_all()
        self._database_temp.cleanup()
        super().tearDown()

    def bank_row(self, *, outgoing, amount):
        self._row_number += 1
        return BankTransaction.objects.create(
            bank_account=self.outgoing_bank_account if outgoing else self.incoming_bank_account,
            remote_id=f"m08-race-row-{self._row_number}",
            booking_date=self.booking_date,
            description="Traspaso en carrera",
            amount=Decimal(amount),
            kind="expense" if outgoing else "income",
            currency="EUR",
            fingerprint=str(self._row_number).zfill(64),
        )

    def link_fee_transfer(self):
        outgoing = self.bank_row(outgoing=True, amount="100.00")
        incoming = self.bank_row(outgoing=False, amount="99.00")
        confirm_bank_transfer(
            outgoing.pk,
            candidate_type="bank_row",
            candidate_id=incoming.pk,
            confirm_fee=True,
        )
        outgoing.refresh_from_db()
        incoming.refresh_from_db()
        return outgoing, incoming, outgoing.transaction, outgoing.fee_transaction

    def concurrent(self, barrier, operation):
        close_old_connections()
        try:
            barrier.wait(timeout=5)
            return operation(Client())
        finally:
            close_old_connections()

    def test_refund_and_transfer_archive_are_serialized_on_file_sqlite(self):
        outgoing, incoming, transfer_out, fee = self.link_fee_transfer()
        barrier = Barrier(2)
        refund_payload = json.dumps({
            "kind": Transaction.Kind.INCOME,
            "amount": "0.50",
            "account": self.outgoing_account.pk,
            "date": self.booking_date.isoformat(),
            "description": "Devolución de comisión en carrera",
            "refund_for": fee.pk,
        })

        def create_refund(client):
            return client.post(reverse("api_transactions"), data=refund_payload, content_type="application/json")

        def archive_transfer(client):
            return client.post(reverse("api_transaction_archive", args=[transfer_out.pk]))

        with ThreadPoolExecutor(max_workers=2) as executor:
            refund_future = executor.submit(self.concurrent, barrier, create_refund)
            archive_future = executor.submit(self.concurrent, barrier, archive_transfer)
            refund_response = refund_future.result(timeout=20)
            archive_response = archive_future.result(timeout=20)

        outgoing.refresh_from_db()
        incoming.refresh_from_db()
        fee.refresh_from_db()
        refunds = list(Transaction.objects.filter(refund_for_id=fee.pk))
        self.assertFalse(refund_response.status_code == 201 and archive_response.status_code == 200)
        if refund_response.status_code == 201:
            self.assertEqual(archive_response.status_code, 400)
            self.assertFalse(fee.archived)
            self.assertEqual(len(refunds), 1)
            self.assertFalse(refunds[0].archived)
        else:
            self.assertEqual(refund_response.status_code, 400)
            self.assertEqual(archive_response.status_code, 200)
            self.assertTrue(fee.archived)
            self.assertEqual(refunds, [])
        self.assertEqual(outgoing.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(incoming.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(outgoing.transaction_id, transfer_out.pk)
        self.assertEqual(outgoing.fee_transaction_id, fee.pk)

    def test_bulk_category_and_split_edit_are_serialized_on_file_sqlite(self):
        original_category = Category.objects.create(name="Compra original carrera", kind=Category.Kind.EXPENSE)
        target_category = Category.objects.create(name="Compra destino carrera", kind=Category.Kind.EXPENSE)
        split_category = Category.objects.create(name="Compra partida carrera", kind=Category.Kind.EXPENSE)
        movement = Transaction.objects.create(
            account=self.outgoing_account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("100.00"),
            date=self.booking_date,
            description="Movimiento para carrera bulk/split",
            category=original_category,
        )
        allocations_checked_empty = Event()
        continue_bulk = Event()
        split_started = Event()

        def filter_allocations(*args, **kwargs):
            queryset = TransactionAllocation.objects.filter(*args, **kwargs)
            if kwargs.get("transaction_id__in") == [movement.pk]:
                original_exists = queryset.exists

                def exists_with_pause():
                    result = original_exists()
                    if not result:
                        allocations_checked_empty.set()
                        if not continue_bulk.wait(timeout=10):
                            raise TimeoutError("bulk test did not release its deferred allocation check")
                    return result

                queryset.exists = exists_with_pause
            return queryset

        allocation_model_proxy = SimpleNamespace(objects=SimpleNamespace(filter=filter_allocations))

        def bulk_category(client):
            return client.post(
                reverse("api_transaction_bulk_category"),
                data=json.dumps({"rows": [movement.pk], "category": target_category.pk}),
                content_type="application/json",
            )

        def create_split(client):
            split_started.set()
            return client.patch(
                reverse("api_transaction_detail", args=[movement.pk]),
                data=json.dumps({
                    "allocations": [
                        {"category_id": target_category.pk, "amount": "60.00"},
                        {"category_id": split_category.pk, "amount": "40.00"},
                    ],
                    "expected_allocation_revision": 0,
                }),
                content_type="application/json",
            )

        try:
            with patch("ledger.transaction_views.TransactionAllocation", allocation_model_proxy):
                with ThreadPoolExecutor(max_workers=2) as executor:
                    bulk_future = executor.submit(self.concurrent, Barrier(1), bulk_category)
                    self.assertTrue(allocations_checked_empty.wait(timeout=5))
                    split_future = executor.submit(self.concurrent, Barrier(1), create_split)
                    self.assertTrue(split_started.wait(timeout=5))
                    continue_bulk.set()
                    bulk_response = bulk_future.result(timeout=20)
                    split_response = split_future.result(timeout=20)
        finally:
            continue_bulk.set()

        self.assertEqual(bulk_response.status_code, 200, bulk_response.content)
        self.assertEqual(split_response.status_code, 200, split_response.content)
        movement.refresh_from_db()
        self.assertIsNone(movement.category_id)
        self.assertEqual(
            list(movement.allocations.order_by("position").values_list("category_id", "amount")),
            [(target_category.pk, Decimal("60.00")), (split_category.pk, Decimal("40.00"))],
        )
        self.assertEqual(account_balance(self.outgoing_account), Decimal("-100.00"))

    def test_stale_patch_racing_reopen_never_resurrects_the_imported_movement(self):
        row = self.bank_row(outgoing=True, amount="50.00")
        movement = Transaction.objects.create(
            account=self.outgoing_account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("50.00"),
            date=self.booking_date,
            description="Movimiento importado concurrente",
            source=Transaction.Source.ENABLE_BANKING,
        )
        row.transaction = movement
        row.status = BankTransaction.Status.IMPORTED
        row.save(update_fields=["transaction", "status"])
        barrier = Barrier(2)

        def patch_movement(client):
            return client.patch(
                reverse("api_transaction_detail", args=[movement.pk]),
                data=json.dumps({"description": "Edición concurrente"}),
                content_type="application/json",
            )

        def reopen_movement(client):
            return client.post(reverse("api_transaction_reopen", args=[movement.pk]))

        with ThreadPoolExecutor(max_workers=2) as executor:
            patch_future = executor.submit(self.concurrent, barrier, patch_movement)
            reopen_future = executor.submit(self.concurrent, barrier, reopen_movement)
            patch_response = patch_future.result(timeout=20)
            reopen_response = reopen_future.result(timeout=20)

        row.refresh_from_db()
        self.assertIn(patch_response.status_code, {200, 404, 409})
        self.assertEqual(reopen_response.status_code, 200)
        self.assertEqual(row.status, BankTransaction.Status.PENDING)
        self.assertEqual(row.transaction_id, movement.pk)
        movement.refresh_from_db()
        self.assertTrue(movement.archived)
