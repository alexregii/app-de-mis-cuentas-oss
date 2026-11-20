from django.apps import AppConfig


class LedgerConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "ledger"
    verbose_name = "Mis cuentas"

    def ready(self):
        from . import signals  # noqa: F401
