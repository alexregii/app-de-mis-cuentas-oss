"""Compose the ledger URL surface from explicit ownership groups."""

from .api_urls import urlpatterns as api_urlpatterns
from .runtime_urls import urlpatterns as runtime_urlpatterns

urlpatterns = [*api_urlpatterns, *runtime_urlpatterns]
