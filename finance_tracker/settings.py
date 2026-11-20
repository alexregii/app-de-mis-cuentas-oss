import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "django-insecure-local-development-only")
DEBUG = os.getenv("DJANGO_DEBUG", "1") == "1"
MOBILE_REVIEW_PREVIEW = os.getenv("MOBILE_REVIEW_PREVIEW", "0") == "1"
ALLOWED_HOSTS = [host.strip() for host in os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")]
CSRF_TRUSTED_ORIGINS = [
    origin.strip() for origin in os.getenv("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",") if origin.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "ledger.apps.LedgerConfig",
]

MIDDLEWARE = [
    "ledger.performance.PerformanceMetricsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "ledger.middleware.BackendOperationLockMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "ledger.auth_middleware.FinanceAuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
if MOBILE_REVIEW_PREVIEW:
    MIDDLEWARE.insert(0, "ledger.middleware.MobileReviewCookieIsolationMiddleware")

ROOT_URLCONF = "finance_tracker.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]
WSGI_APPLICATION = "finance_tracker.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": Path(os.getenv("DATABASE_PATH", BASE_DIR / "data" / "db.sqlite3")),
        "OPTIONS": {
            "timeout": 20,
            "transaction_mode": os.getenv("SQLITE_TRANSACTION_MODE", "IMMEDIATE"),
        },
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
LANGUAGE_CODE = "es-es"
TIME_ZONE = "Europe/Madrid"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
RUNNING_TESTS = "test" in sys.argv
FINANCE_AUTH_REQUIRED = False if RUNNING_TESTS else (not DEBUG or os.getenv("DJANGO_REQUIRE_AUTH", "0") == "1")
RESTORE_COORDINATOR_ENABLED = os.getenv("RESTORE_COORDINATOR_ENABLED", "1") == "1"
PERFORMANCE_INSTRUMENTATION = os.getenv("PERFORMANCE_INSTRUMENTATION", "0") == "1"
PERFORMANCE_METRICS_PATH = os.getenv("PERFORMANCE_METRICS_PATH", "")

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": (
            "django.contrib.staticfiles.storage.StaticFilesStorage"
            if DEBUG or RUNNING_TESTS
            else "whitenoise.storage.CompressedManifestStaticFilesStorage"
        )
    },
}
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", BASE_DIR / "data" / "media"))
DATA_UPLOAD_MAX_MEMORY_SIZE = 12 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 12 * 1024 * 1024

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_NAME = os.getenv("DJANGO_SESSION_COOKIE_NAME", "sessionid")
CSRF_COOKIE_NAME = os.getenv("DJANGO_CSRF_COOKIE_NAME", "csrftoken")
secure_cookies = os.getenv("DJANGO_SECURE_COOKIES", "0" if DEBUG else "1") == "1"
SESSION_COOKIE_SECURE = secure_cookies
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 12 * 60 * 60
CSRF_COOKIE_SECURE = os.getenv(
    "DJANGO_CSRF_COOKIE_SECURE",
    "1" if secure_cookies else "0",
) == "1"
CSRF_COOKIE_SAMESITE = "Lax"
SECURE_SSL_REDIRECT = os.getenv("DJANGO_SECURE_SSL_REDIRECT", "0") == "1"
SECURE_HSTS_SECONDS = int(os.getenv("DJANGO_SECURE_HSTS_SECONDS", "0"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

ENABLE_BANKING_APP_ID = os.getenv("ENABLE_BANKING_APP_ID", "")
ENABLE_BANKING_PRIVATE_KEY_PATH = os.getenv("ENABLE_BANKING_PRIVATE_KEY_PATH", "/run/secrets/enable_banking_private_key")
ENABLE_BANKING_API_URL = os.getenv("ENABLE_BANKING_API_URL", "https://api.enablebanking.com")
ENABLE_BANKING_REDIRECT_URL = os.getenv("ENABLE_BANKING_REDIRECT_URL", "")
LOCAL_LLM_URL = os.getenv("LOCAL_LLM_URL", "http://ollama:11434")
LOCAL_LLM_MODEL = os.getenv("LOCAL_LLM_MODEL", "qwen3:1.7b")
