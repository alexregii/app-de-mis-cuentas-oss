import os
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.test import TestCase, override_settings

from .banking_client import EnableBankingClient


class EnableBankingClientTests(TestCase):
    def test_jwt_is_cached_per_client_and_rotates_when_key_file_changes(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            key_path = Path(temporary_dir) / "private.pem"
            key_path.write_bytes(b"first-key")
            with override_settings(
                ENABLE_BANKING_PRIVATE_KEY_PATH=str(key_path),
                ENABLE_BANKING_APP_ID="test-app",
            ):
                with patch("ledger.banking_client.jwt.encode", side_effect=["first-token", "second-token"]) as encode:
                    client = EnableBankingClient()
                    first = client._headers()
                    cached = client._headers()
                    original_stat = key_path.stat()
                    key_path.write_bytes(b"second-key")
                    os.utime(
                        key_path,
                        ns=(original_stat.st_atime_ns + 1_000_000_000, original_stat.st_mtime_ns + 1_000_000_000),
                    )
                    rotated = client._headers()

        self.assertEqual(first["Authorization"], "Bearer first-token")
        self.assertEqual(cached, first)
        self.assertEqual(rotated["Authorization"], "Bearer second-token")
        self.assertEqual(encode.call_count, 2)
