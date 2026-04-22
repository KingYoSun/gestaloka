"""multi-location travel routes"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0012_location_routes"
down_revision = "0011_scene_frames"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "location_routes" not in tables:
        op.create_table(
            "location_routes",
            sa.Column("id", sa.String(length=96), nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("from_location_id", sa.String(length=96), nullable=False),
            sa.Column("to_location_id", sa.String(length=96), nullable=False),
            sa.Column("route_key", sa.String(length=96), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="open"),
            sa.Column("travel_summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("unlock_requirements_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("id", "world_id", name="uq_location_routes_id_world"),
            sa.UniqueConstraint("world_id", "route_key", name="uq_location_routes_world_route_key"),
            sa.UniqueConstraint("world_id", "from_location_id", "to_location_id", name="uq_location_routes_world_pair"),
            sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["from_location_id", "world_id"], ["locations.id", "locations.world_id"]),
            sa.ForeignKeyConstraint(["to_location_id", "world_id"], ["locations.id", "locations.world_id"]),
        )
        if bind.dialect.name == "postgresql":
            op.alter_column("location_routes", "status", server_default=None)
            op.alter_column("location_routes", "travel_summary", server_default=None)
            op.alter_column("location_routes", "unlock_requirements_json", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "location_routes" in tables:
        op.drop_table("location_routes")
