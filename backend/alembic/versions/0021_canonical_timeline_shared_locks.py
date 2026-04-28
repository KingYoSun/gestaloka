"""canonical timeline and shared resource locks"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import sqlalchemy as sa
from alembic import op


revision = "0021_timeline_locks"
down_revision = "0020_player_profiles"
branch_labels = None
depends_on = None


def _table_names(inspector: sa.Inspector) -> set[str]:
    return set(inspector.get_table_names())


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "events" in tables:
        event_columns = _column_names(inspector, "events")
        event_unique_constraints = {constraint["name"] for constraint in inspector.get_unique_constraints("events")}
        with op.batch_alter_table("events") as batch:
            if "canonical_sequence" not in event_columns:
                batch.add_column(sa.Column("canonical_sequence", sa.Integer(), nullable=True))
            if "canonical_status" not in event_columns:
                batch.add_column(sa.Column("canonical_status", sa.String(length=32), nullable=False, server_default="pending"))
            if "timeline_entry_id" not in event_columns:
                batch.add_column(sa.Column("timeline_entry_id", sa.String(length=36), nullable=True))
            if "uq_events_world_canonical_sequence" not in event_unique_constraints:
                batch.create_unique_constraint("uq_events_world_canonical_sequence", ["world_id", "canonical_sequence"])

    if "world_timeline_counters" not in tables:
        op.create_table(
            "world_timeline_counters",
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("next_sequence", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("world_id"),
            sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
        )

    if "world_timeline_entries" not in tables:
        op.create_table(
            "world_timeline_entries",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("entry_kind", sa.String(length=32), nullable=False),
            sa.Column("source_event_id", sa.String(length=36), nullable=True),
            sa.Column("scope_kind", sa.String(length=32), nullable=False, server_default="event"),
            sa.Column("location_id", sa.String(length=96), nullable=True),
            sa.Column("affected_location_ids", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="canon"),
            sa.Column("narrative_constraint", sa.Text(), nullable=False, server_default=""),
            sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("id", "world_id", name="uq_world_timeline_entries_id_world"),
            sa.UniqueConstraint("world_id", "sequence", name="uq_world_timeline_entries_world_sequence"),
            sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["source_event_id", "world_id"], ["events.id", "events.world_id"]),
            sa.ForeignKeyConstraint(["location_id", "world_id"], ["locations.id", "locations.world_id"]),
        )
        op.create_index("ix_world_timeline_entries_world_status", "world_timeline_entries", ["world_id", "status"])

    if "world_resource_locks" not in tables:
        op.create_table(
            "world_resource_locks",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("resource_type", sa.String(length=32), nullable=False),
            sa.Column("resource_id", sa.String(length=120), nullable=False),
            sa.Column("holder_turn_id", sa.String(length=36), nullable=True),
            sa.Column("holder_session_id", sa.String(length=36), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
            sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("constraint_summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("id", "world_id", name="uq_world_resource_locks_id_world"),
            sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["holder_turn_id", "world_id"], ["turns.id", "turns.world_id"]),
            sa.ForeignKeyConstraint(["holder_session_id", "world_id"], ["sessions.id", "sessions.world_id"]),
        )
        op.create_index(
            "ix_world_resource_locks_resource",
            "world_resource_locks",
            ["world_id", "resource_type", "resource_id", "status"],
        )

    if "world_broadcast_events" not in tables:
        op.create_table(
            "world_broadcast_events",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("source_event_id", sa.String(length=36), nullable=False),
            sa.Column("semantic_key", sa.String(length=160), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
            sa.Column("scope_kind", sa.String(length=32), nullable=False, server_default="location"),
            sa.Column("lifecycle_kind", sa.String(length=32), nullable=False, server_default="scene"),
            sa.Column("origin_location_id", sa.String(length=96), nullable=True),
            sa.Column("affected_location_ids", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("constraint_text", sa.Text(), nullable=False, server_default=""),
            sa.Column("relevance_tags", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("resolved_by_event_id", sa.String(length=36), nullable=True),
            sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("id", "world_id", name="uq_world_broadcast_events_id_world"),
            sa.UniqueConstraint("world_id", "semantic_key", name="uq_world_broadcast_events_semantic_key"),
            sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["source_event_id", "world_id"], ["events.id", "events.world_id"]),
            sa.ForeignKeyConstraint(["origin_location_id", "world_id"], ["locations.id", "locations.world_id"]),
        )
        op.create_index("ix_world_broadcast_events_world_status", "world_broadcast_events", ["world_id", "status"])

    if "world_broadcast_deliveries" not in tables:
        op.create_table(
            "world_broadcast_deliveries",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("broadcast_event_id", sa.String(length=36), nullable=False),
            sa.Column("session_id", sa.String(length=36), nullable=False),
            sa.Column("actor_id", sa.String(length=36), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
            sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("id", "world_id", name="uq_world_broadcast_deliveries_id_world"),
            sa.UniqueConstraint("world_id", "broadcast_event_id", "session_id", name="uq_world_broadcast_delivery_session"),
            sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["broadcast_event_id", "world_id"], ["world_broadcast_events.id", "world_broadcast_events.world_id"]),
            sa.ForeignKeyConstraint(["session_id", "world_id"], ["sessions.id", "sessions.world_id"]),
            sa.ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        )
        op.create_index(
            "ix_world_broadcast_deliveries_session_status",
            "world_broadcast_deliveries",
            ["world_id", "session_id", "status"],
        )

    _backfill_existing_events(bind)

    if bind.dialect.name == "postgresql":
        for table_name, columns in {
            "events": ["canonical_status"],
            "world_timeline_counters": ["next_sequence"],
            "world_timeline_entries": ["scope_kind", "affected_location_ids", "status", "narrative_constraint", "payload"],
            "world_resource_locks": ["status", "constraint_summary"],
            "world_broadcast_events": [
                "status",
                "scope_kind",
                "lifecycle_kind",
                "affected_location_ids",
                "summary",
                "constraint_text",
                "relevance_tags",
                "payload",
            ],
            "world_broadcast_deliveries": ["status", "payload"],
        }.items():
            for column_name in columns:
                op.alter_column(table_name, column_name, server_default=None)


def _backfill_existing_events(bind: sa.Connection) -> None:
    now = datetime.now(timezone.utc)
    worlds = [row[0] for row in bind.execute(sa.text("SELECT id FROM worlds ORDER BY id ASC")).all()]
    for world_id in worlds:
        events = bind.execute(
            sa.text(
                """
                SELECT id, location_id, occurred_at, created_at
                FROM events
                WHERE world_id = :world_id
                ORDER BY occurred_at ASC, created_at ASC, id ASC
                """
            ),
            {"world_id": world_id},
        ).all()
        sequence = 1
        for event_id, location_id, _occurred_at, created_at in events:
            entry_id = str(uuid4())
            timestamp = created_at or now
            bind.execute(
                sa.text(
                    """
                    INSERT INTO world_timeline_entries (
                        id, world_id, sequence, entry_kind, source_event_id, scope_kind,
                        location_id, affected_location_ids, status, narrative_constraint, payload,
                        created_at, updated_at
                    )
                    VALUES (
                        :id, :world_id, :sequence, 'event', :event_id, 'event',
                        :location_id, :affected_location_ids, 'canon', '', :payload,
                        :created_at, :updated_at
                    )
                    """
                ),
                {
                    "id": entry_id,
                    "world_id": world_id,
                    "sequence": sequence,
                    "event_id": event_id,
                    "location_id": location_id,
                    "affected_location_ids": "[]" if bind.dialect.name == "sqlite" else [],
                    "payload": "{}" if bind.dialect.name == "sqlite" else {},
                    "created_at": timestamp,
                    "updated_at": timestamp,
                },
            )
            bind.execute(
                sa.text(
                    """
                    UPDATE events
                    SET canonical_sequence = :sequence,
                        canonical_status = 'canon',
                        timeline_entry_id = :entry_id
                    WHERE world_id = :world_id AND id = :event_id
                    """
                ),
                {"sequence": sequence, "entry_id": entry_id, "world_id": world_id, "event_id": event_id},
            )
            sequence += 1
        bind.execute(
            sa.text(
                """
                INSERT INTO world_timeline_counters (world_id, next_sequence, created_at, updated_at)
                VALUES (:world_id, :next_sequence, :created_at, :updated_at)
                """
            ),
            {"world_id": world_id, "next_sequence": sequence, "created_at": now, "updated_at": now},
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "world_broadcast_deliveries" in tables:
        op.drop_index("ix_world_broadcast_deliveries_session_status", table_name="world_broadcast_deliveries")
        op.drop_table("world_broadcast_deliveries")
    if "world_broadcast_events" in tables:
        op.drop_index("ix_world_broadcast_events_world_status", table_name="world_broadcast_events")
        op.drop_table("world_broadcast_events")
    if "world_resource_locks" in tables:
        op.drop_index("ix_world_resource_locks_resource", table_name="world_resource_locks")
        op.drop_table("world_resource_locks")
    if "world_timeline_entries" in tables:
        op.drop_index("ix_world_timeline_entries_world_status", table_name="world_timeline_entries")
        op.drop_table("world_timeline_entries")
    if "world_timeline_counters" in tables:
        op.drop_table("world_timeline_counters")

    if "events" in tables:
        columns = _column_names(inspector, "events")
        with op.batch_alter_table("events") as batch:
            for column_name in ("timeline_entry_id", "canonical_status", "canonical_sequence"):
                if column_name in columns:
                    batch.drop_column(column_name)
