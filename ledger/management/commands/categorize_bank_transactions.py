import requests

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q
from django.utils import timezone
from datetime import timedelta

from ledger.banking_categorization import predict_category
from ledger.categorization_policy import CATEGORIZATION_RETRY_COOLDOWN_SECONDS, MAX_CATEGORIZATION_ROWS_PER_RUN
from ledger.models import BankTransaction


class Command(BaseCommand):
    help = "Categoriza movimientos bancarios pendientes mediante el LLM local."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=20)
        parser.add_argument("--unload-model", action="store_true")

    def handle(self, *args, **options):
        limit = options["limit"]
        if limit < 1 or limit > MAX_CATEGORIZATION_ROWS_PER_RUN:
            raise CommandError(f"El límite debe estar entre 1 y {MAX_CATEGORIZATION_ROWS_PER_RUN} filas.")
        retry_before = timezone.now() - timedelta(seconds=CATEGORIZATION_RETRY_COOLDOWN_SECONDS)
        rows = BankTransaction.objects.filter(
            status=BankTransaction.Status.PENDING,
            category__isnull=True,
        ).filter(
            Q(prediction__isnull=True)
            | Q(prediction__status="failed", prediction__updated_at__lte=retry_before)
        ).order_by("created_at")[:limit]
        processed = 0
        for row in rows:
            predict_category(row)
            processed += 1
        if options["unload_model"] and processed:
            self.unload_model()
        self.stdout.write(f"Movimientos procesados: {processed}")

    def unload_model(self):
        try:
            response = requests.post(
                f"{settings.LOCAL_LLM_URL}/api/generate",
                json={
                    "model": settings.LOCAL_LLM_MODEL,
                    "prompt": "",
                    "keep_alive": 0,
                    "stream": False,
                },
                timeout=30,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            self.stderr.write(self.style.WARNING(f"No se pudo descargar el modelo local: {exc}"))
