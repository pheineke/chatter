"""API token scopes and expiry (security_pass S19)

Revision ID: c1d2e3f4a5b6
Revises: b0c1d2e3f4a5
Create Date: 2026-11-26
"""
import sqlalchemy as sa
from alembic import op

revision = "c1d2e3f4a5b6"
down_revision = "b0c1d2e3f4a5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing tokens keep full access (all three scopes) and never expire,
    # so bots already running don't break; users can replace them.
    op.add_column(
        "api_tokens",
        sa.Column("scopes", sa.String(64), nullable=False, server_default="read,send,manage"),
    )
    op.add_column("api_tokens", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("api_tokens", "expires_at")
    op.drop_column("api_tokens", "scopes")
