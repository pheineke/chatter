"""add_server_member_privacy_settings

Revision ID: 50ea41a44e17
Revises: c9d8e7f6a5b4
Create Date: 2026-03-18 16:59:24.278501

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '50ea41a44e17'
down_revision: Union[str, None] = 'c9d8e7f6a5b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add allow_dms column to server_members
    op.add_column('server_members', sa.Column('allow_dms', sa.Boolean(), nullable=True))


def downgrade() -> None:
    # Remove allow_dms column from server_members
    op.drop_column('server_members', 'allow_dms')
