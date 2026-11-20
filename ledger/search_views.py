"""Bounded cross-domain search API boundary."""

from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from .api_serializers import api_date, react_transactions_url
from .models import Account, Category, CategoryRule, Transaction


@require_GET
def api_search(request):
    """Bounded command-palette search; results are never persisted server-side."""
    query = " ".join(request.GET.get("q", "").split())[:80]
    if len(query) < 2:
        return JsonResponse({"query": query, "groups": []})

    transactions = (
        Transaction.objects.filter(archived=False)
        .filter(Q(description__icontains=query) | Q(notes__icontains=query) | Q(tags__name__icontains=query))
        .select_related("account")
        .distinct()
        .order_by("-date", "-created_at", "-pk")[:5]
    )
    accounts = Account.objects.filter(name__icontains=query).order_by("active", "name")[:5]
    categories = (
        Category.objects.filter(Q(name__icontains=query) | Q(parent__name__icontains=query))
        .select_related("parent")
        .order_by("active", "kind", "parent__name", "name")[:5]
    )
    rules = (
        CategoryRule.objects.filter(description__icontains=query)
        .select_related("category", "category__parent")
        .order_by("active", "priority", "description")[:5]
    )
    groups = [
        {
            "id": "transactions",
            "label": "Movimientos",
            "items": [
                {
                    "id": f"transaction:{movement.pk}",
                    "title": movement.description,
                    "detail": f"{api_date(movement.date)} · {movement.account.name}",
                    "href": react_transactions_url({"q": movement.description}),
                }
                for movement in transactions
            ],
        },
        {
            "id": "accounts",
            "label": "Cuentas",
            "items": [
                {
                    "id": f"account:{account.pk}",
                    "title": account.name,
                    "detail": account.get_kind_display(),
                    "href": f"/?tab=accounts&account={account.pk}",
                }
                for account in accounts
            ],
        },
        {
            "id": "categories",
            "label": "Categorías",
            "items": [
                {
                    "id": f"category:{category.pk}",
                    "title": category.display_name,
                    "detail": category.get_kind_display(),
                    "href": f"/?tab=settings&settings_section=classification&category={category.pk}",
                }
                for category in categories
            ],
        },
        {
            "id": "rules",
            "label": "Reglas",
            "items": [
                {
                    "id": f"rule:{rule.pk}",
                    "title": rule.description,
                    "detail": rule.category.display_name,
                    "href": f"/?tab=automations&rule={rule.pk}",
                }
                for rule in rules
            ],
        },
    ]
    return JsonResponse({"query": query, "groups": [group for group in groups if group["items"]]})
