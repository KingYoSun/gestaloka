"""actor knowledge entries"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0032_actor_knowledge_entries"
down_revision = "0031_persistent_entities"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if "actor_knowledge_entries" in _tables():
        return
    op.create_table(
        "actor_knowledge_entries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("world_id", sa.String(length=64), nullable=False),
        sa.Column("actor_id", sa.String(length=36), nullable=False),
        sa.Column("entry_kind", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("salience", sa.Float(), nullable=False),
        sa.Column("source_event_id", sa.String(length=36), nullable=True),
        sa.Column("evidence_payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("entry_kind IN ('known_fact', 'skill')", name="ck_actor_knowledge_entry_kind"),
        sa.ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        sa.ForeignKeyConstraint(["source_event_id", "world_id"], ["events.id", "events.world_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "world_id",
            "actor_id",
            "entry_kind",
            "title",
            name="uq_actor_knowledge_world_actor_kind_title",
        ),
    )
    op.create_index(
        "ix_actor_knowledge_world_actor_kind",
        "actor_knowledge_entries",
        ["world_id", "actor_id", "entry_kind"],
    )


def downgrade() -> None:
    if "actor_knowledge_entries" not in _tables():
        return
    op.drop_index("ix_actor_knowledge_world_actor_kind", table_name="actor_knowledge_entries")
    op.drop_table("actor_knowledge_entries")
