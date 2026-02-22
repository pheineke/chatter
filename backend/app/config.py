from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # File uploads
    static_dir: str = "static"
    max_upload_size: int = 8 * 1024 * 1024  # 8 MB

    # Rate limiting (message spam protection)
    ratelimit_enabled: bool = True
    ratelimit_messages: int = 10    # max messages per window
    ratelimit_window_seconds: int = 5  # rolling window size


settings = Settings()
