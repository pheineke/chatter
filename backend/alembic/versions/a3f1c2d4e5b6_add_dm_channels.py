"""add_dm_channels

Revision ID: a3f1c2d4e5b6
Revises: 62dea8428b64
Create Date: 2026-02-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a3f1c2d4e5b6'
down_revision: Union[str, None] = '62dea8428b64'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite stores enums as TEXT so no ALTER TYPE needed.
    # Make channels.server_id nullable using batch mode (required for SQLite).
    with op.batch_alter_table('channels') as batch_op:
        batch_op.alter_column('server_id', existing_type=sa.Uuid(), nullable=True)

    # Create dm_channels lookup table
    op.create_table(
        'dm_channels',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('channel_id', sa.Uuid(), nullable=False),
        sa.Column('user_a_id', sa.Uuid(), nullable=False),
        sa.Column('user_b_id', sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(['channel_id'], ['channels.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_a_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_b_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('channel_id'),
        sa.UniqueConstraint('user_a_id', 'user_b_id', name='uq_dm_channel_pair'),
    )


def downgrade() -> None:
    op.drop_table('dm_channels')

    with op.batch_alter_table('channels') as batch_op:
        batch_op.alter_column('server_id', existing_type=sa.Uuid(), nullable=False)
