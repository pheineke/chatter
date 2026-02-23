"""add_word_filters_and_server_bans

Revision ID: m5n6o7p8q9r0
Revises: l4m5n6o7p8q9
Create Date: 2026-02-23 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'm5n6o7p8q9r0'
down_revision = 'l4m5n6o7p8q9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'word_filters',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('server_id', sa.Uuid(), nullable=False),
        sa.Column('pattern', sa.String(100), nullable=False),
        sa.Column('action', sa.String(20), nullable=False, server_default='delete'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['server_id'], ['servers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_word_filters_server_id', 'word_filters', ['server_id'])

    op.create_table(
        'server_bans',
        sa.Column('server_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('banned_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['server_id'], ['servers.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('server_id', 'user_id'),
    )


def downgrade() -> None:
    op.drop_table('server_bans')
    op.drop_index('ix_word_filters_server_id', 'word_filters')
    op.drop_table('word_filters')
