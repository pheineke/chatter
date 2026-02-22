"""add channel slowmode_delay

Revision ID: e5f6a7b8c9d0
Revises: c3d4e5f6a1b2
Create Date: 2026-02-22

"""
from alembic import op
import sqlalchemy as sa

revision = 'e5f6a7b8c9d0'
down_revision = 'c3d4e5f6a1b2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('channels', sa.Column('slowmode_delay', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('channels', 'slowmode_delay')
