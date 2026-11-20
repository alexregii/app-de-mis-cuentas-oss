import json
import os
import sqlite3
import tempfile
import zipfile
from contextlib import closing
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.utils import timezone

from ledger.backup_contract import BACKUP_FORMAT, BACKUP_VERSION, DATABASE_ENTRY, MANIFEST_ENTRY
from ledger.recovery import operation_allows_backup, operation_lock_status


class Command(BaseCommand):
    help = "Genera una copia consistente de SQLite y adjuntos; conserva 14 diarias y 12 mensuales."

    def add_arguments(self, parser):
        parser.add_argument("--destination", default=str(settings.BASE_DIR / "backups"))
        parser.add_argument(
            "--kind",
            choices=["scheduled", "manual", "pre-restore", "pre-release"],
            default="scheduled",
        )

    def handle(self, *args, **options):
        operation = operation_lock_status()
        if not operation_allows_backup(options["kind"], operation):
            raise CommandError("La aplicación está en una operación de mantenimiento; la copia se ha bloqueado.")
        destination = Path(options["destination"]) / options["kind"]
        destination.mkdir(parents=True, exist_ok=True)
        now = timezone.localtime()
        stamp = now.strftime("%Y-%m-%dT%H-%M-%S")
        daily = destination / (f"daily-{now:%Y-%m-%d}.zip" if options["kind"] == "scheduled" else f"{options['kind']}-{stamp}.zip")
        self._create_archive(daily, options["kind"], now.isoformat())
        if options["kind"] == "scheduled" and now.day == 1:
            self._create_archive(destination / f"monthly-{now:%Y-%m}.zip", options["kind"], now.isoformat())
        self._prune(destination, "daily-*.zip", 14)
        self._prune(destination, "monthly-*.zip", 12)
        self.stdout.write(self.style.SUCCESS(f"Copia creada: {daily}"))

    def _create_archive(self, output, kind="scheduled", created_at=""):
        output = Path(output)
        temporary_archive = None
        try:
            with tempfile.NamedTemporaryFile(
                dir=output.parent,
                prefix=f".{output.name}.",
                suffix=".tmp",
                delete=False,
            ) as temporary_file:
                temporary_archive = Path(temporary_file.name)

            with tempfile.TemporaryDirectory() as temp_dir:
                snapshot = Path(temp_dir) / "db.sqlite3"
                connection.ensure_connection()
                with closing(sqlite3.connect(snapshot)) as target:
                    connection.connection.backup(target)
                with zipfile.ZipFile(temporary_archive, "w", zipfile.ZIP_DEFLATED) as archive:
                    archive.writestr(MANIFEST_ENTRY, json.dumps({"format": BACKUP_FORMAT, "version": BACKUP_VERSION, "kind": kind, "created_at": created_at}))
                    archive.write(snapshot, DATABASE_ENTRY)
                    media = Path(settings.MEDIA_ROOT)
                    if media.exists():
                        for file in media.rglob("*"):
                            if file.is_file():
                                archive.write(file, Path("media") / file.relative_to(media))

            os.replace(temporary_archive, output)
        finally:
            if temporary_archive is not None:
                temporary_archive.unlink(missing_ok=True)

    @staticmethod
    def _prune(destination, pattern, keep):
        for old in sorted(destination.glob(pattern), reverse=True)[keep:]:
            old.unlink()
