"""add_channel_nsfw_user_limit_bitrate

Add nsfw (bool), user_limit (int, nullable), and bitrate (int, nullable)
columns to the channels table.

  nsfw       — marks a channel as age-restricted (text channels)
  user_limit — max simultaneous voice participants; NULL = unlimited
  bitrate    — voice channel audio quality in bps; NULL = server default

Revision ID: h9c0d1e2f3a4
Revises: g8b9c0d1e2f3
Create Date: 2026-02-22 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'h9c0d1e2f3a4'
down_revision: Union[str, None] = 'g8b9c0d1e2f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("channels") as batch_op:
        batch_op.add_column(sa.Column("nsfw",       sa.Boolean(),  nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("user_limit", sa.Integer(),  nullable=True))
        batch_op.add_column(sa.Column("bitrate",    sa.Integer(),  nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("channels") as batch_op:
        batch_op.drop_column("bitrate")
        batch_op.drop_column("user_limit")
        batch_op.drop_column("nsfw")
