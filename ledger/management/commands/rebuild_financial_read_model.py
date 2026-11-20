from django.core.management.base import BaseCommand
from django.utils.dateparse import parse_date

from ledger.financial_read_models import rebuild_dirty_financial_aggregates, recompute_monthly_financial_aggregates


class Command(BaseCommand):
    help = "Rebuild the monthly financial statistics read model."

    def add_arguments(self, parser):
        parser.add_argument("--start", default="")
        parser.add_argument("--end", default="")
        parser.add_argument("--dirty", action="store_true", help="Rebuild only dirty months in coalesced batches.")
        parser.add_argument("--limit", type=int, default=24, help="Maximum number of dirty months per pass.")

    def handle(self, *args, **options):
        start = parse_date(options["start"]) if options["start"] else None
        end = parse_date(options["end"]) if options["end"] else None
        if options["dirty"]:
            result = rebuild_dirty_financial_aggregates(options["limit"], start=start, end=end)
            self.stdout.write(
                self.style.SUCCESS(
                    "Agregados dirty procesados: "
                    f"{result['rebuilt']} reconstruidos, {result['conflicts']} conflictos, "
                    f"{result['months']} meses en {result['batches']} lotes."
                )
            )
            return
        count = recompute_monthly_financial_aggregates(start=start, end=end)
        self.stdout.write(self.style.SUCCESS(f"Agregados financieros reconstruidos: {count}."))
