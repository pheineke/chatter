"""add_mls_tables_and_message_epoch

Revision ID: x6y7z8a9b0c1
Revises: w5x6y7z8a9b
Create Date: 2026-08-01 00:00:00.000000

Adds the server-side "Delivery Service" schema for MLS (RFC 9420) group
encryption: published KeyPackages, one MLSGroup row per channel_id, and an
ordered MLSGroupEvent log for commits/welcomes. Also adds `messages.mls_epoch`
so clients know which group epoch a given ciphertext was encrypted under.

The server never stores private key material in any of these tables — see
models/mls.py for the full trust-boundary rationale.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'x6y7z8a9b0c1'
down_revision: Union[str, None] = 'w5x6y7z8a9b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'mls_key_packages',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('key_package', sa.LargeBinary(), nullable=False),
        sa.Column('consumed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_mls_key_packages_user_id', 'mls_key_packages', ['user_id'])

    op.create_table(
        'mls_groups',
        sa.Column('channel_id', sa.Uuid(), nullable=False),
        sa.Column('ciphersuite', sa.String(length=80), nullable=False),
        sa.Column('current_epoch', sa.BigInteger(), nullable=False),
        sa.Column('group_info', sa.LargeBinary(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['channel_id'], ['channels.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('channel_id'),
    )

    op.create_table(
        'mls_group_events',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('channel_id', sa.Uuid(), nullable=False),
        sa.Column('seq', sa.BigInteger(), nullable=False),
        sa.Column('epoch', sa.BigInteger(), nullable=False),
        sa.Column('event_type', sa.Enum('commit', 'welcome', 'proposal', name='mls_event_type'), nullable=False),
        sa.Column('sender_user_id', sa.Uuid(), nullable=False),
        sa.Column('recipient_user_id', sa.Uuid(), nullable=True),
        sa.Column('payload', sa.LargeBinary(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['channel_id'], ['mls_groups.channel_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sender_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['recipient_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('channel_id', 'seq', name='uq_mls_group_event_channel_seq'),
    )
    op.create_index('ix_mls_group_events_channel_id', 'mls_group_events', ['channel_id'])
    op.create_index('ix_mls_group_events_recipient_user_id', 'mls_group_events', ['recipient_user_id'])

    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.add_column(sa.Column('mls_epoch', sa.BigInteger(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.drop_column('mls_epoch')

    op.drop_index('ix_mls_group_events_recipient_user_id', table_name='mls_group_events')
    op.drop_index('ix_mls_group_events_channel_id', table_name='mls_group_events')
    op.drop_table('mls_group_events')

    op.drop_table('mls_groups')

    op.drop_index('ix_mls_key_packages_user_id', table_name='mls_key_packages')
    op.drop_table('mls_key_packages')

    conn = op.get_bind()
    if getattr(conn.dialect, "name", None) == "postgresql":
        op.execute("DROP TYPE IF EXISTS mls_event_type")
