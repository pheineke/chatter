"""add_key_package_device_id

Revision ID: y7z8a9b0c1d2
Revises: x6y7z8a9b0c1
Create Date: 2026-08-02 00:00:00.000000

Attributes each published MLS KeyPackage to the specific device that made it.

MLS is a protocol between devices, not accounts. A KeyPackage's private half
never leaves the browser profile that generated it, so a package is only ever
redeemable by that one device. Without knowing which device owns which
package the server can't support multiple devices per user: adding a user to
a group has to claim one package per device, and cleaning up after a wiped
device must not delete a sibling device's packages.

Existing rows predate any device concept. They're deleted rather than
back-filled with a placeholder: a package whose owning device is unknown is
one nobody can prove they can redeem, and handing it out produces a Welcome
that its recipient cannot decrypt — a silent, permanent lockout from that
group. Clients republish on next load, so the cost of dropping them is one
round-trip.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'y7z8a9b0c1d2'
down_revision: Union[str, None] = 'x6y7z8a9b0c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Unattributable and unusable — see the module docstring.
    op.execute('DELETE FROM mls_key_packages')

    op.add_column(
        'mls_key_packages',
        sa.Column('device_id', sa.String(length=64), nullable=False),
    )
    op.create_index(
        op.f('ix_mls_key_packages_device_id'),
        'mls_key_packages',
        ['device_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_mls_key_packages_device_id'), table_name='mls_key_packages')
    op.drop_column('mls_key_packages', 'device_id')
