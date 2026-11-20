from datetime import datetime, timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .api_urls import urlpatterns as finance_api_patterns
from .auth_views import AUTH_EXPIRY_SESSION_KEY


@override_settings(FINANCE_AUTH_REQUIRED=True)
class FinanceAuthenticationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create_user(username="operator", password="test-only-long-password")

    def assert_auth_required(self, response):
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response["Content-Type"], "application/json")
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(response.json()["code"], "authentication_required")

    def test_anonymous_finance_api_exports_media_and_recovery_are_denied(self):
        for path in (
            "/api/bootstrap/",
            "/api/transactions/",
            "/api/accounts/",
            "/api/recovery/",
            "/api/recovery/export/",
            "/exportar/excel/",
            "/adjuntos/1/",
            "/media/private.pdf",
        ):
            with self.subTest(path=path):
                self.assert_auth_required(self.client.get(path))

        self.assert_auth_required(self.client.post("/api/recovery/restore/", data="{}", content_type="application/json"))

    def test_every_finance_api_route_rejects_anonymous_reads_and_writes(self):
        public = {reverse("api_auth_login"), reverse("api_auth_session")}
        substitutions = {
            "<int:pk>": "1",
            "<int:year>": "2026",
            "<int:month>": "1",
            "<int:application_id>": "1",
            "<str:action>": "archive",
        }
        for pattern in finance_api_patterns:
            path = f"/{pattern.pattern._route}"
            for token, value in substitutions.items():
                path = path.replace(token, value)
            self.assertNotIn("<", path, f"Test route needs a substitution: {path}")
            if path in public:
                continue
            for method in (self.client.get, self.client.post):
                with self.subTest(path=path, method=method.__name__):
                    self.assert_auth_required(method(path))

    def test_public_health_callback_and_session_endpoints_have_narrow_methods(self):
        self.assertEqual(self.client.get(reverse("health")).status_code, 200)
        self.assertEqual(self.client.get(reverse("bank_callback")).status_code, 302)
        session = self.client.get(reverse("api_auth_session"))
        self.assertEqual(session.status_code, 200)
        self.assertFalse(session.json()["authenticated"])
        self.assertTrue(session.json()["required"])
        self.assertEqual(session["Cache-Control"], "private, no-store")
        self.assertEqual(self.client.post(reverse("health")).status_code, 405)
        self.assertEqual(self.client.post(reverse("bank_callback")).status_code, 405)

    def test_api_responses_are_private_and_never_redirect_to_html_login(self):
        self.client.force_login(self.user)
        response = self.client.get(reverse("api_bootstrap"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_login_and_logout_require_csrf_and_rotate_session(self):
        client = Client(enforce_csrf_checks=True)
        csrf = client.get(reverse("api_auth_session")).json()["csrf_token"]
        login_path = reverse("api_auth_login")
        credentials = {"username": "operator", "password": "test-only-long-password"}

        rejected = client.post(login_path, credentials, content_type="application/json")
        self.assertEqual(rejected.status_code, 403)

        logged_in = client.post(
            login_path,
            credentials,
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(logged_in.status_code, 200)
        self.assertTrue(logged_in.json()["authenticated"])
        self.assertEqual(logged_in["Cache-Control"], "private, no-store")
        session_cookie = logged_in.cookies["sessionid"]
        self.assertTrue(session_cookie["httponly"])
        self.assertEqual(session_cookie["samesite"], "Lax")
        self.assertEqual(session_cookie["max-age"], 12 * 60 * 60)
        expiry_deadline = logged_in.json()["expires_at"]
        self.assertEqual(client.session[AUTH_EXPIRY_SESSION_KEY], expiry_deadline)
        self.assertEqual(client.get(reverse("api_auth_session")).json()["expires_at"], expiry_deadline)
        self.assertEqual(client.get(reverse("api_bootstrap")).status_code, 200)

        logout_path = reverse("api_auth_logout")
        csrf_after_login = logged_in.json()["csrf_token"]
        rejected_logout = client.post(logout_path, {}, content_type="application/json")
        self.assertEqual(rejected_logout.status_code, 403)
        logged_out = client.post(
            logout_path,
            {},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_after_login,
        )
        self.assertEqual(logged_out.status_code, 200)
        self.assertFalse(logged_out.json()["authenticated"])
        self.assert_auth_required(client.get(reverse("api_bootstrap")))

    def test_invalid_login_is_generic_json_and_expired_session_is_denied(self):
        client = Client(enforce_csrf_checks=True)
        csrf = client.get(reverse("api_auth_session")).json()["csrf_token"]
        response = client.post(
            reverse("api_auth_login"),
            {"username": "operator", "password": "incorrect"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response["Content-Type"], "application/json")
        self.assertEqual(response.json()["error"], "El usuario o la contraseña no son válidos.")

        self.client.force_login(self.user)
        session = self.client.session
        session.set_expiry(-1)
        session.save()
        self.assert_auth_required(self.client.get(reverse("api_bootstrap")))

    def test_session_endpoint_returns_the_fixed_expiry_deadline(self):
        client = Client()
        client.force_login(self.user)
        expected_expiry = timezone.now() + timedelta(seconds=60)
        session = client.session
        session[AUTH_EXPIRY_SESSION_KEY] = expected_expiry.isoformat()
        session.save()

        response = client.get(reverse("api_auth_session"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["expires_at"], expected_expiry.isoformat())
        remaining = (datetime.fromisoformat(response.json()["expires_at"]) - timezone.now()).total_seconds()
        self.assertLess(remaining, 61)
        self.assertGreater(remaining, 50)

    def test_operator_password_validation_rejects_short_and_accepts_strong_passwords(self):
        with self.assertRaises(ValidationError):
            validate_password("short", user=self.user)
        validate_password("mango-chair-planet-saffron", user=self.user)
