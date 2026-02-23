"""add_notification_settings

Revision ID: l4m5n6o7p8q9
Revises: k3l4m5n6o7p8
Create Date: 2025-01-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'l4m5n6o7p8q9'
down_revision = 'k3l4m5n6o7p8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'user_channel_notification_settings',
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('channel_id', sa.Uuid(), nullable=False),
        sa.Column('level', sa.String(10), nullable=False, server_default='all'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['channel_id'], ['channels.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'channel_id'),
    )
    op.create_table(
        'user_server_notification_settings',
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('server_id', sa.Uuid(), nullable=False),
        sa.Column('level', sa.String(10), nullable=False, server_default='all'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['server_id'], ['servers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'server_id'),
    )


def downgrade() -> None:
    op.drop_table('user_server_notification_settings')
    op.drop_table('user_channel_notification_settings')
