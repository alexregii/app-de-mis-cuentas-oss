from django.db import migrations, models
from django.utils import timezone


def collapse_duplicate_active_sync_runs(apps, schema_editor):
    BankSyncRun = apps.get_model("ledger", "BankSyncRun")
    active_statuses = {"queued", "running"}
    connection_ids = (
        BankSyncRun.objects.filter(status__in=active_statuses, connection_id__isnull=False)
        .values_list("connection_id", flat=True)
        .distinct()
    )
    for connection_id in connection_ids:
        active_runs = list(
            BankSyncRun.objects.filter(
                connection_id=connection_id,
                status__in=active_statuses,
            ).order_by("started_at", "pk")
        )
        for duplicate in active_runs[1:]:
            duplicate.status = "failed"
            duplicate.error = "Ejecución activa duplicada cerrada durante la migración."
            duplicate.finished_at = timezone.now()
            duplicate.save(update_fields=["status", "error", "finished_at"])


class Migration(migrations.Migration):
    dependencies = [("ledger", "0013_monthlyfinancialaggregate")]

    operations = [
        migrations.AddField(
            model_name="monthlyfinancialaggregate",
            name="dirty_version",
            field=models.PositiveBigIntegerField(default=0),
        ),
        migrations.AlterField(
            model_name="banksyncrun",
            name="status",
            field=models.CharField(
                choices=[
                    ("queued", "En cola"),
                    ("running", "En curso"),
                    ("completed", "Completada"),
                    ("failed", "Fallida"),
                ],
                default="running",
                max_length=12,
            ),
        ),
        migrations.RunPython(collapse_duplicate_active_sync_runs, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="banksyncrun",
            constraint=models.UniqueConstraint(
                condition=models.Q(status__in=["queued", "running"]),
                fields=("connection",),
                name="unique_active_bank_sync_connection",
            ),
        ),
    ]
