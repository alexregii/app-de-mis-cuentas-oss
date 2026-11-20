import hashlib
import json
import uuid
import zipfile
from datetime import date, timedelta
from decimal import Decimal
from io import BytesIO
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .calculations.annual_reserve import next_annual_due_date, reserve_progress
from .models import Account, Category, RecurringOccurrence, RecurringRule, SavingsObjective, Transaction
from .recurring_services import match_recurring_occurrence
from .recovery import import_portable, write_portable_export
from .services import total_balance
from .savings_objectives import create_objective
from .transaction_services import archive_transaction


class AnnualReserveCalculationTests(TestCase):
    def test_calendar_months_remaining_and_leap_day(self):
        rule = RecurringRule(
            kind=Category.Kind.EXPENSE,
            frequency=RecurringRule.Frequency.YEARLY,
            start_date=date(2024, 2, 29),
            day_of_month=29,
        )
        due = next_annual_due_date(rule, date(2026, 10, 25))
        self.assertEqual(due, date(2027, 2, 28))
        progress = reserve_progress(Decimal("1200.00"), Decimal("300.00"), date(2027, 7, 1), as_of=date(2026, 10, 25))
        self.assertEqual(progress["months_remaining"], 9)
        self.assertEqual(progress["monthly_amount"], Decimal("100.00"))

    def test_fully_assigned_and_overdue_reserves_do_not_recommend_more(self):
        full = reserve_progress(Decimal("500.00"), Decimal("500.00"), date(2027, 6, 1), as_of=date(2026, 10, 25))
        overdue = reserve_progress(Decimal("500.00"), Decimal("200.00"), date(2026, 10, 24), as_of=date(2026, 10, 25))
        self.assertEqual(full["monthly_amount"], Decimal("0.00"))
        self.assertEqual(overdue["status"], "overdue")
        self.assertEqual(overdue["months_remaining"], 0)
        self.assertEqual(overdue["monthly_amount"], Decimal("0.00"))


class AnnualReserveApiTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.account = Account.objects.create(name="Cuenta anual", opening_balance=Decimal("2000.00"))
        self.category = Category.objects.create(name="Seguros", kind=Category.Kind.EXPENSE)

    def make_rule(self, *, amount="1200.00", start_date=None, day=1, active=True):
        start_date = start_date or date(self.today.year - 1, 7, 1)
        return RecurringRule.objects.create(
            name="Seguro anual",
            kind=Category.Kind.EXPENSE,
            amount=Decimal(amount),
            account=self.account,
            category=self.category,
            frequency=RecurringRule.Frequency.YEARLY,
            day_of_month=day,
            start_date=start_date,
            active=active,
        )

    def create_reserve(self, rule):
        response = self.client.post(
            reverse("api_savings_objectives"),
            data=json.dumps({"recurring_rule_id": rule.pk, "idempotency_key": str(uuid.uuid4())}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        return SavingsObjective.objects.get(pk=response.json()["objective"]["id"]), response

    def test_linked_objective_shows_monthly_contribution_for_actual_due_date(self):
        rule = self.make_rule()
        due = next_annual_due_date(rule, self.today)
        objective, response = self.create_reserve(rule)
        self.assertEqual(objective.recurring_rule_id, rule.pk)
        self.assertEqual(objective.target_amount, rule.amount)
        self.assertEqual(objective.target_date, due)
        progress = response.json()["objective"]["annual_reserve"]
        expected = reserve_progress(rule.amount, Decimal("0.00"), due, as_of=self.today)
        self.assertEqual(progress["months_remaining"], expected["months_remaining"])
        self.assertEqual(progress["monthly_amount"], float(expected["monthly_amount"]))
        self.assertEqual(RecurringOccurrence.objects.filter(rule=rule, due_date=due).count(), 1)

    def test_linked_create_rereads_idempotency_after_an_interleaved_commit(self):
        rule = self.make_rule()
        key = uuid.uuid4()
        payload = {"recurring_rule_id": rule.pk, "idempotency_key": str(key)}
        digest = hashlib.sha256(json.dumps(
            {"kind": "annual_reserve", "recurring_rule_id": rule.pk},
            sort_keys=True, separators=(",", ":"),
        ).encode("utf-8")).hexdigest()
        due = next_annual_due_date(rule, self.today)
        original_filter = SavingsObjective.objects.filter
        inserted = False

        class EmptyRead:
            def first(self):
                return None

        def interleaved_filter(*args, **kwargs):
            nonlocal inserted
            if kwargs == {"idempotency_key": key} and not inserted:
                inserted = True
                SavingsObjective.objects.create(
                    name=rule.name,
                    target_amount=rule.amount,
                    target_date=due,
                    priority=2,
                    idempotency_key=key,
                    create_digest=digest,
                    recurring_rule=rule,
                )
                RecurringOccurrence.objects.get_or_create(
                    rule=rule, due_date=due, defaults={"amount": rule.amount}
                )
                return EmptyRead()
            return original_filter(*args, **kwargs)

        with patch.object(SavingsObjective.objects, "filter", side_effect=interleaved_filter):
            objective, created = create_objective(payload)
        self.assertFalse(created)
        self.assertEqual(objective.create_digest, digest)
        self.assertEqual(SavingsObjective.objects.filter(recurring_rule=rule).count(), 1)
    def test_missing_recurring_rule_is_a_client_error_not_a_server_error(self):
        response = self.client.post(
            reverse("api_savings_objectives"),
            data=json.dumps({"recurring_rule_id": 99999, "idempotency_key": str(uuid.uuid4())}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(SavingsObjective.objects.exists())
    def test_linked_creation_retry_is_stable_after_rule_edit_and_pause(self):
        rule = self.make_rule()
        payload = {"recurring_rule_id": rule.pk, "idempotency_key": str(uuid.uuid4())}
        first = self.client.post(reverse("api_savings_objectives"), data=json.dumps(payload), content_type="application/json")
        self.assertEqual(first.status_code, 201, first.content)
        objective_id = first.json()["objective"]["id"]
        changed = self.client.patch(
            reverse("api_recurring_rule_detail", args=[rule.pk]),
            data=json.dumps({"amount": "1450.00"}),
            content_type="application/json",
        )
        self.assertEqual(changed.status_code, 200, changed.content)
        retry = self.client.post(reverse("api_savings_objectives"), data=json.dumps(payload), content_type="application/json")
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(retry.json()["objective"]["id"], objective_id)
        self.client.delete(reverse("api_recurring_rule_detail", args=[rule.pk]))
        retry_after_pause = self.client.post(reverse("api_savings_objectives"), data=json.dumps(payload), content_type="application/json")
        self.assertEqual(retry_after_pause.status_code, 200, retry_after_pause.content)
        self.assertEqual(SavingsObjective.objects.filter(recurring_rule=rule).count(), 1)
    def test_rule_edit_recalculates_goal_and_future_occurrence(self):
        rule = self.make_rule()
        objective, _ = self.create_reserve(rule)
        response = self.client.patch(
            reverse("api_recurring_rule_detail", args=[rule.pk]),
            data=json.dumps({"amount": "1500.00", "day_of_month": 8}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        objective.refresh_from_db()
        rule.refresh_from_db()
        due = next_annual_due_date(rule, self.today)
        self.assertEqual(objective.target_amount, Decimal("1500.00"))
        self.assertEqual(objective.target_date, due)
        self.assertTrue(RecurringOccurrence.objects.filter(rule=rule, due_date=due, amount=Decimal("1500.00")).exists())

    def test_payment_consumes_virtual_assignment_once_and_archive_restores_it(self):
        rule = self.make_rule(amount="500.00", start_date=self.today.replace(day=1), day=self.today.day)
        occurrence = RecurringOccurrence.objects.create(rule=rule, due_date=self.today, amount=Decimal("500.00"))
        objective, _ = self.create_reserve(rule)
        allocation = self.client.put(
            reverse("api_savings_objective_allocation", args=[objective.pk]),
            data=json.dumps({"expected_revision": objective.revision, "assigned_amount": "300.00"}),
            content_type="application/json",
        )
        self.assertEqual(allocation.status_code, 200, allocation.content)
        movement = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("500.00"),
            date=self.today,
            description="Seguro anual",
            category=self.category,
        )
        matched = match_recurring_occurrence(movement)
        self.assertEqual(matched.pk, occurrence.pk)
        objective.refresh_from_db()
        occurrence.refresh_from_db()
        self.assertEqual(objective.assigned_amount, Decimal("0.00"))
        self.assertEqual(occurrence.reserve_consumed_amount, Decimal("300.00"))
        self.assertEqual(occurrence.reserve_objective_id, objective.pk)
        self.assertEqual(occurrence.status, RecurringOccurrence.Status.CONFIRMED)
        self.assertIsNone(match_recurring_occurrence(movement))
        objective.refresh_from_db()
        self.assertEqual(objective.assigned_amount, Decimal("0.00"))
        self.assertEqual(total_balance(), Decimal("1500.00"))
        locked_edit = self.client.patch(
            reverse("api_transaction_detail", args=[movement.pk]),
            data=json.dumps({"amount": "100.00"}),
            content_type="application/json",
        )
        self.assertEqual(locked_edit.status_code, 409, locked_edit.content)
        self.assertEqual(locked_edit.json()["code"], "annual_reserve_payment_locked")
        movement.refresh_from_db()
        self.assertEqual(movement.amount, Decimal("500.00"))
        plan_after_payment = self.client.get(reverse("api_planning")).json()
        row_after_payment = next(item for item in plan_after_payment["savings_objectives"]["items"] if item["id"] == objective.pk)
        self.assertEqual(row_after_payment["annual_reserve"]["due_date"], next_annual_due_date(rule, self.today, strictly_after=True).isoformat())
        unlinked = self.client.patch(
            reverse("api_savings_objective_detail", args=[objective.pk]),
            data=json.dumps({"expected_revision": objective.revision, "recurring_rule_id": None}),
            content_type="application/json",
        )
        self.assertEqual(unlinked.status_code, 200, unlinked.content)

        archive_transaction(movement)
        movement.refresh_from_db()
        occurrence.refresh_from_db()
        objective.refresh_from_db()
        self.assertTrue(movement.archived)
        self.assertIsNone(movement.recurring_occurrence_id)
        self.assertEqual(occurrence.status, RecurringOccurrence.Status.PENDING)
        self.assertEqual(occurrence.reserve_consumed_amount, Decimal("0.00"))
        self.assertEqual(objective.assigned_amount, Decimal("300.00"))
        self.assertEqual(total_balance(), Decimal("2000.00"))

        movement.archived = False
        movement.save(update_fields=["archived", "updated_at"])
        self.assertEqual(match_recurring_occurrence(movement).pk, occurrence.pk)
        objective.refresh_from_db()
        self.assertEqual(objective.assigned_amount, Decimal("300.00"))
        self.assertEqual(Transaction.objects.count(), 1)

    def test_skipping_keeps_reserve_and_moves_to_next_cycle(self):
        rule = self.make_rule(amount="600.00", start_date=self.today.replace(day=1), day=self.today.day)
        occurrence = RecurringOccurrence.objects.create(rule=rule, due_date=self.today, amount=rule.amount)
        objective, _ = self.create_reserve(rule)
        assigned = self.client.put(
            reverse("api_savings_objective_allocation", args=[objective.pk]),
            data=json.dumps({"expected_revision": objective.revision, "assigned_amount": "250.00"}),
            content_type="application/json",
        )
        self.assertEqual(assigned.status_code, 200)
        skipped = self.client.post(reverse("api_occurrence_action", args=[occurrence.pk, "skip"]))
        self.assertEqual(skipped.status_code, 200)
        objective.refresh_from_db()
        due = next_annual_due_date(rule, self.today, strictly_after=True)
        self.assertEqual(objective.assigned_amount, Decimal("250.00"))
        self.assertEqual(objective.target_date, due)
        plan = self.client.get(reverse("api_planning")).json()
        row = next(item for item in plan["savings_objectives"]["items"] if item["id"] == objective.pk)
        self.assertEqual(row["annual_reserve"]["due_date"], due.isoformat())

    def test_pausing_rule_suspends_quota_without_releasing_assignment(self):
        rule = self.make_rule()
        objective, _ = self.create_reserve(rule)
        assigned = self.client.put(
            reverse("api_savings_objective_allocation", args=[objective.pk]),
            data=json.dumps({"expected_revision": objective.revision, "assigned_amount": "250.00"}),
            content_type="application/json",
        )
        self.assertEqual(assigned.status_code, 200)
        paused = self.client.delete(reverse("api_recurring_rule_detail", args=[rule.pk]))
        self.assertEqual(paused.status_code, 200)
        objective.refresh_from_db()
        self.assertEqual(objective.assigned_amount, Decimal("250.00"))
        plan = self.client.get(reverse("api_planning")).json()
        row = next(item for item in plan["savings_objectives"]["items"] if item["id"] == objective.pk)
        self.assertEqual(row["annual_reserve"]["status"], "paused")
        self.assertIsNone(row["annual_reserve"]["monthly_amount"])

    def test_last_payment_ends_reserve_without_a_fake_next_month(self):
        rule = RecurringRule.objects.create(
            name="Último seguro anual",
            kind=Category.Kind.EXPENSE,
            amount=Decimal("500.00"),
            account=self.account,
            category=self.category,
            frequency=RecurringRule.Frequency.YEARLY,
            day_of_month=self.today.day,
            start_date=self.today,
            end_date=self.today,
        )
        occurrence = RecurringOccurrence.objects.create(rule=rule, due_date=self.today, amount=rule.amount)
        objective, _ = self.create_reserve(rule)
        movement = Transaction.objects.create(
            account=self.account, kind=Transaction.Kind.EXPENSE, amount=rule.amount,
            date=self.today, description="Último seguro", category=self.category,
        )
        match_recurring_occurrence(movement)
        occurrence.refresh_from_db()
        plan = self.client.get(reverse("api_planning")).json()
        row = next(item for item in plan["savings_objectives"]["items"] if item["id"] == objective.pk)
        self.assertEqual(occurrence.status, RecurringOccurrence.Status.CONFIRMED)
        self.assertEqual(row["annual_reserve"]["status"], "ended")
        self.assertIsNone(row["annual_reserve"]["monthly_amount"])
    def test_paused_rule_cannot_match_or_consume_a_real_payment(self):
        rule = self.make_rule(amount="500.00", start_date=self.today.replace(day=1), day=self.today.day)
        occurrence = RecurringOccurrence.objects.create(rule=rule, due_date=self.today, amount=rule.amount)
        objective, _ = self.create_reserve(rule)
        allocated = self.client.put(
            reverse("api_savings_objective_allocation", args=[objective.pk]),
            data=json.dumps({"expected_revision": objective.revision, "assigned_amount": "300.00"}),
            content_type="application/json",
        )
        self.assertEqual(allocated.status_code, 200)
        self.client.delete(reverse("api_recurring_rule_detail", args=[rule.pk]))
        movement = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=rule.amount,
            date=self.today,
            description="Seguro anual",
            category=self.category,
        )
        self.assertIsNone(match_recurring_occurrence(movement))
        objective.refresh_from_db()
        occurrence.refresh_from_db()
        movement.refresh_from_db()
        self.assertEqual(objective.assigned_amount, Decimal("300.00"))
        self.assertEqual(occurrence.status, RecurringOccurrence.Status.PENDING)
        self.assertIsNone(movement.recurring_occurrence_id)
    def test_linked_objective_can_be_unlinked_before_changing_rule_frequency(self):
        rule = self.make_rule()
        objective, _ = self.create_reserve(rule)
        unlinked = self.client.patch(
            reverse("api_savings_objective_detail", args=[objective.pk]),
            data=json.dumps({"expected_revision": objective.revision, "recurring_rule_id": None}),
            content_type="application/json",
        )
        self.assertEqual(unlinked.status_code, 200, unlinked.content)
        self.assertIsNone(SavingsObjective.objects.get(pk=objective.pk).recurring_rule_id)
        changed = self.client.patch(
            reverse("api_recurring_rule_detail", args=[rule.pk]),
            data=json.dumps({"frequency": RecurringRule.Frequency.MONTHLY}),
            content_type="application/json",
        )
        self.assertEqual(changed.status_code, 200, changed.content)


class AnnualReservePortableTests(TestCase):
    def test_portable_v5_preserves_linked_annual_rule_and_reserve(self):
        today = timezone.localdate()
        account = Account.objects.create(name="Cuenta portable anual", opening_balance=Decimal("1000.00"))
        category = Category.objects.create(name="Seguro portable", kind=Category.Kind.EXPENSE)
        paid_due = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
        rule = RecurringRule.objects.create(
            name="Seguro portable",
            kind=Category.Kind.EXPENSE,
            amount=Decimal("900.00"),
            account=account,
            category=category,
            frequency=RecurringRule.Frequency.YEARLY,
            day_of_month=1,
            start_date=paid_due.replace(year=paid_due.year - 1),
        )
        due = next_annual_due_date(rule, today)
        objective = SavingsObjective.objects.create(
            name=rule.name,
            target_amount=rule.amount,
            target_date=due,
            priority=2,
            assigned_amount=Decimal("200.00"),
            recurring_rule=rule,
        )
        paid_occurrence = RecurringOccurrence.objects.create(
            rule=rule, due_date=paid_due, amount=rule.amount,
            status=RecurringOccurrence.Status.CONFIRMED,
            reserve_consumed_amount=Decimal("300.00"), reserve_objective=objective,
        )
        Transaction.objects.create(
            account=account, kind=Transaction.Kind.EXPENSE, amount=rule.amount,
            date=paid_due, description="Pago anual ya conciliado", category=category,
            recurring_occurrence=paid_occurrence,
        )
        output = BytesIO()
        write_portable_export(output)
        with zipfile.ZipFile(BytesIO(output.getvalue())) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            data = json.loads(archive.read("data.json"))
            data.update(manifest)
        self.assertEqual(manifest["version"], 5)
        self.assertEqual(len(data["annual_reserve_rules"]), 1)
        self.assertEqual(data["savings_objectives"][0]["recurring_rule"], f"recurring_rule:{rule.pk}")

        Transaction.objects.all().delete()
        RecurringOccurrence.objects.all().delete()
        SavingsObjective.objects.all().delete()
        RecurringRule.objects.all().delete()
        Category.objects.all().delete()
        Account.objects.all().delete()
        occurrence_data = data["annual_reserve_rules"][0]["occurrences"][0]
        transaction_data = data["transactions"][0]
        valid_transaction_kind = transaction_data["kind"]
        valid_transaction_category = transaction_data["category"]
        transaction_data["kind"] = Transaction.Kind.INCOME
        transaction_data["category"] = None
        with self.assertRaises(ValueError):
            import_portable(data)
        self.assertFalse(Account.objects.exists())
        transaction_data["kind"] = valid_transaction_kind
        transaction_data["category"] = valid_transaction_category
        valid_consumed = occurrence_data["reserve_consumed_amount"]
        valid_occurrence_amount = occurrence_data["amount"]
        valid_owner = occurrence_data["reserve_objective"]
        valid_status = occurrence_data["status"]
        occurrence_data["reserve_objective"] = f"savings_objective:{objective.pk}"
        occurrence_data["status"] = "pending"
        with self.assertRaises(ValueError):
            import_portable(data)
        self.assertFalse(Account.objects.exists())
        occurrence_data["status"] = valid_status
        for invalid_amount in ("not-money", "NaN"):
            occurrence_data["amount"] = invalid_amount
            with self.assertRaises(ValueError):
                import_portable(data)
            self.assertFalse(Account.objects.exists())
        occurrence_data["amount"] = valid_occurrence_amount
        for invalid_amount in ("901.00", "NaN", "not-a-number"):
            occurrence_data["reserve_consumed_amount"] = invalid_amount
            with self.assertRaises(ValueError):
                import_portable(data)
            self.assertFalse(Account.objects.exists())
        occurrence_data["reserve_consumed_amount"] = valid_consumed
        occurrence_data["reserve_objective"] = valid_owner
        result = import_portable(data)
        self.assertEqual(result["savings_objectives"], 1)
        self.assertEqual(result["transactions"], 1)
        restored = SavingsObjective.objects.get()
        self.assertEqual(restored.assigned_amount, Decimal("200.00"))
        self.assertIsNotNone(restored.recurring_rule_id)
        self.assertEqual(restored.recurring_rule.amount, Decimal("900.00"))
        paid = RecurringOccurrence.objects.get(rule=restored.recurring_rule, due_date=paid_due)
        self.assertEqual(paid.status, RecurringOccurrence.Status.CONFIRMED)
        self.assertEqual(paid.reserve_consumed_amount, Decimal("300.00"))
        self.assertEqual(paid.reserve_objective_id, restored.pk)
        movement = Transaction.objects.get(description="Pago anual ya conciliado")
        self.assertEqual(movement.recurring_occurrence_id, paid.pk)
        self.assertTrue(RecurringOccurrence.objects.filter(rule=restored.recurring_rule, due_date=due).exists())
        prepared = self.client.post(reverse("api_planning_prepare"), data=json.dumps({"month": paid_due.strftime("%Y-%m")}), content_type="application/json")
        self.assertEqual(prepared.status_code, 200, prepared.content)
        restored.refresh_from_db()
        self.assertEqual(restored.assigned_amount, Decimal("200.00"))
        self.assertEqual(Transaction.objects.filter(description="Pago anual ya conciliado").count(), 1)

    def test_portable_v5_preserves_reopen_restore_after_goal_unlink(self):
        today = timezone.localdate()
        account = Account.objects.create(name="Cuenta portable tras desvincular", opening_balance=Decimal("1200.00"))
        category = Category.objects.create(name="Seguro desvinculado", kind=Category.Kind.EXPENSE)
        paid_due = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
        rule = RecurringRule.objects.create(
            name="Seguro de vivienda",
            kind=Category.Kind.EXPENSE,
            amount=Decimal("500.00"),
            account=account,
            category=category,
            frequency=RecurringRule.Frequency.YEARLY,
            day_of_month=1,
            start_date=paid_due.replace(year=paid_due.year - 1),
        )
        future_due = next_annual_due_date(rule, today)
        objective = SavingsObjective.objects.create(
            name=rule.name,
            target_amount=rule.amount,
            target_date=future_due,
            priority=2,
            assigned_amount=Decimal("200.00"),
            recurring_rule=rule,
        )
        paid = RecurringOccurrence.objects.create(
            rule=rule,
            due_date=paid_due,
            amount=rule.amount,
            status=RecurringOccurrence.Status.CONFIRMED,
            reserve_consumed_amount=Decimal("300.00"),
            reserve_objective=objective,
        )
        movement = Transaction.objects.create(
            account=account,
            kind=Transaction.Kind.EXPENSE,
            amount=rule.amount,
            date=paid_due,
            description="Seguro pagado antes de desvincular",
            category=category,
            recurring_occurrence=paid,
        )
        objective.recurring_rule = None
        objective.save(update_fields=["recurring_rule"])

        output = BytesIO()
        write_portable_export(output)
        with zipfile.ZipFile(BytesIO(output.getvalue())) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            data = json.loads(archive.read("data.json"))
            data.update(manifest)
        self.assertEqual(manifest["version"], 5)
        self.assertEqual(len(data["annual_reserve_rules"]), 1)
        self.assertIsNone(data["savings_objectives"][0]["recurring_rule"])
        self.assertEqual(data["transactions"][0]["recurring_occurrence"], f"recurring_occurrence:{paid.pk}")

        Transaction.objects.all().delete()
        RecurringOccurrence.objects.all().delete()
        SavingsObjective.objects.all().delete()
        RecurringRule.objects.all().delete()
        Category.objects.all().delete()
        Account.objects.all().delete()
        import_portable(data)

        restored = SavingsObjective.objects.get()
        imported_rule = RecurringRule.objects.get()
        imported_paid = RecurringOccurrence.objects.get(rule=imported_rule, due_date=paid_due)
        imported_movement = Transaction.objects.get(description="Seguro pagado antes de desvincular")
        self.assertIsNone(restored.recurring_rule_id)
        self.assertEqual(imported_movement.recurring_occurrence_id, imported_paid.pk)
        self.assertEqual(imported_paid.reserve_objective_id, restored.pk)
        self.assertEqual(imported_paid.reserve_consumed_amount, Decimal("300.00"))

        prepared = self.client.post(
            reverse("api_planning_prepare"),
            data=json.dumps({"month": paid_due.strftime("%Y-%m")}),
            content_type="application/json",
        )
        self.assertEqual(prepared.status_code, 200, prepared.content)
        imported_paid.refresh_from_db()
        self.assertEqual(imported_paid.status, RecurringOccurrence.Status.CONFIRMED)
        self.assertEqual(Transaction.objects.filter(description="Seguro pagado antes de desvincular").count(), 1)
        self.assertEqual(SavingsObjective.objects.get(pk=restored.pk).assigned_amount, Decimal("200.00"))

        archive_transaction(imported_movement)
        imported_paid.refresh_from_db()
        restored.refresh_from_db()
        self.assertEqual(imported_paid.status, RecurringOccurrence.Status.PENDING)
        self.assertEqual(restored.assigned_amount, Decimal("500.00"))
