import sys
import uuid
from typing import Annotated

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_WARNED = False


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

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
        _WARNED = True
        return self

    def is_decoration_admin(self, user_id: uuid.UUID | str) -> bool:
        """Return True if the given user is allowed to generate decoration codes."""
        raw = self.decoration_admin_ids
        if raw == "*":
            return True
        return str(user_id) in [uid.strip() for uid in raw.split(",") if uid.strip()]


settings = Settings()
