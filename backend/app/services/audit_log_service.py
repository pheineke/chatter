import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from models.audit_log import AuditLog, AuditLogAction

async def create_audit_log(
    session: AsyncSession,
    server_id: uuid.UUID,
    user_id: uuid.UUID | None,
    action: AuditLogAction,
    target_id: uuid.UUID | None = None,
    changes: dict[str, Any] | None = None,
    reason: str | None = None,
) -> AuditLog:
    """
    Creates an audit log entry.
    Does NOT commit the session. The caller is responsible for committing.
    """
    log_entry = AuditLog(
        server_id=server_id,
        user_id=user_id,
        action_type=action.value,
        target_id=target_id,
        changes=changes,
        reason=reason,
    )
    session.add(log_entry)
    return log_entry
