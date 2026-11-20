import json
import sqlite3
import tempfile
import uuid
from contextlib import closing
from datetime import date, datetime
from decimal import Decimal
from io import BytesIO
from pathlib import Path
import zipfile
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import IntegrityError, OperationalError, connection
from django.test import TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone

from .models import Account, BankAccount, BankConnection, BankTransaction, Category, ImportBatch, ImportRow, MonthlyClose, ReconciliationSnapshot, Transaction
from .monthly_closures import (
    MonthlyCloseConflict,
    _normalize_declarations,
    _request_digest,
    build_monthly_close_preview,
    create_monthly_close,
    parse_month,
)
from .recovery import import_portable, inspect_restore_archive, write_portable_export
from .transaction_allocations import replace_transaction_allocations


class MonthlyCloseApiTests(TestCase):
    month = date(2026, 9, 1)
    cutoff = date(2026, 9, 30)

    def setUp(self):
        self.account = Account.objects.create(name="Cierre mensual", kind=Account.Kind.CHECKING)
        old_created_at = timezone.make_aware(datetime(2026, 8, 1, 12, 0))
        Account.objects.filter(pk=self.account.pk).update(created_at=old_created_at)
        self.account.refresh_from_db()
        self.expense_category = Category.objects.create(name="Gasto cierre", kind=Category.Kind.EXPENSE)
        self.income_category = Category.objects.create(name="Ingreso cierre", kind=Category.Kind.INCOME)
        self.expense = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("40.00"),
            date=date(2026, 9, 10),
            description="Compra septiembre",
            category=self.expense_category,
        )
        self.income = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("100.00"),
            date=date(2026, 9, 20),
            description="Ingreso septiembre",
            category=self.income_category,
        )
        ReconciliationSnapshot.objects.create(
            account=self.account,
            date=self.cutoff,
            statement_balance=Decimal("60.00"),
            ledger_balance=Decimal("60.00"),
            difference=Decimal("0.00"),
            status=ReconciliationSnapshot.Status.RECONCILED,
        )
        self.url = reverse("api_monthly_closures")

    def test_parse_month_preserves_format_calendar_and_cutoff_errors(self):
        with self.assertRaisesRegex(ValueError, "Indica el mes con el formato YYYY-MM"):
            parse_month("not-a-month")
        with self.assertRaisesRegex(ValueError, "El mes no es válido"):
            parse_month("2026-13")

        with patch("ledger.monthly_closures.timezone.localdate", return_value=date(2026, 9, 30)):
            with self.assertRaisesRegex(ValueError, "Solo se pueden cerrar meses completos ya finalizados"):
                parse_month("2026-09")

        with patch("ledger.monthly_closures.timezone.localdate", return_value=date(2026, 9, 30)):
            self.assertEqual(parse_month("2026-08"), (date(2026, 8, 1), date(2026, 8, 31)))

    def get_state(self, basis="analytics"):
        return self.client.get(self.url, {"month": "2026-09", "basis": basis})

    def post_close(self, preview, **overrides):
        payload = {
            "month": "2026-09",
            "basis": "analytics",
            "source_digest": preview["source_digest"],
            "idempotency_key": str(uuid.uuid4()),
            "declarations": {},
            "correction_reason": "",
        }
        payload.update(overrides)
        return self.client.post(self.url, data=json.dumps(payload), content_type="application/json"), payload

    def test_preview_is_read_only_and_pins_full_month_basis_and_sources(self):
        with CaptureQueriesContext(connection) as queries:
            response = self.get_state()

        self.assertEqual(response.status_code, 200)
        state = response.json()
        preview = state["preview"]
        self.assertEqual(preview["issues"], [])
        self.assertEqual(preview["report"]["scope"]["date_from"], "2026-09-01")
        self.assertEqual(preview["report"]["scope"]["date_to"], "2026-09-30")
        self.assertEqual(preview["report"]["summary"]["income"], "100.00")
        self.assertEqual(preview["report"]["summary"]["net_expense"], "40.00")
        self.assertEqual(preview["report"]["summary"]["analytical_result"], "60.00")
        self.assertIn("source_movements_url", preview["report"])
        writes = [query["sql"] for query in queries if query["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))]
        self.assertEqual(writes, [])
        self.assertEqual(MonthlyClose.objects.count(), 0)

    def test_preview_preserves_the_selected_analytics_or_all_basis(self):
        excluded = Category.objects.create(
            name="Gasto fuera de analítica",
            kind=Category.Kind.EXPENSE,
            exclude_from_analytics=True,
        )
        Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("8.00"),
            date=date(2026, 9, 12),
            description="Gasto excluido del análisis",
            category=excluded,
        )

        analytics = self.get_state("analytics").json()["preview"]
        all_movements = self.get_state("all").json()["preview"]

        self.assertEqual(analytics["report"]["scope"]["basis"], MonthlyClose.Basis.ANALYTICS)
        self.assertEqual(analytics["report"]["summary"]["net_expense"], "40.00")
        self.assertEqual(all_movements["report"]["scope"]["basis"], MonthlyClose.Basis.ALL)
        self.assertEqual(all_movements["report"]["summary"]["net_expense"], "48.00")

    def test_late_created_account_with_preperiod_balance_is_checked_and_hashed(self):
        late_account = Account.objects.create(name="Cuenta importada tarde", kind=Account.Kind.CHECKING)
        Transaction.objects.create(
            account=late_account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("5.00"),
            date=date(2026, 8, 18),
            description="Saldo anterior al periodo",
            category=self.expense_category,
        )

        preview = self.get_state().json()["preview"]
        late_check = next(account for account in preview["accounts"] if account["account_name"] == late_account.name)
        self.assertTrue(late_check["created_after_cutoff"])
        self.assertEqual(late_check["ledger_balance_at_cut"], "-5.00")
        account_issue = next(issue for issue in preview["issues"] if issue.get("account_name") == late_account.name)
        self.assertIn("missing_month_end_cut", account_issue["details"]["reasons"])

        response, _ = self.post_close(preview)
        self.assertEqual(response.status_code, 409)
        declarations = {issue["key"]: "Se importó la cuenta y se revisó su corte histórico." for issue in preview["issues"]}
        response, _ = self.post_close(preview, idempotency_key=str(uuid.uuid4()), declarations=declarations)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(MonthlyClose.objects.get().status_at_close, MonthlyClose.Status.DECLARED)

        Transaction.objects.create(
            account=late_account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("2.00"),
            date=date(2026, 8, 21),
            description="Ajuste previo al periodo",
            category=self.expense_category,
        )
        updated = self.get_state().json()
        self.assertEqual(updated["preview"]["report"]["summary"]["net_expense"], "40.00")
        updated_late_check = next(account for account in updated["preview"]["accounts"] if account["account_name"] == late_account.name)
        self.assertEqual(updated_late_check["ledger_balance_at_cut"], "-7.00")
        self.assertEqual(updated["versions"][0]["source_verification"], "stale")

    def test_idempotency_race_rejects_a_colliding_key_with_different_reasons(self):
        batch = ImportBatch.objects.create(filename="colisión.csv", account=self.account)
        ImportRow.objects.create(
            batch=batch,
            row_number=1,
            date=date(2026, 9, 26),
            description="Fila pendiente para colisión",
            amount=Decimal("3.00"),
            kind=Category.Kind.EXPENSE,
            fingerprint="c" * 64,
        )
        preview = self.get_state().json()["preview"]
        issue_key = preview["issues"][0]["key"]
        original_declarations = _normalize_declarations({issue_key: "Motivo de la petición que ganó la carrera."})
        correction_reason = "Corrección de un cierre previo."

        for index, collision_error in enumerate((IntegrityError, OperationalError)):
            with self.subTest(error=collision_error.__name__):
                idempotency_key = str(uuid.uuid4())
                request_digest = _request_digest("2026-09", MonthlyClose.Basis.ANALYTICS, preview["source_digest"], original_declarations, correction_reason)
                previous_request = MonthlyClose.objects.create(
                    month=date(2026, 8 + index, 1),
                    basis=MonthlyClose.Basis.ANALYTICS,
                    version=1,
                    status_at_close=MonthlyClose.Status.DECLARED,
                    source_digest="0" * 64,
                    idempotency_key=idempotency_key,
                    request_digest=request_digest,
                    report={},
                    accounts=[],
                    issues=[],
                    declarations=original_declarations,
                    correction_reason=correction_reason,
                )
                real_filter = MonthlyClose.objects.filter
                idempotency_filter_count = 0

                def hide_first_idempotency_read(*args, **kwargs):
                    nonlocal idempotency_filter_count
                    if kwargs.get("idempotency_key") == idempotency_key:
                        idempotency_filter_count += 1
                        if idempotency_filter_count == 1:
                            return MonthlyClose.objects.none()
                    return real_filter(*args, **kwargs)

                with patch.object(MonthlyClose.objects, "filter", side_effect=hide_first_idempotency_read):
                    with patch.object(MonthlyClose.objects, "create", side_effect=collision_error("simulated concurrent insert")):
                        with self.assertRaises(MonthlyCloseConflict):
                            create_monthly_close(
                                month_value="2026-09",
                                basis=MonthlyClose.Basis.ANALYTICS,
                                source_digest=preview["source_digest"],
                                idempotency_key=idempotency_key,
                                declarations={issue_key: "Motivo distinto para el payload concurrente."},
                                correction_reason=correction_reason,
                            )
                self.assertEqual(previous_request.request_digest, request_digest)

    def test_empty_report_marks_coverage_as_unknown_not_zero(self):
        Transaction.objects.all().delete()

        preview = self.get_state().json()["preview"]

        self.assertEqual(preview["report"]["activity_status"], "unknown")
        self.assertEqual(preview["report"]["summary"]["net_expense"], "0.00")
        coverage = next(issue for issue in preview["issues"] if issue["type"] == "coverage_unknown")
        self.assertEqual(coverage["key"], "coverage:2026-09:analytics")

    def test_statement_difference_requires_a_traced_close_declaration(self):
        snapshot = ReconciliationSnapshot.objects.get(account=self.account)
        snapshot.statement_balance = Decimal("65.00")
        snapshot.difference = Decimal("5.00")
        snapshot.status = ReconciliationSnapshot.Status.DIFFERENCE
        snapshot.save(update_fields=["statement_balance", "difference", "status"])

        preview = self.get_state().json()["preview"]
        account_issue = next(issue for issue in preview["issues"] if issue["type"] == "account_reconciliation")
        self.assertIn("statement_difference", account_issue["details"]["reasons"])
        response, _ = self.post_close(preview)
        self.assertEqual(response.status_code, 409)

        response, _ = self.post_close(
            preview,
            declarations={issue["key"]: "La diferencia de extracto se revisó y se declara en este cierre." for issue in preview["issues"]},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(MonthlyClose.objects.get().status_at_close, MonthlyClose.Status.DECLARED)

    def test_pending_bank_and_csv_rows_require_explicit_reasons(self):
        connection_row = BankConnection.objects.create(bank_name="Banco cierre", session_id="monthly-close-session")
        connection_row.last_synced_at = timezone.now()
        connection_row.save(update_fields=["last_synced_at"])
        bank_account = BankAccount.objects.create(
            connection=connection_row,
            account=self.account,
            remote_uid="monthly-close-account",
            display_name="Cuenta de cierre",
        )
        BankTransaction.objects.create(
            bank_account=bank_account,
            remote_id="monthly-close-bank-row",
            booking_date=date(2026, 9, 25),
            description="Cargo pendiente",
            amount=Decimal("5.00"),
            kind=Category.Kind.EXPENSE,
            fingerprint="a" * 64,
        )
        batch = ImportBatch.objects.create(filename="cierre.csv", account=self.account)
        ImportRow.objects.create(
            batch=batch,
            row_number=1,
            date=date(2026, 9, 26),
            description="Fila CSV pendiente",
            amount=Decimal("3.00"),
            kind=Category.Kind.EXPENSE,
            fingerprint="b" * 64,
        )

        preview = self.get_state().json()["preview"]
        issue_keys = {issue["type"]: issue["key"] for issue in preview["issues"]}
        self.assertEqual(set(issue_keys), {"pending_bank", "pending_csv"})
        response, _ = self.post_close(preview)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(MonthlyClose.objects.count(), 0)

        declarations = {key: "Conciliado contra el extracto y declarado al cierre." for key in issue_keys.values()}
        response, _ = self.post_close(preview, declarations=declarations)
        self.assertEqual(response.status_code, 201)
        close = MonthlyClose.objects.get()
        self.assertEqual(close.status_at_close, MonthlyClose.Status.DECLARED)
        self.assertEqual(len(close.declarations), 2)

    def test_bank_link_without_a_completed_sync_requires_declaration(self):
        connection_row = BankConnection.objects.create(bank_name="Banco sin sync", session_id="monthly-close-unsynced")
        BankAccount.objects.create(
            connection=connection_row,
            account=self.account,
            remote_uid="monthly-close-unsynced-account",
            display_name="Cuenta sin sync",
        )

        preview = self.get_state().json()["preview"]
        account_issue = next(issue for issue in preview["issues"] if issue["type"] == "account_reconciliation")
        self.assertIn("bank_connection_attention", account_issue["details"]["reasons"])
        response, _ = self.post_close(preview)
        self.assertEqual(response.status_code, 409)

        response, _ = self.post_close(
            preview,
            idempotency_key=str(uuid.uuid4()),
            declarations={issue["key"]: "Se verificó el estado del conector y se declara su cobertura pendiente." for issue in preview["issues"]},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(MonthlyClose.objects.get().accounts[0]["bank_source"]["last_synced_at"], None)

    def test_same_idempotency_key_retries_the_same_version(self):
        preview = self.get_state().json()["preview"]
        response, payload = self.post_close(preview)
        self.assertEqual(response.status_code, 201)

        retry = self.client.post(self.url, data=json.dumps(payload), content_type="application/json")

        self.assertEqual(retry.status_code, 200)
        self.assertFalse(retry.json()["created"])
        self.assertEqual(retry.json()["versions"][0]["version"], 1)
        self.assertEqual(retry.json()["versions"][0]["accounts"][0]["account_name"], self.account.name)
        self.assertEqual(MonthlyClose.objects.count(), 1)

    def test_late_refund_marks_closed_report_stale_and_reclose_keeps_version_one(self):
        preview = self.get_state().json()["preview"]
        first_response, _ = self.post_close(preview)
        self.assertEqual(first_response.status_code, 201)
        Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("15.00"),
            date=date(2026, 10, 5),
            description="Devolución posterior",
            category=self.income_category,
            refund_for=self.expense,
        )

        state = self.get_state().json()
        self.assertEqual(state["versions"][0]["source_verification"], "stale")
        self.assertEqual(state["preview"]["report"]["summary"]["net_expense"], "25.00")
        stale_response, _ = self.post_close(preview)
        self.assertEqual(stale_response.status_code, 409)

        second_response, _ = self.post_close(
            state["preview"],
            idempotency_key=str(uuid.uuid4()),
            correction_reason="Se registró una devolución posterior del gasto.",
        )
        self.assertEqual(second_response.status_code, 201)
        state = second_response.json()
        self.assertEqual([item["version"] for item in state["versions"]], [1, 2])
        self.assertEqual(state["versions"][0]["report"]["summary"]["net_expense"], "40.00")
        self.assertEqual(state["versions"][0]["source_verification"], "superseded")
        self.assertEqual(state["versions"][1]["report"]["summary"]["net_expense"], "25.00")
        self.assertEqual(state["versions"][1]["source_verification"], "current")

    def test_partial_month_and_reclose_without_reason_are_rejected(self):
        current_month = self.client.get(self.url, {"month": timezone.localdate().strftime("%Y-%m"), "basis": "analytics"})
        self.assertEqual(current_month.status_code, 400)
        preview = self.get_state().json()["preview"]
        first_response, _ = self.post_close(preview)
        self.assertEqual(first_response.status_code, 201)
        second_response, _ = self.post_close(preview, idempotency_key=str(uuid.uuid4()))
        self.assertEqual(second_response.status_code, 400)
        self.assertEqual(MonthlyClose.objects.count(), 1)

    def test_reclose_requires_a_changed_source_digest(self):
        preview = self.get_state().json()["preview"]
        first_response, _ = self.post_close(preview)
        self.assertEqual(first_response.status_code, 201)

        duplicate_response, _ = self.post_close(
            preview,
            idempotency_key=str(uuid.uuid4()),
            correction_reason="Intento duplicado sin cambio financiero.",
        )

        self.assertEqual(duplicate_response.status_code, 409)
        self.assertEqual(MonthlyClose.objects.count(), 1)

    def test_reallocating_a_transaction_changes_the_month_close_source_digest(self):
        preview = self.get_state().json()["preview"]
        first_response, _ = self.post_close(preview)
        self.assertEqual(first_response.status_code, 201)
        transport = Category.objects.create(name="Transporte cierre", kind=Category.Kind.EXPENSE)

        replace_transaction_allocations(self.expense, [
            {"category_id": self.expense_category.pk, "amount": "25.00"},
            {"category_id": transport.pk, "amount": "15.00"},
        ], expected_revision=0)

        refreshed = self.get_state().json()
        self.assertNotEqual(preview["source_digest"], refreshed["preview"]["source_digest"])
        self.assertEqual(refreshed["versions"][0]["source_verification"], "stale")

    def test_unpaired_transfer_is_declared_as_a_close_issue(self):
        destination = Account.objects.create(name="Destino cierre", kind=Account.Kind.SAVINGS)
        old_created_at = timezone.make_aware(datetime(2026, 8, 1, 12, 0))
        Account.objects.filter(pk=destination.pk).update(created_at=old_created_at)
        transfer_group = uuid.uuid4()
        transfer_out = Transaction.objects.create(
            account=self.account,
            kind=Transaction.Kind.TRANSFER_OUT,
            amount=Decimal("20.00"),
            date=date(2026, 9, 15),
            description="Traspaso sin pierna destino",
            transfer_group=transfer_group,
        )
        Transaction.objects.create(
            account=destination,
            kind=Transaction.Kind.TRANSFER_IN,
            amount=Decimal("20.00"),
            date=date(2026, 9, 15),
            description="Traspaso sin pierna origen",
            transfer_group=transfer_group,
        )
        Transaction.objects.filter(pk=transfer_out.pk).delete()

        preview = self.get_state().json()["preview"]

        self.assertEqual([issue["type"] for issue in preview["issues"]].count("transfer_inconsistent"), 1)
        transfer_issue = next(issue for issue in preview["issues"] if issue["type"] == "transfer_inconsistent")
        self.assertEqual(transfer_issue["details"]["group_id"], str(transfer_group))

    def test_portable_round_trip_preserves_reconciliation_and_close_versions(self):
        preview = self.get_state().json()["preview"]
        first_response, _ = self.post_close(preview)
        self.assertEqual(first_response.status_code, 201)
        self.expense.amount = Decimal("35.00")
        self.expense.save(update_fields=["amount"])
        corrected_preview = self.get_state().json()["preview"]
        second_response, _ = self.post_close(
            corrected_preview,
            idempotency_key=str(uuid.uuid4()),
            declarations={issue["key"]: "La diferencia quedó identificada y explicada al cierre." for issue in corrected_preview["issues"]},
            correction_reason="Se registra una nueva decisión de cierre.",
        )
        self.assertEqual(second_response.status_code, 201)
        original_created_at = MonthlyClose.objects.order_by("version").first().created_at

        output = BytesIO()
        write_portable_export(output)
        with zipfile.ZipFile(BytesIO(output.getvalue())) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            portable = json.loads(archive.read("data.json"))
            portable.update(manifest)
        self.assertEqual(manifest["version"], 5)
        self.assertEqual(len(portable["monthly_closes"]), 2)
        self.assertEqual(portable["monthly_closes"][0]["accounts"][0]["account_name"], self.account.name)
        self.assertEqual(len(portable["reconciliation_snapshots"]), 1)

        MonthlyClose.objects.all().delete()
        ReconciliationSnapshot.objects.all().delete()
        Transaction.objects.all().delete()
        Category.objects.all().delete()
        Account.objects.all().delete()
        import_portable(portable)

        restored = list(MonthlyClose.objects.order_by("version"))
        self.assertEqual([close.version for close in restored], [1, 2])
        self.assertEqual([close.status_at_close for close in restored], [MonthlyClose.Status.CLEAN, MonthlyClose.Status.DECLARED])
        self.assertEqual(restored[0].origin, MonthlyClose.Origin.PORTABLE_ARCHIVE)
        self.assertEqual(restored[0].created_at, original_created_at)
        self.assertEqual(restored[0].report["summary"]["analytical_result"], "60.00")
        self.assertEqual(restored[1].report["summary"]["analytical_result"], "65.00")
        self.assertEqual(restored[0].accounts[0]["account_name"], "Cierre mensual")
        self.assertEqual(restored[1].accounts[0]["reconciliation"]["stale"], True)
        self.assertEqual(ReconciliationSnapshot.objects.count(), 1)
        self.assertEqual(Account.objects.get(name="Cierre mensual").created_at.date(), date(2026, 8, 1))
        imported_state = self.get_state().json()
        self.assertEqual([item["source_verification"] for item in imported_state["versions"]], ["superseded", "unknown"])

class MonthlyCloseNativeBackupTests(TransactionTestCase):
    def test_native_backup_archive_contains_month_close_history(self):
        account = Account.objects.create(name="Cierre backup", kind=Account.Kind.CHECKING)
        old_created_at = timezone.make_aware(datetime(2026, 8, 1, 12, 0))
        Account.objects.filter(pk=account.pk).update(created_at=old_created_at)
        category = Category.objects.create(name="Gasto backup", kind=Category.Kind.EXPENSE)
        Transaction.objects.create(
            account=account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("1.00"),
            date=date(2026, 9, 10),
            description="Movimiento backup",
            category=category,
        )
        ReconciliationSnapshot.objects.create(
            account=account,
            date=date(2026, 9, 30),
            statement_balance=Decimal("-1.00"),
            ledger_balance=Decimal("-1.00"),
            difference=Decimal("0.00"),
            status=ReconciliationSnapshot.Status.RECONCILED,
        )
        preview = build_monthly_close_preview("2026-09", MonthlyClose.Basis.ANALYTICS)
        MonthlyClose.objects.create(
            month=date(2026, 9, 1),
            basis=MonthlyClose.Basis.ANALYTICS,
            version=1,
            status_at_close=MonthlyClose.Status.CLEAN,
            origin=MonthlyClose.Origin.NATIVE,
            source_digest=preview["source_digest"],
            idempotency_key=str(uuid.uuid4()),
            request_digest="backup-test",
            report=preview["report"],
            accounts=preview["accounts"],
            issues=preview["issues"],
            declarations=[],
        )

        with tempfile.TemporaryDirectory() as backup_directory:
            call_command("backup_finance", destination=backup_directory, kind="manual")
            archive_path = next(Path(backup_directory).rglob("*.zip"))
            upload = SimpleUploadedFile(archive_path.name, archive_path.read_bytes(), content_type="application/zip")
            self.assertGreater(inspect_restore_archive(upload)["files"], 0)
            with zipfile.ZipFile(archive_path) as archive:
                db_bytes = archive.read("db.sqlite3")
            with tempfile.TemporaryDirectory() as database_directory:
                database_path = Path(database_directory) / "backup.sqlite3"
                database_path.write_bytes(db_bytes)
                with closing(sqlite3.connect(database_path)) as restored_db:
                    restored_close = restored_db.execute("SELECT status_at_close, accounts FROM ledger_monthlyclose").fetchone()
        status, accounts = restored_close
        self.assertIsNotNone(restored_close)
        self.assertEqual(status, MonthlyClose.Status.CLEAN)
        self.assertEqual(json.loads(accounts)[0]["account_name"], account.name)
