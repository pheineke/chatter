import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import decode_access_token, hash_api_token
from app.database import get_db
from models.api_token import ApiToken
from models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


async def get_current_user(
    request: Request,
    token: Annotated[str | None, Depends(oauth2_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # ------------------------------------------------------------------
    # Personal API token path: Authorization: Bot <raw_token>
    # ------------------------------------------------------------------
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bot "):
        raw = auth_header[4:].strip()
        token_hash = hash_api_token(raw)
        result = await db.execute(
            select(ApiToken).where(
                ApiToken.token_hash == token_hash,
                ApiToken.revoked.is_(False),
            )
        )
        api_token = result.scalar_one_or_none()
        if api_token is None:
            raise credentials_exception

        # Update last_used_at (best-effort; don't block the request if it fails)
        try:
            await db.execute(
                update(ApiToken)
                .where(ApiToken.id == api_token.id)
                .values(last_used_at=datetime.now(timezone.utc))
            )
            await db.commit()
        except Exception:
            await db.rollback()

        # Load the owning user
        user_result = await db.execute(select(User).where(User.id == api_token.user_id))
        user = user_result.scalar_one_or_none()
        if user is None:
            raise credentials_exception
        return user

    # ------------------------------------------------------------------
    # JWT Bearer path: Authorization: Bearer <jwt>
    # ------------------------------------------------------------------
    if token is None:
        raise credentials_exception

    user_id = decode_access_token(token)
    if user_id is None:
        raise credentials_exception

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]
