"""Non-JSON backend routes intentionally exposed through the React reverse proxy."""

from django.urls import path

from . import banking_callback_views, runtime_views

urlpatterns = [
    path("bancos/enable-banking/callback/", banking_callback_views.bank_callback, name="bank_callback"),
    path("exportar/excel/", runtime_views.export_excel, name="export_excel"),
    path("adjuntos/<int:pk>/", runtime_views.attachment_download, name="attachment_download"),
    path("health/", runtime_views.health, name="health"),
]
