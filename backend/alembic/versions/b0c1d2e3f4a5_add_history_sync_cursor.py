"""add_history_sync_cursor

Revision ID: b0c1d2e3f4a5
Revises: a9b0c1d2e3f4
Create Date: 2026-08-02 03:00:00.000000

Adds a resume point to history requests.

History is transferred newest-first in batches rather than as one archive, so
a newly-linked device shows recent conversation straight away instead of after
everything has landed. `synced_before` records how far back a device has been
filled in: it holds everything at or newer than that instant and wants older,
with NULL meaning "nothing yet, start from the newest".

Keeping it server-side rather than only on the device is what makes the
transfer resumable — close the tab mid-sync and the next session continues from
the same point instead of restarting or re-sending what already arrived.

Nullable with no back-fill: existing rows are mid-transfer requests, and NULL
correctly means "start from the newest", which is where a fresh request begins
anyway.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b0c1d2e3f4a5'
down_revision: Union[str, None] = 'a9b0c1d2e3f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'mls_history_requests',
        sa.Column('synced_before', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('mls_history_requests', 'synced_before')
