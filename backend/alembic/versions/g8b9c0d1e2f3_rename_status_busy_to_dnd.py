"""rename_status_busy_to_dnd

Add 'dnd' to the UserStatus enum in PostgreSQL.

NOTE: This migration only adds the new enum value. It intentionally does
NOT touch any data. PostgreSQL does not allow a newly added enum value to
be referenced (e.g. in an UPDATE ... = 'dnd') within the same transaction
that added it — Alembic runs each migration inside a transaction, so doing
both here would fail with "unsafe use of new value of enum type". The data
migration (busy -> dnd) lives in the next revision,
g9c1d2e3f4a5_migrate_status_busy_to_dnd_data, which runs in its own
transaction after this one has committed.

(An earlier version of this migration tried to work around the same
constraint by shelling out to a `psql` subprocess so the ADD VALUE would
commit immediately. That relied on a `psql` client binary and PG* env vars
that are not present in this project's backend container, so it silently
failed and the subsequent data UPDATE would error out on any real Postgres
deployment. Splitting into two migrations is the correct, portable fix.)

Revision ID: g8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-02-22 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'g8b9c0d1e2f3'
down_revision: Union[str, None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    dialect_name = getattr(conn.dialect, "name", None)
    if dialect_name == "postgresql":
        # IF NOT EXISTS makes this safe to re-run and idempotent across envs.
        op.execute("ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'dnd'")
    # SQLite stores enum values as plain TEXT, so there is no type to alter —
    # the data migration in the next revision handles it directly.


def downgrade() -> None:
    # PostgreSQL does not support removing individual enum values; nothing to
    # undo here. The data migration's downgrade() reverts 'dnd' rows back to
    # 'busy' before this step would ever be reached.
    pass
