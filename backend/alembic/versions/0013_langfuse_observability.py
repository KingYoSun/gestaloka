"""langfuse observability metadata"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0013_langfuse_observability"
down_revision = "0012_location_routes"
branch_labels = None
depends_on = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    turn_columns = _column_names(inspector, "turns")
    if "langfuse_trace_id" not in turn_columns:
        op.add_column("turns", sa.Column("langfuse_trace_id", sa.String(length=64), nullable=True))
    if "langfuse_trace_url" not in turn_columns:
        op.add_column("turns", sa.Column("langfuse_trace_url", sa.String(length=500), nullable=True))
    if "langfuse_status" not in turn_columns:
        op.add_column("turns", sa.Column("langfuse_status", sa.String(length=32), nullable=False, server_default="disabled"))
        if bind.dialect.name == "postgresql":
            op.alter_column("turns", "langfuse_status", server_default=None)

    llm_run_columns = _column_names(inspector, "llm_runs")
    if "langfuse_trace_id" not in llm_run_columns:
        op.add_column("llm_runs", sa.Column("langfuse_trace_id", sa.String(length=64), nullable=True))
    if "langfuse_observation_id" not in llm_run_columns:
        op.add_column("llm_runs", sa.Column("langfuse_observation_id", sa.String(length=64), nullable=True))
    if "langfuse_trace_url" not in llm_run_columns:
        op.add_column("llm_runs", sa.Column("langfuse_trace_url", sa.String(length=500), nullable=True))
    if "langfuse_status" not in llm_run_columns:
        op.add_column("llm_runs", sa.Column("langfuse_status", sa.String(length=32), nullable=False, server_default="disabled"))
        if bind.dialect.name == "postgresql":
            op.alter_column("llm_runs", "langfuse_status", server_default=None)

    eval_run_columns = _column_names(inspector, "eval_runs")
    if "langfuse_trace_id" not in eval_run_columns:
        op.add_column("eval_runs", sa.Column("langfuse_trace_id", sa.String(length=64), nullable=True))
    if "langfuse_trace_url" not in eval_run_columns:
        op.add_column("eval_runs", sa.Column("langfuse_trace_url", sa.String(length=500), nullable=True))
    if "langfuse_status" not in eval_run_columns:
        op.add_column("eval_runs", sa.Column("langfuse_status", sa.String(length=32), nullable=False, server_default="disabled"))
        if bind.dialect.name == "postgresql":
            op.alter_column("eval_runs", "langfuse_status", server_default=None)

    report_columns = _column_names(inspector, "release_gate_reports")
    if "langfuse_trace_id" not in report_columns:
        op.add_column("release_gate_reports", sa.Column("langfuse_trace_id", sa.String(length=64), nullable=True))
    if "langfuse_trace_url" not in report_columns:
        op.add_column("release_gate_reports", sa.Column("langfuse_trace_url", sa.String(length=500), nullable=True))
    if "langfuse_status" not in report_columns:
        op.add_column(
            "release_gate_reports",
            sa.Column("langfuse_status", sa.String(length=32), nullable=False, server_default="disabled"),
        )
        if bind.dialect.name == "postgresql":
            op.alter_column("release_gate_reports", "langfuse_status", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table_name, columns in (
        ("release_gate_reports", ["langfuse_status", "langfuse_trace_url", "langfuse_trace_id"]),
        ("eval_runs", ["langfuse_status", "langfuse_trace_url", "langfuse_trace_id"]),
        ("llm_runs", ["langfuse_status", "langfuse_trace_url", "langfuse_observation_id", "langfuse_trace_id"]),
        ("turns", ["langfuse_status", "langfuse_trace_url", "langfuse_trace_id"]),
    ):
        existing = _column_names(inspector, table_name)
        for column_name in columns:
            if column_name in existing:
                op.drop_column(table_name, column_name)
