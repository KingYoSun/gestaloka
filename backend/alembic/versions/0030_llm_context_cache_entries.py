"""llm context cache entries"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0030_llm_context_cache"
down_revision = "0029_dynamic_quest_chapters"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "llm_context_cache_entries" in set(inspector.get_table_names()):
        return

    op.create_table(
        "llm_context_cache_entries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("provider_name", sa.String(length=64), nullable=False),
        sa.Column("model_id", sa.String(length=120), nullable=False),
        sa.Column("context_hash", sa.String(length=128), nullable=False),
        sa.Column("cache_name", sa.String(length=500), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "provider_name",
            "model_id",
            "context_hash",
            name="uq_llm_context_cache_provider_model_hash",
        ),
    )
    op.create_index(
        "ix_llm_context_cache_entries_status_expires",
        "llm_context_cache_entries",
        ["status", "expires_at"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "llm_context_cache_entries" not in set(inspector.get_table_names()):
        return
    op.drop_index("ix_llm_context_cache_entries_status_expires", table_name="llm_context_cache_entries")
    op.drop_table("llm_context_cache_entries")
