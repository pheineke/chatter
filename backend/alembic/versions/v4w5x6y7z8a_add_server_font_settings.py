"""add_server_font_settings

Revision ID: v4w5x6y7z8a
Revises: u3v4w5x6y7z
Create Date: 2026-03-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'v4w5x6y7z8a'
down_revision: Union[str, None] = 'u3v4w5x6y7z'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('allow_server_fonts', sa.Boolean(), nullable=False, server_default=sa.true()))

    with op.batch_alter_table('servers', schema=None) as batch_op:
        batch_op.add_column(sa.Column('custom_font_name', sa.String(length=80), nullable=True))
        batch_op.add_column(sa.Column('custom_font_path', sa.String(length=255), nullable=True))

    with op.batch_alter_table('server_members', schema=None) as batch_op:
        batch_op.add_column(sa.Column('use_server_font', sa.Boolean(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('server_members', schema=None) as batch_op:
        batch_op.drop_column('use_server_font')

    with op.batch_alter_table('servers', schema=None) as batch_op:
        batch_op.drop_column('custom_font_path')
        batch_op.drop_column('custom_font_name')

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('allow_server_fonts')
