"""release gate reports and eval run metadata"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0005_release_gate_reports"
down_revision = "0004_eval_harness"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    dialect_name = bind.dialect.name

    eval_run_columns = {column["name"] for column in inspector.get_columns("eval_runs")} if inspector.has_table("eval_runs") else set()
    if "trigger_type" not in eval_run_columns:
        if dialect_name == "postgresql":
            op.execute("ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS trigger_type VARCHAR(32) DEFAULT 'manual' NOT NULL")
            op.execute("ALTER TABLE eval_runs ALTER COLUMN trigger_type DROP DEFAULT")
        else:
            op.add_column("eval_runs", sa.Column("trigger_type", sa.String(length=32), nullable=False, server_default="manual"))
            op.alter_column("eval_runs", "trigger_type", server_default=None)
    if "runtime_role" not in eval_run_columns:
        if dialect_name == "postgresql":
            op.execute("ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS runtime_role VARCHAR(32) DEFAULT 'primary' NOT NULL")
            op.execute("ALTER TABLE eval_runs ALTER COLUMN runtime_role DROP DEFAULT")
        else:
            op.add_column("eval_runs", sa.Column("runtime_role", sa.String(length=32), nullable=False, server_default="primary"))
            op.alter_column("eval_runs", "runtime_role", server_default=None)

    if not inspector.has_table("release_gate_reports"):
        op.create_table(
            "release_gate_reports",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("smoke_run_id", sa.String(length=36), nullable=False),
            sa.Column("failure_run_id", sa.String(length=36), nullable=False),
            sa.Column("shadow_run_id", sa.String(length=36), nullable=False),
            sa.Column("verdict", sa.String(length=32), nullable=False),
            sa.Column("blocked_reasons", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("slo_snapshot", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("trigger_type", sa.String(length=32), nullable=False, server_default="manual"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["smoke_run_id"], ["eval_runs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["failure_run_id"], ["eval_runs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["shadow_run_id"], ["eval_runs.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_release_gate_reports_smoke_run_id", "release_gate_reports", ["smoke_run_id"], unique=False)
        op.create_index("ix_release_gate_reports_failure_run_id", "release_gate_reports", ["failure_run_id"], unique=False)
        op.create_index("ix_release_gate_reports_shadow_run_id", "release_gate_reports", ["shadow_run_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("release_gate_reports"):
        existing_indexes = {index["name"] for index in inspector.get_indexes("release_gate_reports")}
        for name in (
            "ix_release_gate_reports_smoke_run_id",
            "ix_release_gate_reports_failure_run_id",
            "ix_release_gate_reports_shadow_run_id",
        ):
            if name in existing_indexes:
                op.drop_index(name, table_name="release_gate_reports")
        op.drop_table("release_gate_reports")

    eval_run_columns = {column["name"] for column in inspector.get_columns("eval_runs")} if inspector.has_table("eval_runs") else set()
    if "runtime_role" in eval_run_columns:
        op.drop_column("eval_runs", "runtime_role")
    if "trigger_type" in eval_run_columns:
        op.drop_column("eval_runs", "trigger_type")
