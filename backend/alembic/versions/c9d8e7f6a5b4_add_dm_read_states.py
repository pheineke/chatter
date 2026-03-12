"""add_dm_read_states

Revision ID: c9d8e7f6a5b4
Revises: bfc3fc9ae647
Create Date: 2026-03-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9d8e7f6a5b4'
down_revision: Union[str, None] = 'bfc3fc9ae647'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'dm_read_states',
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('channel_id', sa.Uuid(), nullable=False),
        sa.Column('last_read_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['channel_id'], ['channels.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'channel_id'),
    )


def downgrade() -> None:
    op.drop_table('dm_read_states')
