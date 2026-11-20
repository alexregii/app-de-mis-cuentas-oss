from django.core.management.base import BaseCommand

from ledger.banking import enqueue_due_connections
from ledger.banking_client import banking_configured


class Command(BaseCommand):
    help = "Sincroniza todas las conexiones activas de Enable Banking."

    def handle(self, *args, **options):
        if not banking_configured():
            self.stdout.write("Enable Banking no está configurado; no se sincroniza.")
            return
        runs = enqueue_due_connections()
        self.stdout.write(self.style.SUCCESS(f"Sincronizaciones encoladas: {len(runs)}"))
