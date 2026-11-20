import json
import tempfile
from pathlib import Path

from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase, override_settings
from django.urls import reverse

from .middleware import BackendOperationLockMiddleware
from .recovery_views import api_recovery, api_recovery_restore
from .recovery import (
    RestoreBusyError,
    acquire_operation_lock,
    operation_allows_backup,
    operation_lock_directory,
    operation_lock_status,
    publish_restore_request,
    recovery_directory,
    release_operation_lock,
)


class BackendOperationLockTests(SimpleTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.settings_override = override_settings(BASE_DIR=self.base)
        self.settings_override.enable()

    def tearDown(self):
        self.settings_override.disable()
        self.temp.cleanup()

    def test_lock_excludes_restore_publication_until_release(self):
        lock = acquire_operation_lock("backend_release", "Actualización del backend en curso.")
        self.assertEqual(operation_lock_status()["operation"], "backend_release")
        with self.assertRaises(RestoreBusyError):
            acquire_operation_lock("restore_request", "Restauración pendiente.")
        release_operation_lock(lock)
        self.assertIsNone(operation_lock_status())

    def test_recovery_api_reports_backend_release_as_quiescing(self):
        lock = acquire_operation_lock("backend_release", "Actualización del backend en curso.")
        response = api_recovery(RequestFactory().get("/api/recovery/"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["restore"]["status"], {
            "status": "quiescing",
            "message": "Actualización del backend en curso.",
        })
        release_operation_lock(lock)

    def test_restore_submission_conflicts_with_backend_release_lock(self):
        staged = recovery_directory() / "staged"
        staged.mkdir()
        token = "b" * 32
        (staged / f"{token}.zip").write_bytes(b"synthetic archive")
        lock = acquire_operation_lock("backend_release", "Actualización del backend en curso.")
        request = RequestFactory().post(
            "/api/recovery/restore/",
            data=json.dumps({"token": token, "confirmation": "RESTAURAR"}),
            content_type="application/json",
        )
        response = api_recovery_restore(request)
        self.assertEqual(response.status_code, 409)
        self.assertFalse((recovery_directory() / "restore-request.json").exists())
        release_operation_lock(lock)

    def test_restore_publication_is_atomic_and_uses_maintenance_mount_path(self):
        staged = recovery_directory() / "staged"
        staged.mkdir()
        archive = staged / ("a" * 32 + ".zip")
        archive.write_bytes(b"synthetic backup")

        publish_restore_request(archive)

        request = json.loads((recovery_directory() / "restore-request.json").read_text(encoding="utf-8"))
        self.assertEqual(request["archive"], f"/data/recovery/staged/{archive.name}")
        self.assertFalse(operation_lock_directory().exists())

    def test_release_lock_blocks_mutations_and_allows_safe_reads(self):
        lock = acquire_operation_lock("backend_release", "Actualización del backend en curso.")
        middleware = BackendOperationLockMiddleware(lambda _request: HttpResponse("allowed"))
        factory = RequestFactory()

        mutation = middleware(factory.post("/api/transactions/"))
        read = middleware(factory.get("/api/transactions/"))

        self.assertEqual(mutation.status_code, 503)
        self.assertEqual(mutation["Retry-After"], "5")
        self.assertEqual(read.status_code, 200)
        release_operation_lock(lock)

    def test_release_lock_blocks_bank_callback_get_before_side_effects(self):
        lock = acquire_operation_lock("backend_release", "Actualización del backend en curso.")
        downstream_called = False

        def downstream(_request):
            nonlocal downstream_called
            downstream_called = True
            return HttpResponse("allowed")

        request = RequestFactory().get(
            reverse("bank_callback"),
            {"state": "signed-state", "code": "authorization-code"},
        )
        response = BackendOperationLockMiddleware(downstream)(request)

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response["Retry-After"], "5")
        self.assertFalse(downstream_called)
        release_operation_lock(lock)

    def test_only_the_internal_backup_kind_for_the_owner_may_run_under_lock(self):
        release = {"operation": "backend_release"}
        restore = {"operation": "restore"}
        self.assertTrue(operation_allows_backup("scheduled", None))
        self.assertTrue(operation_allows_backup("pre-release", release))
        self.assertFalse(operation_allows_backup("manual", release))
        self.assertTrue(operation_allows_backup("pre-restore", restore))
        self.assertFalse(operation_allows_backup("pre-release", restore))
        self.assertFalse(operation_allows_backup("scheduled", {"operation": "unknown"}))


if __name__ == "__main__":
    import unittest

    unittest.main()
