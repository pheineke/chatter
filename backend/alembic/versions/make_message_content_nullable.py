"""make messages.content nullable (allow attachment-only messages)

Revision ID: f1a2b3c4d5e6
Revises: e5f6a7b8c9d0
Create Date: 2026-02-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite doesn't support ALTER COLUMN, so we use batch mode
    with op.batch_alter_table('messages') as batch_op:
        batch_op.alter_column('content', existing_type=sa.Text(), nullable=True)


def downgrade() -> None:
    # Set any NULL content to empty string before re-adding NOT NULL constraint
    op.execute("UPDATE messages SET content = '' WHERE content IS NULL")
    with op.batch_alter_table('messages') as batch_op:
        batch_op.alter_column('content', existing_type=sa.Text(), nullable=False)
