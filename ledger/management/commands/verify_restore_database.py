"""Validate the supported SQLite restore layout and financial schema."""

from pathlib import Path
import sqlite3
import time

from django.apps import apps
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from ledger.recovery import operation_lock_status


def assert_supported_restore_layout(*, base_dir, database_path, media_root, engine):
    base = Path(base_dir)
    data_root = base / "data"
    expected_database = data_root / "db.sqlite3"
    expected_media = data_root / "media"
    database = Path(database_path)
    media = Path(media_root)

    if engine != "django.db.backends.sqlite3":
        raise ValueError("La restauración solo admite SQLite en el volumen de datos soportado.")
    if data_root.is_symlink() or database.is_symlink() or media.is_symlink():
        raise ValueError("La restauración no admite rutas de datos enlazadas simbólicamente.")
    if database.resolve() != expected_database.resolve() or media.resolve() != expected_media.resolve():
        raise ValueError("La restauración solo admite /app/data/db.sqlite3 y /app/data/media.")
    if not database.is_file() or not media.is_dir():
        raise ValueError("No están presentes el archivo SQLite y el directorio de medios soportados.")
    return database


def _quote_identifier(value):
    return '"' + value.replace('"', '""') + '"'


def validate_financial_sqlite_schema(database_path):
    database = Path(database_path)
    if not database.is_file():
        raise ValueError("El archivo de base de datos no existe.")

    connection = sqlite3.connect(f"{database.resolve().as_uri()}?mode=ro", uri=True, timeout=20)
    try:
        quick_check = connection.execute("PRAGMA quick_check").fetchone()
        if not quick_check or quick_check[0] != "ok":
            raise ValueError("La integridad SQLite no es válida.")
        if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("La base de datos contiene referencias financieras inconsistentes.")

        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        models = [
            model
            for model in apps.get_models(include_auto_created=True)
            if model._meta.managed and not model._meta.proxy
        ]
        for model in models:
            table = model._meta.db_table
            if table not in tables:
                raise ValueError("El esquema restaurado no contiene todas las tablas de esta versión.")
            quoted_table = _quote_identifier(table)
            actual_columns = {
                row[1]
                for row in connection.execute(f"PRAGMA table_info({quoted_table})")
            }
            expected_columns = {
                field.column
                for field in model._meta.local_concrete_fields
                if field.column
            }
            if expected_columns - actual_columns:
                raise ValueError("El esquema restaurado no contiene todas las columnas de esta versión.")
            columns = ", ".join(_quote_identifier(column) for column in sorted(expected_columns))
            connection.execute(f"SELECT {columns} FROM {quoted_table} LIMIT 0")

        for table in ("ledger_account", "ledger_transaction"):
            connection.execute(f"SELECT COUNT(*) FROM {_quote_identifier(table)}").fetchone()
        return len(models)
    finally:
        connection.close()


def checkpoint_sqlite_wal(database_path, *, retries=5, retry_delay=0.25):
    database = Path(database_path)
    if not database.is_file():
        raise ValueError("El archivo SQLite no existe para checkpoint.")
    connection = sqlite3.connect(database, timeout=20)
    try:
        journal_mode = connection.execute("PRAGMA journal_mode").fetchone()[0].lower()
        if journal_mode != "wal":
            return
        for attempt in range(retries):
            busy, log_frames, checkpointed_frames = connection.execute(
                "PRAGMA wal_checkpoint(TRUNCATE)"
            ).fetchone()
            if busy == 0 and (log_frames < 0 or checkpointed_frames >= log_frames):
                return
            if attempt + 1 < retries:
                time.sleep(retry_delay)
        raise ValueError("No se pudieron checkpointar todas las páginas del WAL.")
    finally:
        connection.close()


class Command(BaseCommand):
    help = "Valida el layout de restore y el esquema financiero sin escribir datos."

    def add_arguments(self, parser):
        modes = parser.add_mutually_exclusive_group()
        modes.add_argument("--layout-only", action="store_true")
        modes.add_argument("--checkpoint", action="store_true")

    def handle(self, *args, **options):
        layout = settings.DATABASES["default"]
        try:
            database = assert_supported_restore_layout(
                base_dir=settings.BASE_DIR,
                database_path=layout["NAME"],
                media_root=settings.MEDIA_ROOT,
                engine=layout["ENGINE"],
            )
            if options["checkpoint"]:
                operation = operation_lock_status()
                if not operation or operation.get("operation") != "restore":
                    raise ValueError("El checkpoint solo se permite durante una restauración protegida.")
                checkpoint_sqlite_wal(database)
                self.stdout.write(self.style.SUCCESS("WAL checkpoint verificado."))
                return
            if options["layout_only"]:
                self.stdout.write(self.style.SUCCESS("Rutas de restauración soportadas."))
                return
            model_count = validate_financial_sqlite_schema(database)
        except (OSError, sqlite3.Error, ValueError) as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(f"Esquema financiero SQLite verificado ({model_count} modelos)."))
