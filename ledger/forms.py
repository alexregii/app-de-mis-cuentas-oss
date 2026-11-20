from datetime import date
from decimal import Decimal

from django import forms
from django.core.exceptions import ValidationError
from django.db.models import Q

from .models import (
    Account,
    Attachment,
    AutomationSettings,
    Budget,
    Category,
    CategoryRule,
    ImportProfile,
    RecurringRule,
    SavingsGoal,
    Tag,
    Transaction,
)


class StyledFormMixin:
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            if isinstance(field.widget, forms.CheckboxInput):
                field.widget.attrs["class"] = "checkbox"
            else:
                field.widget.attrs["class"] = "field"
                if isinstance(field.widget, (forms.TextInput, forms.Textarea, forms.NumberInput, forms.Select, forms.DateInput)):
                    field.widget.attrs.setdefault("autocomplete", "off")
                if isinstance(field, forms.DecimalField) or isinstance(field.widget, forms.NumberInput):
                    field.widget.attrs.setdefault("inputmode", "decimal")


class KindAwareSelect(forms.Select):
    def create_option(self, name, value, label, selected, index, subindex=None, attrs=None):
        option = super().create_option(name, value, label, selected, index, subindex=subindex, attrs=attrs)
        instance = getattr(value, "instance", None)
        if instance:
            option["attrs"]["data-kind"] = instance.kind
        return option


class AccountForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = Account
        fields = ["name", "kind", "opening_balance", "color", "active"]
        widgets = {"color": forms.TextInput(attrs={"type": "color"})}


class CategoryForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = Category
        fields = ["name", "kind", "parent", "color", "icon", "active", "exclude_from_analytics", "sort_order", "is_favorite"]
        widgets = {"color": forms.TextInput(attrs={"type": "color"})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["sort_order"].required = False
        self.fields["is_favorite"].required = False


class CategoryRuleForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = CategoryRule
        fields = ["description", "kind", "category", "priority", "match_mode", "account", "amount_min", "amount_max", "active"]
        widgets = {"category": KindAwareSelect()}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name in ["priority", "match_mode", "account", "amount_min", "amount_max"]:
            self.fields[name].required = False
        self.fields["category"].queryset = Category.objects.filter(active=True).select_related("parent")
        self.fields["account"].queryset = Account.objects.filter(active=True)


class TransactionForm(StyledFormMixin, forms.ModelForm):
    tag_names = forms.CharField(label="Etiquetas", required=False, help_text="Separadas por comas")
    attachment = forms.FileField(label="Ticket o factura", required=False)

    class Meta:
        model = Transaction
        fields = ["kind", "amount", "account", "date", "description", "category", "refund_for", "notes"]
        widgets = {
            "date": forms.DateInput(format="%Y-%m-%d", attrs={"type": "date"}),
            "amount": forms.NumberInput(attrs={"step": "0.01", "inputmode": "decimal"}),
            "category": KindAwareSelect(),
            "refund_for": forms.Select(),
            "notes": forms.Textarea(attrs={"rows": 3}),
        }

    def __init__(self, *args, compact=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["kind"].choices = [
            (Transaction.Kind.EXPENSE, "Gasto"),
            (Transaction.Kind.INCOME, "Ingreso"),
        ]
        self.fields["category"].queryset = Category.objects.filter(active=True).select_related("parent")
        refund_filter = Q(archived=False, kind=Transaction.Kind.EXPENSE, transfer_group__isnull=True)
        if self.instance and self.instance.pk and self.instance.refund_for_id:
            refund_filter |= Q(pk=self.instance.refund_for_id)
        refund_queryset = (
            Transaction.objects.filter(refund_filter)
            .select_related("account", "category", "category__parent")
            .order_by("-date", "-created_at")
        )
        reference_date = self.instance.date if self.instance and self.instance.pk else date.today()
        raw_date = self.data.get(self.add_prefix("date")) if self.is_bound else None
        if raw_date:
            try:
                reference_date = date.fromisoformat(str(raw_date))
            except ValueError:
                pass
        date_filter = Q(date__lte=reference_date)
        if self.instance and self.instance.pk and self.instance.refund_for_id:
            date_filter |= Q(pk=self.instance.refund_for_id)
        self.fields["refund_for"].queryset = refund_queryset.filter(date_filter)
        self.fields["refund_for"].required = False
        self.fields["refund_for"].help_text = "Opcional. Si este ingreso devuelve dinero de un gasto previo, selecciónalo aquí."
        self.fields["refund_for"].label_from_instance = (
            lambda movement: f"{movement.date:%d/%m/%Y} · {movement.description} · {movement.amount:.2f} €"
        )
        self.fields["account"].queryset = Account.objects.filter(active=True)
        if self.instance.pk:
            self.fields["tag_names"].initial = ", ".join(self.instance.tags.values_list("name", flat=True))
        if compact:
            self.fields["description"].required = False
            self.fields["description"].widget.attrs["placeholder"] = "Opcional…"
            keep = ["kind", "amount", "description", "account", "category"]
            self.fields = {name: self.fields[name] for name in keep}

    def clean(self):
        cleaned = super().clean()
        refund_for = cleaned.get("refund_for")
        kind = cleaned.get("kind")
        if refund_for and kind != Transaction.Kind.INCOME:
            self.add_error("refund_for", "Solo un ingreso puede marcarse como reembolso.")
        return cleaned

    def clean_attachment(self):
        upload = self.cleaned_data.get("attachment")
        if upload:
            allowed = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
            if upload.content_type not in allowed:
                raise ValidationError("Solo se permiten imágenes JPG/PNG/WEBP o PDF.")
            if upload.size > 10 * 1024 * 1024:
                raise ValidationError("El archivo no puede superar 10 MB.")
        return upload

    def save(self, commit=True, *, force_update=False):
        if force_update and not commit:
            raise ValueError("Una edición existente debe guardarse para poder forzar el UPDATE.")
        movement = super().save(commit=False if force_update else commit)
        if force_update:
            movement.save(force_update=True)
            self.save_m2m()
        if not commit:
            return movement
        names = [name.strip()[:40] for name in self.cleaned_data.get("tag_names", "").split(",") if name.strip()]
        movement.tags.set([Tag.objects.get_or_create(name=name)[0] for name in names])
        upload = self.cleaned_data.get("attachment")
        if upload:
            Attachment.objects.create(
                transaction=movement,
                file=upload,
                original_name=upload.name,
                content_type=getattr(upload, "content_type", ""),
            )
        return movement


class TransferForm(StyledFormMixin, forms.Form):
    source_account = forms.ModelChoiceField(label="Cuenta de origen", queryset=Account.objects.none())
    target_account = forms.ModelChoiceField(label="Cuenta de destino", queryset=Account.objects.none())
    amount = forms.DecimalField(label="Importe", min_value=Decimal("0.01"), decimal_places=2, max_digits=14)
    date = forms.DateField(label="Fecha", initial=date.today, widget=forms.DateInput(attrs={"type": "date"}))
    description = forms.CharField(label="Concepto", max_length=180, initial="Traspaso")
    notes = forms.CharField(label="Notas", required=False, widget=forms.Textarea(attrs={"rows": 3}))

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        accounts = Account.objects.filter(active=True)
        self.fields["source_account"].queryset = accounts
        self.fields["target_account"].queryset = accounts

    def clean(self):
        cleaned = super().clean()
        if cleaned.get("source_account") == cleaned.get("target_account"):
            self.add_error("target_account", "Selecciona una cuenta diferente.")
        return cleaned


class BudgetForm(StyledFormMixin, forms.ModelForm):
    month = forms.DateField(
        label="Mes",
        input_formats=["%Y-%m", "%Y-%m-%d"],
        widget=forms.DateInput(format="%Y-%m", attrs={"type": "month"}),
    )

    class Meta:
        model = Budget
        fields = ["month", "category", "limit"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["category"].queryset = Category.objects.filter(kind=Category.Kind.EXPENSE, active=True).select_related("parent")

    def clean_month(self):
        value = self.cleaned_data["month"]
        return value.replace(day=1)


class RecurringRuleForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = RecurringRule
        fields = [
            "name",
            "kind",
            "amount",
            "account",
            "category",
            "frequency",
            "day_of_month",
            "start_date",
            "end_date",
            "notes",
            "active",
        ]
        widgets = {
            "category": KindAwareSelect(),
            "start_date": forms.DateInput(attrs={"type": "date"}),
            "end_date": forms.DateInput(attrs={"type": "date"}),
            "notes": forms.Textarea(attrs={"rows": 3}),
        }


class SavingsGoalForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = SavingsGoal
        fields = ["percentage", "minimum", "active"]


class AutomationSettingsForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = AutomationSettings
        fields = ["llm_enabled", "auto_apply_enabled", "confidence_threshold"]


class ImportProfileForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = ImportProfile
        fields = [
            "name",
            "delimiter",
            "date_format",
            "date_column",
            "description_column",
            "amount_column",
            "category_column",
            "subcategory_column",
        ]


class CSVUploadForm(StyledFormMixin, forms.Form):
    account = forms.ModelChoiceField(label="Cuenta", queryset=Account.objects.none())
    profile = forms.ModelChoiceField(label="Perfil de importación", queryset=ImportProfile.objects.none())
    file = forms.FileField(label="Archivo CSV")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["account"].queryset = Account.objects.filter(active=True)
        self.fields["profile"].queryset = ImportProfile.objects.all()

    def clean_file(self):
        upload = self.cleaned_data["file"]
        if not upload.name.lower().endswith(".csv"):
            raise ValidationError("Selecciona un archivo CSV.")
        if upload.size > 5 * 1024 * 1024:
            raise ValidationError("El CSV no puede superar 5 MB.")
        return upload
