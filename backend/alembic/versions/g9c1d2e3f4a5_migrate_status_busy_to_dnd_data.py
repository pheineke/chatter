"""migrate_status_busy_to_dnd_data

Rename UserStatus value 'busy' -> 'dnd' in existing rows.

Runs after g8b9c0d1e2f3 (which adds 'dnd' to the PostgreSQL enum type in
its own, already-committed transaction) so referencing the new value here
is safe on PostgreSQL. SQLite stores enum values as plain TEXT, so this
data update is all that's needed there.

Revision ID: g9c1d2e3f4a5
Revises: g8b9c0d1e2f3
Create Date: 2026-02-22 00:00:01.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'g9c1d2e3f4a5'
down_revision: Union[str, None] = 'g8b9c0d1e2f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE users SET status           = 'dnd' WHERE status           = 'busy'")
    op.execute("UPDATE users SET preferred_status = 'dnd' WHERE preferred_status = 'busy'")


def downgrade() -> None:
    op.execute("UPDATE users SET status           = 'busy' WHERE status           = 'dnd'")
    op.execute("UPDATE users SET preferred_status = 'busy' WHERE preferred_status = 'dnd'")
