"""non pay to win progression and reward item utility"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0009_non_pay_to_win_progression"
down_revision = "0008_semantic_memory_retrieval"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    turn_columns = {column["name"] for column in inspector.get_columns("turns")}
    if bind.dialect.name == "postgresql":
        if "action_type" not in turn_columns:
            op.add_column("turns", sa.Column("action_type", sa.String(length=32), nullable=False, server_default="narrative"))
            op.alter_column("turns", "action_type", server_default=None)
    else:
        with op.batch_alter_table("turns", recreate="always") as batch:
            if "action_type" not in turn_columns:
                batch.add_column(sa.Column("action_type", sa.String(length=32), nullable=False, server_default="narrative"))

    quest_template_columns = {column["name"] for column in inspector.get_columns("quest_templates")}
    if bind.dialect.name == "postgresql":
        if "stage_key" not in quest_template_columns:
            op.add_column("quest_templates", sa.Column("stage_key", sa.String(length=96), nullable=False, server_default="starter"))
            op.alter_column("quest_templates", "stage_key", server_default=None)
        if "unlock_requirements" not in quest_template_columns:
            op.add_column(
                "quest_templates",
                sa.Column("unlock_requirements", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            )
            op.alter_column("quest_templates", "unlock_requirements", server_default=None)
    else:
        with op.batch_alter_table("quest_templates", recreate="always") as batch:
            if "stage_key" not in quest_template_columns:
                batch.add_column(sa.Column("stage_key", sa.String(length=96), nullable=False, server_default="starter"))
            if "unlock_requirements" not in quest_template_columns:
                batch.add_column(sa.Column("unlock_requirements", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))

    item_columns = {column["name"] for column in inspector.get_columns("items")}
    item_foreign_keys = {foreign_key["name"] for foreign_key in inspector.get_foreign_keys("items")}
    if bind.dialect.name == "postgresql":
        if "effect_kind" not in item_columns:
            op.add_column("items", sa.Column("effect_kind", sa.String(length=64), nullable=True))
        if "effect_payload" not in item_columns:
            op.add_column(
                "items",
                sa.Column("effect_payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            )
            op.alter_column("items", "effect_payload", server_default=None)
        if "used_at" not in item_columns:
            op.add_column("items", sa.Column("used_at", sa.DateTime(timezone=True), nullable=True))
        if "used_event_id" not in item_columns:
            op.add_column("items", sa.Column("used_event_id", sa.String(length=36), nullable=True))
        if "fk_items_used_event_world" not in item_foreign_keys:
            op.create_foreign_key(
                "fk_items_used_event_world",
                "items",
                "events",
                ["used_event_id", "world_id"],
                ["id", "world_id"],
            )
    else:
        with op.batch_alter_table("items", recreate="always") as batch:
            if "effect_kind" not in item_columns:
                batch.add_column(sa.Column("effect_kind", sa.String(length=64), nullable=True))
            if "effect_payload" not in item_columns:
                batch.add_column(sa.Column("effect_payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
            if "used_at" not in item_columns:
                batch.add_column(sa.Column("used_at", sa.DateTime(timezone=True), nullable=True))
            if "used_event_id" not in item_columns:
                batch.add_column(sa.Column("used_event_id", sa.String(length=36), nullable=True))
            if "fk_items_used_event_world" not in item_foreign_keys:
                batch.create_foreign_key(
                    "fk_items_used_event_world",
                    "events",
                    ["used_event_id", "world_id"],
                    ["id", "world_id"],
                )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.drop_constraint("fk_items_used_event_world", "items", type_="foreignkey")
        op.drop_column("items", "used_event_id")
        op.drop_column("items", "used_at")
        op.drop_column("items", "effect_payload")
        op.drop_column("items", "effect_kind")
        op.drop_column("quest_templates", "unlock_requirements")
        op.drop_column("quest_templates", "stage_key")
        op.drop_column("turns", "action_type")
    else:
        with op.batch_alter_table("items", recreate="always") as batch:
            batch.drop_constraint("fk_items_used_event_world", type_="foreignkey")
            batch.drop_column("used_event_id")
            batch.drop_column("used_at")
            batch.drop_column("effect_payload")
            batch.drop_column("effect_kind")

        with op.batch_alter_table("quest_templates", recreate="always") as batch:
            batch.drop_column("unlock_requirements")
            batch.drop_column("stage_key")

        with op.batch_alter_table("turns", recreate="always") as batch:
            batch.drop_column("action_type")
