# ── Build stage: compilers live here only ─────────────────────────────────────
FROM python:3.11-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt


# ── Runtime stage ────────────────────────────────────────────────────────────
FROM python:3.11-slim

# The app runs as an unprivileged user (S24). The UID defaults to 1000 so the
# bind-mounted ./backend/static (owned by the first host user on most Linux
# systems) stays writable; build with --build-arg APP_UID=$(id -u) otherwise.
ARG APP_UID=1000
ARG APP_GID=1000
RUN groupadd --gid "$APP_GID" app \
    && useradd --uid "$APP_UID" --gid app --no-create-home --shell /usr/sbin/nologin app

COPY --from=build /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
# Code is owned by root and read-only for the app user; only static/ is writable.
COPY . .
RUN mkdir -p static && chown app:app static

USER app

# Run Alembic migrations and start the application.
# --proxy-headers: take the client IP from nginx's X-Forwarded-For (needed for
# per-IP rate limiting; otherwise every request looks like it comes from the
# nginx container). Trusting any sender ("*") is only safe because the
# backend port is not published; see docker-compose.yml. Override with
# FORWARDED_ALLOW_IPS=<nginx ip/cidr> if you expose it.
CMD sh -c "alembic upgrade head && exec uvicorn main:app --host 0.0.0.0 --port 8000 --ws-max-size 65536 --proxy-headers --forwarded-allow-ips=\"${FORWARDED_ALLOW_IPS:-*}\""
