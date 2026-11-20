import hashlib
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator, MaxValueValidator, MinValueValidator
from django.db import models
from django.conf import settings
from django.utils import timezone


MONEY = {"max_digits": 14, "decimal_places": 2}


def normalize_match_text(value):
    return " ".join(str(value or "").lower().split())[:180]


def first_day(value: date) -> date:
    return value.replace(day=1)


def attachment_path(instance, filename):
    return f"tickets/{instance.transaction.date:%Y/%m}/{uuid.uuid4().hex}{Path(filename).suffix.lower()}"


def validate_file_size(value):
    if value.size > 10 * 1024 * 1024:
        raise ValidationError("El archivo no puede superar 10 MB.")


class Account(models.Model):
    class Kind(models.TextChoices):
        CHECKING = "checking", "Cuenta corriente"
        SAVINGS = "savings", "Cuenta de ahorro"

    name = models.CharField("nombre", max_length=80, unique=True)
    kind = models.CharField("tipo", max_length=16, choices=Kind.choices, default=Kind.CHECKING)
    opening_balance = models.DecimalField("saldo inicial", default=0, **MONEY)
    active = models.BooleanField("activa", default=True)
    color = models.CharField("color", max_length=7, default="#3478F6")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "cuenta"
        verbose_name_plural = "cuentas"

    def __str__(self):
        return self.name


class ReconciliationSnapshot(models.Model):
    class Status(models.TextChoices):
        RECONCILED = "reconciled", "Reconciliada"
        DIFFERENCE = "difference", "Con diferencia"

    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="reconciliation_snapshots")
    date = models.DateField("fecha de extracto")
    statement_balance = models.DecimalField("saldo del extracto", **MONEY)
    ledger_balance = models.DecimalField("saldo del ledger", **MONEY)
    difference = models.DecimalField("diferencia", **MONEY)
    status = models.CharField(max_length=16, choices=Status.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-created_at"]
        verbose_name = "reconciliación"
        verbose_name_plural = "reconciliaciones"


class DashboardPreferences(models.Model):
    """Cross-device dashboard layout; finance values remain derived in Django."""

    DENSITY_CHOICES = [("normal", "Normal"), ("compact", "Compacto")]
    CONTENT_CHOICES = [("full", "Completo"), ("balance", "Solo saldo"), ("review", "Revisión rápida")]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="dashboard_preferences")
    widget_order = models.JSONField(default=list, blank=True)
    hidden_widgets = models.JSONField(default=list, blank=True)
    density = models.CharField(max_length=10, choices=DENSITY_CHOICES, default="normal")
    content_mode = models.CharField(max_length=10, choices=CONTENT_CHOICES, default="full")
    last_snapshot_month = models.CharField(max_length=7, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "preferencias del dashboard"
        verbose_name_plural = "preferencias del dashboard"


class MonthlyDashboardSnapshot(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="dashboard_snapshots")
    month = models.CharField(max_length=7)
    payload = models.JSONField(default=dict)
    captured_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "month"], name="unique_dashboard_snapshot_user_month")]
        ordering = ["-month"]


class MonthlyFinancialAggregate(models.Model):
    """Rebuilt monthly read model for the statistics workbench."""

    month = models.DateField()
    basis = models.CharField(max_length=10)
    income = models.DecimalField(**MONEY)
    gross_expense = models.DecimalField(**MONEY)
    refunds_applied = models.DecimalField(**MONEY)
    extra_income = models.DecimalField(**MONEY)
    payload = models.JSONField(default=dict)
    dirty = models.BooleanField(default=True)
    dirty_version = models.PositiveBigIntegerField(default=0)
    calculated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["month", "basis"], name="unique_financial_aggregate_month_basis")]
        ordering = ["month", "basis"]


class MonthlyClose(models.Model):
    class Basis(models.TextChoices):
        ANALYTICS = "analytics", "Categorías analíticas"
        ALL = "all", "Todas las categorías"

    class Status(models.TextChoices):
        CLEAN = "clean", "Sin incidencias declaradas"
        DECLARED = "declared", "Incidencias declaradas"

    class Origin(models.TextChoices):
        NATIVE = "native", "Cierre local"
        PORTABLE_ARCHIVE = "portable_archive", "Archivo portable importado"

    month = models.DateField("mes cerrado")
    basis = models.CharField(max_length=10, choices=Basis.choices)
    version = models.PositiveIntegerField()
    status_at_close = models.CharField(max_length=10, choices=Status.choices)
    origin = models.CharField(max_length=20, choices=Origin.choices, default=Origin.NATIVE)
    source_digest = models.CharField(max_length=64)
    idempotency_key = models.CharField(max_length=36, unique=True)
    request_digest = models.CharField(max_length=64)
    report = models.JSONField(default=dict)
    accounts = models.JSONField(default=list)
    issues = models.JSONField(default=list)
    declarations = models.JSONField(default=list)
    correction_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["month", "basis", "version"], name="unique_month_close_version"),
        ]
        ordering = ["-month", "basis", "-version"]
        verbose_name = "cierre mensual"
        verbose_name_plural = "cierres mensuales"

    def clean(self):
        if self.month and self.month.day != 1:
            raise ValidationError({"month": "El cierre debe identificar el primer día del mes."})
        if self.version < 1:
            raise ValidationError({"version": "La versión del cierre debe ser positiva."})


class SubscriptionReview(models.Model):
    class Status(models.TextChoices):
        ACCEPTED = "accepted", "Aceptada"
        DISMISSED = "dismissed", "Descartada"

    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="subscription_reviews")
    normalized_description = models.CharField(max_length=180)
    status = models.CharField(max_length=10, choices=Status.choices)
    revision = models.PositiveBigIntegerField(default=0)
    evidence_signature = models.CharField(max_length=64)
    reviewed_monthly_amount = models.DecimalField(null=True, blank=True, **MONEY)
    reviewed_months_seen = models.PositiveSmallIntegerField(null=True, blank=True)
    next_review_date = models.DateField(null=True, blank=True)
    monthly_periodicity_confirmed = models.BooleanField(default=False)
    confirmed_annual_cost = models.DecimalField(null=True, blank=True, **MONEY)
    reviewed_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["account", "normalized_description"], name="unique_subscription_review_account_concept"),
        ]
        ordering = ["account__name", "normalized_description"]
        verbose_name = "revisión de suscripción"
        verbose_name_plural = "revisiones de suscripciones"


class BankConnection(models.Model):
    class Status(models.TextChoices):
        AUTHORIZED = "authorized", "Autorizada"
        NEEDS_RECONNECT = "needs_reconnect", "Necesita reconexión"
        DISCONNECTED = "disconnected", "Desconectada"

    class SyncStatus(models.TextChoices):
        IDLE = "idle", "Sincronizada"
        SYNCING = "syncing", "Sincronizando"
        ERROR = "error", "Error de sincronización"

    bank_name = models.CharField(max_length=120)
    bank_country = models.CharField(max_length=2, default="ES")
    session_id = models.CharField(max_length=120, unique=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.AUTHORIZED)
    sync_status = models.CharField(max_length=12, choices=SyncStatus.choices, default=SyncStatus.IDLE)
    sync_started_at = models.DateTimeField(null=True, blank=True)
    authorized_until = models.DateTimeField(null=True, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=240, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["bank_name", "-created_at"]

    def __str__(self):
        return self.bank_name


class BankAccount(models.Model):
    connection = models.ForeignKey(BankConnection, on_delete=models.CASCADE, related_name="bank_accounts")
    account = models.OneToOneField(Account, on_delete=models.PROTECT, related_name="bank_link")
    remote_uid = models.CharField(max_length=160, unique=True)
    display_name = models.CharField(max_length=160)
    currency = models.CharField(max_length=3, default="EUR")
    remote_balance = models.DecimalField(null=True, blank=True, **MONEY)
    balance_updated_at = models.DateTimeField(null=True, blank=True)
    remote_balance_type = models.CharField(max_length=4, blank=True)
    remote_balance_currency = models.CharField(max_length=3, blank=True)
    remote_balance_reference_date = models.DateField(null=True, blank=True)
    balance_provenance_updated_at = models.DateTimeField(null=True, blank=True)
    last_transaction_date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["display_name"]

    def __str__(self):
        return self.display_name


class Category(models.Model):
    class Kind(models.TextChoices):
        INCOME = "income", "Ingreso"
        EXPENSE = "expense", "Gasto"

    name = models.CharField("nombre", max_length=80)
    kind = models.CharField("tipo", max_length=10, choices=Kind.choices)
    parent = models.ForeignKey(
        "self", verbose_name="categoría principal", null=True, blank=True, on_delete=models.PROTECT, related_name="children"
    )
    color = models.CharField("color", max_length=7, default="#8E8E93")
    icon = models.CharField("icono", max_length=30, blank=True)
    active = models.BooleanField("activa", default=True)
    exclude_from_analytics = models.BooleanField("excluir de estadísticas", default=False)
    sort_order = models.IntegerField("orden", default=0)
    is_favorite = models.BooleanField("favorita", default=False)
    merged_into = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="merged_sources")
    deactivated_at = models.DateTimeField("desactivada el", null=True, blank=True)

    class Meta:
        ordering = ["kind", "parent__name", "name"]
        constraints = [models.UniqueConstraint(fields=["name", "kind", "parent"], name="unique_category_path")]
        verbose_name = "categoría"
        verbose_name_plural = "categorías"

    def clean(self):
        if self.parent:
            if self.parent.parent_id:
                raise ValidationError("Solo se admite un nivel de subcategorías.")
            if self.parent.kind != self.kind:
                raise ValidationError("La subcategoría debe tener el mismo tipo que su categoría principal.")
            if self.pk and self.parent_id == self.pk:
                raise ValidationError("Una categoría no puede depender de sí misma.")

    @property
    def display_name(self):
        return f"{self.parent.name} · {self.name}" if self.parent else self.name

    def __str__(self):
        return self.display_name


class CategoryRule(models.Model):
    class MatchMode(models.TextChoices):
        EXACT = "exact", "Exacta"
        CONTAINS = "contains", "Contiene"
        STARTS_WITH = "starts_with", "Empieza por"
        ENDS_WITH = "ends_with", "Termina en"
    description = models.CharField("descripción", max_length=180)
    normalized_description = models.CharField(max_length=180, editable=False)
    kind = models.CharField("tipo", max_length=10, choices=Category.Kind.choices)
    category = models.ForeignKey(Category, verbose_name="categoría", on_delete=models.PROTECT, related_name="rules")
    priority = models.PositiveIntegerField("prioridad", default=100)
    match_mode = models.CharField("modo", max_length=16, choices=MatchMode.choices, default=MatchMode.EXACT)
    account = models.ForeignKey(Account, null=True, blank=True, on_delete=models.PROTECT, related_name="category_rules")
    amount_min = models.DecimalField(null=True, blank=True, **MONEY)
    amount_max = models.DecimalField(null=True, blank=True, **MONEY)
    active = models.BooleanField("activa", default=True)
    last_tested_at = models.DateTimeField(null=True, blank=True)
    last_test_result = models.JSONField(default=dict, blank=True)
    application_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["description"]
        constraints = [
            models.UniqueConstraint(fields=["normalized_description", "kind"], name="unique_category_rule_description_kind")
        ]
        verbose_name = "regla de categoría"
        verbose_name_plural = "reglas de categoría"

    def clean(self):
        if self.category_id and self.category.kind != self.kind:
            raise ValidationError("La categoría de la regla debe coincidir con el tipo.")
        if self.amount_min is not None and self.amount_max is not None and self.amount_min > self.amount_max:
            raise ValidationError({"amount_max": "El importe máximo debe ser mayor o igual que el mínimo."})
        if self.category_id and (not self.category.active or (self.account_id and not self.account.active)):
            raise ValidationError("La regla solo puede usar categorías y cuentas activas.")

    def save(self, *args, **kwargs):
        self.normalized_description = normalize_match_text(self.description)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.description


class CategoryMergeOperation(models.Model):
    class Status(models.TextChoices):
        COMPLETED = "completed", "Completada"
        UNDONE = "undone", "Deshecha"
        PARTIAL = "partial", "Parcial"

    source_categories = models.JSONField(default=list)
    destination = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="merge_destinations")
    operation_type = models.CharField(max_length=24, default="category_merge")
    created_at = models.DateTimeField(auto_now_add=True)
    transaction_count = models.PositiveIntegerField(default=0)
    budget_count = models.PositiveIntegerField(default=0)
    rule_count = models.PositiveIntegerField(default=0)
    import_count = models.PositiveIntegerField(default=0)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.COMPLETED)
    reversible = models.BooleanField(default=True)
    snapshot = models.JSONField(default=dict, blank=True)


class CategoryRuleApplication(models.Model):
    class Status(models.TextChoices):
        COMPLETED = "completed", "Completada"
        UNDONE = "undone", "Deshecha"
        PARTIAL = "partial", "Parcial"

    rule = models.ForeignKey(CategoryRule, null=True, blank=True, on_delete=models.SET_NULL, related_name="applications")
    applied_at = models.DateTimeField(auto_now_add=True)
    filters_used = models.JSONField(default=dict, blank=True)
    affected_records = models.JSONField(default=list, blank=True)
    previous_values = models.JSONField(default=list, blank=True)
    new_values = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.COMPLETED)
    reversible = models.BooleanField(default=True)


class Tag(models.Model):
    name = models.CharField("nombre", max_length=40, unique=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "etiqueta"
        verbose_name_plural = "etiquetas"

    def __str__(self):
        return self.name


class RecurringRule(models.Model):
    class Frequency(models.TextChoices):
        MONTHLY = "monthly", "Mensual"
        YEARLY = "yearly", "Anual"

    name = models.CharField("nombre", max_length=120)
    kind = models.CharField("tipo", max_length=10, choices=Category.Kind.choices)
    amount = models.DecimalField("importe", validators=[MinValueValidator(Decimal("0.01"))], **MONEY)
    account = models.ForeignKey(Account, verbose_name="cuenta", on_delete=models.PROTECT)
    category = models.ForeignKey(Category, verbose_name="categoría", on_delete=models.PROTECT)
    frequency = models.CharField("frecuencia", max_length=10, choices=Frequency.choices, default=Frequency.MONTHLY)
    day_of_month = models.PositiveSmallIntegerField(
        "día del mes", default=1, validators=[MinValueValidator(1), MaxValueValidator(31)]
    )
    start_date = models.DateField("fecha inicial", default=date.today)
    end_date = models.DateField("fecha final", null=True, blank=True)
    active = models.BooleanField("activa", default=True)
    notes = models.TextField("notas", blank=True)

    class Meta:
        ordering = ["day_of_month", "name"]
        verbose_name = "regla recurrente"
        verbose_name_plural = "reglas recurrentes"

    def clean(self):
        if self.category_id and self.category.kind != self.kind:
            raise ValidationError("La categoría no corresponde al tipo del recurrente.")
        if self.end_date and self.end_date < self.start_date:
            raise ValidationError("La fecha final debe ser posterior a la inicial.")

    def __str__(self):
        return self.name


class RecurringOccurrence(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pendiente"
        CONFIRMED = "confirmed", "Confirmada"
        SKIPPED = "skipped", "Omitida"

    rule = models.ForeignKey(RecurringRule, on_delete=models.CASCADE, related_name="occurrences")
    due_date = models.DateField("fecha efectiva")
    amount = models.DecimalField("importe", validators=[MinValueValidator(Decimal("0.01"))], **MONEY)
    status = models.CharField("estado", max_length=10, choices=Status.choices, default=Status.PENDING)
    reserve_consumed_amount = models.DecimalField(default=Decimal("0.00"), validators=[MinValueValidator(Decimal("0.00"))], **MONEY)
    reserve_objective = models.ForeignKey(
        "SavingsObjective", null=True, blank=True, on_delete=models.PROTECT, related_name="consumed_occurrences"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["due_date", "rule__name"]
        constraints = [
            models.UniqueConstraint(fields=["rule", "due_date"], name="unique_rule_due_date"),
            models.CheckConstraint(condition=models.Q(reserve_consumed_amount__gte=0), name="recurring_occurrence_reserve_consumed_nonnegative"),
            models.CheckConstraint(condition=models.Q(reserve_consumed_amount__lte=models.F("amount")), name="recurring_occurrence_reserve_consumed_lte_amount"),
            models.CheckConstraint(condition=models.Q(reserve_consumed_amount=0) | models.Q(reserve_objective__isnull=False), name="recurring_occurrence_reserve_owner_required"),
        ]
        verbose_name = "ocurrencia recurrente"
        verbose_name_plural = "ocurrencias recurrentes"

    def clean(self):
        super().clean()
        try:
            amount = Decimal(str(self.amount))
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise ValidationError({"amount": "El importe de la ocurrencia debe ser un decimal válido."}) from exc
        if not amount.is_finite():
            raise ValidationError({"amount": "El importe de la ocurrencia debe ser finito."})
        try:
            reserve_consumed_amount = Decimal(str(self.reserve_consumed_amount))
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise ValidationError({"reserve_consumed_amount": "El importe consumido debe ser un decimal válido."}) from exc
        if not reserve_consumed_amount.is_finite() or reserve_consumed_amount < 0:
            raise ValidationError({"reserve_consumed_amount": "El importe consumido debe ser un decimal finito no negativo."})
        if reserve_consumed_amount > amount:
            raise ValidationError({"reserve_consumed_amount": "No puede superar el importe de la ocurrencia."})
        if reserve_consumed_amount and not self.reserve_objective_id:
            raise ValidationError({"reserve_objective": "La reserva consumida requiere su objetivo de origen."})

    def __str__(self):
        return f"{self.rule.name} · {self.due_date:%d/%m/%Y}"


class Transaction(models.Model):
    class Kind(models.TextChoices):
        INCOME = "income", "Ingreso"
        EXPENSE = "expense", "Gasto"
        TRANSFER_IN = "transfer_in", "Traspaso recibido"
        TRANSFER_OUT = "transfer_out", "Traspaso enviado"

    class Source(models.TextChoices):
        MANUAL = "manual", "Manual"
        CSV = "csv", "Importación CSV"
        RECURRING = "recurring", "Recurrente"
        ENABLE_BANKING = "enable_banking", "Enable Banking"

    account = models.ForeignKey(Account, verbose_name="cuenta", on_delete=models.PROTECT, related_name="transactions")
    kind = models.CharField("tipo", max_length=16, choices=Kind.choices)
    amount = models.DecimalField("importe", validators=[MinValueValidator(Decimal("0.01"))], **MONEY)
    date = models.DateField("fecha", default=date.today, db_index=True)
    description = models.CharField("concepto", max_length=180)
    category = models.ForeignKey(
        Category, verbose_name="categoría", null=True, blank=True, on_delete=models.PROTECT, related_name="transactions"
    )
    refund_for = models.ForeignKey(
        "self",
        verbose_name="reembolso de",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="refunds",
    )
    notes = models.TextField("notas", blank=True)
    tags = models.ManyToManyField(Tag, verbose_name="etiquetas", blank=True, related_name="transactions")
    source = models.CharField("origen", max_length=20, choices=Source.choices, default=Source.MANUAL)
    transfer_group = models.UUIDField(null=True, blank=True, db_index=True)
    recurring_occurrence = models.OneToOneField(
        RecurringOccurrence, null=True, blank=True, on_delete=models.SET_NULL, related_name="transaction"
    )
    fingerprint = models.CharField(max_length=64, blank=True, db_index=True)
    allocation_revision = models.PositiveIntegerField(default=0)
    archived = models.BooleanField("archivado", default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-created_at"]
        indexes = [models.Index(fields=["archived", "date", "kind"])]
        verbose_name = "movimiento"
        verbose_name_plural = "movimientos"

    def clean(self):
        if self.category_id:
            expected = Category.Kind.INCOME if self.kind == self.Kind.INCOME else Category.Kind.EXPENSE
            if self.kind in {self.Kind.INCOME, self.Kind.EXPENSE} and self.category.kind != expected:
                raise ValidationError("La categoría no corresponde al tipo de movimiento.")
        if self.kind in {self.Kind.TRANSFER_IN, self.Kind.TRANSFER_OUT} and self.category_id:
            raise ValidationError("Los traspasos no llevan categoría.")
        if self.refund_for_id:
            if self.kind != self.Kind.INCOME:
                raise ValidationError({"refund_for": "Solo un ingreso puede marcarse como reembolso."})
            if self.refund_for_id == self.pk:
                raise ValidationError({"refund_for": "Un movimiento no puede reembolsarse a sí mismo."})
            if self.refund_for.kind != self.Kind.EXPENSE:
                raise ValidationError({"refund_for": "El reembolso debe apuntar a un gasto."})
            if self.refund_for.transfer_group:
                raise ValidationError({"refund_for": "No puedes asociar un reembolso a un traspaso."})
            existing_refund = (
                Transaction.objects.filter(pk=self.pk).values("refund_for_id", "date").first()
                if self.pk
                else None
            )
            existing_refund_target = existing_refund["refund_for_id"] if existing_refund else None
            if self.refund_for.archived and existing_refund_target != self.refund_for_id:
                raise ValidationError({"refund_for": "No puedes asociar un reembolso a un gasto archivado."})
            unchanged_legacy_date = (
                existing_refund_target == self.refund_for_id
                and existing_refund
                and existing_refund["date"] == self.date
            )
            if self.date and self.date < self.refund_for.date and not unchanged_legacy_date:
                raise ValidationError({"date": "El reembolso no puede ser anterior al gasto original."})
        if self.pk:
            linked_refunds = Transaction.objects.filter(refund_for_id=self.pk)
            first_refund_date = linked_refunds.order_by("date").values_list("date", flat=True).first()
            was_archived = Transaction.objects.filter(pk=self.pk).values_list("archived", flat=True).first()
            if first_refund_date and self.kind != self.Kind.EXPENSE:
                raise ValidationError({"kind": "Un gasto con reembolsos asociados no puede convertirse en ingreso."})
            if first_refund_date and self.date and self.date > first_refund_date:
                raise ValidationError({"date": "La fecha del gasto no puede ser posterior a uno de sus reembolsos."})
            if self.archived and was_archived is False and linked_refunds.filter(archived=False).exists():
                raise ValidationError({"archived": "Archiva primero los reembolsos asociados a este gasto."})

    def save(self, *args, **kwargs):
        if self._state.adding and self.kind in {self.Kind.TRANSFER_IN, self.Kind.TRANSFER_OUT} and not self.transfer_group:
            raise ValidationError({"transfer_group": "Todo traspaso nuevo debe crearse como un par interno."})
        self.fingerprint = self.make_fingerprint(self.account_id, self.date, self.description, self.amount, self.kind)
        super().save(*args, **kwargs)

    @staticmethod
    def make_fingerprint(account_id, tx_date, description, amount, kind):
        normalized = f"{account_id}|{tx_date}|{' '.join(description.lower().split())}|{Decimal(amount):.2f}|{kind}"
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    @property
    def signed_amount(self):
        if self.kind in {self.Kind.EXPENSE, self.Kind.TRANSFER_OUT}:
            return -self.amount
        return self.amount

    def __str__(self):
        return f"{self.date:%d/%m/%Y} · {self.description}"

    @property
    def is_refund(self):
        return bool(self.refund_for_id)


class TransactionAllocation(models.Model):
    transaction = models.ForeignKey(Transaction, on_delete=models.CASCADE, related_name="allocations")
    category = models.ForeignKey(
        Category,
        verbose_name="categoría",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="transaction_allocations",
    )
    amount = models.DecimalField("importe asignado", validators=[MinValueValidator(Decimal("0.01"))], **MONEY)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "pk"]
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="tx_alloc_amount_positive"),
            models.UniqueConstraint(fields=["transaction", "position"], name="tx_alloc_position_unique"),
        ]
        verbose_name = "partida de movimiento"
        verbose_name_plural = "partidas de movimientos"

    def __str__(self):
        return f"{self.transaction_id} · {self.amount:.2f}"


class Attachment(models.Model):
    transaction = models.ForeignKey(Transaction, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(
        "archivo",
        upload_to=attachment_path,
        validators=[FileExtensionValidator(["jpg", "jpeg", "png", "webp", "pdf"]), validate_file_size],
    )
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "adjunto"
        verbose_name_plural = "adjuntos"

    def __str__(self):
        return self.original_name


class Budget(models.Model):
    month = models.DateField("mes")
    category = models.ForeignKey(Category, verbose_name="categoría", on_delete=models.CASCADE, related_name="budgets")
    limit = models.DecimalField("límite", validators=[MinValueValidator(Decimal("0.01"))], **MONEY)

    class Meta:
        ordering = ["-month", "category__name"]
        constraints = [models.UniqueConstraint(fields=["month", "category"], name="unique_month_category_budget")]
        verbose_name = "presupuesto"
        verbose_name_plural = "presupuestos"

    def clean(self):
        if self.category_id and self.category.kind != Category.Kind.EXPENSE:
            raise ValidationError("Solo se pueden presupuestar categorías de gasto.")

    def save(self, *args, **kwargs):
        self.month = first_day(self.month)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.category} · {self.month:%m/%Y}"


class SavingsGoal(models.Model):
    percentage = models.DecimalField(
        "porcentaje", default=20, max_digits=5, decimal_places=2, validators=[MinValueValidator(0), MaxValueValidator(100)]
    )
    minimum = models.DecimalField("mínimo mensual", default=0, validators=[MinValueValidator(0)], **MONEY)
    active = models.BooleanField("activo", default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "objetivo de ahorro"
        verbose_name_plural = "objetivos de ahorro"

    def __str__(self):
        return f"{self.percentage}% o {self.minimum} €"


class SavingsObjective(models.Model):
    name = models.CharField("objetivo", max_length=100)
    target_amount = models.DecimalField(
        "importe objetivo", validators=[MinValueValidator(Decimal("0.01"))], **MONEY
    )
    target_date = models.DateField("fecha objetivo")
    priority = models.PositiveSmallIntegerField(
        "prioridad", default=2, validators=[MinValueValidator(1), MaxValueValidator(3)]
    )
    assigned_amount = models.DecimalField(
        "importe asignado", default=Decimal("0.00"), validators=[MinValueValidator(Decimal("0.00"))], **MONEY
    )
    recurring_rule = models.OneToOneField(
        RecurringRule, null=True, blank=True, on_delete=models.SET_NULL, related_name="savings_objective"
    )
    archived = models.BooleanField("archivado", default=False)
    idempotency_key = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    create_digest = models.CharField(max_length=64, blank=True, default="", editable=False)
    revision = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(target_amount__gt=0), name="savings_objective_target_positive"),
            models.CheckConstraint(condition=models.Q(assigned_amount__gte=0), name="savings_objective_assigned_nonnegative"),
            models.CheckConstraint(condition=models.Q(priority__gte=1, priority__lte=3), name="savings_objective_priority_range"),
        ]
        ordering = ["archived", "priority", "target_date", "pk"]
        verbose_name = "meta de ahorro"
        verbose_name_plural = "metas de ahorro"

    @property
    def achieved(self):
        return self.assigned_amount >= self.target_amount

    def __str__(self):
        return self.name


class ImportProfile(models.Model):
    name = models.CharField("nombre", max_length=80, unique=True)
    delimiter = models.CharField("separador", max_length=1, default=",")
    date_format = models.CharField("formato de fecha", max_length=30, default="%Y-%m-%d")
    date_column = models.CharField("columna fecha", max_length=80, default="date")
    description_column = models.CharField("columna concepto", max_length=80, default="description")
    amount_column = models.CharField("columna importe", max_length=80, default="amount")
    category_column = models.CharField("columna categoría", max_length=80, default="category", blank=True)
    subcategory_column = models.CharField("columna subcategoría", max_length=80, default="subcategory", blank=True)

    class Meta:
        verbose_name = "perfil de importación"
        verbose_name_plural = "perfiles de importación"

    def __str__(self):
        return self.name


class ImportBatch(models.Model):
    class Status(models.TextChoices):
        REVIEW = "review", "En revisión"
        COMPLETED = "completed", "Completada"

    filename = models.CharField(max_length=255)
    account = models.ForeignKey(Account, on_delete=models.PROTECT)
    profile = models.ForeignKey(ImportProfile, null=True, blank=True, on_delete=models.SET_NULL)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.REVIEW)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "lote de importación"
        verbose_name_plural = "lotes de importación"

    def __str__(self):
        return self.filename


class ImportRow(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pendiente"
        IMPORTED = "imported", "Importada"
        SKIPPED = "skipped", "Omitida"

    batch = models.ForeignKey(ImportBatch, on_delete=models.CASCADE, related_name="rows")
    row_number = models.PositiveIntegerField()
    date = models.DateField()
    description = models.CharField(max_length=180)
    amount = models.DecimalField(**MONEY)
    kind = models.CharField(max_length=10, choices=Category.Kind.choices)
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.PROTECT)
    fingerprint = models.CharField(max_length=64, db_index=True)
    possible_duplicate = models.BooleanField(default=False)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    transaction = models.OneToOneField(Transaction, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ["row_number"]
        constraints = [models.UniqueConstraint(fields=["batch", "row_number"], name="unique_batch_row")]
        verbose_name = "fila importada"
        verbose_name_plural = "filas importadas"

    def __str__(self):
        return f"{self.row_number} · {self.description}"


class BankTransaction(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pendiente"
        IMPORTED = "imported", "Importada"
        SKIPPED = "skipped", "Omitida"

    bank_account = models.ForeignKey(BankAccount, on_delete=models.CASCADE, related_name="bank_transactions")
    remote_id = models.CharField(max_length=240)
    booking_date = models.DateField()
    description = models.CharField(max_length=240)
    amount = models.DecimalField(**MONEY)
    kind = models.CharField(max_length=10, choices=Category.Kind.choices)
    currency = models.CharField(max_length=3, default="EUR")
    fingerprint = models.CharField(max_length=64, db_index=True)
    possible_duplicate = models.BooleanField(default=False)
    possible_transfer = models.BooleanField(default=False)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.PROTECT)
    transaction = models.OneToOneField(Transaction, null=True, blank=True, on_delete=models.SET_NULL)
    fee_transaction = models.OneToOneField(
        Transaction, null=True, blank=True, on_delete=models.SET_NULL, related_name="bank_transfer_fee_origin"
    )
    raw_summary = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-booking_date", "-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["bank_account", "remote_id"], name="unique_bank_remote_transaction")
        ]

    def __str__(self):
        return f"{self.booking_date:%d/%m/%Y} · {self.description}"


class CategoryPrediction(models.Model):
    class Status(models.TextChoices):
        SUGGESTED = "suggested", "Sugerida"
        APPLIED = "applied", "Aplicada"
        ACCEPTED = "accepted", "Aceptada"
        REJECTED = "rejected", "Rechazada"
        FAILED = "failed", "Fallida"

    bank_transaction = models.OneToOneField(BankTransaction, on_delete=models.CASCADE, related_name="prediction")
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.SET_NULL)
    model_name = models.CharField(max_length=100)
    confidence = models.DecimalField(default=0, max_digits=4, decimal_places=3)
    reason = models.CharField(max_length=240, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.SUGGESTED)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class BankSyncRun(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "En cola"
        RUNNING = "running", "En curso"
        COMPLETED = "completed", "Completada"
        FAILED = "failed", "Fallida"

    connection = models.ForeignKey(BankConnection, null=True, blank=True, on_delete=models.SET_NULL)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.RUNNING)
    imported_count = models.PositiveIntegerField(default=0)
    pending_count = models.PositiveIntegerField(default=0)
    error = models.CharField(max_length=240, blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["connection"],
                condition=models.Q(status__in=["queued", "running"]),
                name="unique_active_bank_sync_connection",
            )
        ]


class AutomationSettings(models.Model):
    llm_enabled = models.BooleanField(default=True)
    auto_apply_enabled = models.BooleanField(default=False)
    confidence_threshold = models.DecimalField(default=Decimal("0.900"), max_digits=4, decimal_places=3)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "automation settings"
