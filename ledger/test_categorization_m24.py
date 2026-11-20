from __future__ import annotations

import json
from datetime import date, timedelta
from decimal import Decimal
from io import StringIO
from unittest.mock import Mock, patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from django.utils import timezone

from .banking_categorization import predict_category
from .banking_staging import stage_remote_transaction
from .categorization_evaluation import (
    _normalize_prediction,
    evaluate_synthetic_holdout,
    evaluation_prompt,
    load_synthetic_dataset,
    validate_synthetic_dataset,
)
from .category_services import apply_category_rule_historically
from .financial_read_models import recompute_monthly_financial_aggregates
from .bank_review_services import confirm_bank_transaction
from .models import (
    Account,
    AutomationSettings,
    BankAccount,
    BankConnection,
    BankTransaction,
    Category,
    CategoryPrediction,
    CategoryRule,
    CategoryRuleApplication,
    ImportBatch,
    ImportRow,
    MonthlyFinancialAggregate,
    Transaction,
)
from .statistics import statistics_report


class SyntheticCategorizationEvaluationTests(SimpleTestCase):
    def test_synthetic_holdout_is_time_ordered_and_never_promotes(self):
        dataset = load_synthetic_dataset()
        cutoff = date.fromisoformat(dataset["split_date"])
        self.assertTrue(all(date.fromisoformat(item["date"]) < cutoff for item in dataset["training"]))
        self.assertTrue(all(date.fromisoformat(item["date"]) >= cutoff for item in dataset["holdout"]))
        holdout = iter(dataset["holdout"])
        prompts = []

        def predict(prompt):
            prompts.append(json.loads(prompt))
            item = next(holdout)
            return {"category_id": item["expected_category_id"], "confidence": 0.95, "reason": "synthetic fixture"}

        report = evaluate_synthetic_holdout(dataset, predict, model_tag="qwen3:1.7b")
        self.assertEqual(report["validation_status"], "SYNTHETIC_ONLY")
        self.assertEqual(report["promotion_status"], "NO_PROMOTION")
        self.assertEqual(report["overall"]["accuracy"], 1)
        self.assertEqual(report["overall"]["thresholds"]["0.95"]["coverage"], 1)
        self.assertIsNone(report["overall"]["thresholds"]["0.99"]["precision"])
        self.assertEqual(set(report["by_source"]), {"csv", "enable_banking"})
        self.assertEqual(len(report["by_category"]), len(dataset["categories"]))
        self.assertGreaterEqual(report["overall"]["latency_ms"]["p95"], 0)
        for prompt, sample in zip(prompts, dataset["holdout"]):
            self.assertNotIn(sample["description"], [item["description"] for item in prompt["examples"]])

    def test_temporal_holdout_rejects_future_training_examples(self):
        dataset = load_synthetic_dataset()
        dataset["training"][0]["date"] = dataset["split_date"]
        with self.assertRaises(ValueError):
            validate_synthetic_dataset(dataset)

    def test_prediction_contract_rejects_invalid_category_and_confidence_values(self):
        invalid_confidences = [1.5, -0.2, float("nan"), float("inf"), True, "0.9"]
        for confidence in invalid_confidences:
            with self.subTest(confidence=repr(confidence)):
                with self.assertRaises(ValueError):
                    _normalize_prediction({"category_id": 1, "confidence": confidence}, {1})
        for category_id in ["1", 1.5, True, 2]:
            with self.subTest(category_id=repr(category_id)):
                with self.assertRaises(ValueError):
                    _normalize_prediction({"category_id": category_id, "confidence": 0.9}, {1})

    def test_command_uses_only_the_fixture_and_never_writes_settings_or_ledger(self):
        dataset = load_synthetic_dataset()
        predictions = iter(dataset["holdout"])
        response = Mock()
        response.raise_for_status.return_value = None

        def local_model(_url, *, json, timeout):
            item = next(predictions)
            response.json.return_value = {"response": json_module_dumps({
                "category_id": item["expected_category_id"],
                "confidence": 0.95,
                "reason": "synthetic fixture",
            })}
            return response

        output = StringIO()
        with patch("ledger.management.commands.evaluate_local_categorizer.requests.post", side_effect=local_model) as post:
            call_command("evaluate_local_categorizer", stdout=output)
        report = json.loads(output.getvalue())
        self.assertEqual(report["validation_status"], "SYNTHETIC_ONLY")
        self.assertEqual(report["promotion_status"], "NO_PROMOTION")
        self.assertEqual(report["overall"]["samples"], len(dataset["holdout"]))
        self.assertEqual(post.call_count, len(dataset["holdout"]))


def json_module_dumps(value):
    return json.dumps(value)


class M24AutomationAndHistoryTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create(name="M24 Principal")
        self.expense = Category.objects.create(name="M24 Alimentos", kind=Category.Kind.EXPENSE)
        self.other = Category.objects.create(name="M24 Hogar", kind=Category.Kind.EXPENSE)
        connection = BankConnection.objects.create(bank_name="M24 Banco", session_id="m24-session")
        self.bank_account = BankAccount.objects.create(
            connection=connection,
            account=self.account,
            remote_uid="m24-account",
            display_name="M24 Cuenta",
        )
        self.rule = CategoryRule.objects.create(
            description="M24 compra",
            kind=Category.Kind.EXPENSE,
            category=self.expense,
            match_mode=CategoryRule.MatchMode.EXACT,
            active=False,
        )

    def pending_bank_row(self, suffix=None):
        description = "M24 compra" if suffix is None else f"M24 compra {suffix}"
        return stage_remote_transaction(
            self.bank_account,
            {
                "status": "BOOK",
                "transaction_id": f"m24-bank-{BankTransaction.objects.count()}-{suffix or 'base'}",
                "booking_date": timezone.localdate().isoformat(),
                "transaction_amount": {"amount": "-42.50", "currency": "EUR"},
                "credit_debit_indicator": "DBIT",
                "remittance_information": [description],
            },
        )

    def test_user_preference_and_high_confidence_do_not_promote_auto_confirmation(self):
        AutomationSettings.objects.create(llm_enabled=True, auto_apply_enabled=True, confidence_threshold=Decimal("0.990"))
        row = self.pending_bank_row()
        prediction = predict_category(
            row,
            request_func=lambda _payload: {"response": json.dumps({
                "category_id": self.expense.pk,
                "confidence": 0.999,
                "reason": "sugerencia de prueba",
            })},
        )

        row.refresh_from_db()
        self.assertEqual(row.status, BankTransaction.Status.PENDING)
        self.assertIsNone(row.transaction_id)
        self.assertEqual(prediction.status, CategoryPrediction.Status.SUGGESTED)
        self.assertFalse(Transaction.objects.exists())
        automation = self.client.get(reverse("api_automation_settings")).json()["automation"]
        self.assertTrue(automation["auto_apply_enabled"])
        self.assertFalse(automation["auto_apply_effective"])
        self.assertEqual(automation["promotion_status"], "NO_PROMOTION")

    def test_invalid_model_predictions_are_saved_only_as_failed(self):
        AutomationSettings.objects.create(llm_enabled=True, auto_apply_enabled=True, confidence_threshold=Decimal("0.990"))
        invalid_responses = [
            {"category_id": self.expense.pk, "confidence": 1.5, "reason": "over-range"},
            {"category_id": self.expense.pk, "confidence": -0.2, "reason": "negative"},
            {"category_id": self.expense.pk, "confidence": float("nan"), "reason": "not-finite"},
            {"category_id": self.expense.pk, "confidence": float("inf"), "reason": "not-finite"},
            {"category_id": self.expense.pk, "confidence": True, "reason": "wrong-type"},
            {"category_id": str(self.expense.pk), "confidence": 0.99, "reason": "wrong-id-type"},
            {"category_id": self.expense.pk + 100, "confidence": 0.99, "reason": "unknown-category"},
        ]
        for index, result in enumerate(invalid_responses):
            with self.subTest(result=result):
                row = self.pending_bank_row(suffix=index)
                prediction = predict_category(
                    row,
                    request_func=lambda _payload, result=result: {"response": json.dumps(result)},
                )
                self.assertIsNone(prediction)
                failed = CategoryPrediction.objects.get(bank_transaction=row)
                self.assertEqual(failed.status, CategoryPrediction.Status.FAILED)
                self.assertEqual(failed.confidence, Decimal("0"))
                self.assertIsNone(failed.category_id)
        self.assertFalse(Transaction.objects.exists())

    def test_recent_failed_prediction_is_cooled_down(self):
        row = self.pending_bank_row()
        prediction = CategoryPrediction.objects.create(
            bank_transaction=row,
            category=None,
            model_name="qwen3:1.7b",
            confidence=0,
            status=CategoryPrediction.Status.FAILED,
            reason="fallo sintético",
        )
        result = predict_category(row, request_func=lambda _payload: self.fail("No debe reintentar durante el cooldown."))
        self.assertEqual(result.pk, prediction.pk)
        with patch("ledger.management.commands.categorize_bank_transactions.predict_category") as predict:
            output = StringIO()
            call_command("categorize_bank_transactions", stdout=output)
        predict.assert_not_called()
        self.assertIn("Movimientos procesados: 0", output.getvalue())
        self.assertFalse(Transaction.objects.exists())

    def test_batch_limit_is_bounded_before_processing(self):
        with self.assertRaises(CommandError):
            call_command("categorize_bank_transactions", limit=21)

    def test_category_rule_history_paginates_and_survives_undo(self):
        first = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("12.00"),
            date=date(2026, 1, 2),
            description="M24 compra",
            category=self.other,
        )
        result = apply_category_rule_historically(self.rule)
        application_id = result["application_id"]
        history_url = reverse("api_category_rule_applications")
        before_undo = self.client.get(history_url, {"limit": 1}).json()
        self.assertEqual(len(before_undo["applications"]), 1)
        self.assertEqual(before_undo["applications"][0]["id"], application_id)
        self.assertEqual(before_undo["applications"][0]["transactions"], 1)
        self.assertTrue(before_undo["applications"][0]["reversible"])
        older_application = CategoryRuleApplication.objects.create(
            rule=self.rule,
            filters_used={"description": "Aplicación anterior", "category_id": self.expense.pk},
            affected_records=[{"type": "transaction", "id": 999, "previous_category": self.other.pk, "new_category": self.expense.pk}],
        )
        page_one = self.client.get(history_url, {"limit": 1}).json()
        self.assertEqual(page_one["next_offset"], 1)
        self.assertEqual(page_one["applications"][0]["id"], older_application.pk)
        page_two = self.client.get(history_url, {"limit": 1, "offset": 1}).json()
        self.assertEqual(page_two["applications"][0]["id"], application_id)

        undo = self.client.post(reverse("api_category_rule_undo", args=[self.rule.pk, application_id]))
        self.assertEqual(undo.status_code, 200)
        retry = self.client.post(reverse("api_category_rule_undo", args=[self.rule.pk, application_id]))
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json(), {"ok": True, "partial": False, "application_id": application_id, "idempotent": True})
        after_undo = self.client.get(history_url, {"limit": 1, "offset": 1}).json()["applications"][0]
        self.assertEqual(after_undo["id"], application_id)
        self.assertEqual(after_undo["status"], CategoryRuleApplication.Status.UNDONE)
        self.assertFalse(after_undo["reversible"])
        self.assertTrue(CategoryRuleApplication.objects.filter(pk=application_id).exists())
        first.refresh_from_db()
        self.assertEqual(first.category_id, self.other.pk)

    def test_undo_preserves_bank_and_csv_rows_consumed_after_rule_application(self):
        bank_row = self.pending_bank_row()
        batch = ImportBatch.objects.create(filename="m24-consumed.csv", account=self.account)
        csv_row = ImportRow.objects.create(
            batch=batch,
            row_number=1,
            date=timezone.localdate(),
            description="M24 compra",
            amount=Decimal("42.50"),
            kind=Category.Kind.EXPENSE,
            category=self.other,
            fingerprint="m24-consumed-csv",
        )
        result = apply_category_rule_historically(self.rule)
        self.assertEqual(result["bank_rows"], 1)
        self.assertEqual(result["csv_rows"], 1)

        movement = confirm_bank_transaction(bank_row, category=self.expense)
        skip_csv = self.client.post(
            reverse("api_import_row_action", args=[csv_row.pk, "skip"]),
            data=json.dumps({}),
            content_type="application/json",
        )
        self.assertEqual(skip_csv.status_code, 200)
        undo = self.client.post(reverse("api_category_rule_undo", args=[self.rule.pk, result["application_id"]]))

        self.assertEqual(undo.status_code, 200)
        self.assertTrue(undo.json()["partial"])
        bank_row.refresh_from_db()
        csv_row.refresh_from_db()
        movement.refresh_from_db()
        self.assertEqual(bank_row.status, BankTransaction.Status.IMPORTED)
        self.assertEqual(bank_row.category_id, self.expense.pk)
        self.assertEqual(bank_row.transaction_id, movement.pk)
        self.assertEqual(movement.category_id, self.expense.pk)
        self.assertEqual(csv_row.status, ImportRow.Status.SKIPPED)
        self.assertEqual(csv_row.category_id, self.expense.pk)
        self.assertIsNone(csv_row.transaction_id)
        application = CategoryRuleApplication.objects.get(pk=result["application_id"])
        self.assertEqual(application.status, CategoryRuleApplication.Status.PARTIAL)
        self.assertFalse(application.reversible)

    def test_undo_marks_missing_previous_category_partial_and_preserves_current_data(self):
        movement = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("12.00"),
            date=date(2026, 1, 2),
            description="M24 compra",
            category=self.other,
        )
        result = apply_category_rule_historically(self.rule)
        self.other.delete()

        undo = self.client.post(reverse("api_category_rule_undo", args=[self.rule.pk, result["application_id"]]))

        self.assertEqual(undo.status_code, 200)
        self.assertTrue(undo.json()["partial"])
        movement.refresh_from_db()
        self.assertEqual(movement.category_id, self.expense.pk)
        application = CategoryRuleApplication.objects.get(pk=result["application_id"])
        self.assertEqual(application.status, CategoryRuleApplication.Status.PARTIAL)
        self.assertFalse(application.reversible)

    def test_stale_undo_attempt_after_concurrent_terminal_winner_is_idempotent(self):
        Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("12.00"),
            date=date(2026, 1, 2),
            description="M24 compra",
            category=self.other,
        )
        result = apply_category_rule_historically(self.rule)
        application_id = result["application_id"]
        real_filter = CategoryRuleApplication.objects.filter
        interleaved = False

        def another_request_wins(*args, **kwargs):
            nonlocal interleaved
            queryset = real_filter(*args, **kwargs)
            if (
                not interleaved
                and kwargs.get("pk") == application_id
                and kwargs.get("status") == CategoryRuleApplication.Status.COMPLETED
                and kwargs.get("reversible") is True
            ):
                interleaved = True
                real_filter(pk=application_id).update(
                    status=CategoryRuleApplication.Status.UNDONE,
                    reversible=False,
                )
            return queryset

        with patch.object(CategoryRuleApplication.objects, "filter", side_effect=another_request_wins):
            retry = self.client.post(reverse("api_category_rule_undo", args=[self.rule.pk, application_id]))

        self.assertTrue(interleaved)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()["idempotent"], True)
        application = CategoryRuleApplication.objects.get(pk=application_id)
        self.assertEqual(application.status, CategoryRuleApplication.Status.UNDONE)
        self.assertFalse(application.reversible)

    def test_undo_savepoint_keeps_audit_partial_after_restore_integrity_error(self):
        movement = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("12.00"),
            date=date(2026, 1, 2),
            description="M24 compra",
            category=self.other,
        )
        result = apply_category_rule_historically(self.rule)
        original_save = Transaction.save
        integrity_error_raised = False

        def fail_restore_once(instance, *args, **kwargs):
            nonlocal integrity_error_raised
            if instance.pk == movement.pk and instance.category_id == self.other.pk and not integrity_error_raised:
                integrity_error_raised = True
                raise IntegrityError("synthetic FK race while restoring the previous category")
            return original_save(instance, *args, **kwargs)

        with patch.object(Transaction, "save", new=fail_restore_once):
            undo = self.client.post(reverse("api_category_rule_undo", args=[self.rule.pk, result["application_id"]]))

        self.assertTrue(integrity_error_raised)
        self.assertEqual(undo.status_code, 200)
        self.assertTrue(undo.json()["partial"])
        self.assertTrue(Category.objects.filter(pk=self.other.pk).exists())
        movement.refresh_from_db()
        self.assertEqual(movement.category_id, self.expense.pk)
        application = CategoryRuleApplication.objects.get(pk=result["application_id"])
        self.assertEqual(application.status, CategoryRuleApplication.Status.PARTIAL)

    def test_undo_updates_transaction_timestamp_and_invalidates_monthly_statistics(self):
        month = date(2026, 1, 1)
        month_end = date(2026, 1, 31)
        movement = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("12.00"),
            date=date(2026, 1, 2),
            description="M24 compra",
            category=self.other,
        )
        result = apply_category_rule_historically(self.rule)
        recompute_monthly_financial_aggregates(month, month_end)
        cached = statistics_report(month, month_end, "all")
        self.assertIn(self.expense.name, {item["family_name"] for item in cached["categories"]})
        aggregate = MonthlyFinancialAggregate.objects.get(month=month, basis="all")
        self.assertFalse(aggregate.dirty)
        old_updated_at = timezone.now() - timedelta(days=2)
        Transaction.objects.filter(pk=movement.pk).update(updated_at=old_updated_at)

        undo = self.client.post(reverse("api_category_rule_undo", args=[self.rule.pk, result["application_id"]]))

        self.assertEqual(undo.status_code, 200)
        movement.refresh_from_db()
        self.assertEqual(movement.category_id, self.other.pk)
        self.assertGreater(movement.updated_at, old_updated_at)
        aggregate.refresh_from_db()
        self.assertTrue(aggregate.dirty)
        current = statistics_report(month, month_end, "all")
        self.assertIn(self.other.name, {item["family_name"] for item in current["categories"]})
