import json
import tempfile
import uuid

from django.core.management import call_command
from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST, require_http_methods

from .api_helpers import api_json_body
from .recovery import (
    RestoreBusyError,
    backup_directory,
    inspect_restore_archive,
    latest_backup,
    operation_lock_status,
    publish_restore_request,
    recovery_directory,
    scheduled_backup_status,
    write_portable_export,
)


@require_http_methods(["GET", "POST"])
def api_recovery(request):
    if request.method == "POST":
        if operation_lock_status() is not None:
            return JsonResponse({"ok": False, "error": "La aplicación está en mantenimiento; inténtalo de nuevo."}, status=503)
        call_command("backup_finance", destination=str(backup_directory()), kind="manual")
    status_file = recovery_directory() / "restore-status.json"
    operation = operation_lock_status()
    if operation and operation["operation"] == "backend_release":
        status = {"status": "quiescing", "message": operation["message"]}
    elif operation and operation["operation"] == "restore_request":
        status = {"status": "staged", "message": operation["message"]}
    elif operation and operation["operation"] == "unknown":
        status = {"status": "failed", "message": operation["message"]}
    elif operation and operation["operation"] == "restore":
        status = {"status": "quiescing", "message": operation["message"]}
    else:
        status = json.loads(status_file.read_text(encoding="utf-8")) if status_file.exists() else None
    restore_available = settings.RESTORE_COORDINATOR_ENABLED
    return JsonResponse({"ok": True, "latest_backup": latest_backup(), "backup_status": scheduled_backup_status(), "restore": {"available": restore_available, "status": status if restore_available else None}})


@require_POST
def api_recovery_restore_preview(request):
    if not settings.RESTORE_COORDINATOR_ENABLED:
        return JsonResponse({"ok": False, "error": "La restauración automática no está habilitada en esta instalación."}, status=503)
    upload = request.FILES.get("archive")
    if not upload or upload.size > 2 * 1024 * 1024 * 1024:
        return JsonResponse({"ok": False, "error": "Selecciona una copia ZIP de hasta 2 GB."}, status=400)
    try:
        impact = inspect_restore_archive(upload)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    token = uuid.uuid4().hex
    staged = recovery_directory() / "staged"
    staged.mkdir(exist_ok=True)
    destination = staged / f"{token}.zip"
    with destination.open("wb") as target:
        for chunk in upload.chunks():
            target.write(chunk)
    return JsonResponse({"ok": True, "token": token, "impact": impact})


@require_POST
def api_recovery_restore(request):
    if not settings.RESTORE_COORDINATOR_ENABLED:
        return JsonResponse({"ok": False, "error": "La restauración automática no está habilitada en esta instalación."}, status=503)
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    token = str(payload.get("token", ""))
    if payload.get("confirmation") != "RESTAURAR" or not token.isalnum() or len(token) != 32:
        return JsonResponse({"ok": False, "error": "Confirma escribiendo RESTAURAR."}, status=400)
    archive = recovery_directory() / "staged" / f"{token}.zip"
    if not archive.exists():
        return JsonResponse({"ok": False, "error": "La previsualización ya no está disponible."}, status=400)
    try:
        publish_restore_request(archive)
    except RestoreBusyError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=409)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    except OSError:
        return JsonResponse({"ok": False, "error": "No se pudo enviar la solicitud de restauración."}, status=503)
    return JsonResponse({"ok": True, "message": "Restauración solicitada; la aplicación se reiniciará."})


@require_GET
def export_portable(request):
    with tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b") as output:
        write_portable_export(output)
        output.seek(0)
        response = HttpResponse(output.read(), content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="mis-cuentas-portable-{timezone.localdate():%Y-%m-%d}.zip"'
    return response
