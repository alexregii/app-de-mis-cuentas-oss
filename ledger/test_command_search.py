from decimal import Decimal

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Account, Category, CategoryRule, Transaction


class CommandSearchApiTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create(name="Cuenta paleta", kind=Account.Kind.CHECKING)
        self.category = Category.objects.create(name="Comida paleta", kind=Category.Kind.EXPENSE)
        self.movement = Transaction.objects.create(
            account=self.account,
            category=self.category,
            kind=Transaction.Kind.EXPENSE,
            amount=Decimal("12.50"),
            date=timezone.localdate(),
            description="Supermercado paleta",
        )
        CategoryRule.objects.create(
            description="SUPERMERCADO paleta",
            kind=Category.Kind.EXPENSE,
            category=self.category,
        )

    def test_search_groups_are_bounded_and_use_canonical_deep_links(self):
        response = self.client.get(reverse("api_search"), {"q": "paleta"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        groups = {group["id"]: group["items"] for group in payload["groups"]}
        self.assertEqual(payload["query"], "paleta")
        self.assertEqual(groups["transactions"][0]["href"], "/?tab=transactions&q=Supermercado+paleta")
        self.assertEqual(groups["accounts"][0]["href"], f"/?tab=accounts&account={self.account.pk}")
        category_result = next(item for item in groups["categories"] if item["id"] == f"category:{self.category.pk}")
        self.assertEqual(
            category_result["href"],
            f"/?tab=settings&settings_section=classification&category={self.category.pk}",
        )
        self.assertEqual(groups["rules"][0]["href"], f"/?tab=automations&rule={CategoryRule.objects.get().pk}")
        self.assertTrue(all(len(items) <= 5 for items in groups.values()))

    def test_parent_child_and_inactive_category_results_keep_their_exact_id(self):
        parent = Category.objects.create(name="Familia paleta", kind=Category.Kind.EXPENSE)
        child = Category.objects.create(name="Hijo paleta", kind=Category.Kind.EXPENSE, parent=parent)
        inactive = Category.objects.create(name="Archivada paleta", kind=Category.Kind.EXPENSE, active=False)

        response = self.client.get(reverse("api_search"), {"q": "paleta"})

        categories = {item["id"]: item for group in response.json()["groups"] if group["id"] == "categories" for item in group["items"]}
        for category in (parent, child, inactive):
            result = categories[f"category:{category.pk}"]
            self.assertEqual(
                result["href"],
                f"/?tab=settings&settings_section=classification&category={category.pk}",
            )
            self.assertNotIn("paleta", result["href"])

    def test_search_requires_at_least_two_characters(self):
        response = self.client.get(reverse("api_search"), {"q": "s"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"query": "s", "groups": []})
