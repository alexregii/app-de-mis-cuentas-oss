"""Enable Banking HTTP client and provider configuration checks."""

import json
from datetime import timedelta
from pathlib import Path

import jwt
import requests
from django.conf import settings
from django.utils import timezone
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


def banking_configured():
    return bool(
        settings.ENABLE_BANKING_APP_ID
        and settings.ENABLE_BANKING_REDIRECT_URL
        and Path(settings.ENABLE_BANKING_PRIVATE_KEY_PATH).is_file()
    )


class EnableBankingClient:
    def __init__(self):
        self.base_url = settings.ENABLE_BANKING_API_URL.rstrip("/")
        self._jwt_token = None
        self._jwt_token_expires_at = 0
        self._jwt_key_mtime_ns = None
        self.session = requests.Session()
        self.session.mount(
            "https://",
            HTTPAdapter(
                max_retries=Retry(
                    total=4,
                    backoff_factor=1,
                    status_forcelist=(500, 502, 503, 504),
                    allowed_methods=("GET", "POST", "DELETE"),
                )
            ),
        )

    def _headers(self):
        key_path = Path(settings.ENABLE_BANKING_PRIVATE_KEY_PATH)
        key_mtime_ns = key_path.stat().st_mtime_ns
        now = int(timezone.now().timestamp())
        if (
            self._jwt_token
            and self._jwt_key_mtime_ns == key_mtime_ns
            and now < self._jwt_token_expires_at - 60
        ):
            token = self._jwt_token
        else:
            private_key = key_path.read_bytes()
            token = jwt.encode(
                {
                    "iss": "enablebanking.com",
                    "aud": "api.enablebanking.com",
                    "iat": now,
                    "exp": now + 3600,
                },
                private_key,
                algorithm="RS256",
                headers={"kid": settings.ENABLE_BANKING_APP_ID},
            )
            self._jwt_token = token
            self._jwt_token_expires_at = now + 3600
            self._jwt_key_mtime_ns = key_mtime_ns
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def request(self, method, path, **kwargs):
        response = self.session.request(
            method,
            f"{self.base_url}{path}",
            headers=self._headers(),
            timeout=30,
            **kwargs,
        )
        response.raise_for_status()
        return response.json() if response.content else {}

    def banks(self, country="ES"):
        return self.request("GET", "/aspsps", params={"country": country}).get("aspsps", [])

    def start_authorization(self, bank_name, bank_country, state):
        valid_until = timezone.now() + timedelta(days=90)
        payload = {
            "access": {"valid_until": valid_until.isoformat()},
            "aspsp": {"name": bank_name, "country": bank_country},
            "state": state,
            "redirect_url": settings.ENABLE_BANKING_REDIRECT_URL,
            "psu_type": "personal",
        }
        return self.request("POST", "/auth", data=json.dumps(payload))

    def create_session(self, code):
        return self.request("POST", "/sessions", data=json.dumps({"code": code}))

    def balances(self, remote_uid):
        return self.request("GET", f"/accounts/{remote_uid}/balances").get("balances", [])

    def transactions(self, remote_uid, date_from, continuation_key=None):
        params = {"date_from": date_from.isoformat()}
        if continuation_key:
            params["continuation_key"] = continuation_key
        return self.request("GET", f"/accounts/{remote_uid}/transactions", params=params)

    def delete_session(self, session_id):
        return self.request("DELETE", f"/sessions/{session_id}")
