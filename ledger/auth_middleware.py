from django.conf import settings
from django.http import JsonResponse


PUBLIC_PATHS = {
    "/api/auth/login/",
    "/api/auth/session/",
    "/bancos/enable-banking/callback/",
    "/health/",
}


class FinanceAuthenticationMiddleware:
    """Protect financial HTTP surfaces while keeping an explicit public allowlist."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path_info
        protected = (
            path == "/api"
            or path.startswith("/api/")
            or path.startswith("/adjuntos/")
            or path.startswith(settings.MEDIA_URL)
            or path == "/exportar/excel/"
        )
        if not protected:
            return self.get_response(request)

        if settings.FINANCE_AUTH_REQUIRED and path not in PUBLIC_PATHS and not request.user.is_authenticated:
            response = JsonResponse(
                {
                    "ok": False,
                    "code": "authentication_required",
                    "error": "Inicia sesión para acceder a tus datos financieros.",
                },
                status=401,
            )
            response["Cache-Control"] = "no-store"
            return response

        response = self.get_response(request)
        response["Cache-Control"] = "private, no-store"
        return response
