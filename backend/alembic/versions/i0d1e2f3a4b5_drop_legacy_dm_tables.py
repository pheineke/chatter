"""drop legacy direct_messages and dm_attachments tables

Revision ID: i0d1e2f3a4b5
Revises: h9c0d1e2f3a4
Create Date: 2025-01-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'i0d1e2f3a4b5'
down_revision = 'h9c0d1e2f3a4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop child table first (foreign key to direct_messages)
    op.drop_table('dm_attachments')
    op.drop_table('direct_messages')


def downgrade() -> None:
    op.create_table(
        'direct_messages',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('sender_id', sa.Uuid(), nullable=False),
        sa.Column('recipient_id', sa.Uuid(), nullable=False),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('(CURRENT_TIMESTAMP)')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('(CURRENT_TIMESTAMP)')),
        sa.ForeignKeyConstraint(['recipient_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sender_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'dm_attachments',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('dm_id', sa.Uuid(), nullable=False),
        sa.Column('file_path', sa.String(), nullable=False),
        sa.Column('file_type', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('(CURRENT_TIMESTAMP)')),
        sa.ForeignKeyConstraint(['dm_id'], ['direct_messages.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
