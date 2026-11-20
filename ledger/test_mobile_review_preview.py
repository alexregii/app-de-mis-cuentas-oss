import json
import os
from calendar import monthrange
from datetime import date
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from ledger.middleware import MobileReviewCookieIsolationMiddleware
from ledger.management.commands.seed_e2e import seed_mobile_review_annual_reserves
from ledger.models import Account, Category


class MobileReviewSyntheticFixtureTests(TestCase):
    def test_m20_annual_reserve_fixture_is_exposed_by_the_planning_api(self):
        today = timezone.localdate()
        account = Account.objects.create(name="Cuenta review M20", opening_balance=Decimal("1200.00"))
        category = Category.objects.create(name="Seguro review M20", kind=Category.Kind.EXPENSE)
        seed_mobile_review_annual_reserves(account, category, today)
        self.client.force_login(get_user_model().objects.create_user(username="m20-review"))

        response = self.client.get(reverse("api_planning"))

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        objective = next(item for item in payload["savings_objectives"]["items"] if item["name"] == "Reserva del seguro del hogar E2E")
        self.assertEqual(objective["assigned_amount"], 300)
        self.assertEqual(objective["annual_reserve"]["status"], "active")
        self.assertEqual(objective["annual_reserve"]["remaining_amount"], 900)
        self.assertEqual(objective["annual_reserve"]["months_remaining"], 9)
        self.assertEqual(objective["annual_reserve"]["monthly_amount"], 100)
        self.assertIn(
            "Impuesto municipal anual E2E",
            [rule["name"] for rule in payload["rules"] if rule["frequency"] == "yearly" and rule["active"]],
        )
        prepared = self.client.post(
            reverse("api_planning_prepare"),
            data=json.dumps({"month": today.strftime("%Y-%m")}),
            content_type="application/json",
        )
        self.assertEqual(prepared.status_code, 200, prepared.content)
        after_prepare = self.client.get(reverse("api_planning")).json()
        objective_after_prepare = next(
            item for item in after_prepare["savings_objectives"]["items"]
            if item["name"] == "Reserva del seguro del hogar E2E"
        )
        self.assertEqual(objective_after_prepare["annual_reserve"]["status"], "active")
        self.assertEqual(objective_after_prepare["annual_reserve"]["months_remaining"], 9)
        self.assertEqual(objective_after_prepare["annual_reserve"]["monthly_amount"], 100)

    def test_mobile_preview_seed_exposes_a_current_month_m16_spike(self):
        e2e_directory = Path(settings.BASE_DIR) / ".e2e"
        e2e_directory.mkdir(exist_ok=True)
        today = timezone.localdate()
        month_end = date(today.year, today.month, monthrange(today.year, today.month)[1])
        with TemporaryDirectory(dir=e2e_directory) as temporary_directory:
            temporary_path = Path(temporary_directory)
            with (
                patch.dict(settings.DATABASES["default"], {"NAME": str(temporary_path / "mobile-review.sqlite3")}),
                override_settings(MEDIA_ROOT=str(temporary_path / "media")),
                patch("ledger.management.commands.seed_e2e.timezone.localdate", return_value=month_end),
                patch.dict(os.environ, {
                    "E2E_TEST_MODE": "1",
                    "E2E_AUTH_TEST_MODE": "1",
                    "MOBILE_REVIEW_PREVIEW": "1",
                    "MOBILE_REVIEW_SHA": "0123456789abcdef0123456789abcdef01234567",
                }, clear=False),
                patch("ledger.management.commands.seed_e2e.call_command") as flush,
            ):
                call_command("seed_e2e", mobile_review=True, verbosity=0)
            flush.assert_called_once_with("flush", interactive=False, verbosity=0)

        self.client.force_login(get_user_model().objects.get(username="e2e-operator"))
        with patch("ledger.statistics_views.timezone.localdate", return_value=month_end):
            response = self.client.get(f"/api/statistics/{month_end.year}/{month_end.month}/?basis=analytics")

        self.assertEqual(response.status_code, 200)
        spike = next(
            item for item in response.json()["insights"]["spikes"]["items"]
            if item["family_name"] == "Pico de gasto E2E"
        )
        self.assertEqual(spike["median_net_expense"], 100)
        self.assertEqual(spike["current_net_expense"], 200)


class MobileReviewSeedSafetyTests(SimpleTestCase):
    def run_mobile_seed(self, *, environment, database_path, media_path=None):
        databases = {
            "default": {
                **settings.DATABASES["default"],
                "NAME": str(database_path),
            }
        }
        override = override_settings(DATABASES=databases)
        if media_path is not None:
            override = override_settings(DATABASES=databases, MEDIA_ROOT=media_path)
        with override, patch.dict(os.environ, environment, clear=False):
            call_command("seed_e2e", mobile_review=True, verbosity=0)

    def test_mobile_fixture_requires_all_isolation_flags(self):
        with self.assertRaisesRegex(CommandError, "MOBILE_REVIEW_PREVIEW=1"):
            self.run_mobile_seed(
                environment={"E2E_TEST_MODE": "1", "MOBILE_REVIEW_PREVIEW": "0"},
                database_path=Path(settings.BASE_DIR) / ".e2e" / "review.sqlite3",
            )

    def test_mobile_fixture_rejects_the_application_data_directory(self):
        with self.assertRaisesRegex(CommandError, "Base protegida"):
            self.run_mobile_seed(
                environment={
                    "E2E_TEST_MODE": "1",
                    "E2E_AUTH_TEST_MODE": "1",
                    "MOBILE_REVIEW_PREVIEW": "1",
                    "MOBILE_REVIEW_SHA": "0123456789abcdef0123456789abcdef01234567",
                },
                database_path=Path(settings.BASE_DIR) / "data" / "db.sqlite3",
            )

    def test_mobile_fixture_rejects_media_outside_e2e_directory(self):
        with self.assertRaisesRegex(CommandError, "medios del preview"):
            self.run_mobile_seed(
                environment={
                    "E2E_TEST_MODE": "1",
                    "E2E_AUTH_TEST_MODE": "1",
                    "MOBILE_REVIEW_PREVIEW": "1",
                    "MOBILE_REVIEW_SHA": "0123456789abcdef0123456789abcdef01234567",
                },
                database_path=Path(settings.BASE_DIR) / ".e2e" / "review.sqlite3",
                media_path=str(Path(settings.BASE_DIR) / "data" / "media"),
            )


class MobileReviewCookieIsolationTests(SimpleTestCase):
    @override_settings(
        MOBILE_REVIEW_PREVIEW=True,
        SESSION_COOKIE_NAME="mobile_review_sessionid",
        CSRF_COOKIE_NAME="mobile_review_csrftoken",
    )
    def test_preview_backend_receives_only_preview_session_and_csrf_cookies(self):
        request = RequestFactory().get(
            "/api/bootstrap/",
            HTTP_COOKIE=(
                "sessionid=production-session; csrftoken=production-csrf; "
                "mobile_review_sessionid=preview-session; mobile_review_csrftoken=preview-csrf"
            ),
        )
        response = MobileReviewCookieIsolationMiddleware(lambda _: HttpResponse("ok"))(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            request.COOKIES,
            {
                "mobile_review_sessionid": "preview-session",
                "mobile_review_csrftoken": "preview-csrf",
            },
        )
        self.assertEqual(
            request.META["HTTP_COOKIE"],
            "mobile_review_sessionid=preview-session; mobile_review_csrftoken=preview-csrf",
        )

    @override_settings(MOBILE_REVIEW_PREVIEW=False)
    def test_production_cookie_behavior_is_unchanged(self):
        request = RequestFactory().get(
            "/api/bootstrap/",
            HTTP_COOKIE="sessionid=production-session; csrftoken=production-csrf",
        )
        MobileReviewCookieIsolationMiddleware(lambda _: HttpResponse("ok"))(request)

        self.assertEqual(request.COOKIES, {"sessionid": "production-session", "csrftoken": "production-csrf"})
        self.assertEqual(request.META["HTTP_COOKIE"], "sessionid=production-session; csrftoken=production-csrf")
