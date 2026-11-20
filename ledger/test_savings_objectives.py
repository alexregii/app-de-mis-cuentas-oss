import json
import sqlite3
import tempfile
import uuid
import zipfile
from contextlib import closing
from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from django.core.management import call_command
from django.db import IntegrityError, connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.conf import settings
from django.urls import reverse
from django.utils import timezone

from .backup_contract import DATABASE_ENTRY
from .models import Account, Category, RecurringOccurrence, RecurringRule, SavingsGoal, SavingsObjective, Transaction
from .recovery import import_portable, write_portable_export
from .services import account_balance, dashboard_metrics, total_balance
from .transaction_services import create_transfer


class SavingsObjectiveApiTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.account = Account.objects.create(name="Cuenta de metas", opening_balance=Decimal("1000.00"))
        self.income = Category.objects.create(name="Ingreso metas", kind=Category.Kind.INCOME)
        self.expense = Category.objects.create(name="Gasto metas", kind=Category.Kind.EXPENSE)

    def create_objective(self, *, name="Viaje", target="800.00", assigned="0.00", archived=False):
        return SavingsObjective.objects.create(
            name=name,
            target_amount=Decimal(target),
            target_date=self.today + timedelta(days=90),
            assigned_amount=Decimal(assigned),
            archived=archived,
        )

    def post_create(self, *, name="Viaje", target="800.00", key=None):
        return self.client.post(
            reverse("api_savings_objectives"),
            data=json.dumps({
                "name": name,
                "target_amount": target,
                "target_date": (self.today + timedelta(days=90)).isoformat(),
                "priority": 2,
                "idempotency_key": str(key or uuid.uuid4()),
            }),
            content_type="application/json",
        )

    def test_create_retry_is_idempotent_and_reusing_key_with_other_data_conflicts(self):
        key = uuid.uuid4()
        first = self.post_create(key=key)

        self.assertEqual(first.status_code, 201)
        self.assertTrue(first.json()["created"])
        created_id = first.json()["objective"]["id"]
        changed = self.client.patch(
            reverse("api_savings_objective_detail", args=[created_id]),
            data=json.dumps({"expected_revision": 0, "name": "Viaje actualizado"}),
            content_type="application/json",
        )
        self.assertEqual(changed.status_code, 200)
        retry = self.post_create(key=key)

        self.assertEqual(retry.status_code, 200)
        self.assertFalse(retry.json()["created"])
        self.assertEqual(retry.json()["objective"]["name"], "Viaje actualizado")
        self.assertEqual(SavingsObjective.objects.count(), 1)

        conflict = self.post_create(name="Otro propósito", key=key)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["code"], "idempotency_key_reused")
        self.assertEqual(SavingsObjective.objects.count(), 1)

    def test_plan_lists_objectives_and_reports_recorded_balance_without_changing_legacy_goal(self):
        SavingsGoal.objects.create(percentage=20, minimum=Decimal("100.00"))
        Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("1500.00"),
            date=self.today,
            description="Nómina",
            category=self.income,
        )
        active = self.create_objective(assigned="300.00")
        archived = self.create_objective(name="Archivada", target="200.00", assigned="70.00", archived=True)

        payload = self.client.get(reverse("api_planning"), {"month": self.today.strftime("%Y-%m")}).json()
        objectives = payload["savings_objectives"]

        self.assertEqual([item["id"] for item in objectives["items"]], [active.pk, archived.pk])
        self.assertEqual(objectives["items"][0]["remaining_amount"], 500.0)
        self.assertFalse(objectives["items"][0]["achieved"])
        self.assertTrue(objectives["items"][1]["archived"])
        self.assertEqual(
            {key: value for key, value in objectives["summary"].items() if key != "confirmation_token"},
            {
                "ledger_balance": 2500.0,
                "eligible_balance": 2500.0,
                "assigned_total": 300.0,
                "free_to_assign": 2200.0,
                "overallocated": False,
                "overallocated_by": 0.0,
            },
        )
        self.assertEqual(len(objectives["summary"]["confirmation_token"]), 64)
        self.assertEqual(payload["goal"]["percentage"], 20.0)
        self.assertEqual(payload["goal"]["minimum"], 100.0)
        self.assertAlmostEqual(payload["margin"]["savings_goal"], 300.0)

    def test_overallocation_requires_explicit_confirmation_and_stale_revision_cannot_replace_newer_assignment(self):
        first = self.create_objective(target="1200.00")
        first_response = self.client.put(
            reverse("api_savings_objective_allocation", args=[first.pk]),
            data=json.dumps({"expected_revision": 0, "assigned_amount": "900.00"}),
            content_type="application/json",
        )
        second = self.create_objective(name="Muebles", target="500.00")
        needs_confirmation = self.client.put(
            reverse("api_savings_objective_allocation", args=[second.pk]),
            data=json.dumps({"expected_revision": 0, "assigned_amount": "200.00"}),
            content_type="application/json",
        )

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(first_response.json()["objective"]["revision"], 1)
        self.assertEqual(needs_confirmation.status_code, 409)
        self.assertEqual(needs_confirmation.json()["code"], "over_allocation_confirmation_required")
        self.assertEqual(needs_confirmation.json()["summary"]["overallocated_by"], 100.0)
        second.refresh_from_db()
        self.assertEqual(second.assigned_amount, Decimal("0.00"))

        confirmed_snapshot = needs_confirmation.json()["summary"]["confirmation_token"]
        self.account.opening_balance = Decimal("900.00")
        self.account.save(update_fields=["opening_balance"])
        stale_confirmation = self.client.put(
            reverse("api_savings_objective_allocation", args=[second.pk]),
            data=json.dumps({
                "expected_revision": 0,
                "assigned_amount": "200.00",
                "confirm_overallocation": True,
                "confirmed_snapshot": confirmed_snapshot,
            }),
            content_type="application/json",
        )
        self.assertEqual(stale_confirmation.status_code, 409)
        self.assertEqual(stale_confirmation.json()["code"], "allocation_snapshot_changed")

        accepted = self.client.put(
            reverse("api_savings_objective_allocation", args=[second.pk]),
            data=json.dumps({
                "expected_revision": 0,
                "assigned_amount": "200.00",
                "confirm_overallocation": True,
                "confirmed_snapshot": stale_confirmation.json()["summary"]["confirmation_token"],
            }),
            content_type="application/json",
        )
        exact_retry = self.client.put(
            reverse("api_savings_objective_allocation", args=[second.pk]),
            data=json.dumps({"expected_revision": 0, "assigned_amount": "200.00"}),
            content_type="application/json",
        )
        stale_change = self.client.put(
            reverse("api_savings_objective_allocation", args=[second.pk]),
            data=json.dumps({"expected_revision": 0, "assigned_amount": "300.00"}),
            content_type="application/json",
        )

        self.assertEqual(accepted.status_code, 200)
        self.assertTrue(accepted.json()["summary"]["overallocated"])
        self.assertEqual(exact_retry.status_code, 200)
        self.assertEqual(exact_retry.json()["objective"]["revision"], 1)
        self.assertEqual(stale_change.status_code, 409)
        self.assertEqual(stale_change.json()["code"], "stale_revision")
        second.refresh_from_db()
        self.assertEqual(second.assigned_amount, Decimal("200.00"))

    def test_archive_releases_virtual_reserve_and_reactivation_requires_confirmation_when_balance_fell(self):
        objective = self.create_objective(target="500.00", assigned="500.00")
        archived = self.client.patch(
            reverse("api_savings_objective_detail", args=[objective.pk]),
            data=json.dumps({"expected_revision": 0, "archived": True}),
            content_type="application/json",
        )
        self.account.opening_balance = Decimal("300.00")
        self.account.save(update_fields=["opening_balance"])
        needs_confirmation = self.client.patch(
            reverse("api_savings_objective_detail", args=[objective.pk]),
            data=json.dumps({"expected_revision": 1, "archived": False}),
            content_type="application/json",
        )
        reactivated = self.client.patch(
            reverse("api_savings_objective_detail", args=[objective.pk]),
            data=json.dumps({
                "expected_revision": 1,
                "archived": False,
                "confirm_overallocation": True,
                "confirmed_snapshot": needs_confirmation.json()["summary"]["confirmation_token"],
            }),
            content_type="application/json",
        )

        self.assertEqual(archived.status_code, 200)
        self.assertEqual(archived.json()["summary"]["assigned_total"], 0.0)
        self.assertEqual(archived.json()["objective"]["remaining_amount"], 0.0)
        self.assertTrue(archived.json()["objective"]["achieved"])
        self.assertEqual(needs_confirmation.status_code, 409)
        self.assertEqual(reactivated.status_code, 200)
        self.assertFalse(reactivated.json()["objective"]["archived"])
        self.assertTrue(reactivated.json()["summary"]["overallocated"])

    def test_reactivation_refreshes_projected_summary_when_ledger_changes_before_confirmation(self):
        objective = self.create_objective(target="500.00", assigned="500.00", archived=True)
        self.account.opening_balance = Decimal("300.00")
        self.account.save(update_fields=["opening_balance"])
        url = reverse("api_savings_objective_detail", args=[objective.pk])

        needs_confirmation = self.client.patch(
            url,
            data=json.dumps({"expected_revision": 0, "archived": False}),
            content_type="application/json",
        )
        self.account.opening_balance = Decimal("250.00")
        self.account.save(update_fields=["opening_balance"])
        stale_confirmation = self.client.patch(
            url,
            data=json.dumps({
                "expected_revision": 0,
                "archived": False,
                "confirm_overallocation": True,
                "confirmed_snapshot": needs_confirmation.json()["summary"]["confirmation_token"],
            }),
            content_type="application/json",
        )
        summary = stale_confirmation.json()["summary"]
        accepted = self.client.patch(
            url,
            data=json.dumps({
                "expected_revision": 0,
                "archived": False,
                "confirm_overallocation": True,
                "confirmed_snapshot": summary["confirmation_token"],
            }),
            content_type="application/json",
        )

        self.assertEqual(needs_confirmation.status_code, 409)
        self.assertEqual(needs_confirmation.json()["summary"]["assigned_total"], 500.0)
        self.assertEqual(stale_confirmation.status_code, 409)
        self.assertEqual(stale_confirmation.json()["code"], "allocation_snapshot_changed")
        self.assertEqual(summary["eligible_balance"], 250.0)
        self.assertEqual(summary["assigned_total"], 500.0)
        self.assertEqual(summary["free_to_assign"], 0.0)
        self.assertTrue(summary["overallocated"])
        self.assertEqual(summary["overallocated_by"], 250.0)
        self.assertEqual(accepted.status_code, 200)
        self.assertFalse(accepted.json()["objective"]["archived"])
        self.assertTrue(accepted.json()["summary"]["overallocated"])

    def test_negative_balance_confirmation_uses_the_same_raw_snapshot(self):
        Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("1010.00"),
            date=self.today,
            description="Gasto superior al saldo",
            category=self.expense,
        )
        objective = self.create_objective()
        url = reverse("api_savings_objective_allocation", args=[objective.pk])
        payload = {"expected_revision": 0, "assigned_amount": "20.00"}

        needs_confirmation = self.client.put(
            url,
            data=json.dumps(payload),
            content_type="application/json",
        )
        summary = needs_confirmation.json()["summary"]
        accepted = self.client.put(
            url,
            data=json.dumps({
                **payload,
                "confirm_overallocation": True,
                "confirmed_snapshot": summary["confirmation_token"],
            }),
            content_type="application/json",
        )

        self.assertEqual(total_balance(), Decimal("-10.00"))
        self.assertEqual(needs_confirmation.status_code, 409)
        self.assertEqual(needs_confirmation.json()["code"], "over_allocation_confirmation_required")
        self.assertEqual(summary["ledger_balance"], -10.0)
        self.assertEqual(summary["eligible_balance"], 0.0)
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json()["objective"]["assigned_amount"], 20.0)

    def test_refund_changes_recorded_base_once_but_virtual_assignment_never_changes_metrics_or_liquidity(self):
        SavingsGoal.objects.create(percentage=20, minimum=Decimal("100.00"))
        expense = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("100.00"),
            date=self.today,
            description="Compra reembolsable",
            category=self.expense,
        )
        Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("30.00"),
            date=self.today,
            description="Reembolso",
            category=self.income,
            refund_for=expense,
        )
        objective = self.create_objective(target="1000.00", assigned="800.00")
        self.assertEqual(total_balance(), Decimal("930.00"))
        self.assertEqual(self.client.get(reverse("api_planning")).json()["savings_objectives"]["summary"]["free_to_assign"], 130.0)

        before_metrics = dashboard_metrics(as_of=self.today)
        before_ledger_balance = total_balance()
        date_to = self.today + timedelta(days=1)
        query = {"account": self.account.pk, "date_from": self.today.isoformat(), "date_to": date_to.isoformat()}
        before_liquidity = self.client.get(reverse("api_planning_liquidity"), query).json()
        transaction_count = Transaction.objects.count()
        allocation = self.client.put(
            reverse("api_savings_objective_allocation", args=[objective.pk]),
            data=json.dumps({"expected_revision": 0, "assigned_amount": "900.00"}),
            content_type="application/json",
        )
        after_metrics = dashboard_metrics(as_of=self.today)
        after_liquidity = self.client.get(reverse("api_planning_liquidity"), query).json()

        self.assertEqual(allocation.status_code, 200)
        self.assertEqual(total_balance(), before_ledger_balance)
        self.assertEqual(Transaction.objects.count(), transaction_count)
        self.assertEqual(after_metrics["savings_goal"], before_metrics["savings_goal"])
        self.assertEqual(after_metrics["savings_goal_progress"], before_metrics["savings_goal_progress"])
        self.assertEqual(after_metrics["safe_to_spend"], before_metrics["safe_to_spend"])
        self.assertEqual(after_liquidity, before_liquidity)

        destination = Account.objects.create(name="Destino de traspaso", kind=Account.Kind.SAVINGS)
        source_balance = account_balance(self.account)
        create_transfer(
            source_account=self.account,
            target_account=destination,
            amount=Decimal("50.00"),
            tx_date=self.today,
            description="Aportación real",
        )
        self.assertEqual(account_balance(self.account), source_balance - Decimal("50.00"))
        self.assertEqual(account_balance(destination), Decimal("50.00"))
        self.assertEqual(total_balance(), before_ledger_balance)
        objective.refresh_from_db()
        self.assertEqual(objective.assigned_amount, Decimal("900.00"))

    def test_invalid_dates_money_and_boolean_values_are_rejected(self):
        payload = {
            "name": "Viaje",
            "target_amount": "10.001",
            "target_date": "2026-02-30",
            "priority": True,
            "idempotency_key": str(uuid.uuid4()),
        }
        response = self.client.post(reverse("api_savings_objectives"), data=json.dumps(payload), content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(SavingsObjective.objects.count(), 0)


class SavingsObjectivePortableTests(TestCase):
    def test_portable_v4_round_trip_preserves_legacy_setting_and_active_archived_goals(self):
        legacy = SavingsGoal.objects.create(percentage=25, minimum=Decimal("125.00"), active=True)
        active = SavingsObjective.objects.create(
            name="Estudios",
            target_amount=Decimal("1200.00"),
            target_date=date(2027, 6, 1),
            priority=1,
            assigned_amount=Decimal("250.00"),
            revision=4,
        )
        archived = SavingsObjective.objects.create(
            name="Bicicleta",
            target_amount=Decimal("700.00"),
            target_date=date(2027, 2, 1),
            priority=3,
            assigned_amount=Decimal("100.00"),
            archived=True,
        )

        output = BytesIO()
        write_portable_export(output)
        with zipfile.ZipFile(BytesIO(output.getvalue())) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            portable = json.loads(archive.read("data.json"))
            portable.update(manifest)
        self.assertEqual(manifest["version"], 5)
        self.assertEqual(portable["legacy_savings_goal"], {"percentage": "25.00", "minimum": "125.00", "active": True})
        self.assertEqual(len(portable["savings_objectives"]), 2)

        SavingsObjective.objects.all().delete()
        SavingsGoal.objects.all().delete()
        result = import_portable(portable)

        self.assertEqual(result["legacy_savings_goal"], 1)
        self.assertEqual(result["savings_objectives"], 2)
        restored_legacy = SavingsGoal.objects.get()
        self.assertEqual(restored_legacy.percentage, legacy.percentage)
        self.assertEqual(restored_legacy.minimum, legacy.minimum)
        self.assertTrue(restored_legacy.active)
        restored_active = SavingsObjective.objects.get(name="Estudios")
        restored_archived = SavingsObjective.objects.get(name="Bicicleta")
        self.assertEqual(restored_active.target_amount, active.target_amount)
        self.assertEqual(restored_active.assigned_amount, active.assigned_amount)
        self.assertEqual(restored_active.target_date, active.target_date)
        self.assertEqual(restored_active.priority, active.priority)
        self.assertEqual(restored_active.revision, 0)
        self.assertNotEqual(restored_active.idempotency_key, active.idempotency_key)
        self.assertTrue(restored_archived.archived)
        self.assertEqual(restored_archived.assigned_amount, archived.assigned_amount)

    def test_portable_v3_import_keeps_transaction_on_legacy_category_fallback(self):
        data = {
            "format": "miscuentas-portable",
            "version": 3,
            "accounts": [{"id": 1, "name": "Cuenta v3", "kind": Account.Kind.CHECKING, "opening_balance": "500.00"}],
            "categories": [{"id": 1, "name": "Comida v3", "kind": Category.Kind.EXPENSE}],
            "tags": [],
            "transactions": [{
                "id": 1,
                "account": 1,
                "category": 1,
                "kind": Transaction.Kind.EXPENSE,
                "amount": "12.34",
                "date": timezone.localdate().isoformat(),
                "description": "Compra legacy v3",
                "tags": [],
            }],
            "legacy_savings_goal": None,
            "savings_objectives": [],
        }

        result = import_portable(data)

        self.assertEqual(result, {
            "accounts": 1,
            "categories": 1,
            "transactions": 1,
            "legacy_savings_goal": 0,
            "savings_objectives": 0,
        })
        restored = Transaction.objects.get(description="Compra legacy v3")
        self.assertEqual(restored.category.name, "Comida v3")
        self.assertEqual(restored.allocations.count(), 0)

    def test_portable_v1_and_v2_still_import_without_creating_goal_state(self):
        for version in (1, 2):
            with self.subTest(version=version):
                data = {
                    "format": "miscuentas-portable",
                    "version": version,
                    "accounts": [],
                    "categories": [],
                    "tags": [],
                    "transactions": [],
                }
                result = import_portable(data)
                self.assertEqual(result, {"accounts": 0, "categories": 0, "transactions": 0})
                self.assertFalse(SavingsGoal.objects.exists())
                self.assertFalse(SavingsObjective.objects.exists())

    def test_invalid_portable_v3_goal_rolls_back_legacy_and_objective_import(self):
        data = {
            "format": "miscuentas-portable",
            "version": 3,
            "accounts": [],
            "categories": [],
            "tags": [],
            "transactions": [],
            "legacy_savings_goal": {"percentage": "10.00", "minimum": "50.00", "active": True},
            "savings_objectives": [{
                "name": "Inválida",
                "target_amount": "0.00",
                "target_date": "2027-01-01",
                "priority": 2,
                "assigned_amount": "0.00",
                "archived": False,
            }],
        }
        with self.assertRaises(ValueError):
            import_portable(data)
        self.assertFalse(SavingsGoal.objects.exists())
        self.assertFalse(SavingsObjective.objects.exists())


class SavingsObjectiveNativeBackupTests(TransactionTestCase):
    def test_native_backup_snapshot_contains_legacy_goal_and_objective(self):
        SavingsGoal.objects.create(percentage=18, minimum=Decimal("90.00"))
        account = Account.objects.create(name="Cuenta nativa")
        category = Category.objects.create(name="Seguro nativo", kind=Category.Kind.EXPENSE)
        rule = RecurringRule.objects.create(name="Seguro anual nativo", kind=Category.Kind.EXPENSE, amount=Decimal("1000.00"), account=account, category=category, frequency=RecurringRule.Frequency.YEARLY, day_of_month=1, start_date=timezone.localdate().replace(day=1))
        objective = SavingsObjective.objects.create(
            name="Fondo",
            target_amount=Decimal("1000.00"),
            target_date=timezone.localdate() + timedelta(days=60),
            assigned_amount=Decimal("350.00"),
            recurring_rule=rule,
        )
        occurrence = RecurringOccurrence.objects.create(rule=rule, due_date=objective.target_date, amount=Decimal("1000.00"), reserve_consumed_amount=Decimal("125.00"), reserve_objective=objective)
        with tempfile.TemporaryDirectory() as temp:
            call_command("backup_finance", destination=temp, kind="manual")
            archive_path = next((Path(temp) / "manual").glob("manual-*.zip"))
            with zipfile.ZipFile(archive_path) as archive:
                database_file = Path(temp) / "snapshot.sqlite3"
                database_file.write_bytes(archive.read(DATABASE_ENTRY))
            with closing(sqlite3.connect(database_file)) as restored:
                saved_goal = restored.execute("SELECT percentage, minimum, active FROM ledger_savingsgoal").fetchone()
                saved_objective = restored.execute(
                    "SELECT name, assigned_amount, archived, recurring_rule_id FROM ledger_savingsobjective WHERE id = ?",
                    [objective.pk],
                ).fetchone()
                saved_occurrence = restored.execute(
                    "SELECT reserve_consumed_amount, reserve_objective_id FROM ledger_recurringoccurrence WHERE id = ?",
                    [occurrence.pk],
                ).fetchone()
        self.assertEqual((Decimal(str(saved_goal[0])), Decimal(str(saved_goal[1])), saved_goal[2]), (Decimal("18.00"), Decimal("90.00"), 1))
        self.assertEqual((saved_objective[0], Decimal(str(saved_objective[1])), saved_objective[2], saved_objective[3]), ("Fondo", Decimal("350.00"), 0, rule.pk))
        self.assertEqual((Decimal(str(saved_occurrence[0])), saved_occurrence[1]), (Decimal("125.00"), objective.pk))


class SavingsObjectiveMigrationTests(TransactionTestCase):
    def setUp(self):
        super().setUp()
        self.database_temp = tempfile.TemporaryDirectory()
        databases = deepcopy(settings.DATABASES)
        databases["default"]["NAME"] = Path(self.database_temp.name) / "m19-migrations.sqlite3"
        connections.close_all()
        self.database_override = override_settings(DATABASES=databases)
        self.database_override.enable()
        connections.__dict__.pop("settings", None)
        connections._settings = None
        try:
            del connections["default"]
        except AttributeError:
            pass
        call_command("migrate", "ledger", "0019_subscriptionreview_revision", database="default", interactive=False, verbosity=0)

    def tearDown(self):
        connections.close_all()
        self.database_override.disable()
        connections.__dict__.pop("settings", None)
        connections._settings = None
        try:
            del connections["default"]
        except AttributeError:
            pass
        connections.close_all()
        self.database_temp.cleanup()
        super().tearDown()

    def test_new_model_migration_runs_forward_reverse_and_forward_on_disposable_sqlite(self):
        table_names = set(connections["default"].introspection.table_names())
        self.assertNotIn("ledger_savingsobjective", table_names)

        call_command("migrate", "ledger", "0020_savingsobjective", database="default", interactive=False, verbosity=0)
        self.assertIn("ledger_savingsobjective", connections["default"].introspection.table_names())
        self.assertIn("ledger_savingsgoal", connections["default"].introspection.table_names())
        with connections["default"].cursor() as cursor:
            first_columns = {column.name for column in connections["default"].introspection.get_table_description(cursor, "ledger_savingsobjective")}
        self.assertNotIn("create_digest", first_columns)

        call_command("migrate", "ledger", "0021_savingsobjective_create_digest", database="default", interactive=False, verbosity=0)
        with connections["default"].cursor() as cursor:
            self.assertIn("create_digest", {column.name for column in connections["default"].introspection.get_table_description(cursor, "ledger_savingsobjective")})

        call_command("migrate", "ledger", "0019_subscriptionreview_revision", database="default", interactive=False, verbosity=0)
        self.assertNotIn("ledger_savingsobjective", connections["default"].introspection.table_names())
        self.assertIn("ledger_savingsgoal", connections["default"].introspection.table_names())

        call_command("migrate", "ledger", "0021_savingsobjective_create_digest", database="default", interactive=False, verbosity=0)
        self.assertIn("ledger_savingsobjective", connections["default"].introspection.table_names())
