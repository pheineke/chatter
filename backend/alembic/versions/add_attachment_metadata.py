"""add filename, file_size, width, height to attachments

Revision ID: a1b2c3d4e5f7
Revises: f1a2b3c4d5e6
Create Date: 2026-02-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f7'
down_revision: Union[str, None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('attachments') as batch_op:
        batch_op.add_column(sa.Column('filename', sa.String(255), nullable=True))
        batch_op.add_column(sa.Column('file_size', sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column('width', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('height', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('attachments') as batch_op:
        batch_op.drop_column('height')
        batch_op.drop_column('width')
        batch_op.drop_column('file_size')
        batch_op.drop_column('filename')
