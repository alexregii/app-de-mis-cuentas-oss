"""Create deterministic S/M/L data for backend performance measurements."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from ledger.models import (
    Account,
    BankAccount,
    BankConnection,
    BankTransaction,
    Budget,
    Category,
    ImportBatch,
    ImportProfile,
    ImportRow,
    RecurringOccurrence,
    RecurringRule,
    SavingsGoal,
    Transaction,
)


DATASET_SIZES = {"S": 1_000, "M": 25_000, "L": 250_000}
CHUNK_SIZE = 2_000


class Command(BaseCommand):
    help = "Create a deterministic performance dataset in the configured database."

    def add_arguments(self, parser):  # noqa: ANN001
        parser.add_argument("--dataset", choices=sorted(DATASET_SIZES), required=True)

    def handle(self, *args, **options):  # noqa: ANN002, ARG002
        dataset = options["dataset"]
        if any(model.objects.exists() for model in (Account, Category, Transaction)):
            raise CommandError("La base no está vacía; usa una base de benchmark nueva.")

        size = DATASET_SIZES[dataset]
        started = date.today()
        with transaction.atomic():
            accounts = self._create_accounts()
            categories = self._create_categories()
            self._create_supporting_data(accounts, categories, started)
            transactions = self._create_transactions(size, accounts, categories, started)
            bank_rows = self._create_bank_data(size, accounts, categories, started)
            import_rows = self._create_import_data(size, accounts, categories, started)

        self.stdout.write(
            self.style.SUCCESS(
                f"dataset={dataset} transactions={len(transactions)} "
                f"bank_transactions={bank_rows} import_rows={import_rows}"
            )
        )

    def _create_accounts(self):
        accounts = [
            Account(name="Cuenta principal", kind=Account.Kind.CHECKING, opening_balance=Decimal("1200.00"), color="#3478F6"),
            Account(name="Cuenta ahorro", kind=Account.Kind.SAVINGS, opening_balance=Decimal("8500.00"), color="#34C759"),
            Account(name="Cuenta diaria", kind=Account.Kind.CHECKING, opening_balance=Decimal("300.00"), color="#FF9500"),
            Account(name="Cuenta viajes", kind=Account.Kind.SAVINGS, opening_balance=Decimal("600.00"), color="#AF52DE"),
        ]
        return Account.objects.bulk_create(accounts)

    def _create_categories(self):
        parents = [
            Category(name="Casa", kind=Category.Kind.EXPENSE, color="#FF3B30", sort_order=1),
            Category(name="Vida", kind=Category.Kind.EXPENSE, color="#FF9500", sort_order=2),
            Category(name="Ocio", kind=Category.Kind.EXPENSE, color="#AF52DE", sort_order=3),
            Category(name="Salario", kind=Category.Kind.INCOME, color="#34C759", sort_order=4),
            Category(name="Otros ingresos", kind=Category.Kind.INCOME, color="#30D158", sort_order=5),
        ]
        parents = Category.objects.bulk_create(parents)
        children = []
        for parent in parents[:3]:
            children.extend(
                [
                    Category(name=f"{parent.name} fijo", kind=parent.kind, parent=parent, sort_order=1),
                    Category(name=f"{parent.name} variable", kind=parent.kind, parent=parent, sort_order=2),
                ]
            )
        return Category.objects.bulk_create(children) + parents

    def _create_supporting_data(self, accounts, categories, today):
        expense_categories = [category for category in categories if category.kind == Category.Kind.EXPENSE]
        profile = ImportProfile.objects.create(name="CSV benchmark")
        SavingsGoal.objects.create(percentage=Decimal("20.00"), minimum=Decimal("100.00"))
        months = [today.replace(day=1) - timedelta(days=30 * offset) for offset in range(12)]
        budgets = [
            Budget(month=month.replace(day=1), category=category, limit=Decimal("900.00"))
            for month in months
            for category in expense_categories[:3]
        ]
        Budget.objects.bulk_create(budgets)

        rules = [
            RecurringRule(
                name=f"Regla recurrente {index:02d}",
                kind=Category.Kind.EXPENSE,
                amount=Decimal("42.50") + index,
                account=accounts[index % len(accounts)],
                category=expense_categories[index % len(expense_categories)],
                frequency=RecurringRule.Frequency.MONTHLY,
                day_of_month=(index % 25) + 1,
                start_date=today - timedelta(days=365),
            )
            for index in range(12)
        ]
        rules = RecurringRule.objects.bulk_create(rules)
        occurrences = [
            RecurringOccurrence(
                rule=rule,
                due_date=today + timedelta(days=30 * ((index % 3) + 1)),
                amount=rule.amount,
                status=RecurringOccurrence.Status.PENDING,
            )
            for index, rule in enumerate(rules)
        ]
        RecurringOccurrence.objects.bulk_create(occurrences)

    def _create_transactions(self, size, accounts, categories, today):
        expense_categories = [category for category in categories if category.kind == Category.Kind.EXPENSE]
        income_categories = [category for category in categories if category.kind == Category.Kind.INCOME]
        transfer_pairs = max(2, size // 250)
        refund_pairs = max(2, size // 200)
        regular_count = size - (transfer_pairs * 2) - refund_pairs
        transactions = []
        for index in range(regular_count):
            is_income = index % 7 == 0
            kind = Transaction.Kind.INCOME if is_income else Transaction.Kind.EXPENSE
            amount = Decimal(25 + (index % 175)) + Decimal(".50")
            movement_date = today - timedelta(days=index % 3650)
            category_pool = income_categories if is_income else expense_categories
            movement = Transaction(
                account=accounts[index % len(accounts)],
                kind=kind,
                amount=amount,
                date=movement_date,
                description=("Nómina benchmark" if is_income else f"Compra supermercado {index % 31:02d}"),
                category=category_pool[index % len(category_pool)],
                source=Transaction.Source.MANUAL,
                archived=index % 29 == 0,
                fingerprint="",
            )
            movement.fingerprint = Transaction.make_fingerprint(movement.account_id, movement.date, movement.description, movement.amount, movement.kind)
            transactions.append(movement)

        for index in range(transfer_pairs):
            group = uuid.uuid5(uuid.NAMESPACE_URL, f"perf-transfer-{index}")
            movement_date = today - timedelta(days=index % 3650)
            amount = Decimal("75.00") + index
            for account_index, kind in ((index % len(accounts), Transaction.Kind.TRANSFER_OUT), ((index + 1) % len(accounts), Transaction.Kind.TRANSFER_IN)):
                movement = Transaction(
                    account=accounts[account_index],
                    kind=kind,
                    amount=amount,
                    date=movement_date,
                    description=f"Traspaso benchmark {index:04d}",
                    transfer_group=group,
                    source=Transaction.Source.MANUAL,
                    fingerprint="",
                )
                movement.fingerprint = Transaction.make_fingerprint(movement.account_id, movement.date, movement.description, movement.amount, movement.kind)
                transactions.append(movement)

        created = []
        for chunk_start in range(0, len(transactions), CHUNK_SIZE):
            created.extend(Transaction.objects.bulk_create(transactions[chunk_start : chunk_start + CHUNK_SIZE]))

        refunds = []
        refund_targets = [movement for movement in created if movement.kind == Transaction.Kind.EXPENSE][:refund_pairs]
        for index, target in enumerate(refund_targets):
            refund = Transaction(
                account=target.account,
                kind=Transaction.Kind.INCOME,
                amount=min(target.amount, Decimal("20.00")),
                date=target.date + timedelta(days=1),
                description=f"Reembolso benchmark {index:04d}",
                category=income_categories[index % len(income_categories)],
                refund_for=target,
                source=Transaction.Source.MANUAL,
                fingerprint="",
            )
            refund.fingerprint = Transaction.make_fingerprint(refund.account_id, refund.date, refund.description, refund.amount, refund.kind)
            refunds.append(refund)
        created.extend(Transaction.objects.bulk_create(refunds))
        return created

    def _create_bank_data(self, size, accounts, categories, today):
        bank_count = max(20, size // 50)
        connection = BankConnection.objects.create(bank_name="Banco benchmark", bank_country="ES", session_id="perf-session")
        bank_accounts = [
            BankAccount.objects.create(
                connection=connection,
                account=account,
                remote_uid=f"perf-remote-{index}",
                display_name=f"Cuenta bancaria {index + 1}",
                remote_balance=Decimal("1000.00") + index,
                last_transaction_date=today - timedelta(days=30),
            )
            for index, account in enumerate(accounts[:2])
        ]
        expense_categories = [category for category in categories if category.kind == Category.Kind.EXPENSE]
        rows = [
            BankTransaction(
                bank_account=bank_accounts[index % len(bank_accounts)],
                remote_id=f"perf-bank-{index:08d}",
                booking_date=today - timedelta(days=index % 3650),
                description=f"Compra banco benchmark {index % 47:02d}",
                amount=Decimal(12 + index % 220) + Decimal(".25"),
                kind=Category.Kind.EXPENSE,
                fingerprint=f"perf-bank-fingerprint-{index:08d}",
                possible_duplicate=index % 19 == 0,
                possible_transfer=index % 37 == 0,
                category=expense_categories[index % len(expense_categories)],
            )
            for index in range(bank_count)
        ]
        BankTransaction.objects.bulk_create(rows, batch_size=CHUNK_SIZE)
        return bank_count

    def _create_import_data(self, size, accounts, categories, today):
        row_count = max(50, size // 100)
        profile = ImportProfile.objects.get(name="CSV benchmark")
        batch = ImportBatch.objects.create(filename="benchmark.csv", account=accounts[0], profile=profile)
        expense_categories = [category for category in categories if category.kind == Category.Kind.EXPENSE]
        rows = [
            ImportRow(
                batch=batch,
                row_number=index + 1,
                date=today - timedelta(days=index % 3650),
                description=f"Fila importada benchmark {index:05d}",
                amount=Decimal(5 + index % 100) + Decimal(".75"),
                kind=Category.Kind.EXPENSE,
                category=expense_categories[index % len(expense_categories)],
                fingerprint=f"perf-import-fingerprint-{index:08d}",
                possible_duplicate=index % 23 == 0,
            )
            for index in range(row_count)
        ]
        ImportRow.objects.bulk_create(rows, batch_size=CHUNK_SIZE)
        return row_count
