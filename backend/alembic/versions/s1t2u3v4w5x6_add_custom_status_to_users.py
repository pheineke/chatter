"""add_custom_status_to_users

Revision ID: s1t2u3v4w5x6
Revises: a2c8cb61c6be
Create Date: 2026-03-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 's1t2u3v4w5x6'
down_revision: Union[str, None] = 'a2c8cb61c6be'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('custom_status', sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'custom_status')
