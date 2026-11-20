import json
import tempfile
from pathlib import Path

from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase, override_settings

from .performance import PerformanceMetricsMiddleware, query_shape


class PerformanceMetricsTests(SimpleTestCase):
    def test_query_shape_is_stable_and_does_not_include_parameters(self):
        self.assertEqual(query_shape("SELECT * FROM ledger_transaction WHERE id = 1"), query_shape("SELECT  *  FROM ledger_transaction WHERE id = 2"))
        self.assertEqual(len(query_shape("SELECT 1")), 12)

    def test_middleware_writes_opt_in_request_contract(self):
        factory = RequestFactory()
        with tempfile.TemporaryDirectory() as temporary:
            metrics_path = Path(temporary) / "metrics.jsonl"
            with override_settings(PERFORMANCE_INSTRUMENTATION=True, PERFORMANCE_METRICS_PATH=str(metrics_path)):
                response = PerformanceMetricsMiddleware(lambda request: JsonResponse({"ok": True}))(factory.get("/health/"))

            self.assertEqual(response.status_code, 200)
            record = json.loads(metrics_path.read_text(encoding="utf-8"))
            self.assertEqual(record["request"], "/health/")
            self.assertEqual(record["status_code"], 200)
            self.assertIn("duration_ms", record)
            self.assertIn("sql_queries", record)
            self.assertIn("response_bytes", record)
