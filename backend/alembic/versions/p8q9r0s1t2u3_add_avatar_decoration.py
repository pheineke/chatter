"""add avatar_decoration to users

Revision ID: p8q9r0s1t2u3
Revises: o7p8q9r0s1t2
Create Date: 2026-02-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "p8q9r0s1t2u3"
down_revision: Union[str, None] = "o7p8q9r0s1t2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("avatar_decoration", sa.String(50), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("avatar_decoration")
