"""world pack metadata"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0016_world_pack_metadata"
down_revision = "0015_branch_route_pressures"
branch_labels = None
depends_on = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "worlds" not in set(inspector.get_table_names()):
        return
    world_columns = _column_names(inspector, "worlds")
    if "state" not in world_columns:
        op.add_column("worlds", sa.Column("state", sa.JSON(), nullable=False, server_default="{}"))
        if bind.dialect.name == "postgresql":
            op.alter_column("worlds", "state", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "worlds" not in set(inspector.get_table_names()):
        return
    world_columns = _column_names(inspector, "worlds")
    if "state" in world_columns:
        op.drop_column("worlds", "state")
