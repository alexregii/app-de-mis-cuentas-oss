import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from threading import Barrier

from django.db import close_old_connections
from django.test import Client, TestCase, TransactionTestCase
from django.urls import reverse

from .models import Budget, Category


class BudgetCopyFixtureMixin:
    source_month = date(2026, 7, 1)
    target_month = date(2026, 8, 1)

    def make_budget_fixture(self):
        self.new_category = Category.objects.create(name="Comida M15", kind=Category.Kind.EXPENSE)
        self.existing_category = Category.objects.create(name="Vivienda M15", kind=Category.Kind.EXPENSE)
        self.inactive_category = Category.objects.create(name="Archivo M15", kind=Category.Kind.EXPENSE)
        self.source_new = Budget.objects.create(month=self.source_month, category=self.new_category, limit=Decimal("125.00"))
        self.source_existing = Budget.objects.create(month=self.source_month, category=self.existing_category, limit=Decimal("300.00"))
        self.source_inactive = Budget.objects.create(month=self.source_month, category=self.inactive_category, limit=Decimal("40.00"))
        self.inactive_category.active = False
        self.inactive_category.save(update_fields=["active"])
        self.destination_existing = Budget.objects.create(month=self.target_month, category=self.existing_category, limit=Decimal("275.00"))

    def preview(self, *, source_month=None, target_month=None):
        return self.client.get(reverse("api_budgets_copy_preview"), {
            "source_month": source_month or self.source_month.strftime("%Y-%m"),
            "target_month": target_month or self.target_month.strftime("%Y-%m"),
        })

    def apply_copy(self, token, category_ids):
        return self.client.post(
            reverse("api_budgets_copy"),
            data=json.dumps({"preview_token": token, "selected_category_ids": category_ids}),
            content_type="application/json",
        )


class BudgetCopyApiTests(BudgetCopyFixtureMixin, TestCase):
    def setUp(self):
        self.make_budget_fixture()

    def test_preview_classifies_source_and_destination_without_writing(self):
        before = list(Budget.objects.filter(month=self.target_month).order_by("category_id").values_list("category_id", "limit"))

        response = self.preview()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "private, no-store")
        payload = response.json()
        items = {item["category"]["id"]: item for item in payload["items"]}
        self.assertEqual(items[self.new_category.pk]["status"], "new")
        self.assertTrue(items[self.new_category.pk]["selected_by_default"])
        self.assertEqual(items[self.new_category.pk]["source_limit"], "125.00")
        self.assertIsNone(items[self.new_category.pk]["destination_limit"])
        self.assertEqual(items[self.existing_category.pk]["status"], "existing")
        self.assertFalse(items[self.existing_category.pk]["selected_by_default"])
        self.assertEqual(items[self.existing_category.pk]["destination_limit"], "275.00")
        self.assertEqual(items[self.inactive_category.pk]["status"], "inactive")
        self.assertFalse(items[self.inactive_category.pk]["can_copy"])
        self.assertEqual(
            list(Budget.objects.filter(month=self.target_month).order_by("category_id").values_list("category_id", "limit")),
            before,
        )

    def test_copy_creates_only_selected_and_overwrites_existing_only_when_selected(self):
        preview = self.preview().json()

        created = self.apply_copy(preview["preview_token"], [self.new_category.pk])

        self.assertEqual(created.status_code, 200)
        self.assertEqual(created["Cache-Control"], "private, no-store")
        self.assertEqual(created.json()["created"], 1)
        self.assertEqual(created.json()["updated"], 0)
        self.assertEqual(Budget.objects.get(month=self.target_month, category=self.new_category).limit, Decimal("125.00"))
        self.destination_existing.refresh_from_db()
        self.assertEqual(self.destination_existing.limit, Decimal("275.00"))
        self.assertFalse(Budget.objects.filter(month=self.target_month, category=self.inactive_category).exists())

        second_preview = self.preview().json()
        overwritten = self.apply_copy(second_preview["preview_token"], [self.existing_category.pk])

        self.assertEqual(overwritten.status_code, 200)
        self.assertEqual(overwritten.json()["updated"], 1)
        self.destination_existing.refresh_from_db()
        self.assertEqual(self.destination_existing.limit, Decimal("300.00"))

    def test_exact_retry_is_idempotent(self):
        preview = self.preview().json()

        first = self.apply_copy(preview["preview_token"], [self.new_category.pk])
        retry = self.apply_copy(preview["preview_token"], [self.new_category.pk])

        self.assertEqual(first.status_code, 200)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(first.json()["created"], 1)
        self.assertEqual(retry.json()["created"], 0)
        self.assertEqual(retry.json()["unchanged"], 1)
        self.assertEqual(Budget.objects.filter(month=self.target_month, category=self.new_category).count(), 1)

    def test_stale_target_prevents_partial_copy(self):
        preview = self.preview().json()
        Budget.objects.filter(pk=self.destination_existing.pk).update(limit=Decimal("250.00"))

        response = self.apply_copy(preview["preview_token"], [self.new_category.pk, self.existing_category.pk])

        self.assertEqual(response.status_code, 409)
        self.assertFalse(Budget.objects.filter(month=self.target_month, category=self.new_category).exists())
        self.destination_existing.refresh_from_db()
        self.assertEqual(self.destination_existing.limit, Decimal("250.00"))

    def test_invalid_month_same_month_empty_source_and_inactive_selection_are_safe(self):
        self.assertEqual(self.preview(source_month="2026-13").status_code, 400)
        self.assertEqual(self.preview(target_month="2026-13").status_code, 400)
        self.assertEqual(self.preview(source_month="2026-07", target_month="2026-07").status_code, 400)

        empty = self.preview(source_month="2026-05").json()
        self.assertEqual(empty["items"], [])
        self.assertEqual(self.apply_copy(empty["preview_token"], []).status_code, 400)

        preview = self.preview().json()
        inactive = self.apply_copy(preview["preview_token"], [self.inactive_category.pk])
        self.assertEqual(inactive.status_code, 409)
        self.assertFalse(Budget.objects.filter(month=self.target_month, category=self.inactive_category).exists())


class BudgetCopyConcurrencyTests(BudgetCopyFixtureMixin, TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.client = Client()
        self.make_budget_fixture()

    def test_concurrent_same_copy_keeps_one_budget_and_retry_is_idempotent(self):
        preview = self.preview().json()
        body = json.dumps({"preview_token": preview["preview_token"], "selected_category_ids": [self.new_category.pk]})
        barrier = Barrier(2)

        def apply_concurrently(_):
            close_old_connections()
            try:
                client = Client()
                barrier.wait(timeout=5)
                response = client.post(reverse("api_budgets_copy"), data=body, content_type="application/json")
                return response.status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            statuses = list(executor.map(apply_concurrently, range(2)))

        self.assertTrue(all(status in {200, 409} for status in statuses), statuses)
        self.assertEqual(Budget.objects.filter(month=self.target_month, category=self.new_category).count(), 1)
        self.assertEqual(Budget.objects.get(month=self.target_month, category=self.new_category).limit, Decimal("125.00"))
        if 409 in statuses:
            retry = self.apply_copy(preview["preview_token"], [self.new_category.pk])
            self.assertEqual(retry.status_code, 200)
            self.assertEqual(retry.json()["unchanged"], 1)
        self.assertEqual(Budget.objects.filter(month=self.target_month, category=self.new_category).count(), 1)
