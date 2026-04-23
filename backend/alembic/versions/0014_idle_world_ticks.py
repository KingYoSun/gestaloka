"""idle world ticks"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0014_idle_world_ticks"
down_revision = "0013_langfuse_observability"
branch_labels = None
depends_on = None


def _table_names(inspector: sa.Inspector) -> set[str]:
    return set(inspector.get_table_names())


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = _table_names(inspector)

    if "world_ticks" not in existing_tables:
        op.create_table(
            "world_ticks",
            sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("tick_kind", sa.String(length=32), nullable=False, server_default="idle_world_pass"),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
            sa.Column("seed_turn_id", sa.String(length=36), nullable=True),
            sa.Column("location_id", sa.String(length=96), nullable=True),
            sa.Column("summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("id", "world_id", name="uq_world_ticks_id_world"),
            sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["seed_turn_id", "world_id"], ["turns.id", "turns.world_id"]),
            sa.ForeignKeyConstraint(["location_id", "world_id"], ["locations.id", "locations.world_id"]),
        )
        op.create_index("ix_world_ticks_world_id", "world_ticks", ["world_id"])
        op.create_index("ix_world_ticks_status", "world_ticks", ["status"])
        if bind.dialect.name == "postgresql":
            op.alter_column("world_ticks", "tick_kind", server_default=None)
            op.alter_column("world_ticks", "status", server_default=None)
            op.alter_column("world_ticks", "summary", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "world_ticks" in _table_names(inspector):
        op.drop_index("ix_world_ticks_status", table_name="world_ticks")
        op.drop_index("ix_world_ticks_world_id", table_name="world_ticks")
        op.drop_table("world_ticks")
