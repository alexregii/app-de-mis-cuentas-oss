import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import zipfile
from contextlib import closing
from decimal import Decimal
from io import BytesIO, StringIO
from pathlib import Path
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .backup_contract import BACKUP_FORMAT, BACKUP_VERSION, MANIFEST_ENTRY
from .calculations.ledger import allocate_refunds
from .models import Account, BankAccount, BankConnection, BankTransaction, Category, Tag, Transaction
from .management.commands.verify_restore_database import (
    assert_supported_restore_layout,
    checkpoint_sqlite_wal,
    validate_financial_sqlite_schema,
)
from .recovery import import_portable, inspect_restore_archive, latest_backup, scheduled_backup_status, write_portable_export
from .transaction_allocations import replace_transaction_allocations
from .transaction_services import create_transfer


class BackupTests(TransactionTestCase):
    @staticmethod
    def _rewrite_backup(path, *, manifest=..., extra_entries=None):
        output = BytesIO()
        with zipfile.ZipFile(path) as source, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target:
            for entry in source.infolist():
                if entry.filename != MANIFEST_ENTRY:
                    target.writestr(entry, source.read(entry))
            if manifest is ...:
                target.writestr(MANIFEST_ENTRY, json.dumps({"format": BACKUP_FORMAT, "version": BACKUP_VERSION}))
            elif manifest is not None:
                target.writestr(MANIFEST_ENTRY, json.dumps(manifest))
            for name, content in extra_entries or []:
                target.writestr(name, content)
        return output.getvalue()

    def test_backup_contains_database(self):
        with tempfile.TemporaryDirectory() as temp:
            call_command("backup_finance", destination=temp)
            archives = list((Path(temp) / "scheduled").glob("daily-*.zip"))
            self.assertEqual(len(archives), 1)
            with zipfile.ZipFile(archives[0]) as archive:
                self.assertIn("db.sqlite3", archive.namelist())

    def test_restore_checkpoint_flushes_committed_wal_frames(self):
        with tempfile.TemporaryDirectory() as temp:
            database_path = Path(temp) / "db.sqlite3"
            initial_writer = (
                "import os, sqlite3, sys; "
                "path=sys.argv[1]; "
                "writer=sqlite3.connect(path); "
                "writer.execute('PRAGMA journal_mode=WAL'); "
                "writer.execute('PRAGMA wal_autocheckpoint=0'); "
                "writer.execute('CREATE TABLE sample (value TEXT NOT NULL)'); "
                "writer.execute(\"INSERT INTO sample (value) VALUES ('before')\"); "
                "writer.commit(); os._exit(0)"
            )
            subprocess.run([sys.executable, "-c", initial_writer, str(database_path)], check=True)
            checkpoint_sqlite_wal(database_path)

            late_writer = (
                "import os, sqlite3, sys; "
                "writer=sqlite3.connect(sys.argv[1]); "
                "writer.execute('PRAGMA wal_autocheckpoint=0'); "
                "writer.execute(\"INSERT INTO sample (value) VALUES ('committed-in-wal')\"); "
                "writer.commit(); os._exit(0)"
            )
            subprocess.run([sys.executable, "-c", late_writer, str(database_path)], check=True)
            wal_path = Path(f"{database_path}-wal")
            self.assertGreater(wal_path.stat().st_size, 32)

            # The final checkpoint is safe only after the late writer has exited.
            checkpoint_sqlite_wal(database_path)

            with closing(sqlite3.connect(database_path)) as restored_source:
                values = [row[0] for row in restored_source.execute("SELECT value FROM sample ORDER BY rowid")]
            self.assertEqual(values, ["before", "committed-in-wal"])
            self.assertFalse(wal_path.exists() and wal_path.stat().st_size > 32)

    def test_restore_schema_readiness_rejects_missing_financial_column_with_quick_check_ok(self):
        with tempfile.TemporaryDirectory() as temp:
            database_path = Path(temp) / "db.sqlite3"
            connection.ensure_connection()
            with closing(sqlite3.connect(database_path)) as target:
                connection.connection.backup(target)

            self.assertGreater(validate_financial_sqlite_schema(database_path), 0)
            with closing(sqlite3.connect(database_path)) as restored:
                restored.execute("ALTER TABLE ledger_transaction DROP COLUMN amount")
                restored.commit()
                self.assertEqual(restored.execute("PRAGMA quick_check").fetchone()[0], "ok")

            with self.assertRaisesRegex(ValueError, "columnas"):
                validate_financial_sqlite_schema(database_path)

    def test_restore_layout_fails_closed_for_custom_database_or_media_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            data = base / "data"
            media = data / "media"
            data.mkdir()
            media.mkdir()
            database = data / "db.sqlite3"
            database.touch()

            self.assertEqual(
                assert_supported_restore_layout(
                    base_dir=base,
                    database_path=database,
                    media_root=media,
                    engine="django.db.backends.sqlite3",
                ),
                database,
            )
            with self.assertRaises(ValueError):
                assert_supported_restore_layout(
                    base_dir=base,
                    database_path=data / "custom.sqlite3",
                    media_root=media,
                    engine="django.db.backends.sqlite3",
                )
            with self.assertRaises(ValueError):
                assert_supported_restore_layout(
                    base_dir=base,
                    database_path=database,
                    media_root=base / "receipts",
                    engine="django.db.backends.sqlite3",
                )

    def test_failed_backup_keeps_last_good_archive_visible(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            destination = base / "backups"
            current_time = timezone.localtime()
            with override_settings(BASE_DIR=base), patch(
                "ledger.management.commands.backup_finance.timezone.localtime",
                return_value=current_time,
            ):
                call_command("backup_finance", destination=destination)
                archive_path = next((destination / "scheduled").glob("daily-*.zip"))
                original = archive_path.read_bytes()
                successful_archives = {
                    path.relative_to(destination).as_posix(): path.read_bytes()
                    for path in destination.rglob("*.zip")
                }
                successful_mtimes = {
                    path.relative_to(destination).as_posix(): path.stat().st_mtime
                    for path in destination.rglob("*.zip")
                }
                latest_mtime = max(successful_mtimes.values())
                failure_output = StringIO()
                with patch(
                    "ledger.management.commands.backup_finance.zipfile.ZipFile.write",
                    side_effect=OSError("simulated disk full"),
                ):
                    with self.assertRaisesRegex(OSError, "simulated disk full"):
                        call_command("backup_finance", destination=destination, stdout=failure_output)

                self.assertEqual(archive_path.read_bytes(), original)
                self.assertEqual(
                    {
                        path.relative_to(destination).as_posix(): path.read_bytes()
                        for path in destination.rglob("*.zip")
                    },
                    successful_archives,
                )
                self.assertEqual(
                    {
                        path.relative_to(destination).as_posix(): path.stat().st_mtime
                        for path in destination.rglob("*.zip")
                    },
                    successful_mtimes,
                )
                latest = latest_backup()
                self.assertIsNotNone(latest)
                self.assertIn(
                    latest["name"],
                    {
                        Path(path).name
                        for path, modified_at in successful_mtimes.items()
                        if modified_at == latest_mtime
                    },
                )
                self.assertEqual(list((destination / "scheduled").glob(".*.tmp")), [])
                self.assertNotIn("Copia creada:", failure_output.getvalue())

    def test_pre_release_backup_is_separate_and_self_describing(self):
        with tempfile.TemporaryDirectory() as temp:
            call_command("backup_finance", destination=temp, kind="pre-release")
            archives = list((Path(temp) / "pre-release").glob("pre-release-*.zip"))
            self.assertEqual(len(archives), 1)
            with zipfile.ZipFile(archives[0]) as archive:
                manifest = json.loads(archive.read("manifest.json"))
                self.assertEqual(manifest["format"], "mis-cuentas-backup")
                self.assertEqual(manifest["kind"], "pre-release")
                self.assertIn("db.sqlite3", archive.namelist())

    def test_recovery_api_reports_worker_and_scheduled_backup_health(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            scheduler = base / "data" / "scheduler"
            scheduler.mkdir(parents=True)
            scheduled = base / "backups" / "scheduled"
            scheduled.mkdir(parents=True)
            now = timezone.now()
            epoch = now.timestamp()

            with override_settings(BASE_DIR=base):
                missing = self.client.get(reverse("api_recovery")).json()["backup_status"]
                self.assertEqual(missing["worker"], "stale")
                self.assertEqual(missing["schedule"], "missing")

                heartbeat = scheduler / "backup-worker-heartbeat"
                heartbeat.touch()
                archive = scheduled / "daily-2026-10-21.zip"
                archive.write_bytes(b"synthetic backup")
                os.utime(heartbeat, (epoch, epoch))
                os.utime(archive, (epoch, epoch))
                healthy = self.client.get(reverse("api_recovery")).json()["backup_status"]
                self.assertEqual(healthy["worker"], "healthy")
                self.assertEqual(healthy["schedule"], "healthy")

                failure = scheduler / "backup-last-failure.stamp"
                failure.touch()
                os.utime(failure, (epoch + 2, epoch + 2))
                failed = self.client.get(reverse("api_recovery")).json()["backup_status"]
                self.assertEqual(failed["schedule"], "failed")

                failure.unlink()
                old = epoch - 25 * 60 * 60
                os.utime(heartbeat, (old - 60 * 60, old - 60 * 60))
                os.utime(archive, (old, old))
                stale = self.client.get(reverse("api_recovery")).json()["backup_status"]
                self.assertEqual(stale["worker"], "stale")
                self.assertEqual(stale["schedule"], "stale")

    def test_scheduled_backup_status_ignores_zip_directories(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            scheduled = base / "backups" / "scheduled"
            (scheduled / "not-an-archive.zip").mkdir(parents=True)

            with override_settings(BASE_DIR=base):
                status = scheduled_backup_status()

        self.assertEqual(status["schedule"], "missing")
        self.assertIsNone(status["last_success_at"])

    def test_scheduled_backup_status_ignores_symlink_archives(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            scheduled = base / "backups" / "scheduled"
            scheduled.mkdir(parents=True)
            target = base / "outside.zip"
            target.write_bytes(b"not a scheduled archive")
            link = scheduled / "linked.zip"
            try:
                link.symlink_to(target)
            except (OSError, NotImplementedError):
                self.skipTest("Symlinks are unavailable in this environment")

            with override_settings(BASE_DIR=base):
                status = scheduled_backup_status()

        self.assertEqual(status["schedule"], "missing")
        self.assertIsNone(status["last_success_at"])

    def test_scheduled_backup_status_tolerates_archive_disappearing_during_scan(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            scheduled = base / "backups" / "scheduled"
            scheduled.mkdir(parents=True)
            archive = scheduled / "daily-disappeared.zip"
            archive.write_bytes(b"synthetic backup")
            original_lstat = Path.lstat

            def disappearing_lstat(path, *args, **kwargs):
                if path == archive:
                    raise FileNotFoundError(path)
                return original_lstat(path, *args, **kwargs)

            with override_settings(BASE_DIR=base), patch.object(Path, "lstat", disappearing_lstat):
                status = scheduled_backup_status()

        self.assertEqual(status["schedule"], "missing")
        self.assertIsNone(status["last_success_at"])


    def test_recovery_api_creates_backup_and_portable_export(self):
        with tempfile.TemporaryDirectory() as temp:
            with override_settings(BASE_DIR=Path(temp)):
                response = self.client.post(reverse("api_recovery"))
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json()["latest_backup"]["name"].startswith("manual-"))
                export = self.client.get(reverse("export_portable"))
                self.assertEqual(export.status_code, 200)
                with zipfile.ZipFile(BytesIO(export.content)) as archive:
                    self.assertEqual(json.loads(archive.read("manifest.json"))["format"], "miscuentas-portable")
                    self.assertIn("data.json", archive.namelist())

    def test_restore_api_can_be_disabled_without_disabling_backup(self):
        with tempfile.TemporaryDirectory() as temp, override_settings(
            BASE_DIR=Path(temp), RESTORE_COORDINATOR_ENABLED=False
        ):
            status = self.client.get(reverse("api_recovery")).json()
            self.assertFalse(status["restore"]["available"])
            self.assertIsNone(status["restore"]["status"])

            backup = self.client.post(reverse("api_recovery"))
            self.assertEqual(backup.status_code, 200)
            self.assertTrue(backup.json()["latest_backup"]["name"].startswith("manual-"))

            preview = self.client.post(
                reverse("api_recovery_restore_preview"),
                {"archive": SimpleUploadedFile("copy.zip", b"not a zip", content_type="application/zip")},
            )
            self.assertEqual(preview.status_code, 503)
            self.assertFalse((Path(temp) / "data" / "recovery" / "staged").exists())

            restore = self.client.post(
                reverse("api_recovery_restore"),
                data=json.dumps({"token": "a" * 32, "confirmation": "RESTAURAR"}),
                content_type="application/json",
            )
            self.assertEqual(restore.status_code, 503)
            self.assertFalse((Path(temp) / "data" / "recovery" / "restore-request.json").exists())

    def test_restore_preview_rejects_invalid_archive_and_requires_confirmation(self):
        invalid = SimpleUploadedFile("not-a-backup.zip", b"not a zip", content_type="application/zip")
        response = self.client.post(reverse("api_recovery_restore_preview"), {"archive": invalid})
        self.assertEqual(response.status_code, 400)

        with tempfile.TemporaryDirectory() as temp:
            call_command("backup_finance", destination=temp)
            archive_path = next((Path(temp) / "scheduled").glob("daily-*.zip"))
            with archive_path.open("rb") as archive, override_settings(BASE_DIR=Path(temp)):
                preview = self.client.post(
                    reverse("api_recovery_restore_preview"),
                    {"archive": SimpleUploadedFile("backup.zip", archive.read(), content_type="application/zip")},
                )
                self.assertEqual(preview.status_code, 200)
                rejected = self.client.post(
                    reverse("api_recovery_restore"),
                    data=json.dumps({"token": preview.json()["token"], "confirmation": "no"}),
                    content_type="application/json",
                )
                self.assertEqual(rejected.status_code, 400)
                self.assertFalse((Path(temp) / "data" / "recovery" / "restore-request.json").exists())

    def test_restore_preview_preserves_legacy_backups_without_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            call_command("backup_finance", destination=temp)
            archive_path = next((Path(temp) / "scheduled").glob("daily-*.zip"))
            legacy = self._rewrite_backup(archive_path, manifest=None)
            with override_settings(BASE_DIR=Path(temp)):
                response = self.client.post(
                    reverse("api_recovery_restore_preview"),
                    {"archive": SimpleUploadedFile("legacy.zip", legacy, content_type="application/zip")},
                )
            self.assertEqual(response.status_code, 200)

    def test_restore_preview_rejects_incompatible_manifest_and_unknown_entries(self):
        with tempfile.TemporaryDirectory() as temp:
            call_command("backup_finance", destination=temp)
            archive_path = next((Path(temp) / "scheduled").glob("daily-*.zip"))
            incompatible = self._rewrite_backup(
                archive_path,
                manifest={"format": BACKUP_FORMAT, "version": BACKUP_VERSION + 1},
            )
            unexpected = self._rewrite_backup(archive_path, extra_entries=[("notes.txt", b"not part of backup")])
            with override_settings(BASE_DIR=Path(temp)):
                incompatible_response = self.client.post(
                    reverse("api_recovery_restore_preview"),
                    {"archive": SimpleUploadedFile("future.zip", incompatible, content_type="application/zip")},
                )
                unexpected_response = self.client.post(
                    reverse("api_recovery_restore_preview"),
                    {"archive": SimpleUploadedFile("extra.zip", unexpected, content_type="application/zip")},
                )
            self.assertEqual(incompatible_response.status_code, 400)
            self.assertEqual(unexpected_response.status_code, 400)

    def test_portable_export_import_round_trip_rebuilds_financial_entities(self):
        account = Account.objects.create(name="Portable", kind=Account.Kind.CHECKING, opening_balance=Decimal("50"))
        category = Category.objects.create(name="Portable gasto", kind=Category.Kind.EXPENSE)
        tag = Tag.objects.create(name="portable")
        movement = Transaction.objects.create(
            account=account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("12"),
            date=timezone.localdate(),
            description="Compra portable",
            category=category,
        )
        movement.tags.add(tag)
        output = BytesIO()
        write_portable_export(output)
        with zipfile.ZipFile(BytesIO(output.getvalue())) as archive:
            portable = json.loads(archive.read("data.json"))
            portable.update(json.loads(archive.read("manifest.json")))
        Transaction.objects.all().delete()
        Tag.objects.all().delete()
        Category.objects.all().delete()
        Account.objects.all().delete()
        result = import_portable(portable)
        self.assertEqual(result, {
            "accounts": 1,
            "categories": 1,
            "transactions": 1,
            "legacy_savings_goal": 0,
            "savings_objectives": 0,
            "transaction_allocations": 0,
        })
        restored = Transaction.objects.get(description="Compra portable")
        self.assertEqual(restored.account.name, "Portable")
        self.assertEqual(restored.category.name, "Portable gasto")
        self.assertEqual(list(restored.tags.values_list("name", flat=True)), ["portable"])

    def test_portable_v5_round_trip_preserves_explicit_transaction_allocations(self):
        account = Account.objects.create(name="Portable repartido", kind=Account.Kind.CHECKING, opening_balance=Decimal("500"))
        food = Category.objects.create(name="Alimentación partida", kind=Category.Kind.EXPENSE)
        travel = Category.objects.create(name="Transporte partido", kind=Category.Kind.EXPENSE)
        movement = Transaction.objects.create(
            account=account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("100.00"),
            date=timezone.localdate(),
            description="Compra repartida portable",
        )
        replace_transaction_allocations(movement, [
            {"category_id": food.pk, "amount": "65.00"},
            {"category_id": travel.pk, "amount": "35.00"},
        ])
        output = BytesIO()
        write_portable_export(output)
        with zipfile.ZipFile(BytesIO(output.getvalue())) as archive:
            portable = json.loads(archive.read("data.json"))
            portable.update(json.loads(archive.read("manifest.json")))
        self.assertEqual(portable["version"], 5)
        Transaction.objects.all().delete()
        Category.objects.all().delete()
        Account.objects.all().delete()

        result = import_portable(portable)

        self.assertEqual(result["transaction_allocations"], 2)
        restored = Transaction.objects.get(description="Compra repartida portable")
        self.assertEqual(restored.amount, Decimal("100.00"))
        self.assertIsNone(restored.category_id)
        self.assertEqual(
            list(restored.allocations.order_by("position").values_list("category__name", "amount")),
            [("Alimentación partida", Decimal("65.00")), ("Transporte partido", Decimal("35.00"))],
        )

    def test_portable_v5_round_trip_preserves_explicit_allocations_on_a_linked_refund(self):
        account = Account.objects.create(name="Portable reembolso repartido", kind=Account.Kind.CHECKING)
        food = Category.objects.create(name="Compra portable", kind=Category.Kind.EXPENSE)
        travel = Category.objects.create(name="Transporte portable", kind=Category.Kind.EXPENSE)
        refund_a = Category.objects.create(name="Reembolso portable", kind=Category.Kind.INCOME)
        refund_b = Category.objects.create(name="Compensación portable", kind=Category.Kind.INCOME)
        purchase = Transaction.objects.create(
            account=account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("100.00"),
            date=timezone.localdate(),
            description="Compra con reembolso portable",
        )
        replace_transaction_allocations(purchase, [
            {"category_id": food.pk, "amount": "60.00"},
            {"category_id": travel.pk, "amount": "40.00"},
        ])
        refund = Transaction.objects.create(
            account=account,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("130.00"),
            date=timezone.localdate(),
            description="Reembolso repartido portable",
            refund_for=purchase,
        )
        replace_transaction_allocations(refund, [
            {"category_id": refund_a.pk, "amount": "65.00"},
            {"category_id": refund_b.pk, "amount": "65.00"},
        ])
        output = BytesIO()
        write_portable_export(output)
        with zipfile.ZipFile(BytesIO(output.getvalue())) as archive:
            portable = json.loads(archive.read("data.json"))
            portable.update(json.loads(archive.read("manifest.json")))

        Transaction.objects.filter(refund_for__isnull=False).delete()
        Transaction.objects.all().delete()
        Category.objects.all().delete()
        Account.objects.all().delete()
        result = import_portable(portable)

        self.assertEqual(result["transaction_allocations"], 4)
        restored_purchase = Transaction.objects.get(description="Compra con reembolso portable")
        restored_refund = Transaction.objects.get(description="Reembolso repartido portable")
        self.assertEqual(restored_refund.refund_for_id, restored_purchase.pk)
        self.assertEqual(
            list(restored_refund.allocations.order_by("position").values_list("category__name", "amount")),
            [("Reembolso portable", Decimal("65.00")), ("Compensación portable", Decimal("65.00"))],
        )
        allocation = allocate_refunds([restored_refund])[0]
        refund_category_ids = list(restored_refund.allocations.order_by("position").values_list("category_id", flat=True))
        self.assertEqual(
            allocation.extra_by_category,
            ((refund_category_ids[0], Decimal("15.00")), (refund_category_ids[1], Decimal("15.00"))),
        )

    def test_database_backup_and_restore_preview_preserve_bank_transfer_fee_link(self):
        outgoing_account = Account.objects.create(name="Origen portable", kind=Account.Kind.CHECKING)
        incoming_account = Account.objects.create(name="Destino portable", kind=Account.Kind.SAVINGS)
        connection = BankConnection.objects.create(bank_name="Banco portable", session_id="session-portable")
        bank_account = BankAccount.objects.create(
            connection=connection,
            account=outgoing_account,
            remote_uid="portable-account",
            display_name="Cuenta portable",
        )
        transfer_out, _ = create_transfer(
            source_account=outgoing_account,
            target_account=incoming_account,
            amount=Decimal("99.00"),
            tx_date=timezone.localdate(),
            description="Traspaso portable",
            source=Transaction.Source.ENABLE_BANKING,
        )
        fee = Transaction.objects.create(
            account=outgoing_account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("1.00"),
            date=timezone.localdate(),
            description="Comisión portable",
            source=Transaction.Source.ENABLE_BANKING,
        )
        bank_row = BankTransaction.objects.create(
            bank_account=bank_account,
            remote_id="portable-transfer",
            booking_date=timezone.localdate(),
            description="Traspaso portable",
            amount=Decimal("100.00"),
            kind="expense",
            fingerprint="f" * 64,
            status=BankTransaction.Status.IMPORTED,
            transaction=transfer_out,
            fee_transaction=fee,
        )

        with tempfile.TemporaryDirectory() as temp:
            call_command("backup_finance", destination=temp)
            archive_path = next((Path(temp) / "scheduled").glob("daily-*.zip"))
            backup = archive_path.read_bytes()
            with zipfile.ZipFile(BytesIO(backup)) as archive:
                database_path = Path(temp) / "restored.sqlite3"
                database_path.write_bytes(archive.read("db.sqlite3"))
            with closing(sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)) as database:
                links = database.execute(
                    "SELECT transaction_id, fee_transaction_id FROM ledger_banktransaction WHERE id = ?",
                    [bank_row.pk],
                ).fetchone()
            self.assertEqual(links, (transfer_out.pk, fee.pk))
            preview = inspect_restore_archive(
                SimpleUploadedFile("backup.zip", backup, content_type="application/zip")
            )
            self.assertGreater(preview["files"], 0)

    def test_portable_export_round_trip_keeps_transfer_legs_and_fee_in_ledger(self):
        outgoing_account = Account.objects.create(name="Origen portable", kind=Account.Kind.CHECKING)
        incoming_account = Account.objects.create(name="Destino portable", kind=Account.Kind.SAVINGS)
        transfer_out, transfer_in = create_transfer(
            source_account=outgoing_account,
            target_account=incoming_account,
            amount=Decimal("99.00"),
            tx_date=timezone.localdate(),
            description="Traspaso portable",
            source=Transaction.Source.ENABLE_BANKING,
        )
        Transaction.objects.create(
            account=outgoing_account,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("1.00"),
            date=timezone.localdate(),
            description="Comisión portable",
            source=Transaction.Source.ENABLE_BANKING,
        )
        output = BytesIO()
        write_portable_export(output)
        with zipfile.ZipFile(BytesIO(output.getvalue())) as archive:
            portable = json.loads(archive.read("data.json"))
            portable.update(json.loads(archive.read("manifest.json")))
        Transaction.objects.all().delete()
        Account.objects.all().delete()

        imported = import_portable(portable)

        self.assertEqual(imported["transactions"], 3)
        pair = list(Transaction.objects.filter(description="Traspaso portable").order_by("kind"))
        self.assertEqual(len(pair), 2)
        self.assertEqual(pair[0].transfer_group, pair[1].transfer_group)
        self.assertEqual({item.amount for item in pair}, {Decimal("99.00")})
        self.assertTrue(Transaction.objects.filter(description="Comisión portable", amount=Decimal("1.00")).exists())
