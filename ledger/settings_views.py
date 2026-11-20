"""Application settings API boundary."""

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .api_helpers import api_json_body
from .api_serializers import api_automation, api_errors
from .forms import AutomationSettingsForm
from .models import AutomationSettings


@require_http_methods(["GET", "PUT"])
def api_automation_settings(request):
    automation = AutomationSettings.objects.first()
    if request.method == "PUT":
        try:
            payload = api_json_body(request)
        except ValueError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=400)
        form = AutomationSettingsForm(payload, instance=automation)
        if not form.is_valid():
            return JsonResponse({"ok": False, "errors": api_errors(form)}, status=400)
        automation = form.save()
    return JsonResponse({"ok": True, "automation": api_automation(automation or AutomationSettings())})
