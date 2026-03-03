"""add_dm_to_channel_type_enum

Revision ID: bfc3fc9ae647
Revises: r0s1t2u3v4w5
Create Date: 2026-03-03 20:25:58.025484

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'bfc3fc9ae647'
down_revision: Union[str, None] = 'r0s1t2u3v4w5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add 'dm' to the channel_type enum in PostgreSQL.
    # IF NOT EXISTS prevents failure when re-run or on non-PG dialects.
    op.execute("ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'dm'")


def downgrade() -> None:
    # Postgres does not support removing enum values; downgrade is a no-op.
    pass
