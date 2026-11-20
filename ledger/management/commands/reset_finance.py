import shutil
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from ledger.management.commands.backup_finance import Command as BackupCommand
from ledger.models import (
    Account,
    Attachment,
    AutomationSettings,
    BankAccount,
    BankConnection,
    BankSyncRun,
    BankTransaction,
    Budget,
    Category,
    CategoryPrediction,
    ImportBatch,
    ImportProfile,
    ImportRow,
    RecurringOccurrence,
    RecurringRule,
    SavingsGoal,
    Tag,
    Transaction,
)


class Command(BaseCommand):
    help = "Crea una copia y elimina todos los datos financieros antes de recrear la configuración inicial."

    def add_arguments(self, parser):
        parser.add_argument("--confirm", action="store_true")
        parser.add_argument("--backup-destination", default=str(settings.BASE_DIR / "backups" / "pre-reset"))

    def handle(self, *args, **options):
        if not options["confirm"]:
            raise CommandError("Añade --confirm para ejecutar el reinicio.")

        destination = Path(options["backup_destination"])
        destination.mkdir(parents=True, exist_ok=True)
        output = destination / f"pre-reset-{timezone.localtime():%Y-%m-%d-%H%M%S}.zip"
        BackupCommand()._create_archive(output)

        with transaction.atomic():
            for model in [
                Attachment,
                ImportRow,
                ImportBatch,
                CategoryPrediction,
                BankTransaction,
                BankSyncRun,
                BankAccount,
                BankConnection,
                Transaction,
                RecurringOccurrence,
                RecurringRule,
                Budget,
                Account,
            ]:
                model.objects.all().delete()
            Category.objects.filter(parent__isnull=False).delete()
            Category.objects.filter(parent__isnull=True).delete()
            for model in [ImportProfile, SavingsGoal, Tag, AutomationSettings]:
                model.objects.all().delete()

        media = Path(settings.MEDIA_ROOT)
        if media.exists():
            shutil.rmtree(media)
        media.mkdir(parents=True, exist_ok=True)
        call_command("seed_defaults")
        self.stdout.write(self.style.SUCCESS(f"Datos financieros reiniciados. Copia previa: {output}"))
