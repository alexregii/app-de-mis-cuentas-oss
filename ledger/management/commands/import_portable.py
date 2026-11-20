import json
import zipfile
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from ledger.recovery import import_portable


class Command(BaseCommand):
    help = "Importa un ZIP miscuentas-portable/v1–v4 en una instalación vacía."

    def add_arguments(self, parser):
        parser.add_argument("archive")

    def handle(self, *args, **options):
        archive_path = Path(options["archive"])
        try:
            with zipfile.ZipFile(archive_path) as archive:
                manifest = json.loads(archive.read("manifest.json"))
                data = json.loads(archive.read("data.json"))
        except (OSError, KeyError, json.JSONDecodeError, zipfile.BadZipFile) as exc:
            raise CommandError("El archivo portable no es válido.") from exc
        data.update(manifest)
        try:
            result = import_portable(data)
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(f"Importadas {result['accounts']} cuentas, {result['categories']} categorías y {result['transactions']} movimientos."))
