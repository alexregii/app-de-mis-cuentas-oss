from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("ledger", "0004_category_exclude_from_analytics_categoryrule"),
    ]

    operations = [
        migrations.AddField(
            model_name="transaction",
            name="refund_for",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="refunds",
                to="ledger.transaction",
                verbose_name="reembolso de",
            ),
        ),
    ]
