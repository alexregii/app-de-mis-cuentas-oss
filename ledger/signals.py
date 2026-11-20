import os
from datetime import date

from django.db.backends.signals import connection_created
from django.db.utils import OperationalError
from django.db.models import F
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import Category, MonthlyFinancialAggregate, Transaction


@receiver(connection_created)
def configure_sqlite(sender, connection, **kwargs):
    if connection.vendor != "sqlite":
        return
    with connection.cursor() as cursor:
        cursor.execute("PRAGMA foreign_keys = ON;")
        cursor.execute("PRAGMA busy_timeout = 20000;")
        journal_mode = os.getenv("SQLITE_JOURNAL_MODE", "WAL").upper()
        if journal_mode not in {"DELETE", "WAL", "TRUNCATE", "PERSIST", "MEMORY", "OFF"}:
            journal_mode = "WAL"
        cursor.execute(f"PRAGMA journal_mode = {journal_mode};")
        synchronous = os.getenv("SQLITE_SYNCHRONOUS", "FULL").upper()
        if synchronous in {"OFF", "NORMAL", "FULL", "EXTRA"}:
            cursor.execute(f"PRAGMA synchronous = {synchronous};")
        if os.getenv("SQLITE_OPTIMIZE", "1") == "1":
            try:
                cursor.execute("PRAGMA optimize;")
            except OperationalError:
                # Statistics maintenance is useful but must not prevent a
                # request from opening its connection during a write burst.
                pass


def _mark_months_dirty(*dates):
    normalized = [date.fromisoformat(value) if isinstance(value, str) else value for value in dates if value]
    months = {value.replace(day=1) for value in normalized}
    if months:
        MonthlyFinancialAggregate.objects.filter(month__in=months).update(
            dirty=True,
            dirty_version=F("dirty_version") + 1,
        )


@receiver(post_save, sender=Transaction)
@receiver(post_delete, sender=Transaction)
def invalidate_financial_aggregates(sender, instance, **kwargs):
    target_date = None
    if instance.refund_for_id:
        target_date = getattr(getattr(instance, "refund_for", None), "date", None)
        if target_date is None:
            target_date = Transaction.objects.filter(pk=instance.refund_for_id).values_list("date", flat=True).first()
    refund_dates = ()
    relevant_fields = kwargs.get("update_fields")
    allocation_inputs = {"kind", "amount", "category", "archived", "refund_for", "allocation_revision"}
    if (
        instance.kind == Transaction.Kind.EXPENSE
        and not instance.refund_for_id
        and (relevant_fields is None or allocation_inputs.intersection(relevant_fields))
    ):
        refund_dates = Transaction.objects.filter(refund_for_id=instance.pk, archived=False).values_list("date", flat=True)
    _mark_months_dirty(instance.date, target_date, *refund_dates)


@receiver(post_save, sender=Category)
@receiver(post_delete, sender=Category)
def invalidate_financial_aggregates_for_category(sender, **kwargs):
    MonthlyFinancialAggregate.objects.all().update(
        dirty=True,
        dirty_version=F("dirty_version") + 1,
    )
