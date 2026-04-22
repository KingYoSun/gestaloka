"""scene frames and chapter continuity"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0011_scene_frames"
down_revision = "0010_consequence_threads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "chapter_tracks" not in tables:
        op.create_table(
            "chapter_tracks",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("owner_actor_id", sa.String(length=36), nullable=False),
            sa.Column("chapter_key", sa.String(length=96), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
            sa.Column("summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("opening_event_id", sa.String(length=36), nullable=True),
            sa.Column("closing_event_id", sa.String(length=36), nullable=True),
            sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("id", "world_id", name="uq_chapter_tracks_id_world"),
            sa.UniqueConstraint("world_id", "owner_actor_id", "chapter_key", name="uq_chapter_tracks_owner_key"),
            sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["owner_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
            sa.ForeignKeyConstraint(["opening_event_id", "world_id"], ["events.id", "events.world_id"]),
            sa.ForeignKeyConstraint(["closing_event_id", "world_id"], ["events.id", "events.world_id"]),
        )
        if bind.dialect.name == "postgresql":
            op.alter_column("chapter_tracks", "status", server_default=None)
            op.alter_column("chapter_tracks", "summary", server_default=None)

    if "scene_frames" not in tables:
        op.create_table(
            "scene_frames",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("owner_actor_id", sa.String(length=36), nullable=False),
            sa.Column("chapter_track_id", sa.String(length=36), nullable=False),
            sa.Column("scene_phase", sa.String(length=32), nullable=False, server_default="establish"),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
            sa.Column("location_id", sa.String(length=96), nullable=True),
            sa.Column("focus_actor_id", sa.String(length=36), nullable=True),
            sa.Column("stakes_summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("pressure_summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("opening_event_id", sa.String(length=36), nullable=True),
            sa.Column("closing_event_id", sa.String(length=36), nullable=True),
            sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("id", "world_id", name="uq_scene_frames_id_world"),
            sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["owner_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
            sa.ForeignKeyConstraint(["chapter_track_id", "world_id"], ["chapter_tracks.id", "chapter_tracks.world_id"]),
            sa.ForeignKeyConstraint(["location_id", "world_id"], ["locations.id", "locations.world_id"]),
            sa.ForeignKeyConstraint(["focus_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
            sa.ForeignKeyConstraint(["opening_event_id", "world_id"], ["events.id", "events.world_id"]),
            sa.ForeignKeyConstraint(["closing_event_id", "world_id"], ["events.id", "events.world_id"]),
        )
        if bind.dialect.name == "postgresql":
            op.alter_column("scene_frames", "scene_phase", server_default=None)
            op.alter_column("scene_frames", "status", server_default=None)
            op.alter_column("scene_frames", "stakes_summary", server_default=None)
            op.alter_column("scene_frames", "pressure_summary", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "scene_frames" in tables:
        op.drop_table("scene_frames")
    if "chapter_tracks" in tables:
        op.drop_table("chapter_tracks")
