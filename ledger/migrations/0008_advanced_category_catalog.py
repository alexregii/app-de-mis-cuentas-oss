import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("ledger", "0007_dashboard_preferences_snapshot")]

    operations = [
        migrations.AddField(model_name="category", name="sort_order", field=models.IntegerField(default=0, verbose_name="orden")),
        migrations.AddField(model_name="category", name="is_favorite", field=models.BooleanField(default=False, verbose_name="favorita")),
        migrations.AddField(model_name="category", name="deactivated_at", field=models.DateTimeField(blank=True, null=True, verbose_name="desactivada el")),
        migrations.AddField(model_name="category", name="merged_into", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="merged_sources", to="ledger.category")),
        migrations.AddField(model_name="categoryrule", name="priority", field=models.PositiveIntegerField(default=100, verbose_name="prioridad")),
        migrations.AddField(model_name="categoryrule", name="match_mode", field=models.CharField(choices=[("exact", "Exacta"), ("contains", "Contiene"), ("starts_with", "Empieza por"), ("ends_with", "Termina en")], default="exact", max_length=16, verbose_name="modo")),
        migrations.AddField(model_name="categoryrule", name="account", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="category_rules", to="ledger.account")),
        migrations.AddField(model_name="categoryrule", name="amount_min", field=models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True)),
        migrations.AddField(model_name="categoryrule", name="amount_max", field=models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True)),
        migrations.AddField(model_name="categoryrule", name="last_tested_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="categoryrule", name="last_test_result", field=models.JSONField(blank=True, default=dict)),
        migrations.AddField(model_name="categoryrule", name="application_count", field=models.PositiveIntegerField(default=0)),
        migrations.CreateModel(name="CategoryMergeOperation", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("source_categories", models.JSONField(default=list)), ("operation_type", models.CharField(default="category_merge", max_length=24)), ("created_at", models.DateTimeField(auto_now_add=True)),
            ("transaction_count", models.PositiveIntegerField(default=0)), ("budget_count", models.PositiveIntegerField(default=0)), ("rule_count", models.PositiveIntegerField(default=0)), ("import_count", models.PositiveIntegerField(default=0)), ("status", models.CharField(choices=[("completed", "Completada"), ("undone", "Deshecha"), ("partial", "Parcial")], default="completed", max_length=12)), ("reversible", models.BooleanField(default=True)), ("snapshot", models.JSONField(blank=True, default=dict)),
            ("destination", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="merge_destinations", to="ledger.category")), ("user", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
        ]),
        migrations.CreateModel(name="CategoryRuleApplication", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")), ("applied_at", models.DateTimeField(auto_now_add=True)), ("filters_used", models.JSONField(blank=True, default=dict)), ("affected_records", models.JSONField(blank=True, default=list)), ("previous_values", models.JSONField(blank=True, default=list)), ("new_values", models.JSONField(blank=True, default=list)), ("status", models.CharField(choices=[("completed", "Completada"), ("undone", "Deshecha"), ("partial", "Parcial")], default="completed", max_length=12)), ("reversible", models.BooleanField(default=True)),
            ("rule", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="applications", to="ledger.categoryrule")),
        ]),
    ]
