from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("ledger", "0011_reconciliationsnapshot")]
    operations = [migrations.RemoveConstraint(model_name="reconciliationsnapshot", name="unique_reconciliation_snapshot_account_date")]
