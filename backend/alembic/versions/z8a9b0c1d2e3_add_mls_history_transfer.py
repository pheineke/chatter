"""add_mls_history_transfer

Revision ID: z8a9b0c1d2e3
Revises: y7z8a9b0c1d2
Create Date: 2026-08-02 01:00:00.000000

Tables for handing message history from one of a user's devices to another
when they link a new one.

MLS is forward-secret, so a device Added at epoch N cannot derive keys for
anything sent before it joined — history cannot come from the protocol. It has
to be passed over by a device that already holds the plaintext, encrypted to
the new device. The server relays ciphertext it cannot read and deletes it on
delivery, so no decryptable archive accumulates server-side.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'z8a9b0c1d2e3'
down_revision: Union[str, None] = 'y7z8a9b0c1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'mls_history_requests',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('device_id', sa.String(length=64), nullable=False),
        sa.Column('public_key', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'device_id', name='uq_mls_history_request_user_device'),
    )
    op.create_index(
        op.f('ix_mls_history_requests_user_id'), 'mls_history_requests', ['user_id'], unique=False
    )

    op.create_table(
        'mls_history_bundles',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('target_device_id', sa.String(length=64), nullable=False),
        sa.Column('sender_device_id', sa.String(length=64), nullable=False),
        sa.Column('ciphertext', sa.LargeBinary(), nullable=False),
        sa.Column('nonce', sa.LargeBinary(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_mls_history_bundles_user_id'), 'mls_history_bundles', ['user_id'], unique=False
    )
    op.create_index(
        op.f('ix_mls_history_bundles_target_device_id'),
        'mls_history_bundles',
        ['target_device_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_mls_history_bundles_target_device_id'), table_name='mls_history_bundles')
    op.drop_index(op.f('ix_mls_history_bundles_user_id'), table_name='mls_history_bundles')
    op.drop_table('mls_history_bundles')
    op.drop_index(op.f('ix_mls_history_requests_user_id'), table_name='mls_history_requests')
    op.drop_table('mls_history_requests')
