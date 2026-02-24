"""add preferred_status to users

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-02-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add preferred_status column defaulting to 'online'
    # (The user_status enum already exists from the initial migration)
    op.add_column(
        'users',
        sa.Column(
            'preferred_status',
            sa.Enum('online', 'away', 'busy', 'dnd', 'offline', name='user_status'),
            nullable=False,
            server_default='online',
        ),
    )


def downgrade() -> None:
    op.drop_column('users', 'preferred_status')
