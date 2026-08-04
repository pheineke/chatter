"""add_recovery_archive

Revision ID: c1d2e3f4a5b6
Revises: b0c1d2e3f4a5
Create Date: 2026-08-02 04:00:00.000000

Storage for the recovery-code encrypted history archive — the "I lost every
device" fallback.

Normal multi-device linking hands history over device-to-device and leaves no
lasting secret anywhere (see mls_history_requests / mls_history_bundles). That
covers everything except having no device left to hand it over from, which is
what this is for. Recovering history with nothing left necessarily requires a
secret that outlives your devices, so the archive is encrypted under a key
derived from a recovery code shown once at sign-up and never sent to the
server.

Two tables: per-user KDF parameters plus a verifier blob (so a client can tell
a mistyped code from a corrupt archive before attempting a full restore), and
the encrypted chunks themselves. `chunk_key` is derived by the client from the
range a chunk covers, so two devices archiving the same messages upsert rather
than duplicating.

The server holds no part of the recovery code and cannot derive the key; the
salt is stored openly because its only job is to stop precomputation being
shared across users.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, None] = 'b0c1d2e3f4a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'mls_recovery_archive_meta',
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('kdf_salt', sa.Text(), nullable=False),
        sa.Column('verifier_ciphertext', sa.Text(), nullable=False),
        sa.Column('verifier_nonce', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )

    op.create_table(
        'mls_recovery_archive_chunks',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('chunk_key', sa.String(length=128), nullable=False),
        sa.Column('ciphertext', sa.LargeBinary(), nullable=False),
        sa.Column('nonce', sa.LargeBinary(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'chunk_key', name='uq_mls_archive_chunk_user_key'),
    )
    op.create_index(
        op.f('ix_mls_recovery_archive_chunks_user_id'),
        'mls_recovery_archive_chunks',
        ['user_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_mls_recovery_archive_chunks_user_id'),
        table_name='mls_recovery_archive_chunks',
    )
    op.drop_table('mls_recovery_archive_chunks')
    op.drop_table('mls_recovery_archive_meta')
