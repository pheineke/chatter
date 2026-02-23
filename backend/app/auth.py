import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_access_token(token: str) -> uuid.UUID | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        sub = payload.get("sub")
        if sub is None:
            return None
        return uuid.UUID(sub)
    except (JWTError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Refresh token helpers
# ---------------------------------------------------------------------------

def generate_refresh_token() -> tuple[str, str]:
    """Return (raw_token, sha256_hex_hash).

    Store only the hash in the database; give the raw token to the client.
    """
    raw = secrets.token_urlsafe(48)
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, hashed


def hash_refresh_token(raw: str) -> str:
    """SHA-256 hex digest of a raw refresh token."""
    return hashlib.sha256(raw.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Personal API token helpers
# ---------------------------------------------------------------------------

def generate_api_token() -> tuple[str, str, str]:
    """Return (raw_token, prefix, sha256_hex_hash).

    Token format: ``<prefix8>.<random_body>``
    Store only the hash in the database; show the raw token to the user once.
    """
    prefix = secrets.token_urlsafe(6)[:8]  # 8 URL-safe chars
    body = secrets.token_urlsafe(42)        # ~56 URL-safe chars
    raw = f"{prefix}.{body}"
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, prefix, hashed


def hash_api_token(raw: str) -> str:
    """SHA-256 hex digest of a raw API token."""
    return hashlib.sha256(raw.encode()).hexdigest()
