from django.conf import settings
from django.http import JsonResponse

from .recovery import operation_lock_status


class MobileReviewCookieIsolationMiddleware:
    """Keep host-wide production cookies out of the synthetic preview backend."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if settings.MOBILE_REVIEW_PREVIEW:
            allowed_names = (settings.SESSION_COOKIE_NAME, settings.CSRF_COOKIE_NAME)
            request.COOKIES = {
                name: request.COOKIES[name]
                for name in allowed_names
                if name in request.COOKIES
            }
            request.META["HTTP_COOKIE"] = "; ".join(
                f"{name}={request.COOKIES[name]}" for name in allowed_names if name in request.COOKIES
            )
        return self.get_response(request)


class BackendOperationLockMiddleware:
    SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}
    MUTATING_SAFE_PATHS = {"/bancos/enable-banking/callback/"}

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if (
            request.method not in self.SAFE_METHODS or request.path_info in self.MUTATING_SAFE_PATHS
        ) and operation_lock_status() is not None:
            response = JsonResponse(
                {"ok": False, "error": "La aplicación está en mantenimiento; inténtalo de nuevo."},
                status=503,
            )
            response["Retry-After"] = "5"
            response["Cache-Control"] = "no-store"
            return response
        return self.get_response(request)
