"""player profile preferences"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0024_profile_preferences"
down_revision = "0023_admin_management"
branch_labels = None
depends_on = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "player_profiles" not in set(inspector.get_table_names()):
        return

    columns = _column_names(inspector, "player_profiles")
    with op.batch_alter_table("player_profiles") as batch:
        if "preferences" not in columns:
            batch.add_column(sa.Column("preferences", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "player_profiles" not in set(inspector.get_table_names()):
        return

    columns = _column_names(inspector, "player_profiles")
    with op.batch_alter_table("player_profiles") as batch:
        if "preferences" in columns:
            batch.drop_column("preferences")
