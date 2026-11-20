import os
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.core.files.base import ContentFile
from django.utils import timezone

from ledger.models import Account, Attachment, BankAccount, BankConnection, BankTransaction, Category, ImportBatch, ImportProfile, ImportRow, RecurringRule, SavingsGoal, SavingsObjective, Transaction
from ledger.savings_objectives import create_objective, set_objective_allocation
from ledger.transaction_services import create_transfer
from ledger.transaction_allocations import replace_transaction_allocations
from ledger.calculations.annual_reserve import next_annual_due_date


def seed_mobile_review_annual_reserves(account, category, today):
    due_month_index = today.year * 12 + today.month - 1 + 9
    due_year, due_month_index = divmod(due_month_index, 12)
    first_due_date = date(due_year, due_month_index + 1, 1)
    insurance = RecurringRule.objects.create(
        name="Seguro del hogar anual E2E",
        kind=Category.Kind.EXPENSE,
        amount=Decimal("1200.00"),
        account=account,
        category=category,
        frequency=RecurringRule.Frequency.YEARLY,
        day_of_month=1,
        start_date=first_due_date,
    )
    due_date = next_annual_due_date(insurance, today)
    SavingsObjective.objects.create(
        name="Reserva del seguro del hogar E2E",
        target_amount=insurance.amount,
        target_date=due_date,
        priority=1,
        assigned_amount=Decimal("300.00"),
        recurring_rule=insurance,
    )
    RecurringRule.objects.create(
        name="Impuesto municipal anual E2E",
        kind=Category.Kind.EXPENSE,
        amount=Decimal("240.00"),
        account=account,
        category=category,
        frequency=RecurringRule.Frequency.YEARLY,
        day_of_month=1,
        start_date=first_due_date,
    )


class Command(BaseCommand):
    help = "Recrea datos deterministas únicamente en la base SQLite aislada de Playwright."

    def add_arguments(self, parser):
        parser.add_argument(
            "--mobile-review",
            action="store_true",
            help="Añade fixtures sintéticas M19/M20/M21 solo a un entorno de previsualización aislado.",
        )

    def handle(self, *args, **options):
        database_path = Path(settings.DATABASES["default"]["NAME"]).resolve()
        project_e2e_dir = (settings.BASE_DIR / ".e2e").resolve()
        protected_dirs = [(settings.BASE_DIR / "data").resolve(), Path("/app/data").resolve()]
        mobile_review = options["mobile_review"]

        if os.getenv("E2E_TEST_MODE") != "1":
            raise CommandError("seed_e2e exige E2E_TEST_MODE=1.")
        if mobile_review and (
            os.getenv("MOBILE_REVIEW_PREVIEW") != "1"
            or os.getenv("E2E_AUTH_TEST_MODE") != "1"
        ):
            raise CommandError("--mobile-review exige MOBILE_REVIEW_PREVIEW=1 y E2E_AUTH_TEST_MODE=1.")
        mobile_review_revision = os.getenv("MOBILE_REVIEW_SHA", "")
        if mobile_review and (
            len(mobile_review_revision) != 40
            or any(character not in "0123456789abcdef" for character in mobile_review_revision)
        ):
            raise CommandError("--mobile-review exige un MOBILE_REVIEW_SHA de 40 caracteres hexadecimales.")
        if any(database_path == protected or database_path.is_relative_to(protected) for protected in protected_dirs):
            raise CommandError(f"Base protegida: {database_path}")
        if not database_path.is_relative_to(project_e2e_dir):
            raise CommandError(f"La base E2E debe estar dentro de {project_e2e_dir}.")

        media_path = Path(settings.MEDIA_ROOT).resolve()
        if mobile_review and not media_path.is_relative_to(project_e2e_dir):
            raise CommandError(f"Los medios del preview deben estar dentro de {project_e2e_dir}.")

        database_path.parent.mkdir(parents=True, exist_ok=True)
        call_command("flush", interactive=False, verbosity=0)

        if os.getenv("E2E_AUTH_TEST_MODE") == "1":
            get_user_model().objects.create_user(
                username="e2e-operator",
                password="E2E-only-test-password-2026!",
            )

        daily = Account.objects.create(
            name="Cuenta diaria E2E",
            kind=Account.Kind.CHECKING,
            opening_balance=Decimal("1250.00"),
            color="#3478f6",
        )
        savings = Account.objects.create(
            name="Ahorro E2E",
            kind=Account.Kind.SAVINGS,
            opening_balance=Decimal("4500.00"),
            color="#30d158",
        )
        salary = Category.objects.create(
            name="Nómina E2E",
            kind=Category.Kind.INCOME,
            color="#30d158",
            sort_order=1,
        )
        refunds = Category.objects.create(
            name="Reembolsos E2E",
            kind=Category.Kind.INCOME,
            color="#30d158",
            sort_order=2,
        )
        food = Category.objects.create(
            name="Comida E2E",
            kind=Category.Kind.EXPENSE,
            color="#ff9f0a",
            sort_order=1,
        )
        home = Category.objects.create(
            name="Vivienda E2E",
            kind=Category.Kind.EXPENSE,
            color="#af52de",
            sort_order=2,
        )
        leisure = Category.objects.create(
            name="Ocio E2E",
            kind=Category.Kind.EXPENSE,
            color="#5856d6",
            sort_order=3,
        )
        outings = Category.objects.create(
            name="Salidas E2E",
            kind=Category.Kind.EXPENSE,
            color="#5856d6",
            parent=leisure,
            sort_order=1,
        )

        months = [
            (2025, 8), (2025, 9), (2025, 10), (2025, 11), (2025, 12),
            (2026, 1), (2026, 2), (2026, 3), (2026, 4), (2026, 5), (2026, 6), (2026, 7),
        ]
        for index, (year, month) in enumerate(months):
            Transaction.objects.create(
                account=daily,
                kind=Transaction.Kind.INCOME,
                amount=Decimal("2200.00") + Decimal(index * 10),
                date=date(year, month, 2),
                description="Nómina mensual E2E",
                category=salary,
            )
            Transaction.objects.create(
                account=daily,
                kind=Transaction.Kind.EXPENSE,
                amount=Decimal("320.00") + Decimal(index * 3),
                date=date(year, month, 8),
                description="Compra supermercado E2E",
                category=food,
            )
            Transaction.objects.create(
                account=daily,
                kind=Transaction.Kind.EXPENSE,
                amount=Decimal("700.00"),
                date=date(year, month, 5),
                description="Alquiler mensual E2E",
                category=home,
            )

        refunded_purchase = Transaction.objects.create(
            account=daily,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("100.00"),
            date=date(2026, 6, 14),
            description="Compra con reembolso parcial E2E",
            category=food,
        )
        Transaction.objects.create(
            account=daily,
            kind=Transaction.Kind.INCOME,
            amount=Decimal("30.00"),
            date=date(2026, 7, 15),
            description="Reembolso parcial posterior E2E",
            category=refunds,
            refund_for=refunded_purchase,
        )
        create_transfer(
            source_account=daily,
            target_account=savings,
            amount=Decimal("999.00"),
            tx_date=date(2026, 6, 18),
            description="Traspaso neutral estadístico E2E",
        )

        editable = Transaction.objects.create(
            account=daily,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("42.35"),
            date=date(2026, 7, 11),
            description="Movimiento manual editable E2E",
            category=food,
        )
        Transaction.objects.create(
            account=daily,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("18.00"),
            date=date(2026, 7, 12),
            description="Ocio directo E2E",
            category=leisure,
        )
        Transaction.objects.create(
            account=daily,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("27.00"),
            date=date(2026, 7, 12),
            description="Salida hija E2E",
            category=outings,
        )
        attached = Transaction.objects.create(
            account=daily,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("24.75"),
            date=date(2026, 7, 13),
            description="Compra con adjuntos E2E",
            category=food,
        )
        Attachment.objects.create(
            transaction=attached,
            file=ContentFile(b"%PDF-1.4\nE2E attachment\n", name="ticket-e2e.pdf"),
            original_name="ticket-e2e.pdf",
            content_type="application/pdf",
        )

        profile = ImportProfile.objects.create(name="CSV E2E")
        batch = ImportBatch.objects.create(
            filename="reapertura-e2e.csv",
            account=daily,
            profile=profile,
            status=ImportBatch.Status.COMPLETED,
        )
        imported = Transaction.objects.create(
            account=daily,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("19.95"),
            date=date(2026, 7, 10),
            description="Compra CSV reabrible E2E",
            category=food,
            source=Transaction.Source.CSV,
        )
        ImportRow.objects.create(
            batch=batch,
            row_number=1,
            date=imported.date,
            description=imported.description,
            amount=-imported.amount,
            kind=Category.Kind.EXPENSE,
            category=food,
            fingerprint="e2e-csv-reopen-row",
            status=ImportRow.Status.IMPORTED,
            transaction=imported,
        )
        review_batch = ImportBatch.objects.create(
            filename="revision-csv-e2e.csv",
            account=daily,
            profile=profile,
            status=ImportBatch.Status.REVIEW,
        )
        ImportRow.objects.create(
            batch=review_batch,
            row_number=1,
            date=date(2026, 7, 17),
            description="Compra CSV pendiente E2E",
            amount=Decimal("12.50"),
            kind=Category.Kind.EXPENSE,
            fingerprint="e2e-csv-review-pending",
        )
        ImportRow.objects.create(
            batch=review_batch,
            row_number=2,
            date=date(2026, 7, 18),
            description="Compra CSV duplicada E2E",
            amount=Decimal("8.75"),
            kind=Category.Kind.EXPENSE,
            category=food,
            fingerprint="e2e-csv-review-duplicate",
            possible_duplicate=True,
        )
        bank_connection = BankConnection.objects.create(bank_name="Banco E2E", session_id="bank-e2e")
        bank_account = BankAccount.objects.create(
            connection=bank_connection,
            account=daily,
            remote_uid="account-e2e",
            display_name="Cuenta diaria E2E",
        )
        BankTransaction.objects.create(
            bank_account=bank_account,
            remote_id="review-triage-signal-e2e",
            booking_date=date(2026, 7, 16),
            description="Compra bancaria con señal E2E",
            amount=Decimal("24.50"),
            kind=Category.Kind.EXPENSE,
            category=food,
            fingerprint="review-triage-signal-e2e",
            possible_transfer=True,
        )
        BankTransaction.objects.create(
            bank_account=bank_account,
            remote_id="review-triage-confirm-e2e",
            booking_date=date(2026, 7, 17),
            description="Compra bancaria confirmable E2E",
            amount=Decimal("12.50"),
            kind=Category.Kind.EXPENSE,
            category=food,
            fingerprint="review-triage-confirm-e2e",
        )
        SavingsGoal.objects.create(percentage=Decimal("20.00"), minimum=Decimal("300.00"))

        if mobile_review:
            today = timezone.localdate()
            spike_category = Category.objects.create(
                name="Pico de gasto E2E",
                kind=Category.Kind.EXPENSE,
                color="#ff453a",
                sort_order=4,
            )
            for month_offset in range(-12, 1):
                month_index = today.year * 12 + today.month - 1 + month_offset
                year, month_index = divmod(month_index, 12)
                Transaction.objects.create(
                    account=daily,
                    kind=Transaction.Kind.EXPENSE,
                    amount=Decimal("200.00") if month_offset == 0 else Decimal("100.00"),
                    date=date(year, month_index + 1, min(today.day, 10)),
                    description="Pico de gasto sintético E2E",
                    category=spike_category,
                )
            objective, _ = create_objective({
                "name": "Fondo de vacaciones E2E",
                "target_amount": "2500.00",
                "target_date": "2027-08-01",
                "priority": 1,
                "idempotency_key": str(uuid.uuid5(uuid.NAMESPACE_URL, "app-de-mis-cuentas/mobile-review-objective")),
            })
            set_objective_allocation(objective.pk, {
                "expected_revision": objective.revision,
                "assigned_amount": "600.00",
            })
            seed_mobile_review_annual_reserves(daily, home, today)
            replace_transaction_allocations(editable, [
                {"category_id": food.pk, "amount": "20.00"},
                {"category_id": leisure.pk, "amount": "22.35"},
            ])
        self.stdout.write(self.style.SUCCESS(f"Seed E2E recreado en {database_path}"))
