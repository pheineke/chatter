import uuid
from pydantic import BaseModel


class VoiceParticipantRead(BaseModel):
    """Public representation of a voice channel participant."""

    user_id: uuid.UUID
    username: str
    avatar: str | None = None
    is_muted: bool
    is_deafened: bool
    is_sharing_screen: bool
    is_sharing_webcam: bool
    is_speaking: bool = False
