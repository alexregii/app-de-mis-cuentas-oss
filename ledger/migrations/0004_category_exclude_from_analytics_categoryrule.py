# Generated manually for analytics exclusions and category rules.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("ledger", "0003_automationsettings_bankconnection_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="category",
            name="exclude_from_analytics",
            field=models.BooleanField(default=False, verbose_name="excluir de estadísticas"),
        ),
        migrations.CreateModel(
            name="CategoryRule",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("description", models.CharField(max_length=180, verbose_name="descripción")),
                ("normalized_description", models.CharField(editable=False, max_length=180)),
                ("kind", models.CharField(choices=[("income", "Ingreso"), ("expense", "Gasto")], max_length=10, verbose_name="tipo")),
                ("active", models.BooleanField(default=True, verbose_name="activa")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "category",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="rules",
                        to="ledger.category",
                        verbose_name="categoría",
                    ),
                ),
            ],
            options={
                "verbose_name": "regla de categoría",
                "verbose_name_plural": "reglas de categoría",
                "ordering": ["description"],
            },
        ),
        migrations.AddConstraint(
            model_name="categoryrule",
            constraint=models.UniqueConstraint(
                fields=("normalized_description", "kind"),
                name="unique_category_rule_description_kind",
            ),
        ),
    ]
