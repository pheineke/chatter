"""add unique constraint on reactions (message_id, user_id, emoji)

Revision ID: b2c3d4e5f6a8
Revises: a1b2c3d4e5f7
Create Date: 2026-02-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b2c3d4e5f6a8'
down_revision: Union[str, None] = 'a1b2c3d4e5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # First deduplicate any existing dupes (keep lowest rowid)
    op.execute("""
        DELETE FROM reactions
        WHERE rowid NOT IN (
            SELECT MIN(rowid)
            FROM reactions
            GROUP BY message_id, user_id, emoji
        )
    """)
    # SQLite requires batch mode to add a unique constraint
    with op.batch_alter_table('reactions') as batch_op:
        batch_op.create_unique_constraint(
            'uq_reaction_message_user_emoji',
            ['message_id', 'user_id', 'emoji'],
        )


def downgrade() -> None:
    with op.batch_alter_table('reactions') as batch_op:
        batch_op.drop_constraint('uq_reaction_message_user_emoji', type_='unique')
