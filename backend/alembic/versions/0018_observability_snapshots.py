"""observability snapshots"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0018_observability_snapshots"
down_revision = "0017_release_pack_regressions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("observability_snapshots"):
        return

    op.create_table(
        "observability_snapshots",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("snapshot_kind", sa.String(length=32), nullable=False),
        sa.Column("runtime_role", sa.String(length=32), nullable=False),
        sa.Column("pack_id", sa.String(length=120), nullable=True),
        sa.Column("pack_display_name", sa.String(length=120), nullable=True),
        sa.Column("world_template_id", sa.String(length=120), nullable=True),
        sa.Column("world_template_display_name", sa.String(length=120), nullable=True),
        sa.Column("release_gate_report_id", sa.String(length=36), nullable=True),
        sa.Column("primary_slo", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("canary_health", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("langfuse_status", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("metrics", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("trace_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_observability_snapshots_snapshot_kind", "observability_snapshots", ["snapshot_kind"])
    op.create_index("ix_observability_snapshots_runtime_role", "observability_snapshots", ["runtime_role"])
    op.create_index("ix_observability_snapshots_pack_id", "observability_snapshots", ["pack_id"])
    op.create_index("ix_observability_snapshots_world_template_id", "observability_snapshots", ["world_template_id"])
    op.create_index(
        "ix_observability_snapshots_release_gate_report_id",
        "observability_snapshots",
        ["release_gate_report_id"],
    )
    op.create_index("ix_observability_snapshots_created_at", "observability_snapshots", ["created_at"])
    if bind.dialect.name == "postgresql":
        op.alter_column("observability_snapshots", "primary_slo", server_default=None)
        op.alter_column("observability_snapshots", "canary_health", server_default=None)
        op.alter_column("observability_snapshots", "langfuse_status", server_default=None)
        op.alter_column("observability_snapshots", "metrics", server_default=None)
        op.alter_column("observability_snapshots", "trace_count", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("observability_snapshots"):
        return

    op.drop_index("ix_observability_snapshots_created_at", table_name="observability_snapshots")
    op.drop_index("ix_observability_snapshots_release_gate_report_id", table_name="observability_snapshots")
    op.drop_index("ix_observability_snapshots_world_template_id", table_name="observability_snapshots")
    op.drop_index("ix_observability_snapshots_pack_id", table_name="observability_snapshots")
    op.drop_index("ix_observability_snapshots_runtime_role", table_name="observability_snapshots")
    op.drop_index("ix_observability_snapshots_snapshot_kind", table_name="observability_snapshots")
    op.drop_table("observability_snapshots")
