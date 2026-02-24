"""channel_permission_bitfield

Replace the 3-boolean (can_read / can_write / can_edit) channel permission
columns with a Discord-style allow_bits / deny_bits BIGINT bitfield.

Bit positions (see models/channel.py :: ChannelPerm):
  VIEW_CHANNEL    = 1   (was can_read)
  SEND_MESSAGES   = 2   (was can_write)
  MANAGE_MESSAGES = 4   (was can_edit)
  … higher bits are new (ATTACH_FILES, EMBED_LINKS, ADD_REACTIONS, …)

Revision ID: f7a8b9c0d1e2
Revises: d4e5f6a7b8c0
Create Date: 2026-02-22 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f7a8b9c0d1e2'
down_revision: Union[str, None] = 'd4e5f6a7b8c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: add new bitfield columns (default 0)
    with op.batch_alter_table("channel_permissions") as batch_op:
        batch_op.add_column(sa.Column("allow_bits", sa.BigInteger(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("deny_bits",  sa.BigInteger(), nullable=False, server_default="0"))

    # Step 2: migrate existing data
    #   can_read  → VIEW_CHANNEL    (bit 0, value 1)
    #   can_write → SEND_MESSAGES   (bit 1, value 2)
    #   can_edit  → MANAGE_MESSAGES (bit 2, value 4)
    # Convert booleans to integers using CASE so this works on Postgres and SQLite.
    op.execute(
        "UPDATE channel_permissions "
        "SET allow_bits = "
        "(CASE WHEN can_read  THEN 1 ELSE 0 END) | "
        "(CASE WHEN can_write THEN 2 ELSE 0 END) | "
        "(CASE WHEN can_edit  THEN 4 ELSE 0 END)"
    )

    # Step 3: drop the old boolean columns
    with op.batch_alter_table("channel_permissions") as batch_op:
        batch_op.drop_column("can_read")
        batch_op.drop_column("can_write")
        batch_op.drop_column("can_edit")


def downgrade() -> None:
    # Step 1: restore old boolean columns
    with op.batch_alter_table("channel_permissions") as batch_op:
        batch_op.add_column(sa.Column("can_read", sa.Boolean(), nullable=False, server_default="1"))
        batch_op.add_column(sa.Column("can_write", sa.Boolean(), nullable=False, server_default="1"))
        batch_op.add_column(sa.Column("can_edit",  sa.Boolean(), nullable=False, server_default="0"))

    # Step 2: restore values from bitfield
    op.execute(
        "UPDATE channel_permissions SET "
        "can_read  = CASE WHEN (allow_bits & 1) != 0 THEN 1 ELSE 0 END, "
        "can_write = CASE WHEN (allow_bits & 2) != 0 THEN 1 ELSE 0 END, "
        "can_edit  = CASE WHEN (allow_bits & 4) != 0 THEN 1 ELSE 0 END"
    )

    # Step 3: drop new bitfield columns
    with op.batch_alter_table("channel_permissions") as batch_op:
        batch_op.drop_column("allow_bits")
        batch_op.drop_column("deny_bits")
