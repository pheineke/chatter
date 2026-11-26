"""QR login: poll secret, requester details, clear old rows (security_pass S18)

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-11-26
"""
import sqlalchemy as sa
from alembic import op

revision = "d2e3f4a5b6c7"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("qr_sessions", sa.Column("poll_secret_hash", sa.String(64), nullable=True))
    op.add_column("qr_sessions", sa.Column("requester_ip", sa.String(64), nullable=True))
    op.add_column("qr_sessions", sa.Column("requester_user_agent", sa.String(512), nullable=True))
    # Sessions live two minutes. Every existing row is long dead, and some
    # still hold a live access/refresh token in plaintext: drop them all.
    op.execute("DELETE FROM qr_sessions")


def downgrade() -> None:
    op.drop_column("qr_sessions", "requester_user_agent")
    op.drop_column("qr_sessions", "requester_ip")
    op.drop_column("qr_sessions", "poll_secret_hash")
