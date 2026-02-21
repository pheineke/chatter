import uuid
from typing import List

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select, or_, and_
from sqlalchemy.orm import selectinload

from app.dependencies import CurrentUser, DB
from app.schemas.friend import FriendRequestCreate, FriendRequestRead, FriendRead
from app.ws_manager import manager
from models.friend import FriendRequest, FriendRequestStatus
from models.user import User

router = APIRouter(prefix="/friends", tags=["friends"])


@router.get("/requests", response_model=List[FriendRequestRead])
async def list_requests(current_user: CurrentUser, db: DB):
    """List all pending friend requests (sent and received)."""
    result = await db.execute(
        select(FriendRequest)
        .options(selectinload(FriendRequest.sender), selectinload(FriendRequest.recipient))
        .where(
            FriendRequest.status == FriendRequestStatus.pending,
            or_(
                FriendRequest.sender_id == current_user.id,
                FriendRequest.recipient_id == current_user.id,
            ),
        )
    )
    return result.scalars().all()


@router.post("/requests", response_model=FriendRequestRead, status_code=status.HTTP_201_CREATED)
async def send_request(body: FriendRequestCreate, current_user: CurrentUser, db: DB):
    if body.recipient_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot send a friend request to yourself")

    # Check target user exists
    result = await db.execute(select(User).where(User.id == body.recipient_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User not found")

    # Check for existing pending / accepted request in either direction
    existing = await db.execute(
        select(FriendRequest).where(
            FriendRequest.status.in_([FriendRequestStatus.pending, FriendRequestStatus.accepted]),
            or_(
                and_(
                    FriendRequest.sender_id == current_user.id,
                    FriendRequest.recipient_id == body.recipient_id,
                ),
                and_(
                    FriendRequest.sender_id == body.recipient_id,
                    FriendRequest.recipient_id == current_user.id,
                ),
            ),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Friend request already exists or already friends")

    fr = FriendRequest(sender_id=current_user.id, recipient_id=body.recipient_id)
    db.add(fr)
    await db.flush()

    result = await db.execute(
        select(FriendRequest)
        .options(selectinload(FriendRequest.sender), selectinload(FriendRequest.recipient))
        .where(FriendRequest.id == fr.id)
    )
    await db.commit()
    sent = result.scalar_one()
    await manager.broadcast_user(
        body.recipient_id,
        {"type": "friend_request.received", "data": FriendRequestRead.model_validate(sent).model_dump(mode="json")},
    )
    return sent


@router.post("/requests/{request_id}/accept", response_model=FriendRequestRead)
async def accept_request(request_id: uuid.UUID, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(FriendRequest)
        .options(selectinload(FriendRequest.sender), selectinload(FriendRequest.recipient))
        .where(FriendRequest.id == request_id)
    )
    fr = result.scalar_one_or_none()
    if not fr:
        raise HTTPException(status_code=404, detail="Friend request not found")
    if fr.recipient_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot accept a request not addressed to you")
    if fr.status != FriendRequestStatus.pending:
        raise HTTPException(status_code=400, detail="Request is no longer pending")
    fr.status = FriendRequestStatus.accepted
    sender_id = fr.sender_id
    await db.commit()
    result = await db.execute(
        select(FriendRequest)
        .options(selectinload(FriendRequest.sender), selectinload(FriendRequest.recipient))
        .where(FriendRequest.id == request_id)
    )
    fr = result.scalar_one()
    await manager.broadcast_user(
        sender_id,
        {"type": "friend_request.accepted", "data": FriendRequestRead.model_validate(fr).model_dump(mode="json")},
    )
    return fr


@router.post("/requests/{request_id}/decline", response_model=FriendRequestRead)
async def decline_request(request_id: uuid.UUID, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(FriendRequest)
        .options(selectinload(FriendRequest.sender), selectinload(FriendRequest.recipient))
        .where(FriendRequest.id == request_id)
    )
    fr = result.scalar_one_or_none()
    if not fr:
        raise HTTPException(status_code=404, detail="Friend request not found")
    if fr.recipient_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot decline a request not addressed to you")
    if fr.status != FriendRequestStatus.pending:
        raise HTTPException(status_code=400, detail="Request is no longer pending")
    fr.status = FriendRequestStatus.declined
    sender_id = fr.sender_id
    await db.commit()
    result = await db.execute(
        select(FriendRequest)
        .options(selectinload(FriendRequest.sender), selectinload(FriendRequest.recipient))
        .where(FriendRequest.id == request_id)
    )
    fr = result.scalar_one()
    await manager.broadcast_user(
        sender_id,
        {"type": "friend_request.declined", "data": FriendRequestRead.model_validate(fr).model_dump(mode="json")},
    )
    return fr


@router.delete("/requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_request(request_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Allow the sender to cancel their own pending friend request."""
    result = await db.execute(
        select(FriendRequest).where(FriendRequest.id == request_id)
    )
    fr = result.scalar_one_or_none()
    if not fr:
        raise HTTPException(status_code=404, detail="Friend request not found")
    if fr.sender_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot cancel a request you did not send")
    if fr.status != FriendRequestStatus.pending:
        raise HTTPException(status_code=400, detail="Request is no longer pending")
    await db.delete(fr)
    await db.commit()


@router.get("/", response_model=List[FriendRead])
async def list_friends(current_user: CurrentUser, db: DB):
    """Return all accepted friends of the current user."""
    result = await db.execute(
        select(FriendRequest)
        .options(selectinload(FriendRequest.sender), selectinload(FriendRequest.recipient))
        .where(
            FriendRequest.status == FriendRequestStatus.accepted,
            or_(
                FriendRequest.sender_id == current_user.id,
                FriendRequest.recipient_id == current_user.id,
            ),
        )
    )
    requests = result.scalars().all()

    # Return the "other" user in each accepted friendship
    friends = []
    for fr in requests:
        other = fr.recipient if fr.sender_id == current_user.id else fr.sender
        friends.append({"user": other})
    return friends


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_friend(user_id: uuid.UUID, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(FriendRequest).where(
            FriendRequest.status == FriendRequestStatus.accepted,
            or_(
                and_(
                    FriendRequest.sender_id == current_user.id,
                    FriendRequest.recipient_id == user_id,
                ),
                and_(
                    FriendRequest.sender_id == user_id,
                    FriendRequest.recipient_id == current_user.id,
                ),
            ),
        )
    )
    fr = result.scalar_one_or_none()
    if not fr:
        raise HTTPException(status_code=404, detail="Friend not found")
    await db.delete(fr)
    await db.commit()
