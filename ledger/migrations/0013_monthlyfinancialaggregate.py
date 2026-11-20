from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("ledger", "0012_reconciliation_history")]

    operations = [
        migrations.CreateModel(
            name="MonthlyFinancialAggregate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("month", models.DateField()),
                ("basis", models.CharField(max_length=10)),
                ("income", models.DecimalField(decimal_places=2, max_digits=14)),
                ("gross_expense", models.DecimalField(decimal_places=2, max_digits=14)),
                ("refunds_applied", models.DecimalField(decimal_places=2, max_digits=14)),
                ("extra_income", models.DecimalField(decimal_places=2, max_digits=14)),
                ("payload", models.JSONField(default=dict)),
                ("dirty", models.BooleanField(default=True)),
                ("calculated_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={"ordering": ["month", "basis"]},
        ),
        migrations.AddConstraint(
            model_name="monthlyfinancialaggregate",
            constraint=models.UniqueConstraint(fields=("month", "basis"), name="unique_financial_aggregate_month_basis"),
        ),
    ]
