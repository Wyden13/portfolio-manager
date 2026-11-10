"""connection state and account tracking

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-10 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0002'
down_revision: Union[str, Sequence[str], None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# 0001 created the accounts unique constraint without a name. SQLite batch mode can only drop it
# through a naming convention; Postgres gives it its default name.
_SQLITE_CONVENTION = {"uq": "uq_%(table_name)s_%(column_0_name)s"}


def _old_accounts_unique() -> str:
    if op.get_bind().dialect.name == "sqlite":
        return "uq_accounts_user_id"
    return "accounts_user_id_platform_account_number_key"


def upgrade() -> None:
    with op.batch_alter_table('broker_connections', schema=None) as batch_op:
        batch_op.add_column(sa.Column('status', sa.String(length=16), nullable=False, server_default='active'))
        batch_op.add_column(sa.Column('last_error', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('last_synced_at', sa.DateTime(), nullable=True))

    with op.batch_alter_table('accounts', schema=None, naming_convention=_SQLITE_CONVENTION) as batch_op:
        batch_op.add_column(sa.Column('institution', sa.String(), nullable=False, server_default=''))
        batch_op.add_column(sa.Column('transactions_synced_through', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('removed_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('duplicate_of_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key('fk_accounts_duplicate_of_id_accounts', 'accounts', ['duplicate_of_id'], ['id'])
        batch_op.drop_constraint(_old_accounts_unique(), type_='unique')
        batch_op.create_unique_constraint(
            'uq_accounts_user_id_platform_external_id', ['user_id', 'platform', 'external_id'])


def downgrade() -> None:
    with op.batch_alter_table('accounts', schema=None) as batch_op:
        batch_op.drop_constraint('uq_accounts_user_id_platform_external_id', type_='unique')
        batch_op.create_unique_constraint(_old_accounts_unique(), ['user_id', 'platform', 'account_number'])
        batch_op.drop_constraint('fk_accounts_duplicate_of_id_accounts', type_='foreignkey')
        batch_op.drop_column('duplicate_of_id')
        batch_op.drop_column('removed_at')
        batch_op.drop_column('transactions_synced_through')
        batch_op.drop_column('institution')

    with op.batch_alter_table('broker_connections', schema=None) as batch_op:
        batch_op.drop_column('last_synced_at')
        batch_op.drop_column('last_error')
        batch_op.drop_column('status')
