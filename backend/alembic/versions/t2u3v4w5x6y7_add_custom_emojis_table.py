"""add_custom_emojis_table

Revision ID: t2u3v4w5x6y7
Revises: s1t2u3v4w5x6
Create Date: 2026-03-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 't2u3v4w5x6y7'
down_revision: Union[str, None] = 's1t2u3v4w5x6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'custom_emojis',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('server_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(length=32), nullable=False),
        sa.Column('image_path', sa.String(length=255), nullable=False),
        sa.Column('created_by_id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['server_id'], ['servers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('server_id', 'name', name='uq_custom_emoji_server_name'),
    )
    with op.batch_alter_table('custom_emojis', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_custom_emojis_server_id'), ['server_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('custom_emojis', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_custom_emojis_server_id'))

    op.drop_table('custom_emojis')
