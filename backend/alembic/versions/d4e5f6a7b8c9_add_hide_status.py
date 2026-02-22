"""add hide_status to users

Revision ID: k3l4m5n6o7p8
Revises: j2f3a4b5c6d7
Create Date: 2026-02-23 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision: str = 'k3l4m5n6o7p8'
down_revision: str = 'j2f3a4b5c6d7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('hide_status', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column('users', 'hide_status')
