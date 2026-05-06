"""pack preprocess runs"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0033_pack_preprocess"
down_revision = "0032_actor_knowledge_entries"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if "pack_preprocess_runs" in _tables():
        return
    op.create_table(
        "pack_preprocess_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("pack_id", sa.String(length=120), nullable=False),
        sa.Column("world_template_id", sa.String(length=120), nullable=False),
        sa.Column("world_id", sa.String(length=64), nullable=False),
        sa.Column("pack_content_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("counts", sa.JSON(), nullable=False),
        sa.Column("error", sa.JSON(), nullable=False),
        sa.Column("triggered_by_sub", sa.String(length=128), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'ready', 'failed', 'stale')",
            name="ck_pack_preprocess_runs_status",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_pack_preprocess_runs_scope_hash",
        "pack_preprocess_runs",
        ["pack_id", "world_template_id", "pack_content_hash", "status"],
    )
    op.create_index(
        "ix_pack_preprocess_runs_world_status",
        "pack_preprocess_runs",
        ["world_id", "status"],
    )


def downgrade() -> None:
    if "pack_preprocess_runs" not in _tables():
        return
    op.drop_index("ix_pack_preprocess_runs_world_status", table_name="pack_preprocess_runs")
    op.drop_index("ix_pack_preprocess_runs_scope_hash", table_name="pack_preprocess_runs")
    op.drop_table("pack_preprocess_runs")
