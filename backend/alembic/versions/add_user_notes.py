"""add user_notes table

Revision ID: a1b2c3d4e5f6
Revises: 62dea8428b64
Create Date: 2026-02-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'a3f1c2d4e5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_notes',
        sa.Column('owner_id', sa.Uuid(), nullable=False),
        sa.Column('target_id', sa.Uuid(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False, server_default=''),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['target_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('owner_id', 'target_id'),
    )


def downgrade() -> None:
    op.drop_table('user_notes')
