"""persistent generated world entities"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0031_persistent_entities"
down_revision = "0030_llm_context_cache"
branch_labels = None
depends_on = None


ENTITY_TABLES = ("actors", "locations", "factions")


def _columns(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _unique_constraints(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {constraint["name"] for constraint in inspector.get_unique_constraints(table_name)}


def _indexes(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    for table_name in ENTITY_TABLES:
        if table_name not in tables:
            continue
        columns = _columns(inspector, table_name)
        constraints = _unique_constraints(inspector, table_name)
        indexes = _indexes(inspector, table_name)
        with op.batch_alter_table(table_name) as batch:
            if "entity_key" not in columns:
                batch.add_column(sa.Column("entity_key", sa.String(length=160), nullable=True))
            if "origin_kind" not in columns:
                batch.add_column(sa.Column("origin_kind", sa.String(length=32), nullable=False, server_default="pack_seed"))
            if "origin_ref" not in columns:
                batch.add_column(sa.Column("origin_ref", sa.String(length=160), nullable=False, server_default=""))
            if "visibility_scope" not in columns:
                batch.add_column(sa.Column("visibility_scope", sa.String(length=32), nullable=False, server_default="world"))
            if "first_seen_session_id" not in columns:
                batch.add_column(sa.Column("first_seen_session_id", sa.String(length=36), nullable=True))
            if "first_seen_actor_id" not in columns:
                batch.add_column(sa.Column("first_seen_actor_id", sa.String(length=36), nullable=True))
            if "source_event_id" not in columns:
                batch.add_column(sa.Column("source_event_id", sa.String(length=36), nullable=True))
            if f"uq_{table_name}_world_entity_key" not in constraints:
                batch.create_unique_constraint(
                    f"uq_{table_name}_world_entity_key",
                    ["world_id", "entity_key"],
                )
            if f"ix_{table_name}_generated_origin" not in indexes:
                batch.create_index(
                    f"ix_{table_name}_generated_origin",
                    ["world_id", "origin_kind", "visibility_scope"],
                )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    for table_name in reversed(ENTITY_TABLES):
        if table_name not in tables:
            continue
        indexes = _indexes(sa.inspect(bind), table_name)
        constraints = _unique_constraints(sa.inspect(bind), table_name)
        columns = _columns(sa.inspect(bind), table_name)
        with op.batch_alter_table(table_name) as batch:
            if f"ix_{table_name}_generated_origin" in indexes:
                batch.drop_index(f"ix_{table_name}_generated_origin")
            if f"uq_{table_name}_world_entity_key" in constraints:
                batch.drop_constraint(f"uq_{table_name}_world_entity_key", type_="unique")
            for column_name in (
                "source_event_id",
                "first_seen_actor_id",
                "first_seen_session_id",
                "visibility_scope",
                "origin_ref",
                "origin_kind",
                "entity_key",
            ):
                if column_name in columns:
                    batch.drop_column(column_name)
