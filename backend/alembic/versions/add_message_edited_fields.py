"""add is_edited and edited_at to messages

Revision ID: b2c3d4e5f6a1
Revises: a1b2c3d4e5f6
Create Date: 2026-02-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b2c3d4e5f6a1'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('messages', sa.Column('is_edited', sa.Boolean(), nullable=False, server_default='0'))
    op.add_column('messages', sa.Column('edited_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('messages', 'edited_at')
    op.drop_column('messages', 'is_edited')
