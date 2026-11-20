from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ledger", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="importprofile",
            name="category_column",
            field=models.CharField(blank=True, default="category", max_length=80, verbose_name="columna categoría"),
        ),
        migrations.AddField(
            model_name="importprofile",
            name="subcategory_column",
            field=models.CharField(blank=True, default="subcategory", max_length=80, verbose_name="columna subcategoría"),
        ),
    ]
