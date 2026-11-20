from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("ledger", "0006_bankconnection_sync_status"),
    ]

    operations = [
        migrations.CreateModel(
            name="DashboardPreferences",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("widget_order", models.JSONField(blank=True, default=list)),
                ("hidden_widgets", models.JSONField(blank=True, default=list)),
                ("density", models.CharField(choices=[("normal", "Normal"), ("compact", "Compacto")], default="normal", max_length=10)),
                ("content_mode", models.CharField(choices=[("full", "Completo"), ("balance", "Solo saldo"), ("review", "Revisión rápida")], default="full", max_length=10)),
                ("last_snapshot_month", models.CharField(blank=True, max_length=7)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.OneToOneField(blank=True, null=True, on_delete=models.deletion.CASCADE, related_name="dashboard_preferences", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name="MonthlyDashboardSnapshot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("month", models.CharField(max_length=7)),
                ("payload", models.JSONField(default=dict)),
                ("captured_at", models.DateTimeField(auto_now=True)),
                ("user", models.ForeignKey(blank=True, null=True, on_delete=models.deletion.CASCADE, related_name="dashboard_snapshots", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-month"]},
        ),
        migrations.AddConstraint(
            model_name="monthlydashboardsnapshot",
            constraint=models.UniqueConstraint(fields=("user", "month"), name="unique_dashboard_snapshot_user_month"),
        ),
    ]
