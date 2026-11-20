from django.core.management.base import BaseCommand

from ledger.banking import claim_next_bank_sync, sync_connection
from ledger.banking_client import banking_configured


class Command(BaseCommand):
    help = "Procesa una sincronización bancaria encolada fuera del request."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=1)

    def handle(self, *args, **options):
        if not banking_configured():
            self.stdout.write("Enable Banking no está configurado; no se procesa la cola.")
            return
        processed = 0
        failed = 0
        for _ in range(max(options["limit"], 1)):
            run = claim_next_bank_sync()
            if run is None:
                break
            result = sync_connection(run.connection, run=run)
            processed += 1
            failed += int(result.status == result.Status.FAILED)
        self.stdout.write(self.style.SUCCESS(f"Sincronizaciones procesadas: {processed}; fallidas: {failed}."))
