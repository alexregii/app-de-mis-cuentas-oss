"""Stable archive contract shared by backup creation and restore validation."""

from __future__ import annotations

import json
from pathlib import PurePosixPath
from zipfile import ZipFile, ZipInfo

BACKUP_FORMAT = "mis-cuentas-backup"
BACKUP_VERSION = 1
DATABASE_ENTRY = "db.sqlite3"
MANIFEST_ENTRY = "manifest.json"
MEDIA_ROOT_ENTRY = "media"


def _normalized_name(raw: str) -> str:
    if "\\" in raw:
        raise ValueError("La copia contiene rutas no canónicas.")
    value = raw[:-1] if raw.endswith("/") else raw
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("La copia contiene rutas inseguras.")
    normalized = path.as_posix()
    if value != normalized:
        raise ValueError("La copia contiene rutas no canónicas.")
    return normalized


def validate_archive_entries(entries: list[ZipInfo]) -> list[str]:
    names: list[str] = []
    for entry in entries:
        name = _normalized_name(entry.filename)
        file_type = (entry.external_attr >> 16) & 0o170000
        if file_type == 0o120000:
            raise ValueError("La copia contiene enlaces simbólicos no permitidos.")
        if name not in {DATABASE_ENTRY, MANIFEST_ENTRY, MEDIA_ROOT_ENTRY} and not name.startswith(
            f"{MEDIA_ROOT_ENTRY}/"
        ):
            raise ValueError(f"La copia contiene una entrada no reconocida: {entry.filename}")
        names.append(name)

    if len(names) != len(set(names)):
        raise ValueError("La copia contiene nombres de archivo duplicados.")
    if DATABASE_ENTRY not in names:
        raise ValueError("La copia debe contener db.sqlite3.")
    return names


def read_manifest(archive: ZipFile, names: list[str]) -> dict | None:
    if MANIFEST_ENTRY not in names:
        # Backups created before the versioned manifest was introduced remain
        # restorable after the SQLite/schema checks performed by recovery.py.
        return None
    try:
        manifest = json.loads(archive.read(MANIFEST_ENTRY))
    except (json.JSONDecodeError, UnicodeDecodeError, KeyError, RuntimeError) as exc:
        raise ValueError("El manifest de la copia no es válido.") from exc
    if not isinstance(manifest, dict):
        raise ValueError("El manifest de la copia no es válido.")
    if manifest.get("format") != BACKUP_FORMAT or manifest.get("version") != BACKUP_VERSION:
        raise ValueError("La versión de la copia no es compatible con Mis cuentas.")
    return manifest
