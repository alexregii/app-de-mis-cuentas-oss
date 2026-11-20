FROM python:3.13-slim@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

ARG SOURCE_REVISION=unversioned
ARG MOBILE_REVIEW_PREVIEW=false
LABEL org.opencontainers.image.revision=$SOURCE_REVISION \
  com.app.mobile-review=$MOBILE_REVIEW_PREVIEW

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN test ! -e /app/.e2e \
  && test ! -e /app/frontend-react/.e2e \
  && test -z "$(find /app -type d -name .e2e -print -quit)" \
  && test -z "$(find /app -type d -name secrets -print -quit)" \
  && test -z "$(find /app -type f \( -name '.env*' -o -name '*.env' -o -name '*.pem' -o -name '*.p12' -o -name '*.pfx' -o -name '*.key' -o -name 'credentials.*' -o -name '*-credentials.*' -o -name '*.sqlite' -o -name '*.sqlite-*' -o -name '*.sqlite3' -o -name '*.sqlite3-*' -o -name '*.db' -o -name '*.db-*' \) -print -quit)"
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/', timeout=3)"
ENTRYPOINT ["/app/entrypoint.sh"]
