"""branch route pressures"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0015_branch_route_pressures"
down_revision = "0014_idle_world_ticks"
branch_labels = None
depends_on = None


def _table_names(inspector: sa.Inspector) -> set[str]:
    return set(inspector.get_table_names())


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = _table_names(inspector)

    if "chapter_tracks" in existing_tables:
        chapter_columns = _column_names(inspector, "chapter_tracks")
        if "branch_key" not in chapter_columns:
            op.add_column("chapter_tracks", sa.Column("branch_key", sa.String(length=64), nullable=True))
        if "crossroads_status" not in chapter_columns:
            op.add_column(
                "chapter_tracks",
                sa.Column("crossroads_status", sa.String(length=32), nullable=False, server_default="none"),
            )
        if "crossroads_summary" not in chapter_columns:
            op.add_column(
                "chapter_tracks",
                sa.Column("crossroads_summary", sa.Text(), nullable=False, server_default=""),
            )
        if "committed_at" not in chapter_columns:
            op.add_column("chapter_tracks", sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True))
        if bind.dialect.name == "postgresql":
            if "crossroads_status" not in chapter_columns:
                op.alter_column("chapter_tracks", "crossroads_status", server_default=None)
            if "crossroads_summary" not in chapter_columns:
                op.alter_column("chapter_tracks", "crossroads_summary", server_default=None)

    if "route_pressures" not in existing_tables:
        op.create_table(
            "route_pressures",
            sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("owner_actor_id", sa.String(length=36), nullable=False),
            sa.Column("chapter_key", sa.String(length=96), nullable=False),
            sa.Column("route_key", sa.String(length=64), nullable=False),
            sa.Column("pressure", sa.Float(), nullable=False, server_default="0"),
            sa.Column("band", sa.String(length=32), nullable=False, server_default="low"),
            sa.Column("last_signal", sa.String(length=64), nullable=False, server_default="none"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("id", "world_id", name="uq_route_pressures_id_world"),
            sa.UniqueConstraint(
                "world_id",
                "owner_actor_id",
                "chapter_key",
                "route_key",
                name="uq_route_pressures_owner_chapter_route",
            ),
            sa.ForeignKeyConstraint(["owner_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        )
        op.create_index("ix_route_pressures_world_id", "route_pressures", ["world_id"])
        op.create_index(
            "ix_route_pressures_owner_chapter",
            "route_pressures",
            ["world_id", "owner_actor_id", "chapter_key"],
        )
        if bind.dialect.name == "postgresql":
            op.alter_column("route_pressures", "pressure", server_default=None)
            op.alter_column("route_pressures", "band", server_default=None)
            op.alter_column("route_pressures", "last_signal", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = _table_names(inspector)
    if "route_pressures" in existing_tables:
        op.drop_index("ix_route_pressures_owner_chapter", table_name="route_pressures")
        op.drop_index("ix_route_pressures_world_id", table_name="route_pressures")
        op.drop_table("route_pressures")

    if "chapter_tracks" in existing_tables:
        chapter_columns = _column_names(inspector, "chapter_tracks")
        if "committed_at" in chapter_columns:
            op.drop_column("chapter_tracks", "committed_at")
        if "crossroads_summary" in chapter_columns:
            op.drop_column("chapter_tracks", "crossroads_summary")
        if "crossroads_status" in chapter_columns:
            op.drop_column("chapter_tracks", "crossroads_status")
        if "branch_key" in chapter_columns:
            op.drop_column("chapter_tracks", "branch_key")
