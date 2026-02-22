"""add nickname to server_members

Revision ID: d4e5f6a7b8c0
Revises: c3d4e5f6a7b9
Create Date: 2026-02-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd4e5f6a7b8c0'
down_revision: Union[str, None] = 'c3d4e5f6a7b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('server_members') as batch_op:
        batch_op.add_column(sa.Column('nickname', sa.String(32), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('server_members') as batch_op:
        batch_op.drop_column('nickname')
