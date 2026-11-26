"""
Personal API token management endpoints.

GET    /me/tokens           – list active (non-revoked) tokens (no raw token)
POST   /me/tokens           – create a new token (raw token shown once)
DELETE /me/tokens/{token_id} – revoke a token
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import ws_enforcement
from app.auth import generate_api_token
from app.dependencies import CurrentUser, DB
from app.token_scopes import ALL_SCOPES, Scope, parse_scopes
from models.api_token import ApiToken

router = APIRouter(prefix="/me/tokens", tags=["api-tokens"])

MAX_ACTIVE_TOKENS = 5


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class TokenRead(BaseModel):
    id: uuid.UUID
    name: str
    token_prefix: str
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime | None
    scopes: list[str]

    model_config = {"from_attributes": True}

    @field_validator("scopes", mode="before")
    @classmethod
    def _split_scopes(cls, v):
        if isinstance(v, str):
            return [s for s in ALL_SCOPES if s in parse_scopes(v)]
        return v


class TokenCreatedResponse(TokenRead):
    """Returned only on token creation – includes the raw token."""
    token: str


class CreateTokenBody(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    # Least privilege by default: a new token can only read.
    scopes: list[Scope] = Field(default_factory=lambda: ["read"], min_length=1)
    # None = never expires. Otherwise 1 day to 1 year.
    expires_in_days: int | None = Field(default=90, ge=1, le=365)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name must not be blank.")
        return v


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=list[TokenRead])
async def list_tokens(
    current_user: CurrentUser,
    db: DB,
) -> list[ApiToken]:
    result = await db.execute(
        select(ApiToken)
        .where(ApiToken.user_id == current_user.id, ApiToken.revoked.is_(False))
        .order_by(ApiToken.created_at.asc())
    )
    return list(result.scalars().all())


@router.post("", response_model=TokenCreatedResponse, status_code=status.HTTP_201_CREATED)
async def create_token(
    body: CreateTokenBody,
    current_user: CurrentUser,
    db: DB,
) -> dict:
    # Enforce per-user cap (expired tokens don't count)
    now = datetime.now(timezone.utc)
    count_result = await db.execute(
        select(ApiToken).where(
            ApiToken.user_id == current_user.id,
            ApiToken.revoked.is_(False),
            (ApiToken.expires_at.is_(None)) | (ApiToken.expires_at > now),
        )
    )
    active = list(count_result.scalars().all())
    if len(active) >= MAX_ACTIVE_TOKENS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Maximum of {MAX_ACTIVE_TOKENS} active tokens allowed.",
        )

    raw, prefix, token_hash = generate_api_token()

    api_token = ApiToken(
        user_id=current_user.id,
        name=body.name,
        token_hash=token_hash,
        token_prefix=prefix,
        scopes=",".join(s for s in ALL_SCOPES if s in body.scopes),
        expires_at=now + timedelta(days=body.expires_in_days) if body.expires_in_days else None,
    )
    db.add(api_token)
    await db.commit()
    await db.refresh(api_token)

    return {
        "id": api_token.id,
        "name": api_token.name,
        "token_prefix": api_token.token_prefix,
        "created_at": api_token.created_at,
        "last_used_at": api_token.last_used_at,
        "expires_at": api_token.expires_at,
        "scopes": api_token.scopes,
        "token": raw,
    }


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_token(
    token_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> None:
    result = await db.execute(
        select(ApiToken).where(
            ApiToken.id == token_id,
            ApiToken.user_id == current_user.id,
        )
    )
    api_token = result.scalar_one_or_none()
    if api_token is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found.")
    api_token.revoked = True
    db.add(api_token)
    await db.commit()
    await ws_enforcement.close_api_token(api_token.id)
