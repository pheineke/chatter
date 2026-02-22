"""add_dm_permission_and_user_blocks

Revision ID: j2f3a4b5c6d7
Revises: i0d1e2f3a4b5
Create Date: 2026-02-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'j2f3a4b5c6d7'
down_revision: Union[str, None] = 'i0d1e2f3a4b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add dm_permission column to users (stored as TEXT in SQLite)
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(
            sa.Column(
                'dm_permission',
                sa.String(20),
                nullable=False,
                server_default='everyone',
            )
        )

    # Create user_blocks table
    op.create_table(
        'user_blocks',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('blocker_id', sa.Uuid(), nullable=False),
        sa.Column('blocked_id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['blocked_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['blocker_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('blocker_id', 'blocked_id'),
    )
    op.create_index('ix_user_blocks_blocker_id', 'user_blocks', ['blocker_id'])
    op.create_index('ix_user_blocks_blocked_id', 'user_blocks', ['blocked_id'])


def downgrade() -> None:
    op.drop_index('ix_user_blocks_blocked_id', 'user_blocks')
    op.drop_index('ix_user_blocks_blocker_id', 'user_blocks')
    op.drop_table('user_blocks')
    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_column('dm_permission')
