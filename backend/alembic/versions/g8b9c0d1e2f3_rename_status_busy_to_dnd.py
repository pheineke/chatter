"""rename_status_busy_to_dnd

Rename UserStatus enum value 'busy' -> 'dnd' in the users table.
SQLite stores enum values as plain TEXT so only a data UPDATE is needed —
no DDL column type change required.

Revision ID: g8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-02-22 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'g8b9c0d1e2f3'
down_revision: Union[str, None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE users SET status           = 'dnd' WHERE status           = 'busy'")
    op.execute("UPDATE users SET preferred_status = 'dnd' WHERE preferred_status = 'busy'")


def downgrade() -> None:
    op.execute("UPDATE users SET status           = 'busy' WHERE status           = 'dnd'")
    op.execute("UPDATE users SET preferred_status = 'busy' WHERE preferred_status = 'dnd'")
