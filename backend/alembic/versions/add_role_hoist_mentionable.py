"""add hoist and mentionable flags to roles

Revision ID: c3d4e5f6a7b9
Revises: b2c3d4e5f6a8
Create Date: 2026-02-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c3d4e5f6a7b9'
down_revision: Union[str, None] = 'b2c3d4e5f6a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('roles') as batch_op:
        batch_op.add_column(sa.Column('hoist', sa.Boolean(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('mentionable', sa.Boolean(), nullable=False, server_default='0'))


def downgrade() -> None:
    with op.batch_alter_table('roles') as batch_op:
        batch_op.drop_column('mentionable')
        batch_op.drop_column('hoist')
