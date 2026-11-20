from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("ledger", "0005_transaction_refund_for"),
    ]

    operations = [
        migrations.AddField(
            model_name="bankconnection",
            name="sync_status",
            field=models.CharField(
                choices=[
                    ("idle", "Sincronizada"),
                    ("syncing", "Sincronizando"),
                    ("error", "Error de sincronización"),
                ],
                default="idle",
                max_length=12,
            ),
        ),
        migrations.AddField(
            model_name="bankconnection",
            name="sync_started_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
