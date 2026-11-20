import json
from datetime import date, timedelta
from decimal import Decimal
from io import BytesIO

from openpyxl import load_workbook
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .bank_review_services import BankTransferConflict, bank_transfer_candidates, confirm_bank_transfer
from .models import Account, BankAccount, BankConnection, BankTransaction, Transaction
from .services import account_balance
from .statistics import statistics_report
from .transaction_services import create_transfer


class BankTransferReviewTests(TestCase):
    def setUp(self):
        self.outgoing_account = Account.objects.create(name="Cuenta origen")
        self.incoming_account = Account.objects.create(name="Cuenta destino")
        self.connection = BankConnection.objects.create(bank_name="Banco de prueba", session_id="bank-transfer-session")
        self.outgoing_bank_account = BankAccount.objects.create(
            connection=self.connection,
            account=self.outgoing_account,
            remote_uid="transfer-out-account",
            display_name="Cuenta origen bancaria",
        )
        self.incoming_bank_account = BankAccount.objects.create(
            connection=self.connection,
            account=self.incoming_account,
            remote_uid="transfer-in-account",
            display_name="Cuenta destino bancaria",
        )
        self.booking_date = timezone.localdate()
        self._row_number = 0

    def bank_row(self, *, outgoing, amount, booking_date=None, status=BankTransaction.Status.PENDING, possible_transfer=False):
        self._row_number += 1
        return BankTransaction.objects.create(
            bank_account=self.outgoing_bank_account if outgoing else self.incoming_bank_account,
            remote_id=f"transfer-row-{self._row_number}",
            booking_date=booking_date or self.booking_date,
            description="Traspaso de prueba",
            amount=Decimal(amount),
            kind="expense" if outgoing else "income",
            currency="EUR",
            fingerprint=str(self._row_number).zfill(64),
            status=status,
            possible_transfer=possible_transfer,
        )

    def test_preview_lists_other_account_opposite_row_and_its_booking_dates(self):
        outgoing = self.bank_row(outgoing=True, amount="100.00")
        incoming = self.bank_row(outgoing=False, amount="100.00", booking_date=self.booking_date + timedelta(days=2))

        candidates = bank_transfer_candidates(outgoing.pk)

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["candidate_type"], "bank_row")
        self.assertEqual(candidates[0]["candidate_id"], str(incoming.pk))
        self.assertEqual(candidates[0]["outgoing"]["date"], outgoing.booking_date)
        self.assertEqual(candidates[0]["incoming"]["date"], incoming.booking_date)
        self.assertEqual(candidates[0]["fee_amount"], Decimal("0.00"))

    def test_confirm_links_a_symmetric_pair_and_applies_each_booking_date(self):
        outgoing = self.bank_row(outgoing=True, amount="100.00")
        incoming = self.bank_row(outgoing=False, amount="100.00", booking_date=self.booking_date + timedelta(days=2))
        income_before = Transaction.objects.filter(kind=Transaction.Kind.INCOME, archived=False).count()
        expense_before = Transaction.objects.filter(kind=Transaction.Kind.EXPENSE, archived=False).count()

        result = confirm_bank_transfer(outgoing.pk, candidate_type="bank_row", candidate_id=incoming.pk)

        outgoing.refresh_from_db()
        incoming.refresh_from_db()
        transfer_out = outgoing.transaction
        transfer_in = incoming.transaction
        self.assertEqual(result["removed"], [outgoing.pk, incoming.pk])
        self.assertEqual(transfer_out.kind, Transaction.Kind.TRANSFER_OUT)
        self.assertEqual(transfer_in.kind, Transaction.Kind.TRANSFER_IN)
        self.assertEqual(transfer_out.transfer_group, transfer_in.transfer_group)
        self.assertEqual(transfer_out.amount, transfer_in.amount)
        self.assertEqual(transfer_out.date, outgoing.booking_date)
        self.assertEqual(transfer_in.date, incoming.booking_date)
        self.assertEqual(outgoing.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(incoming.status, BankTransaction.Status.IMPORTED)
        self.assertIsNone(outgoing.fee_transaction_id)
        self.assertEqual(account_balance(self.outgoing_account), Decimal("-100.00"))
        self.assertEqual(account_balance(self.incoming_account), Decimal("100.00"))
        self.assertEqual(Transaction.objects.filter(kind=Transaction.Kind.INCOME, archived=False).count(), income_before)
        self.assertEqual(Transaction.objects.filter(kind=Transaction.Kind.EXPENSE, archived=False).count(), expense_before)

    def test_same_retry_returns_the_original_pair_without_a_second_debit(self):
        outgoing = self.bank_row(outgoing=True, amount="80.00")
        incoming = self.bank_row(outgoing=False, amount="80.00")

        first = confirm_bank_transfer(outgoing.pk, candidate_type="bank_row", candidate_id=incoming.pk)
        retry = confirm_bank_transfer(outgoing.pk, candidate_type="bank_row", candidate_id=incoming.pk)

        self.assertEqual(first["removed"], retry["removed"])
        self.assertEqual(Transaction.objects.filter(transfer_group__isnull=False).count(), 2)
        self.assertEqual(account_balance(self.outgoing_account), Decimal("-80.00"))
        self.assertEqual(account_balance(self.incoming_account), Decimal("80.00"))

    def test_fee_requires_explicit_confirmation_and_is_linked_as_expense(self):
        self.booking_date = date(2026, 10, 15)
        outgoing = self.bank_row(outgoing=True, amount="100.00")
        incoming = self.bank_row(outgoing=False, amount="99.00")

        with self.assertRaisesMessage(ValueError, "Confirma que la diferencia"):
            confirm_bank_transfer(outgoing.pk, candidate_type="bank_row", candidate_id=incoming.pk)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(outgoing.status, BankTransaction.Status.PENDING)
        self.assertEqual(incoming.status, BankTransaction.Status.PENDING)

        confirm_bank_transfer(outgoing.pk, candidate_type="bank_row", candidate_id=incoming.pk, confirm_fee=True)
        outgoing.refresh_from_db()
        incoming.refresh_from_db()
        self.assertEqual(outgoing.transaction.amount, Decimal("99.00"))
        self.assertEqual(incoming.transaction.amount, Decimal("99.00"))
        self.assertEqual(outgoing.fee_transaction.amount, Decimal("1.00"))
        self.assertEqual(outgoing.fee_transaction.kind, Transaction.Kind.EXPENSE)
        self.assertEqual(outgoing.fee_transaction.date, outgoing.booking_date)
        self.assertEqual(account_balance(self.outgoing_account), Decimal("-100.00"))
        self.assertEqual(account_balance(self.incoming_account), Decimal("99.00"))
        purchase = Transaction.objects.create(
            account=self.outgoing_account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("10.00"),
            date=self.booking_date - timedelta(days=1),
            description="Compra reembolsable",
        )
        refund = Transaction(
            account=self.outgoing_account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("4.00"),
            date=self.booking_date,
            description="Reembolso",
            refund_for=purchase,
        )
        refund.full_clean()
        refund.save()
        summary = statistics_report(self.booking_date.replace(day=1), self.booking_date, "all")["summary"]
        self.assertEqual(summary["refunds_applied"], Decimal("4.00"))
        self.assertEqual(summary["net_expense"], Decimal("7.00"))

    def test_higher_incoming_amount_is_not_assumed_to_be_a_fee(self):
        outgoing = self.bank_row(outgoing=True, amount="99.00")
        incoming = self.bank_row(outgoing=False, amount="100.00")

        with self.assertRaisesMessage(ValueError, "El abono supera a la salida"):
            confirm_bank_transfer(outgoing.pk, candidate_type="bank_row", candidate_id=incoming.pk, confirm_fee=True)

        outgoing.refresh_from_db()
        incoming.refresh_from_db()
        self.assertEqual(outgoing.status, BankTransaction.Status.PENDING)
        self.assertEqual(incoming.status, BankTransaction.Status.PENDING)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_existing_manual_pair_is_linked_without_creating_a_duplicate(self):
        outgoing = self.bank_row(outgoing=True, amount="50.00")
        transfer_out, transfer_in = create_transfer(
            source_account=self.outgoing_account,
            target_account=self.incoming_account,
            amount=Decimal("50.00"),
            tx_date=self.booking_date,
            description="Traspaso manual",
        )
        candidate = next(
            item for item in bank_transfer_candidates(outgoing.pk)
            if item["candidate_type"] == "transfer_group"
        )

        result = confirm_bank_transfer(
            outgoing.pk,
            candidate_type="transfer_group",
            candidate_id=candidate["candidate_id"],
        )

        outgoing.refresh_from_db()
        self.assertEqual(result["removed"], [outgoing.pk])
        self.assertEqual(outgoing.transaction_id, transfer_out.pk)
        self.assertEqual(Transaction.objects.filter(transfer_group=transfer_out.transfer_group).count(), 2)
        self.assertEqual(Transaction.objects.filter(source=Transaction.Source.ENABLE_BANKING).count(), 0)
        self.assertEqual(transfer_in.transfer_group, transfer_out.transfer_group)

    def test_a_skipped_possible_transfer_remains_available_to_link(self):
        outgoing = self.bank_row(
            outgoing=True,
            amount="75.00",
            status=BankTransaction.Status.SKIPPED,
            possible_transfer=True,
        )
        incoming = self.bank_row(outgoing=False, amount="75.00")

        candidates = bank_transfer_candidates(incoming.pk)
        self.assertIn(outgoing.pk, [int(item["candidate_id"]) for item in candidates if item["candidate_type"] == "bank_row"])
        confirm_bank_transfer(incoming.pk, candidate_type="bank_row", candidate_id=outgoing.pk)

        outgoing.refresh_from_db()
        self.assertEqual(outgoing.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(outgoing.transaction.kind, Transaction.Kind.TRANSFER_OUT)

    def test_stale_skipped_row_without_transfer_marker_conflicts_without_mutation(self):
        outgoing = self.bank_row(
            outgoing=True,
            amount="75.00",
            status=BankTransaction.Status.SKIPPED,
            possible_transfer=False,
        )
        incoming = self.bank_row(outgoing=False, amount="75.00")

        with self.assertRaises(BankTransferConflict):
            confirm_bank_transfer(incoming.pk, candidate_type="bank_row", candidate_id=outgoing.pk)
        outgoing.refresh_from_db()
        self.assertEqual(outgoing.status, BankTransaction.Status.SKIPPED)
        self.assertIsNone(outgoing.transaction_id)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_review_api_previews_and_links_an_explicitly_selected_bank_pair(self):
        outgoing = self.bank_row(outgoing=True, amount="100.00")
        incoming = self.bank_row(outgoing=False, amount="100.00", booking_date=self.booking_date + timedelta(days=2))

        options = self.client.get(reverse("api_bank_review_transfer_options", args=[outgoing.pk]))

        self.assertEqual(options.status_code, 200)
        candidate = next(item for item in options.json()["candidates"] if item["candidate_id"] == str(incoming.pk))
        self.assertEqual(candidate["outgoing"]["booking_date"], outgoing.booking_date.isoformat())
        self.assertEqual(candidate["incoming"]["booking_date"], incoming.booking_date.isoformat())
        self.assertEqual(candidate["transfer_amount"], 100.0)

        response = self.client.post(
            reverse("api_bank_review_action", args=[outgoing.pk, "transfer"]),
            data=json.dumps({"candidate_type": "bank_row", "candidate_id": incoming.pk, "confirm_fee": False}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()["removed"]), {outgoing.pk, incoming.pk})
        outgoing.refresh_from_db()
        incoming.refresh_from_db()
        self.assertEqual(outgoing.transaction.transfer_group, incoming.transaction.transfer_group)

    def test_review_api_requires_explicit_fee_confirmation(self):
        outgoing = self.bank_row(outgoing=True, amount="100.00")
        incoming = self.bank_row(outgoing=False, amount="99.00")
        path = reverse("api_bank_review_action", args=[outgoing.pk, "transfer"])
        payload = {"candidate_type": "bank_row", "candidate_id": incoming.pk, "confirm_fee": False}

        response = self.client.post(path, data=json.dumps(payload), content_type="application/json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(outgoing.status, BankTransaction.Status.PENDING)
        payload["confirm_fee"] = True
        response = self.client.post(path, data=json.dumps(payload), content_type="application/json")

        self.assertEqual(response.status_code, 200)
        outgoing.refresh_from_db()
        self.assertEqual(outgoing.fee_transaction.amount, Decimal("1.00"))

    def test_legacy_skipped_transfer_rows_are_separate_from_the_pending_feed(self):
        skipped = self.bank_row(
            outgoing=True,
            amount="50.00",
            status=BankTransaction.Status.SKIPPED,
            possible_transfer=True,
        )
        pending = self.bank_row(outgoing=False, amount="50.00")

        response = self.client.get(reverse("api_bank_review"))

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertNotIn(skipped.pk, [row["id"] for row in payload["rows"]])
        self.assertIn(skipped.pk, [row["id"] for row in payload["unlinked_transfers"]])
        self.assertIn(pending.pk, [row["id"] for row in payload["rows"]])

    def test_legacy_mark_transfer_api_does_not_hide_a_row_without_a_pair(self):
        outgoing = self.bank_row(outgoing=True, amount="50.00")

        response = self.client.post(
            reverse("api_bank_review_action", args=[outgoing.pk, "transfer"]),
            data="{}",
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        outgoing.refresh_from_db()
        self.assertEqual(outgoing.status, BankTransaction.Status.PENDING)
        self.assertFalse(outgoing.possible_transfer)

    def test_reopening_bank_created_pair_returns_both_origins_and_removes_fee(self):
        outgoing = self.bank_row(outgoing=True, amount="100.00")
        incoming = self.bank_row(outgoing=False, amount="99.00")
        confirm_bank_transfer(outgoing.pk, candidate_type="bank_row", candidate_id=incoming.pk, confirm_fee=True)
        outgoing.refresh_from_db()
        incoming.refresh_from_db()
        pair_ids = list(Transaction.objects.filter(transfer_group=outgoing.transaction.transfer_group).values_list("pk", flat=True))
        fee_id = outgoing.fee_transaction_id

        response = self.client.post(reverse("api_transaction_reopen", args=[fee_id]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()["removed"]), set(pair_ids + [fee_id]))
        self.assertFalse(Transaction.objects.filter(pk__in=pair_ids + [fee_id]).exists())
        for row in (outgoing, incoming):
            row.refresh_from_db()
            self.assertEqual(row.status, BankTransaction.Status.PENDING)
            self.assertFalse(row.possible_transfer)
            self.assertIsNone(row.transaction_id)
            self.assertIsNone(row.fee_transaction_id)
        review_ids = [row["id"] for row in self.client.get(reverse("api_bank_review")).json()["rows"]]
        self.assertTrue({outgoing.pk, incoming.pk}.issubset(review_ids))

    def test_reopening_a_manual_pair_returns_all_origins_and_preserves_the_pair(self):
        outgoing = self.bank_row(outgoing=True, amount="101.00")
        incoming = self.bank_row(outgoing=False, amount="100.00")
        transfer_out, transfer_in = create_transfer(
            source_account=self.outgoing_account,
            target_account=self.incoming_account,
            amount=Decimal("100.00"),
            tx_date=self.booking_date,
            description="Traspaso manual enlazado",
        )
        confirm_bank_transfer(outgoing.pk, candidate_type="transfer_group", candidate_id=transfer_out.transfer_group, confirm_fee=True)
        confirm_bank_transfer(incoming.pk, candidate_type="transfer_group", candidate_id=transfer_in.transfer_group)
        outgoing.refresh_from_db()
        fee_id = outgoing.fee_transaction_id

        ledger = self.client.get(reverse("api_transactions")).json()
        can_reopen = {row["id"]: row["can_reopen"] for row in ledger["results"]}
        self.assertTrue(can_reopen[transfer_out.pk])
        self.assertTrue(can_reopen[transfer_in.pk])

        response = self.client.post(reverse("api_transaction_reopen", args=[transfer_out.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertIn(fee_id, response.json()["removed"])
        self.assertNotIn(transfer_out.pk, response.json()["removed"])
        self.assertNotIn(transfer_in.pk, response.json()["removed"])
        self.assertTrue(Transaction.objects.filter(pk=transfer_out.pk, archived=False).exists())
        self.assertTrue(Transaction.objects.filter(pk=transfer_in.pk, archived=False).exists())
        outgoing.refresh_from_db()
        incoming.refresh_from_db()
        self.assertEqual(outgoing.status, BankTransaction.Status.PENDING)
        self.assertIsNone(outgoing.transaction_id)
        self.assertIsNone(outgoing.fee_transaction_id)
        self.assertEqual(incoming.status, BankTransaction.Status.PENDING)
        self.assertIsNone(incoming.transaction_id)
        self.assertIsNone(incoming.fee_transaction_id)

    def test_archiving_transfer_pair_archives_linked_fee_and_preserves_bank_links(self):
        outgoing = self.bank_row(outgoing=True, amount="100.00")
        incoming = self.bank_row(outgoing=False, amount="99.00")
        confirm_bank_transfer(outgoing.pk, candidate_type="bank_row", candidate_id=incoming.pk, confirm_fee=True)
        outgoing.refresh_from_db()
        incoming.refresh_from_db()
        pair_ids = list(Transaction.objects.filter(transfer_group=outgoing.transaction.transfer_group).values_list("pk", flat=True))
        fee_id = outgoing.fee_transaction_id

        response = self.client.post(reverse("api_transaction_archive", args=[fee_id]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Transaction.objects.filter(pk__in=pair_ids + [fee_id], archived=True).count(), 3)
        outgoing.refresh_from_db()
        incoming.refresh_from_db()
        self.assertEqual(outgoing.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(incoming.status, BankTransaction.Status.IMPORTED)
        self.assertIn(outgoing.transaction_id, pair_ids)
        self.assertIn(incoming.transaction_id, pair_ids)
        self.assertEqual(outgoing.fee_transaction_id, fee_id)

    def test_refund_on_fee_blocks_reopen_and_archive_without_detaching_origins(self):
        outgoing = self.bank_row(outgoing=True, amount="100.00")
        incoming = self.bank_row(outgoing=False, amount="99.00")
        confirm_bank_transfer(outgoing.pk, candidate_type="bank_row", candidate_id=incoming.pk, confirm_fee=True)
        outgoing.refresh_from_db()
        incoming.refresh_from_db()
        fee = outgoing.fee_transaction
        refund = Transaction(
            account=self.outgoing_account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("0.50"),
            date=self.booking_date,
            description="Devolución de comisión",
            refund_for=fee,
        )
        refund.full_clean()
        refund.save()

        reopen = self.client.post(reverse("api_transaction_reopen", args=[fee.pk]))
        archive = self.client.post(reverse("api_transaction_archive", args=[outgoing.transaction_id]))

        self.assertEqual(reopen.status_code, 400)
        self.assertEqual(archive.status_code, 400)
        self.assertTrue(Transaction.objects.filter(pk=fee.pk, archived=False).exists())
        self.assertTrue(Transaction.objects.filter(pk=refund.pk, archived=False).exists())
        outgoing.refresh_from_db()
        incoming.refresh_from_db()
        self.assertEqual(outgoing.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(incoming.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(outgoing.fee_transaction_id, fee.pk)

    def test_api_rejects_edits_to_a_fee_while_its_bank_origin_is_linked(self):
        outgoing = self.bank_row(outgoing=True, amount="100.00")
        incoming = self.bank_row(outgoing=False, amount="99.00")
        confirm_bank_transfer(outgoing.pk, candidate_type="bank_row", candidate_id=incoming.pk, confirm_fee=True)
        outgoing.refresh_from_db()
        fee = outgoing.fee_transaction

        response = self.client.patch(
            reverse("api_transaction_detail", args=[fee.pk]),
            data=json.dumps({"amount": "25.00", "date": (self.booking_date + timedelta(days=1)).isoformat()}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        fee.refresh_from_db()
        outgoing.refresh_from_db()
        self.assertEqual(fee.amount, Decimal("1.00"))
        self.assertEqual(fee.date, outgoing.booking_date)
        self.assertEqual(outgoing.fee_transaction_id, fee.pk)
        self.assertEqual(account_balance(self.outgoing_account), Decimal("-100.00"))

    def test_excel_export_keeps_both_transfer_legs_and_the_separate_fee(self):
        outgoing = self.bank_row(outgoing=True, amount="100.00")
        incoming = self.bank_row(outgoing=False, amount="99.00")
        confirm_bank_transfer(outgoing.pk, candidate_type="bank_row", candidate_id=incoming.pk, confirm_fee=True)
        outgoing.refresh_from_db()
        incoming.refresh_from_db()
        transaction_ids = [outgoing.transaction_id, incoming.transaction_id, outgoing.fee_transaction_id]

        response = self.client.get(
            reverse("export_excel"),
            {"transaction_ids": ",".join(map(str, transaction_ids))},
        )

        self.assertEqual(response.status_code, 200)
        workbook = load_workbook(BytesIO(response.content), read_only=True)
        rows = list(workbook["Movimientos"].iter_rows(min_row=2, values_only=True))
        self.assertEqual(
            {row[3] for row in rows},
            {"Traspaso de prueba", "Comisión del traspaso: Traspaso de prueba"},
        )
        self.assertEqual(sorted(row[5] for row in rows), [-99.0, -1.0, 99.0])
