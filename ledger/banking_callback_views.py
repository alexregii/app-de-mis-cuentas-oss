"""Runtime callback endpoints required by the React banking flow."""

from urllib.parse import urlsplit, urlunsplit

from django.core import signing
from django.shortcuts import redirect
from django.views.decorators.http import require_GET

from .api_serializers import merge_query_params
from .banking import sync_connection
from .banking_client import EnableBankingClient
from .banking_reconnect import reconnect_connection
from .banking_staging import create_connection
from .models import BankConnection, BankSyncRun


def _safe_return_target(request, raw_target):
    fallback = "/?tab=accounts"
    target = str(raw_target or "").strip()
    if not target:
        return fallback

    parts = urlsplit(target)
    if parts.scheme or parts.netloc:
        if parts.scheme not in {"http", "https"} or parts.netloc != request.get_host():
            return fallback
        return urlunsplit(("", "", parts.path or "/", parts.query, parts.fragment))

    if not target.startswith("/") or target.startswith("//"):
        return fallback
    return target


def _accounts_redirect(request, target, *, notice, message):
    return redirect(
        merge_query_params(
            _safe_return_target(request, target),
            tab="accounts",
            bank_notice=notice,
            bank_message=message,
        )
    )


@require_GET
def bank_callback(request):
    try:
        bank = signing.loads(
            request.GET.get("state", ""),
            salt="enable-banking-auth",
            max_age=30 * 60,
        )
    except signing.BadSignature:
        return _accounts_redirect(
            request,
            None,
            notice="error",
            message="No se pudo verificar la respuesta de autorización.",
        )

    next_url = bank.get("next_url")
    if request.GET.get("error"):
        return _accounts_redirect(
            request,
            next_url,
            notice="error",
            message="La autorización bancaria no se completó. Puedes volver a intentarlo.",
        )

    try:
        session_data = EnableBankingClient().create_session(request.GET["code"])
        reconnect_connection_id = bank.get("reconnect_connection_id")
        if reconnect_connection_id:
            connection = reconnect_connection(
                BankConnection.objects.get(pk=reconnect_connection_id),
                session_data,
            )
            success_message = "Cuenta bancaria reconectada y sincronizada."
            success_notice = "reconnected"
        else:
            connection = create_connection(session_data, bank.get("name", "Banco"), bank.get("country", "ES"))
            success_message = "Cuenta bancaria conectada y sincronizada."
            success_notice = "connected"
        run = sync_connection(connection)
        if run.status == BankSyncRun.Status.FAILED:
            return _accounts_redirect(
                request,
                next_url,
                notice="error",
                message="La autorización se completó, pero no se pudo sincronizar. Revisa Cuentas y vuelve a intentarlo.",
            )
    except Exception:
        return _accounts_redirect(
            request,
            next_url,
            notice="error",
            message="No se pudo completar la conexión bancaria. Revisa Cuentas y vuelve a intentarlo.",
        )

    return _accounts_redirect(
        request,
        next_url,
        notice=success_notice,
        message=success_message,
    )
