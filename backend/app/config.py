import sys
import uuid
from typing import Annotated

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
    algorithm: str = "HS256"
    # Access tokens are short-lived; rotating refresh tokens extend sessions securely
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    # Comma-separated list of user IDs that can generate decoration codes.
    # Default "*" allows any authenticated user (dev mode).
    decoration_admin_ids: str = "*"

    # File uploads
    static_dir: str = "static"
    max_upload_size: int = 8 * 1024 * 1024  # 8 MB

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
