import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict
from models.audit_log import AuditLogAction

class AuditLogCreate(BaseModel):
    action: AuditLogAction
    target_id: uuid.UUID | None
    changes: dict[str, Any] | None
    reason: str | None

class AuditLogRead(BaseModel):
    id: uuid.UUID
    server_id: uuid.UUID
    user_id: uuid.UUID | None
    action_type: str
    target_id: uuid.UUID | None
    changes: dict[str, Any] | None
    reason: str | None
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)
    reason: str | None
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)
