from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
import json
import time
from threading import Barrier, Event
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.db import OperationalError, close_old_connections, connection
from django.middleware.csrf import get_token
from django.test import Client, RequestFactory, TransactionTestCase
from django.urls import reverse

from .banking_staging import stage_remote_transaction
from .banking_categorization import predict_category
from .bank_review_services import confirm_bank_transaction
from .banking_views import perform_bank_review_action
from .models import (
    Account,
    BankAccount,
    BankConnection,
    BankTransaction,
    Category,
    CategoryPrediction,
    CategoryRule,
    AutomationSettings,
    Transaction,
)
from .services import account_balance


class BankReviewIdempotencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.account = Account.objects.create(name="Principal", opening_balance=Decimal("1000"))
        self.category = Category.objects.create(name="Comida", kind=Category.Kind.EXPENSE)
        connection = BankConnection.objects.create(bank_name="Banco", session_id="idempotency-session")
        self.bank_account = BankAccount.objects.create(
            connection=connection,
            account=self.account,
            remote_uid="idempotency-account",
            display_name="Cuenta",
        )

    def _pending_row(self):
        return stage_remote_transaction(
            self.bank_account,
            {
                "status": "BOOK",
                "transaction_id": "purchase-42-50",
                "booking_date": "2026-06-10",
                "transaction_amount": {"amount": "-42.50", "currency": "EUR"},
                "credit_debit_indicator": "DBIT",
                "remittance_information": ["Supermercado"],
            },
        )

    def test_stale_copy_and_retry_return_the_same_movement(self):
        row = self._pending_row()
        first_copy = BankTransaction.objects.get(pk=row.pk)
        retry_copy = BankTransaction.objects.get(pk=row.pk)
        skip_copy = BankTransaction.objects.get(pk=row.pk)
        transfer_copy = BankTransaction.objects.get(pk=row.pk)

        movement = confirm_bank_transaction(first_copy, category=self.category)
        retry_movement = confirm_bank_transaction(retry_copy, category=self.category)
        skip_result = perform_bank_review_action(skip_copy, "skip")
        transfer_result = perform_bank_review_action(transfer_copy, "transfer")

        self.assertEqual(retry_movement.pk, movement.pk)
        self.assertEqual(retry_copy.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(retry_copy.transaction_id, movement.pk)
        self.assertEqual(skip_result, "importado")
        self.assertEqual(transfer_result, "importado")
        row.refresh_from_db()
        self.assertFalse(row.possible_transfer)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(account_balance(self.account), Decimal("957.50"))

    def test_concurrent_stale_skip_cannot_replace_an_imported_state(self):
        row = self._pending_row()
        stale_skip = BankTransaction.objects.get(pk=row.pk)
        ready = Event()
        imported = Event()

        def skip_after_import():
            close_old_connections()
            try:
                ready.set()
                self.assertTrue(imported.wait(timeout=10))
                return perform_bank_review_action(stale_skip, "skip")
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=1) as executor:
            result = executor.submit(skip_after_import)
            self.assertTrue(ready.wait(timeout=10))
            movement = confirm_bank_transaction(row, category=self.category)
            imported.set()
            self.assertEqual(result.result(), "importado")

        row.refresh_from_db()
        self.assertEqual(row.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(row.transaction_id, movement.pk)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_unknown_action_stays_invalid_after_the_row_was_imported(self):
        row = self._pending_row()
        confirm_bank_transaction(row, category=self.category)

        with self.assertRaisesRegex(ValueError, "Acción bancaria no válida"):
            perform_bank_review_action(row, "banana")

    def test_validation_failure_leaves_the_bank_row_pending(self):
        row = self._pending_row()
        with patch.object(Transaction, "full_clean", side_effect=ValidationError("invalid movement")):
            with self.assertRaisesRegex(ValueError, "invalid movement"):
                confirm_bank_transaction(row, category=self.category)

        row.refresh_from_db()
        self.assertEqual(row.status, BankTransaction.Status.PENDING)
        self.assertIsNone(row.transaction_id)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_skipped_and_imported_without_link_are_not_successful_confirms(self):
        skipped = self._pending_row()
        skipped.status = BankTransaction.Status.SKIPPED
        skipped.save(update_fields=["status"])
        with self.assertRaisesRegex(ValueError, "ya no está pendiente"):
            confirm_bank_transaction(skipped, category=self.category)

        imported = self._pending_row()
        imported.status = BankTransaction.Status.IMPORTED
        imported.save(update_fields=["status"])
        with self.assertRaisesRegex(ValueError, "no tiene una transacción"):
            confirm_bank_transaction(imported, category=self.category)

    def test_retry_rejects_different_category_or_refund(self):
        row = self._pending_row()
        alternate = Category.objects.create(name="Hogar", kind=Category.Kind.EXPENSE)
        movement = confirm_bank_transaction(row, category=self.category)

        with self.assertRaisesRegex(ValueError, "categoría no coincide"):
            confirm_bank_transaction(row, category=alternate)
        self.assertEqual(movement.category_id, self.category.pk)

        income_row = stage_remote_transaction(
            self.bank_account,
            {
                "status": "BOOK",
                "transaction_id": "refund-1",
                "booking_date": "2026-06-11",
                "transaction_amount": {"amount": "10.00", "currency": "EUR"},
                "credit_debit_indicator": "CRDT",
                "remittance_information": ["Devolución"],
            },
        )
        expense = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("15.00"),
            date=date(2026, 6, 1),
            description="Compra original",
            category=self.category,
        )
        other_expense = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("20.00"),
            date=date(2026, 6, 2),
            description="Otra compra",
            category=self.category,
        )
        refund = confirm_bank_transaction(income_row, category=None, refund_for=expense)
        with self.assertRaisesRegex(ValueError, "reembolso no coincide"):
            confirm_bank_transaction(income_row, refund_for=other_expense)
        self.assertEqual(refund.refund_for_id, expense.pk)

    def _csrf_client(self):
        request = RequestFactory().get("/")
        token = get_token(request)
        client = Client(enforce_csrf_checks=True)
        client.cookies["csrftoken"] = request.META["CSRF_COOKIE"]
        return client, {"HTTP_X_CSRFTOKEN": token}

    def test_api_retry_feedback_and_remember_rule_follow_the_applied_category(self):
        row = self._pending_row()
        prediction_category = Category.objects.create(name="Ocio", kind=Category.Kind.EXPENSE)
        prediction = CategoryPrediction.objects.create(
            bank_transaction=row,
            category=prediction_category,
            model_name="test",
            confidence=Decimal("0.900"),
        )
        client, csrf = self._csrf_client()
        url = reverse("api_bank_review_action", args=[row.pk, "confirm"])

        first = client.post(
            url,
            data=json.dumps({"category": self.category.pk, "remember_category": True}),
            content_type="application/json",
            **csrf,
        )
        self.assertEqual(first.status_code, 200)
        prediction.refresh_from_db()
        self.assertEqual(prediction.status, CategoryPrediction.Status.REJECTED)
        learned_rule = CategoryRule.objects.get(normalized_description="supermercado")
        self.assertEqual(learned_rule.category_id, self.category.pk)

        mismatch = client.post(
            url,
            data=json.dumps({"category": prediction_category.pk, "remember_category": True}),
            content_type="application/json",
            **csrf,
        )
        self.assertEqual(mismatch.status_code, 400)
        prediction.refresh_from_db()
        row.refresh_from_db()
        learned_rule.refresh_from_db()
        self.assertEqual(prediction.status, CategoryPrediction.Status.REJECTED)
        self.assertEqual(row.transaction.category_id, self.category.pk)
        self.assertEqual(learned_rule.category_id, self.category.pk)

    def test_api_compatible_retry_uses_applied_category_when_payload_omits_it(self):
        row = self._pending_row()
        prediction = CategoryPrediction.objects.create(
            bank_transaction=row,
            category=self.category,
            model_name="test",
            confidence=Decimal("0.900"),
        )
        client, csrf = self._csrf_client()
        url = reverse("api_bank_review_action", args=[row.pk, "confirm"])
        first = client.post(
            url,
            data=json.dumps({"category": self.category.pk}),
            content_type="application/json",
            **csrf,
        )
        retry = client.post(
            url,
            data=json.dumps({"remember_category": True}),
            content_type="application/json",
            **csrf,
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(retry.status_code, 200)
        prediction.refresh_from_db()
        self.assertEqual(prediction.status, CategoryPrediction.Status.ACCEPTED)
        self.assertEqual(CategoryRule.objects.get(normalized_description="supermercado").category_id, self.category.pk)

    def test_api_confirm_of_skipped_row_changes_neither_prediction_nor_response_state(self):
        row = self._pending_row()
        prediction = CategoryPrediction.objects.create(
            bank_transaction=row,
            category=self.category,
            model_name="test",
            confidence=Decimal("0.900"),
        )
        perform_bank_review_action(row, "skip")
        client, csrf = self._csrf_client()

        response = client.post(
            reverse("api_bank_review_action", args=[row.pk, "confirm"]),
            data=json.dumps({"category": self.category.pk, "remember_category": True}),
            content_type="application/json",
            **csrf,
        )

        self.assertEqual(response.status_code, 400)
        prediction.refresh_from_db()
        row.refresh_from_db()
        self.assertEqual(prediction.status, CategoryPrediction.Status.SUGGESTED)
        self.assertEqual(row.status, BankTransaction.Status.SKIPPED)
        self.assertIsNone(row.transaction_id)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertFalse(CategoryRule.objects.exists())

    def test_late_llm_success_does_not_overwrite_a_manual_confirmation(self):
        row = self._pending_row()
        alternate = Category.objects.create(name="Ocio", kind=Category.Kind.EXPENSE)
        prediction = CategoryPrediction.objects.create(
            bank_transaction=row,
            category=alternate,
            model_name="test",
            confidence=Decimal("0.800"),
            reason="antes de la carrera",
        )
        AutomationSettings.objects.create(
            llm_enabled=True,
            auto_apply_enabled=True,
            confidence_threshold=Decimal("0.900"),
        )

        def delayed_response(_payload):
            perform_bank_review_action(row, "confirm", self.category)
            return {"response": json.dumps({"category_id": alternate.pk, "confidence": 0.99, "reason": "tardía"})}

        result = predict_category(row, request_func=delayed_response)

        row.refresh_from_db()
        prediction.refresh_from_db()
        self.assertEqual(result.pk, prediction.pk)
        self.assertEqual(row.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(row.transaction.category_id, self.category.pk)
        self.assertEqual(prediction.category_id, alternate.pk)
        self.assertEqual(prediction.confidence, Decimal("0.800"))
        self.assertEqual(prediction.reason, "antes de la carrera")
        self.assertEqual(prediction.status, CategoryPrediction.Status.REJECTED)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_late_llm_failure_does_not_overwrite_manual_feedback(self):
        row = self._pending_row()
        alternate = Category.objects.create(name="Ocio", kind=Category.Kind.EXPENSE)
        prediction = CategoryPrediction.objects.create(
            bank_transaction=row,
            category=alternate,
            model_name="test",
            confidence=Decimal("0.800"),
            reason="antes de la carrera",
        )

        def failed_response(_payload):
            perform_bank_review_action(row, "confirm", self.category)
            raise RuntimeError("respuesta externa tardía fallida")

        self.assertIsNone(predict_category(row, request_func=failed_response))

        row.refresh_from_db()
        prediction.refresh_from_db()
        self.assertEqual(row.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(row.transaction.category_id, self.category.pk)
        self.assertEqual(prediction.category_id, alternate.pk)
        self.assertEqual(prediction.confidence, Decimal("0.800"))
        self.assertEqual(prediction.reason, "antes de la carrera")
        self.assertEqual(prediction.status, CategoryPrediction.Status.REJECTED)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_stale_category_rule_does_not_relabel_an_imported_row(self):
        row = self._pending_row()
        rule = CategoryRule.objects.create(
            description="Supermercado",
            kind=Category.Kind.EXPENSE,
            category=Category.objects.create(name="Hogar", kind=Category.Kind.EXPENSE),
        )

        def confirm_while_matching(_row):
            perform_bank_review_action(row, "confirm", self.category)
            return rule

        with patch("ledger.banking_categorization.matching_category_rule", side_effect=confirm_while_matching):
            self.assertIsNone(predict_category(row, request_func=lambda _payload: self.fail("La regla ya coincidía.")))

        row.refresh_from_db()
        self.assertEqual(row.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(row.category_id, self.category.pk)
        self.assertEqual(row.transaction.category_id, self.category.pk)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_concurrent_stale_copies_create_one_movement(self):
        self.assertEqual(connection.vendor, "sqlite")
        row = self._pending_row()
        copies = [BankTransaction.objects.get(pk=row.pk) for _ in range(2)]
        barrier = Barrier(2)

        def confirm(stale_copy):
            close_old_connections()
            try:
                barrier.wait()
                for attempt in range(5):
                    try:
                        return confirm_bank_transaction(stale_copy, category=self.category).pk
                    except OperationalError as exc:
                        if connection.settings_dict["NAME"].startswith("file:memorydb_") and "locked" in str(exc).lower() and attempt < 4:
                            time.sleep(0.02 * (attempt + 1))
                            continue
                        raise
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            movement_ids = list(executor.map(confirm, copies))

        self.assertEqual(movement_ids[0], movement_ids[1])
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(
            BankTransaction.objects.get(pk=row.pk).status,
            BankTransaction.Status.IMPORTED,
        )

    def test_transfer_action_without_a_selected_pair_does_not_hide_the_row(self):
        row = self._pending_row()
        first_copy = BankTransaction.objects.get(pk=row.pk)

        with self.assertRaisesMessage(ValueError, "seleccionar una contrapartida"):
            perform_bank_review_action(first_copy, "transfer")

        row.refresh_from_db()
        self.assertEqual(row.status, BankTransaction.Status.PENDING)
        self.assertFalse(row.possible_transfer)
        self.assertEqual(Transaction.objects.count(), 0)
