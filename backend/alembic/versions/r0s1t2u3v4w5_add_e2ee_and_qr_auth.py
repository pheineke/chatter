"""Add E2EE key table, QR session table, and encrypted message fields

Revision ID: r0s1t2u3v4w5
Revises: q9r0s1t2u3v4
Create Date: 2026-03-02 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "r0s1t2u3v4w5"
down_revision: Union[str, None] = "q9r0s1t2u3v4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── qr_sessions ──────────────────────────────────────────────────────────
    # Status is stored as a plain varchar; valid values are enforced by the app.
    op.create_table(
        "qr_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("device_ephemeral_pk", sa.Text(), nullable=False),
        sa.Column("approver_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("encrypted_private_key", sa.Text(), nullable=True),
        sa.Column("encryption_nonce", sa.String(64), nullable=True),
        sa.Column("approver_e2ee_public_key", sa.Text(), nullable=True),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_qr_sessions_status_expires", "qr_sessions", ["status", "expires_at"])
    op.create_index("ix_qr_sessions_approver", "qr_sessions", ["approver_user_id"])

    # ── user_e2ee_keys ────────────────────────────────────────────────────────
    op.create_table(
        "user_e2ee_keys",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    # ── messages: add E2EE columns ────────────────────────────────────────────
    op.add_column(
        "messages",
        sa.Column("is_encrypted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "messages",
        sa.Column("nonce", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "nonce")
    op.drop_column("messages", "is_encrypted")
    op.drop_table("user_e2ee_keys")
    op.drop_index("ix_qr_sessions_approver", table_name="qr_sessions")
    op.drop_index("ix_qr_sessions_status_expires", table_name="qr_sessions")
    op.drop_table("qr_sessions")
