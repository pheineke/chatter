"""add user_agent and last_used_at to refresh_tokens

Revision ID: n6o7p8q9r0s1
Revises: m5n6o7p8q9r0
Create Date: 2026-02-23 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'n6o7p8q9r0s1'
down_revision: Union[str, None] = 'm5n6o7p8q9r0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'refresh_tokens',
        sa.Column('user_agent', sa.String(512), nullable=True),
    )
    op.add_column(
        'refresh_tokens',
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('refresh_tokens', 'last_used_at')
    op.drop_column('refresh_tokens', 'user_agent')
