from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.sessions.models import Session
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET, require_POST

from .api_helpers import api_json_body

AUTH_EXPIRY_SESSION_KEY = "_miscuentas_auth_expires_at"


def _session_expiry(request):
    expiry = request.session.get(AUTH_EXPIRY_SESSION_KEY)
    if expiry:
        return expiry
    if request.session.session_key:
        persisted_expiry = Session.objects.filter(session_key=request.session.session_key).values_list("expire_date", flat=True).first()
        if persisted_expiry:
            return persisted_expiry.isoformat()
    return (timezone.now() + timedelta(seconds=request.session.get_expiry_age())).isoformat()


def _session_payload(request):
    authenticated = bool(request.user.is_authenticated)
    return {
        "ok": True,
        "required": settings.FINANCE_AUTH_REQUIRED,
        "authenticated": authenticated,
        "username": request.user.get_username() if authenticated else None,
        "expires_at": _session_expiry(request) if authenticated else None,
        "csrf_token": get_token(request),
    }


@require_GET
@never_cache
def api_auth_session(request):
    return JsonResponse(_session_payload(request))


@require_POST
@never_cache
def api_auth_login(request):
    try:
        payload = api_json_body(request)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    if not isinstance(payload, dict):
        return JsonResponse({"ok": False, "error": "JSON no válido."}, status=400)

    username = payload.get("username")
    password = payload.get("password")
    if (
        not isinstance(username, str)
        or not isinstance(password, str)
        or not username.strip()
        or len(username) > 150
        or not password
        or len(password) > 1024
    ):
        return JsonResponse({"ok": False, "error": "Introduce un usuario y una contraseña válidos."}, status=400)

    user = authenticate(request, username=username.strip(), password=password)
    if user is None or not user.is_active:
        return JsonResponse({"ok": False, "error": "El usuario o la contraseña no son válidos."}, status=401)

    login(request, user)
    request.session[AUTH_EXPIRY_SESSION_KEY] = (
        timezone.now() + timedelta(seconds=request.session.get_expiry_age())
    ).isoformat()
    return JsonResponse(_session_payload(request))


@require_POST
@never_cache
def api_auth_logout(request):
    logout(request)
    return JsonResponse(_session_payload(request))
