"""Lift admin roles above default-position roles (role hierarchy, S28)

Revision ID: b0c1d2e3f4a5
Revises: a9b0c1d2e3f4
Create Date: 2026-11-26

Until now every role was created at position 0, so the hierarchy checks
would leave admins unable to manage any role. New servers create their Admin
role at position 1; this moves existing admin roles still at 0 there too.
Admins of equal rank cannot act on each other, which is the point of S28.
"""
from alembic import op

revision = "b0c1d2e3f4a5"
down_revision = "a9b0c1d2e3f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE roles SET position = 1 "
        "WHERE is_admin = true AND is_default = false AND position = 0"
    )


def downgrade() -> None:
    # Data-only; positions are harmless to keep. Nothing to undo reliably.
    pass
