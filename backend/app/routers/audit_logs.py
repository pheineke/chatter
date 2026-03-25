import uuid

from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy import select, desc
from sqlalchemy.orm import selectinload

from app.dependencies import CurrentUser, DB
from app.schemas.audit_log import AuditLogRead
from models.audit_log import AuditLog
from models.server import Server, ServerMember, Role, UserRole

router = APIRouter(prefix="/servers", tags=["audit-logs"])

async def check_admin_permission(server_id: uuid.UUID, user_id: uuid.UUID, db: DB):
    # Check if user is owner
    server = await db.scalar(select(Server).where(Server.id == server_id))
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    if server.owner_id == user_id:
        return True

    # Check if user has admin role
    # Join ServerMember -> UserRole -> Role
    stmt = (
        select(Role.is_admin)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user_id, Role.server_id == server_id)
    )
    results = await db.scalars(stmt)
    if any(results):
        return True
        
    raise HTTPException(status_code=403, detail="Missing permissions")

@router.get("/{server_id}/audit-logs", response_model=list[AuditLogRead])
async def get_audit_logs(
    server_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    user_id: str | None = Query(None, description="Filter by actor ID"),
    action_type: str | None = Query(None, description="Filter by action type"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """
    Get audit logs for a server with optional filtering.
    """
    await check_admin_permission(server_id, user.id, db)

    stmt = select(AuditLog).where(AuditLog.server_id == server_id)
    
    if user_id:
        try:
            uid = uuid.UUID(user_id)
            stmt = stmt.where(AuditLog.user_id == uid)
        except ValueError:
            # If not a valid UUID, return empty list or just ignore?
            # Safe to return empty list because no user will match an invalid UUID
            return []
            
    if action_type:
        stmt = stmt.where(AuditLog.action_type == action_type)

    stmt = stmt.order_by(desc(AuditLog.created_at)).limit(limit).offset(offset)
    
    result = await db.scalars(stmt)
    return result.all()
