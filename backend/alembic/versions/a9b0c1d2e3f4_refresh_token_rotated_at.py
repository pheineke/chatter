"""refresh_token_rotated_at

Revision ID: a9b0c1d2e3f4
Revises: z8a9b0c1d2e3
Create Date: 2026-11-25 00:00:00.000000

Records when a refresh token was rotated, so a replay can be told apart from
a token ended by logout, and benign races (two tabs) from theft.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a9b0c1d2e3f4'
down_revision: Union[str, None] = 'z8a9b0c1d2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'refresh_tokens',
        sa.Column('rotated_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    with op.batch_alter_table('refresh_tokens') as batch:
        batch.drop_column('rotated_at')
