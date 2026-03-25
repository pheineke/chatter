"""add_theme_preferences_to_users

Revision ID: a2c8cb61c6be
Revises: a286468c08f4
Create Date: 2026-03-25 21:48:34.766676

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2c8cb61c6be'
down_revision: Union[str, None] = 'a286468c08f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('theme_preset', sa.String(length=50), nullable=True))
    op.add_column('users', sa.Column('theme_colors', sa.Text(), nullable=True))

def downgrade() -> None:
    op.drop_column('users', 'theme_colors')
    op.drop_column('users', 'theme_preset')
