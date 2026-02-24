"""add decoration_codes table

Revision ID: q9r0s1t2u3v4
Revises: p8q9r0s1t2u3
Create Date: 2026-02-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "q9r0s1t2u3v4"
down_revision: Union[str, None] = "p8q9r0s1t2u3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "decoration_codes",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("code", sa.String(32), unique=True, nullable=False, index=True),
        sa.Column("frame_id", sa.String(50), nullable=False),
        sa.Column("redeemed_by", sa.Uuid, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("decoration_codes")
