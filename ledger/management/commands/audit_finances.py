"""Read-only reconciliation of the financial ledger.

The oracle below intentionally does not import ``ledger.calculations``.  It is
kept small and explicit so a shared-calculation regression can still be found.
"""

from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.db.models import Max, Min
from django.utils import timezone

from ledger.models import Account, Transaction
from ledger.services import account_balance, month_bounds, shift_month, transaction_totals
from ledger.statistics import _analyse_period


ZERO = Decimal("0.00")


def _oracle_period(rows, refunds_by_target, start, end):
    """Independently calculate all-basis totals for a single date range."""
    income = sum(
        (
            row["amount"]
            for row in rows
            if row["kind"] == Transaction.Kind.INCOME
            and not row["refund_for_id"]
            and start <= row["date"] <= end
        ),
        ZERO,
    )
    gross_expense = sum(
        (
            row["amount"]
            for row in rows
            if row["kind"] == Transaction.Kind.EXPENSE and start <= row["date"] <= end
        ),
        ZERO,
    )
    refunds_applied = ZERO

    for refund_rows in refunds_by_target.values():
        remaining = refund_rows[0]["refund_for__amount"]
        target_is_expense = refund_rows[0]["refund_for__kind"] == Transaction.Kind.EXPENSE
        target_is_active = not refund_rows[0]["refund_for__archived"]
        for refund in refund_rows:
            valid = target_is_expense and refund["date"] >= refund["refund_for__date"]
            if not valid:
                if start <= refund["date"] <= end:
                    income += refund["amount"]
                continue
            applied = min(refund["amount"], max(remaining, ZERO))
            remaining -= applied
            if target_is_active and start <= refund["refund_for__date"] <= end:
                refunds_applied += applied
            extra = refund["amount"] - applied
            if extra and start <= refund["date"] <= end:
                income += extra

    return income, gross_expense - refunds_applied, refunds_applied


class Command(BaseCommand):
    help = "Reconcilia el libro mayor sin escribir ni mostrar datos financieros."

    def add_arguments(self, parser):
        parser.add_argument("--all-history", action="store_true", help="Comprueba todos los meses con movimientos.")
        parser.add_argument("--fail-on-drift", action="store_true", help="Termina con error si una regla exacta discrepa.")

    def handle(self, *args, **options):
        cursor = connection.cursor()
        cursor.execute("PRAGMA query_only = ON")
        try:
            rows = list(
                Transaction.objects.filter(archived=False)
                .values(
                    "id",
                    "account_id",
                    "kind",
                    "amount",
                    "date",
                    "created_at",
                    "refund_for_id",
                    "refund_for__kind",
                    "refund_for__date",
                    "refund_for__amount",
                    "refund_for__archived",
                )
                .order_by("refund_for_id", "date", "created_at", "id")
            )
            refunds_by_target = defaultdict(list)
            for row in rows:
                if row["refund_for_id"]:
                    refunds_by_target[row["refund_for_id"]].append(row)

            accounts = list(Account.objects.values("id", "opening_balance", "active"))
            raw_balances = {item["id"]: item["opening_balance"] for item in accounts}
            signs = {
                Transaction.Kind.INCOME: Decimal("1"),
                Transaction.Kind.EXPENSE: Decimal("-1"),
                Transaction.Kind.TRANSFER_IN: Decimal("1"),
                Transaction.Kind.TRANSFER_OUT: Decimal("-1"),
            }
            for row in rows:
                raw_balances[row["account_id"]] += row["amount"] * signs[row["kind"]]
            account_drift = sum(
                raw_balances[item["id"]] != account_balance(Account.objects.get(pk=item["id"]))
                for item in accounts
            )

            dates = Transaction.objects.filter(archived=False).aggregate(first=Min("date"), last=Max("date"))
            if not dates["first"]:
                months = []
            elif options["all_history"]:
                months = []
                month = dates["first"].replace(day=1)
                final_month = dates["last"].replace(day=1)
                while month <= final_month:
                    months.append(month)
                    month = shift_month(month, 1)
            else:
                months = [timezone.localdate().replace(day=1)]

            service_drift = 0
            statistics_drift = 0
            for month in months:
                start, end = month_bounds(month)
                oracle = _oracle_period(rows, refunds_by_target, start, end)
                service = transaction_totals(start, end, basis="all")
                statistics = _analyse_period(start, end, "all")["summary"]
                service_drift += int((service["income"], service["expense"], service["refunds"]) != oracle)
                statistics_drift += int(
                    (statistics["income"], statistics["net_expense"], statistics["refunds_applied"]) != oracle
                )

            grouped_transfers = defaultdict(list)
            ungrouped_transfers = 0
            for row in Transaction.objects.filter(kind__in=[Transaction.Kind.TRANSFER_IN, Transaction.Kind.TRANSFER_OUT]).values(
                "transfer_group", "kind", "amount", "date", "account_id", "archived"
            ):
                if row["transfer_group"] is None:
                    ungrouped_transfers += 1
                else:
                    grouped_transfers[row["transfer_group"]].append(row)
            malformed_groups = sum(
                len(group) != 2
                or {item["kind"] for item in group} != {Transaction.Kind.TRANSFER_IN, Transaction.Kind.TRANSFER_OUT}
                or len({item["amount"] for item in group}) != 1
                or len({item["date"] for item in group}) != 1
                or len({item["account_id"] for item in group}) != 2
                or len({item["archived"] for item in group}) != 1
                for group in grouped_transfers.values()
            )

            checks = {
                "account_balance_drift": account_drift,
                "service_month_drift": service_drift,
                "statistics_month_drift": statistics_drift,
                "malformed_transfer_groups": malformed_groups,
            }
            self.stdout.write(f"scope={'all-history' if options['all_history'] else 'current-month'}")
            self.stdout.write(f"months_checked:{len(months)}")
            for name, count in checks.items():
                self.stdout.write(f"{name}:{count}")
            self.stdout.write(f"legacy_ungrouped_transfers:{ungrouped_transfers}")
            self.stdout.write(f"active_refund_links:{sum(len(items) for items in refunds_by_target.values())}")
        finally:
            cursor.execute("PRAGMA query_only = OFF")

        drift = sum(checks.values())
        if options["fail_on_drift"] and drift:
            raise CommandError(f"Se detectaron {drift} discrepancias exactas.")
