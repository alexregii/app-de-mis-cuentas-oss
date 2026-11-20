#!/bin/sh
set -eu

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

mkdir -p /app/data/media /app/backups
python manage.py migrate --noinput
python manage.py seed_defaults
python manage.py collectstatic --noinput

case "${MOBILE_REVIEW_PREVIEW:-0}" in
  0) ;;
  1) python manage.py seed_e2e --mobile-review ;;
  *) echo "MOBILE_REVIEW_PREVIEW debe ser 0 o 1." >&2; exit 1 ;;
esac

GUNICORN_WORKERS="${GUNICORN_WORKERS:-4}"
GUNICORN_THREADS="${GUNICORN_THREADS:-1}"
GUNICORN_TIMEOUT="${GUNICORN_TIMEOUT:-90}"

exec gunicorn finance_tracker.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers "${GUNICORN_WORKERS}" \
  --threads "${GUNICORN_THREADS}" \
  --timeout "${GUNICORN_TIMEOUT}"
