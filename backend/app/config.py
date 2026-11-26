import sys
import uuid
from typing import Annotated, Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_WARNED = False


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Deployment environment. Set ENVIRONMENT=production to enable hard
    # startup checks that refuse to run with insecure defaults (see
    # _reject_insecure_production_defaults below). Defaults to "development"
    # so local/dev workflows are unaffected.
    environment: str = "development"

    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/chat"

    # JWT
    secret_key: str = "change-me-in-production"
    # HMAC only: the key is a shared secret, so an asymmetric or "none"
    # algorithm here would be a misconfiguration (security_pass S29).
    algorithm: Literal["HS256", "HS384", "HS512"] = "HS256"
    # Access tokens are short-lived; rotating refresh tokens extend sessions securely
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    # Who may create an account:
    #   open    anyone (default, convenient for local development)
    #   invite  only with a valid server invite code; the first account on an
    #           empty instance is always allowed, so the owner can bootstrap
    #   closed  nobody (existing accounts keep working)
    registration_mode: Literal["open", "invite", "closed"] = "open"
    # A rotated refresh token replayed within this many seconds is rejected
    # without wiping the user's other sessions (two tabs refreshing at once,
    # a response lost in transit). Later replays are treated as theft.
    refresh_reuse_grace_seconds: int = 30
    # Browsers keep the refresh token in an HttpOnly cookie, so injected
    # script can't read it (security_pass S15). Its Path is the browser-side
    # path of the auth routes: behind the bundled nginx they live under /api.
    refresh_cookie_name: str = "chatter_rt"
    refresh_cookie_path: str = "/api/auth"
    # None = Secure when the request arrived over HTTPS (X-Forwarded-Proto is
    # trusted via uvicorn --proxy-headers). Browsers drop Secure cookies on
    # plain-HTTP LAN addresses, so don't force it on there.
    refresh_cookie_secure: bool | None = None

    # Comma-separated list of user IDs that can generate decoration codes.
    # Default "*" allows any authenticated user (dev mode).
    decoration_admin_ids: str = "*"

    # File uploads
    static_dir: str = "static"
    max_upload_size: int = 8 * 1024 * 1024  # 8 MB — per attachment / image upload
    # Requests whose Content-Length exceeds this are rejected before the body
    # is read (multipart overhead on top of max_upload_size).
    max_request_body: int = 9 * 1024 * 1024
    max_attachments_per_message: int = 10
    # Total attachment bytes a user may store; 0 disables the quota.
    user_storage_quota_mb: int = 500
    # Refuse uploads when the static volume has less free space than this.
    min_free_disk_mb: int = 1024

    # Rate limiting (message spam protection)
    ratelimit_enabled: bool = True
    ratelimit_messages: int = 10    # max messages per window
    ratelimit_window_seconds: int = 5  # rolling window size
    ratelimit_redis_url: str | None = None
    # Auth anti-bruteforce limits
    ratelimit_auth_ip_per_minute: int = 30
    ratelimit_auth_login_ip_user_per_minute: int = 6

    @model_validator(mode="after")
    def _warn_default_secret(self) -> "Settings":
        global _WARNED
        if _WARNED:
            return self
        if self.secret_key == "change-me-in-production":
            print(
                "  ⚠  WARNING: Using default SECRET_KEY. Set a strong, unique value in your .env file.\n"
                "     JWT-based authentication will be insecure otherwise.",
                file=sys.stderr,
            )
        if self.decoration_admin_ids == "*":
            print(
                "  ⚠  WARNING: DECORATION_ADMIN_IDS is unset ('*'). Any authenticated user can\n"
                "     generate decoration codes. Restrict this to specific admin UUIDs in production.",
                file=sys.stderr,
            )
        _WARNED = True
        return self

    @model_validator(mode="after")
    def _reject_insecure_production_defaults(self) -> "Settings":
        """Refuse to start with known-insecure defaults when explicitly
        running in production. Local/dev runs (the default) are unaffected;
        this only trips when ENVIRONMENT=production is set, e.g. in the
        deployment's .env or docker-compose environment block.
        """
        if self.environment.lower() != "production":
            return self

        problems = []
        if self.secret_key == "change-me-in-production":
            problems.append("SECRET_KEY is still the default placeholder")
        if len(self.secret_key) < 32:
            problems.append("SECRET_KEY is shorter than 32 characters")
        if self.decoration_admin_ids == "*":
            problems.append("DECORATION_ADMIN_IDS is '*' (any user can act as admin)")
        if "postgres:postgres@" in self.database_url:
            problems.append("DATABASE_URL still uses the default postgres:postgres credentials")
        if self.access_token_expire_minutes > 60:
            problems.append(
                f"ACCESS_TOKEN_EXPIRE_MINUTES is {self.access_token_expire_minutes} "
                "(max 60; refresh tokens keep sessions alive)"
            )

        if problems:
            raise RuntimeError(
                "Refusing to start with ENVIRONMENT=production and insecure settings:\n  - "
                + "\n  - ".join(problems)
                + "\nSet proper values via environment variables or .env before deploying."
            )
        return self

    def is_decoration_admin(self, user_id: uuid.UUID | str) -> bool:
        """Return True if the given user is allowed to generate decoration codes."""
        raw = self.decoration_admin_ids
        if raw == "*":
            return True
        return str(user_id) in [uid.strip() for uid in raw.split(",") if uid.strip()]


settings = Settings()
