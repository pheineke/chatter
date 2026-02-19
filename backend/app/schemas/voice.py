import uuid
from pydantic import BaseModel


class VoiceParticipantRead(BaseModel):
    """Public representation of a voice channel participant."""

    user_id: uuid.UUID
    is_muted: bool
    is_deafened: bool
    is_sharing_screen: bool
    is_sharing_webcam: bool
