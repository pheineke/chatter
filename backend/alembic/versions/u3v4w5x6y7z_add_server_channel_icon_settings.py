"""add_server_channel_icon_settings

Revision ID: u3v4w5x6y7z
Revises: t2u3v4w5x6y7
Create Date: 2026-03-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'u3v4w5x6y7z'
down_revision: Union[str, None] = 't2u3v4w5x6y7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('servers', schema=None) as batch_op:
        batch_op.add_column(sa.Column('text_channel_icon', sa.String(length=32), nullable=False, server_default='hash'))
        batch_op.add_column(sa.Column('voice_channel_icon', sa.String(length=32), nullable=False, server_default='headphones'))


def downgrade() -> None:
    with op.batch_alter_table('servers', schema=None) as batch_op:
        batch_op.drop_column('voice_channel_icon')
        batch_op.drop_column('text_channel_icon')
