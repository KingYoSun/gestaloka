"""world domain slice for character faction quest item"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0006_world_domain_slice"
down_revision = "0005_release_gate_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("character_sheets"):
        op.create_table(
            "character_sheets",
            sa.Column("actor_id", sa.String(length=36), nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("rank", sa.String(length=64), nullable=False),
            sa.Column("hp", sa.Integer(), nullable=False),
            sa.Column("focus", sa.Integer(), nullable=False),
            sa.Column("status_json", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),
            sa.PrimaryKeyConstraint("actor_id", "world_id"),
        )

    if not inspector.has_table("factions"):
        op.create_table(
            "factions",
            sa.Column("id", sa.String(length=96), nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("state", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("id", "world_id", name="uq_factions_id_world"),
        )

    if not inspector.has_table("faction_standings"):
        op.create_table(
            "faction_standings",
            sa.Column("actor_id", sa.String(length=36), nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("faction_id", sa.String(length=96), nullable=False),
            sa.Column("standing", sa.Float(), nullable=False),
            sa.Column("band", sa.String(length=32), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint("standing >= -1.0 AND standing <= 1.0", name="ck_faction_standings_range"),
            sa.ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),
            sa.ForeignKeyConstraint(["faction_id", "world_id"], ["factions.id", "factions.world_id"]),
            sa.PrimaryKeyConstraint("actor_id", "world_id", "faction_id"),
        )

    if not inspector.has_table("quest_templates"):
        op.create_table(
            "quest_templates",
            sa.Column("id", sa.String(length=96), nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("title", sa.String(length=160), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("completion_target", sa.Integer(), nullable=False),
            sa.Column("reward_template_key", sa.String(length=96), nullable=False),
            sa.Column("reward_name", sa.String(length=120), nullable=False),
            sa.Column("reward_description", sa.Text(), nullable=False),
            sa.Column("state", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("id", "world_id", name="uq_quest_templates_id_world"),
        )

    if not inspector.has_table("quest_assignments"):
        op.create_table(
            "quest_assignments",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("owner_actor_id", sa.String(length=36), nullable=False),
            sa.Column("quest_template_id", sa.String(length=96), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("progress", sa.Integer(), nullable=False),
            sa.Column("progress_target", sa.Integer(), nullable=False),
            sa.Column("latest_summary", sa.Text(), nullable=False),
            sa.Column("reward_item_id", sa.String(length=36), nullable=True),
            sa.Column("state_json", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint("progress >= 0", name="ck_quest_assignments_progress_nonnegative"),
            sa.CheckConstraint("progress_target >= 1", name="ck_quest_assignments_progress_target_positive"),
            sa.ForeignKeyConstraint(["owner_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
            sa.ForeignKeyConstraint(["quest_template_id", "world_id"], ["quest_templates.id", "quest_templates.world_id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("id", "world_id", name="uq_quest_assignments_id_world"),
            sa.UniqueConstraint("world_id", "owner_actor_id", "quest_template_id", name="uq_quest_assignments_owner_template"),
        )

    if not inspector.has_table("items"):
        op.create_table(
            "items",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=False),
            sa.Column("owner_actor_id", sa.String(length=36), nullable=False),
            sa.Column("template_key", sa.String(length=96), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("source_quest_assignment_id", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["owner_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
            sa.ForeignKeyConstraint(
                ["source_quest_assignment_id", "world_id"],
                ["quest_assignments.id", "quest_assignments.world_id"],
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("id", "world_id", name="uq_items_id_world"),
            sa.UniqueConstraint("world_id", "source_quest_assignment_id", name="uq_items_source_assignment"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table_name in (
        "items",
        "quest_assignments",
        "quest_templates",
        "faction_standings",
        "factions",
        "character_sheets",
    ):
        if inspector.has_table(table_name):
            op.drop_table(table_name)
