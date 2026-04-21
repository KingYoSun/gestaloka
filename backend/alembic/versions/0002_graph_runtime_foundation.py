"""location and graph runtime foundation"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0002_graph_runtime_foundation"
down_revision = "0001_v2_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("locations"):
        op.create_table(
            "locations",
            sa.Column("id", sa.String(length=96), nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("state", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("id", "world_id", name="uq_locations_id_world"),
        )
        inspector = sa.inspect(bind)

    actor_columns = {column["name"] for column in inspector.get_columns("actors")}
    if "current_location_id" not in actor_columns:
        with op.batch_alter_table("actors", recreate="always") as batch:
            batch.add_column(sa.Column("current_location_id", sa.String(length=96), nullable=True))
            batch.create_foreign_key(
                "fk_actors_current_location_world",
                "locations",
                ["current_location_id", "world_id"],
                ["id", "world_id"],
            )

    event_columns = {column["name"] for column in inspector.get_columns("events")}
    if "location_id" not in event_columns:
        with op.batch_alter_table("events", recreate="always") as batch:
            batch.add_column(sa.Column("location_id", sa.String(length=96), nullable=True))
            batch.create_foreign_key(
                "fk_events_location_world",
                "locations",
                ["location_id", "world_id"],
                ["id", "world_id"],
            )

    memory_columns = {column["name"] for column in inspector.get_columns("memories")}
    if "location_id" not in memory_columns:
        with op.batch_alter_table("memories", recreate="always") as batch:
            batch.add_column(sa.Column("location_id", sa.String(length=96), nullable=True))
            batch.create_foreign_key(
                "fk_memories_location_world",
                "locations",
                ["location_id", "world_id"],
                ["id", "world_id"],
            )

    relationship_columns = {column["name"] for column in inspector.get_columns("relationships")}
    if "to_actor_id" not in relationship_columns:
        with op.batch_alter_table("relationships", recreate="always") as batch:
            batch.add_column(sa.Column("to_actor_id", sa.String(length=36), nullable=True))
            batch.create_foreign_key(
                "fk_relationships_to_actor_world",
                "actors",
                ["to_actor_id", "world_id"],
                ["id", "world_id"],
            )
            batch.create_unique_constraint(
                "uq_relationships_world_pair",
                ["world_id", "from_actor_id", "to_entity_id", "relationship_type"],
            )

    llm_run_columns = {column["name"] for column in inspector.get_columns("llm_runs")}
    if "graph_context_status" not in llm_run_columns:
        with op.batch_alter_table("llm_runs", recreate="always") as batch:
            batch.add_column(
                sa.Column("graph_context_status", sa.String(length=32), nullable=False, server_default="ready")
            )


def downgrade() -> None:
    with op.batch_alter_table("llm_runs", recreate="always") as batch:
        batch.drop_column("graph_context_status")

    with op.batch_alter_table("relationships", recreate="always") as batch:
        batch.drop_constraint("uq_relationships_world_pair", type_="unique")
        batch.drop_constraint("fk_relationships_to_actor_world", type_="foreignkey")
        batch.drop_column("to_actor_id")

    with op.batch_alter_table("memories", recreate="always") as batch:
        batch.drop_constraint("fk_memories_location_world", type_="foreignkey")
        batch.drop_column("location_id")

    with op.batch_alter_table("events", recreate="always") as batch:
        batch.drop_constraint("fk_events_location_world", type_="foreignkey")
        batch.drop_column("location_id")

    with op.batch_alter_table("actors", recreate="always") as batch:
        batch.drop_constraint("fk_actors_current_location_world", type_="foreignkey")
        batch.drop_column("current_location_id")

    op.drop_table("locations")
