import uuid
from typing import List

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, or_, select

from app.dependencies import CurrentUser, DB
from app.schemas.user import UserRead
from models.block import UserBlock
from models.user import User

router = APIRouter(tags=["blocks"])


@router.get("/users/me/blocks", response_model=List[UserRead])
async def list_blocks(current_user: CurrentUser, db: DB):
    """Return all users the current user has blocked."""
    result = await db.execute(
        select(User)
        .join(UserBlock, UserBlock.blocked_id == User.id)
        .where(UserBlock.blocker_id == current_user.id)
    )
    return result.scalars().all()


@router.post("/users/{user_id}/block", status_code=status.HTTP_204_NO_CONTENT)
async def block_user(user_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Block a user. Idempotent — blocking an already-blocked user is a no-op."""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot block yourself")

    # Ensure the target user exists
    target = await db.execute(select(User).where(User.id == user_id))
    if not target.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User not found")

    # Idempotent: skip if already blocked
    existing = await db.execute(
        select(UserBlock).where(
            UserBlock.blocker_id == current_user.id,
            UserBlock.blocked_id == user_id,
        )
    )
    if existing.scalar_one_or_none():
        return

    db.add(UserBlock(blocker_id=current_user.id, blocked_id=user_id))
    await db.commit()


@router.delete("/users/{user_id}/block", status_code=status.HTTP_204_NO_CONTENT)
async def unblock_user(user_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Unblock a user. No-op if the user was not blocked."""
    result = await db.execute(
        select(UserBlock).where(
            UserBlock.blocker_id == current_user.id,
            UserBlock.blocked_id == user_id,
        )
    )
    block = result.scalar_one_or_none()
    if block:
        await db.delete(block)
        await db.commit()
