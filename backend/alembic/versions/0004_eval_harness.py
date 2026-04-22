"""eval harness persistence"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0004_eval_harness"
down_revision = "0003_sp_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("eval_runs"):
        op.create_table(
            "eval_runs",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("source_type", sa.String(length=32), nullable=False),
            sa.Column("dataset_name", sa.String(length=128), nullable=True),
            sa.Column("current_config_name", sa.String(length=64), nullable=False),
            sa.Column("current_config_hash", sa.String(length=128), nullable=False),
            sa.Column("candidate_config_name", sa.String(length=64), nullable=False),
            sa.Column("candidate_config_hash", sa.String(length=128), nullable=False),
            sa.Column("git_sha", sa.String(length=64), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="running"),
            sa.Column("summary", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_eval_runs_dataset_name", "eval_runs", ["dataset_name"], unique=False)

    if not inspector.has_table("eval_case_results"):
        op.create_table(
            "eval_case_results",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("eval_run_id", sa.String(length=36), nullable=False),
            sa.Column("variant", sa.String(length=32), nullable=False),
            sa.Column("case_id", sa.String(length=128), nullable=False),
            sa.Column("prompt_id", sa.String(length=120), nullable=False),
            sa.Column("model_id", sa.String(length=120), nullable=False),
            sa.Column("lane", sa.String(length=32), nullable=False),
            sa.Column("used_fallback", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("schema_valid", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("same_world_invariant", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("graph_context_status", sa.String(length=32), nullable=False, server_default="ready"),
            sa.Column("passed", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("failure_reason", sa.Text(), nullable=True),
            sa.Column("raw_output", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["eval_run_id"], ["eval_runs.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_eval_case_results_eval_run_id", "eval_case_results", ["eval_run_id"], unique=False)
        op.create_index("ix_eval_case_results_case_id", "eval_case_results", ["case_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("eval_case_results"):
        existing_indexes = {index["name"] for index in inspector.get_indexes("eval_case_results")}
        if "ix_eval_case_results_case_id" in existing_indexes:
            op.drop_index("ix_eval_case_results_case_id", table_name="eval_case_results")
        if "ix_eval_case_results_eval_run_id" in existing_indexes:
            op.drop_index("ix_eval_case_results_eval_run_id", table_name="eval_case_results")
        op.drop_table("eval_case_results")

    if inspector.has_table("eval_runs"):
        existing_indexes = {index["name"] for index in inspector.get_indexes("eval_runs")}
        if "ix_eval_runs_dataset_name" in existing_indexes:
            op.drop_index("ix_eval_runs_dataset_name", table_name="eval_runs")
        op.drop_table("eval_runs")
