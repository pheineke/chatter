"""add_history_bundle_sender_key

Revision ID: a9b0c1d2e3f4
Revises: z8a9b0c1d2e3
Create Date: 2026-08-02 02:00:00.000000

Gives history bundles their own field for the sender's ephemeral ECDH public
key.

The recipient needs that key to derive the shared secret, and it exists
nowhere else — it's generated per transfer and never stored by the sender. The
first cut smuggled it through sender_device_id, which is a 64-character column;
a base64 SPKI key is roughly twice that, so every upload was rejected with 422.

Existing rows are dropped rather than back-filled: a bundle whose sender key we
don't have is undecryptable, and they're transient by design (deleted as soon
as the recipient imports them), so nothing durable is lost. The requesting
device simply asks again.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a9b0c1d2e3f4'
down_revision: Union[str, None] = 'z8a9b0c1d2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Undecryptable without a sender key, and transient anyway.
    op.execute('DELETE FROM mls_history_bundles')
    op.add_column(
        'mls_history_bundles',
        sa.Column('sender_public_key', sa.Text(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column('mls_history_bundles', 'sender_public_key')
