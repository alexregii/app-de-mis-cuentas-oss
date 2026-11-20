"""Safe renewal of an existing Enable Banking connection.

Reauthorization is intentionally different from creating a connection: the
local Account and BankAccount identities are durable financial history and must
survive provider session/UID rotation.
"""

from django.db import transaction
from django.utils.dateparse import parse_datetime

from .banking_staging import normalize_description
from .models import BankConnection, BankSyncRun


ACTIVE_SYNC_STATUSES = (BankSyncRun.Status.QUEUED, BankSyncRun.Status.RUNNING)


def _remote_display(remote, bank_name):
    return normalize_description(
        remote.get("name")
        or remote.get("details")
        or f"{bank_name} {str(remote.get('uid') or '')[-4:]}"
    )


def _authorized_eur_accounts(session_data):
    return [
        remote
        for remote in session_data.get("accounts", [])
        if remote.get("uid") and remote.get("currency", "EUR") == "EUR"
    ]


def _match_remote_accounts(connection, links, remotes):
    if len(links) != len(remotes):
        raise ValueError(
            "La nueva autorización no expone el mismo número de cuentas EUR que la conexión existente."
        )

    unmatched_links = list(links)
    unmatched_remotes = list(remotes)
    matches = []

    # Some providers keep the account UID stable across consent renewals. Use
    # that strongest signal first when available.
    for link in list(unmatched_links):
        candidates = [remote for remote in unmatched_remotes if remote.get("uid") == link.remote_uid]
        if len(candidates) == 1:
            remote = candidates[0]
            matches.append((link, remote))
            unmatched_links.remove(link)
            unmatched_remotes.remove(remote)

    # Fall back to a unique normalized display identity. This is useful for
    # multi-account consents where the provider rotates session-scoped UIDs.
    for link in list(unmatched_links):
        expected = normalize_description(link.display_name).casefold()
        candidates = [
            remote
            for remote in unmatched_remotes
            if _remote_display(remote, connection.bank_name).casefold() == expected
        ]
        if len(candidates) == 1:
            remote = candidates[0]
            matches.append((link, remote))
            unmatched_links.remove(link)
            unmatched_remotes.remove(remote)

    # The common single-account case is safe even if the display label changed.
    if len(unmatched_links) == len(unmatched_remotes) == 1:
        matches.append((unmatched_links.pop(), unmatched_remotes.pop()))

    if unmatched_links or unmatched_remotes:
        raise ValueError(
            "No se puede determinar de forma inequívoca qué cuenta bancaria nueva corresponde a cada cuenta existente."
        )
    return matches


@transaction.atomic
def reconnect_connection(connection, session_data):
    """Replace provider session/account identifiers without replacing history."""
    connection = BankConnection.objects.select_for_update().get(pk=connection.pk)
    if BankSyncRun.objects.filter(connection=connection, status__in=ACTIVE_SYNC_STATUSES).exists():
        raise ValueError("Hay una sincronización bancaria activa. Espera a que termine antes de reconectar.")

    session_id = str(session_data.get("session_id") or "").strip()
    if not session_id:
        raise ValueError("Enable Banking no devolvió un identificador de sesión válido.")
    if BankConnection.objects.exclude(pk=connection.pk).filter(session_id=session_id).exists():
        raise ValueError("La nueva sesión bancaria ya está asociada a otra conexión local.")

    aspsp = session_data.get("aspsp") or {}
    remote_bank_name = str(aspsp.get("name") or "").strip()
    remote_bank_country = str(aspsp.get("country") or "").strip().upper()
    if remote_bank_name and remote_bank_name.casefold() != connection.bank_name.casefold():
        raise ValueError("La nueva autorización pertenece a un banco distinto de la conexión existente.")
    if remote_bank_country and remote_bank_country != connection.bank_country.upper():
        raise ValueError("La nueva autorización pertenece a un país distinto de la conexión existente.")

    links = list(connection.bank_accounts.select_for_update().order_by("pk"))
    if not links:
        raise ValueError("La conexión existente no tiene cuentas bancarias locales que reconectar.")
    remotes = _authorized_eur_accounts(session_data)
    matches = _match_remote_accounts(connection, links, remotes)

    for link, remote in matches:
        remote_uid = str(remote["uid"])
        conflict = type(link).objects.exclude(pk=link.pk).filter(remote_uid=remote_uid).exists()
        if conflict:
            raise ValueError("Una cuenta de la nueva autorización ya está asociada a otra cuenta local.")

    for link, remote in matches:
        remote_uid = str(remote["uid"])
        identity_rotated = link.remote_uid != remote_uid
        link.remote_uid = remote_uid
        link.display_name = _remote_display(remote, connection.bank_name)
        link.currency = remote.get("currency", "EUR")
        update_fields = ["remote_uid", "display_name", "currency"]
        if identity_rotated:
            link.remote_balance = None
            link.balance_updated_at = None
            link.remote_balance_type = ""
            link.remote_balance_currency = ""
            link.remote_balance_reference_date = None
            link.balance_provenance_updated_at = None
            update_fields.extend(
                [
                    "remote_balance",
                    "balance_updated_at",
                    "remote_balance_type",
                    "remote_balance_currency",
                    "remote_balance_reference_date",
                    "balance_provenance_updated_at",
                ]
            )
        link.save(update_fields=update_fields)

    valid_until = session_data.get("access", {}).get("valid_until")
    connection.session_id = session_id
    connection.authorized_until = parse_datetime(valid_until) if valid_until else None
    connection.status = BankConnection.Status.AUTHORIZED
    connection.sync_status = BankConnection.SyncStatus.IDLE
    connection.sync_started_at = None
    connection.last_error = ""
    connection.save(
        update_fields=[
            "session_id",
            "authorized_until",
            "status",
            "sync_status",
            "sync_started_at",
            "last_error",
        ]
    )
    return connection
