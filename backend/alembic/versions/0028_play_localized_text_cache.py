"""play localized text cache"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0028_play_localized_cache"
down_revision = "0027_turn_resolution_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "play_localized_text_cache" in set(inspector.get_table_names()):
        return

    op.create_table(
        "play_localized_text_cache",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("world_id", sa.String(length=64), nullable=False),
        sa.Column("actor_id_scope", sa.String(length=36), nullable=False),
        sa.Column("target_language", sa.String(length=120), nullable=False),
        sa.Column("source_kind", sa.String(length=64), nullable=False),
        sa.Column("source_key", sa.String(length=180), nullable=False),
        sa.Column("source_hash", sa.String(length=64), nullable=False),
        sa.Column("source_text", sa.Text(), nullable=False),
        sa.Column("localized_text", sa.Text(), nullable=False),
        sa.Column("model_id", sa.String(length=120), nullable=False),
        sa.Column("prompt_id", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "world_id",
            "actor_id_scope",
            "target_language",
            "source_kind",
            "source_key",
            "source_hash",
            name="uq_play_localized_text_cache_source",
        ),
    )
    op.create_index(
        "ix_play_localized_text_cache_world_actor_language",
        "play_localized_text_cache",
        ["world_id", "actor_id_scope", "target_language"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "play_localized_text_cache" not in set(inspector.get_table_names()):
        return

    op.drop_index("ix_play_localized_text_cache_world_actor_language", table_name="play_localized_text_cache")
    op.drop_table("play_localized_text_cache")
