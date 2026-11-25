"""add_everyone_role

Revision ID: y7z8a9b0c1d2
Revises: x6y7z8a9b0c1
Create Date: 2026-11-25 00:00:00.000000

Adds `roles.is_default`, the implicit @everyone role that every server member
holds without a user_roles row. Its channel permission overwrites apply to all
members before any role-specific overwrite, which is what makes private
channels possible (deny VIEW for @everyone, allow it for a chosen role).

Backfills one @everyone role for every existing server, and adds a partial
unique index so a server can never have two.
"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'y7z8a9b0c1d2'
down_revision: Union[str, None] = 'x6y7z8a9b0c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'roles',
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.create_index(
        'uq_roles_one_default_per_server',
        'roles',
        ['server_id'],
        unique=True,
        postgresql_where=sa.text('is_default'),
        sqlite_where=sa.text('is_default'),
    )

    bind = op.get_bind()
    server_ids = [row[0] for row in bind.execute(sa.text('SELECT id FROM servers'))]
    if server_ids:
        roles = sa.table(
            'roles',
            sa.column('id', sa.Uuid()),
            sa.column('server_id', sa.Uuid()),
            sa.column('name', sa.String()),
            sa.column('is_admin', sa.Boolean()),
            sa.column('hoist', sa.Boolean()),
            sa.column('mentionable', sa.Boolean()),
            sa.column('position', sa.Integer()),
            sa.column('is_default', sa.Boolean()),
        )
        op.bulk_insert(roles, [
            {
                'id': uuid.uuid4(),
                'server_id': sid if isinstance(sid, uuid.UUID) else uuid.UUID(str(sid)),
                'name': '@everyone',
                'is_admin': False,
                'hoist': False,
                'mentionable': False,
                'position': 0,
                'is_default': True,
            }
            for sid in server_ids
        ])


def downgrade() -> None:
    op.execute(sa.text(
        'DELETE FROM channel_permissions WHERE role_id IN (SELECT id FROM roles WHERE is_default)'
    ))
    op.execute(sa.text('DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE is_default)'))
    op.execute(sa.text('DELETE FROM roles WHERE is_default'))
    op.drop_index('uq_roles_one_default_per_server', table_name='roles')
    op.drop_column('roles', 'is_default')
