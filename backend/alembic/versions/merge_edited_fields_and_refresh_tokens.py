"""merge add_message_edited_fields and add_refresh_tokens heads

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a1, b2c3d4e5f6a7
Create Date: 2026-02-22 00:01:00.000000

"""
from typing import Sequence, Union

revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, tuple, None] = ('b2c3d4e5f6a1', 'b2c3d4e5f6a7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
