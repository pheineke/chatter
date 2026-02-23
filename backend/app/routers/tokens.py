"""
Personal API token management endpoints.

GET    /me/tokens           – list active (non-revoked) tokens (no raw token)
POST   /me/tokens           – create a new token (raw token shown once)
DELETE /me/tokens/{token_id} – revoke a token
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import generate_api_token
from app.dependencies import CurrentUser, DB
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

    model_config = {"from_attributes": True}


class TokenCreatedResponse(TokenRead):
    """Returned only on token creation – includes the raw token."""
    token: str


class CreateTokenBody(BaseModel):
    name: str


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
    # Enforce per-user cap
    count_result = await db.execute(
        select(ApiToken).where(
            ApiToken.user_id == current_user.id,
            ApiToken.revoked.is_(False),
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
        name=body.name.strip(),
        token_hash=token_hash,
        token_prefix=prefix,
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
