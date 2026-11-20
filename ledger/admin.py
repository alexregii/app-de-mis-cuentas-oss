from django.contrib import admin

from .models import (
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


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ("date", "description", "account", "kind", "amount", "category", "archived")
    list_filter = ("kind", "account", "archived", "source")
    search_fields = ("description", "notes")
    date_hierarchy = "date"


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "parent", "active")
    list_filter = ("kind", "active")


admin.site.register(
    [
        Account,
        Attachment,
        AutomationSettings,
        BankAccount,
        BankConnection,
        BankSyncRun,
        BankTransaction,
        Budget,
        ImportBatch,
        ImportProfile,
        ImportRow,
        CategoryPrediction,
        RecurringOccurrence,
        RecurringRule,
        SavingsGoal,
        Tag,
    ]
)
