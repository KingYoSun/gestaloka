"""llm usage token telemetry"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0025_llm_usage_tokens"
down_revision = "0024_profile_preferences"
branch_labels = None
depends_on = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "llm_runs" not in set(inspector.get_table_names()):
        return

    llm_run_columns = _column_names(inspector, "llm_runs")
    with op.batch_alter_table("llm_runs") as batch:
        if "prompt_tokens" not in llm_run_columns:
            batch.add_column(sa.Column("prompt_tokens", sa.Integer(), nullable=True))
        if "completion_tokens" not in llm_run_columns:
            batch.add_column(sa.Column("completion_tokens", sa.Integer(), nullable=True))
        if "total_tokens" not in llm_run_columns:
            batch.add_column(sa.Column("total_tokens", sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "llm_runs" not in set(inspector.get_table_names()):
        return

    llm_run_columns = _column_names(inspector, "llm_runs")
    with op.batch_alter_table("llm_runs") as batch:
        if "total_tokens" in llm_run_columns:
            batch.drop_column("total_tokens")
        if "completion_tokens" in llm_run_columns:
            batch.drop_column("completion_tokens")
        if "prompt_tokens" in llm_run_columns:
            batch.drop_column("prompt_tokens")
