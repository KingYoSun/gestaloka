"""shared world projection state"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0019_shared_world_projection"
down_revision = "0018_observability_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "world_axis_states" not in tables:
        op.create_table(
            "world_axis_states",
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("axis_id", sa.String(length=120), nullable=False),
            sa.Column("display_name", sa.String(length=120), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("min_value", sa.Float(), nullable=False, server_default="0"),
            sa.Column("max_value", sa.Float(), nullable=False, server_default="1"),
            sa.Column("current_value", sa.Float(), nullable=False, server_default="0"),
            sa.Column("expose_to_session_context", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("thresholds", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("last_event_id", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("world_id", "axis_id"),
            sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["last_event_id", "world_id"], ["events.id", "events.world_id"]),
            sa.CheckConstraint(
                "current_value >= min_value AND current_value <= max_value",
                name="ck_world_axis_states_value_range",
            ),
        )

    if "shared_history_records" not in tables:
        op.create_table(
            "shared_history_records",
            sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("source_event_id", sa.String(length=36), nullable=False),
            sa.Column("actor_id", sa.String(length=36), nullable=True),
            sa.Column("location_id", sa.String(length=96), nullable=True),
            sa.Column("history_rule_id", sa.String(length=120), nullable=False),
            sa.Column("level", sa.String(length=32), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="candidate"),
            sa.Column("summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("salience", sa.Float(), nullable=False, server_default="0.5"),
            sa.Column("tags", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("world_id", "source_event_id", "history_rule_id", name="uq_shared_history_event_rule"),
            sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["source_event_id", "world_id"], ["events.id", "events.world_id"]),
            sa.ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),
            sa.ForeignKeyConstraint(["location_id", "world_id"], ["locations.id", "locations.world_id"]),
        )
        op.create_index("ix_shared_history_records_world_id", "shared_history_records", ["world_id"])

    if "actor_title_progress" not in tables:
        op.create_table(
            "actor_title_progress",
            sa.Column("actor_id", sa.String(length=36), nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("title_rule_id", sa.String(length=120), nullable=False),
            sa.Column("display_name", sa.String(length=120), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("progress", sa.Float(), nullable=False, server_default="0"),
            sa.Column("progress_target", sa.Float(), nullable=False, server_default="1"),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="in_progress"),
            sa.Column("source_event_id", sa.String(length=36), nullable=True),
            sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("actor_id", "world_id", "title_rule_id"),
            sa.ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),
            sa.ForeignKeyConstraint(["source_event_id", "world_id"], ["events.id", "events.world_id"]),
            sa.CheckConstraint("progress >= 0", name="ck_actor_title_progress_nonnegative"),
            sa.CheckConstraint("progress_target > 0", name="ck_actor_title_progress_target_positive"),
        )

    if "shared_consequence_applications" not in tables:
        op.create_table(
            "shared_consequence_applications",
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("source_event_id", sa.String(length=36), nullable=False),
            sa.Column("rule_id", sa.String(length=120), nullable=False),
            sa.Column("action_tag", sa.String(length=32), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("world_id", "source_event_id", "rule_id"),
            sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["source_event_id", "world_id"], ["events.id", "events.world_id"]),
        )

    if bind.dialect.name == "postgresql":
        for table_name, columns in {
            "world_axis_states": [
                "description",
                "min_value",
                "max_value",
                "current_value",
                "expose_to_session_context",
                "thresholds",
            ],
            "shared_history_records": ["status", "summary", "salience", "tags", "payload"],
            "actor_title_progress": ["description", "progress", "progress_target", "status", "payload"],
            "shared_consequence_applications": ["payload"],
        }.items():
            for column_name in columns:
                op.alter_column(table_name, column_name, server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "shared_consequence_applications" in tables:
        op.drop_table("shared_consequence_applications")
    if "actor_title_progress" in tables:
        op.drop_table("actor_title_progress")
    if "shared_history_records" in tables:
        op.drop_index("ix_shared_history_records_world_id", table_name="shared_history_records")
        op.drop_table("shared_history_records")
    if "world_axis_states" in tables:
        op.drop_table("world_axis_states")
