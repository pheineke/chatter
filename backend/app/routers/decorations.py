"""Avatar decoration code redemption & generation."""

import secrets
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.dependencies import CurrentUser, DB
from models.decoration_code import DecorationCode

router = APIRouter(prefix="/decorations", tags=["decorations"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class RedeemBody(BaseModel):
    code: str


class GenerateBody(BaseModel):
    frame_id: str
    count: int = 1


class FrameEntry(BaseModel):
    frame_id: str


class GeneratedCode(BaseModel):
    code: str
    frame_id: str


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/me", response_model=list[FrameEntry])
async def my_decorations(current_user: CurrentUser, db: DB):
    """Return the list of frame_ids the current user has unlocked."""
    result = await db.execute(
        select(DecorationCode.frame_id)
        .where(DecorationCode.redeemed_by == current_user.id)
        .distinct()
    )
    return [FrameEntry(frame_id=row[0]) for row in result.all()]


@router.post("/redeem", response_model=FrameEntry)
async def redeem_code(body: RedeemBody, current_user: CurrentUser, db: DB):
    """Redeem a decoration code to unlock a frame."""
    code_str = body.code.strip().upper()
    if not code_str:
        raise HTTPException(status_code=422, detail="Code cannot be empty")

    result = await db.execute(
        select(DecorationCode).where(DecorationCode.code == code_str)
    )
    deco = result.scalar_one_or_none()

    if not deco:
        raise HTTPException(status_code=404, detail="Invalid code")

    if deco.redeemed_by is not None:
        if deco.redeemed_by == current_user.id:
            raise HTTPException(status_code=400, detail="You have already redeemed this code")
        raise HTTPException(status_code=400, detail="This code has already been used")

    # Check if user already owns this frame (from another code)
    existing = await db.execute(
        select(DecorationCode.id)
        .where(
            DecorationCode.redeemed_by == current_user.id,
            DecorationCode.frame_id == deco.frame_id,
        )
        .limit(1)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="You already own this decoration")

    deco.redeemed_by = current_user.id
    db.add(deco)
    await db.commit()
    return FrameEntry(frame_id=deco.frame_id)


@router.post("/generate", response_model=list[GeneratedCode])
async def generate_codes(body: GenerateBody, current_user: CurrentUser, db: DB):
    """Generate decoration codes. Limited to 50 per call.

    NOTE: In production this should be admin-only. For now any authenticated
    user can generate codes (useful during development).
    """
    if body.count < 1 or body.count > 50:
        raise HTTPException(status_code=422, detail="Count must be between 1 and 50")

    codes: list[GeneratedCode] = []
    for _ in range(body.count):
        code_str = secrets.token_hex(8).upper()  # 16-char hex
        deco = DecorationCode(code=code_str, frame_id=body.frame_id)
        db.add(deco)
        codes.append(GeneratedCode(code=code_str, frame_id=body.frame_id))

    await db.commit()
    return codes
