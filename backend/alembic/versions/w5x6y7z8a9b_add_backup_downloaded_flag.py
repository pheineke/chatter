"""add_backup_downloaded_flag

Revision ID: w5x6y7z8a9b
Revises: v4w5x6y7z8a
Create Date: 2026-06-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'w5x6y7z8a9b'
down_revision: Union[str, None] = 'v4w5x6y7z8a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('backup_downloaded', sa.Boolean(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('users', 'backup_downloaded')
