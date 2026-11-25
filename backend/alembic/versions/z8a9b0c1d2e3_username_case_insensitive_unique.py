"""username_case_insensitive_unique

Revision ID: z8a9b0c1d2e3
Revises: y7z8a9b0c1d2
Create Date: 2026-11-25 00:00:00.000000

Makes usernames unique regardless of case, so "Alice" and "alice" can't both
exist (impersonation, and /users/search crashed with MultipleResultsFound).

If this fails with a unique violation, an existing database already has
case-variant duplicates. Rename one of each pair, then re-run.
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
    op.create_index(
        'uq_users_username_lower', 'users', [sa.text('lower(username)')], unique=True
    )


def downgrade() -> None:
    op.drop_index('uq_users_username_lower', table_name='users')
