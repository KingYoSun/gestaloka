"""gm council runtime and provider audit fields"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0007_gm_council_live_provider"
down_revision = "0006_world_domain_slice"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    dialect_name = bind.dialect.name

    turn_columns = {column["name"] for column in inspector.get_columns("turns")} if inspector.has_table("turns") else set()
    if "resolution_mode" not in turn_columns:
        if dialect_name == "postgresql":
            op.execute("ALTER TABLE turns ADD COLUMN IF NOT EXISTS resolution_mode VARCHAR(32) DEFAULT 'legacy' NOT NULL")
            op.execute("ALTER TABLE turns ALTER COLUMN resolution_mode DROP DEFAULT")
        else:
            op.add_column("turns", sa.Column("resolution_mode", sa.String(length=32), nullable=False, server_default="legacy"))
            op.alter_column("turns", "resolution_mode", server_default=None)

    llm_run_columns = {column["name"] for column in inspector.get_columns("llm_runs")} if inspector.has_table("llm_runs") else set()
    if "workflow_name" not in llm_run_columns:
        if dialect_name == "postgresql":
            op.execute("ALTER TABLE llm_runs ADD COLUMN IF NOT EXISTS workflow_name VARCHAR(64) DEFAULT 'single_prompt' NOT NULL")
            op.execute("ALTER TABLE llm_runs ALTER COLUMN workflow_name DROP DEFAULT")
        else:
            op.add_column(
                "llm_runs",
                sa.Column("workflow_name", sa.String(length=64), nullable=False, server_default="single_prompt"),
            )
            op.alter_column("llm_runs", "workflow_name", server_default=None)
    if "council_role" not in llm_run_columns:
        op.add_column("llm_runs", sa.Column("council_role", sa.String(length=64), nullable=True))
    if "stage_index" not in llm_run_columns:
        op.add_column("llm_runs", sa.Column("stage_index", sa.Integer(), nullable=True))
    if "approval_status" not in llm_run_columns:
        op.add_column("llm_runs", sa.Column("approval_status", sa.String(length=32), nullable=True))
    if "provider_name" not in llm_run_columns:
        if dialect_name == "postgresql":
            op.execute("ALTER TABLE llm_runs ADD COLUMN IF NOT EXISTS provider_name VARCHAR(64) DEFAULT 'stub' NOT NULL")
            op.execute("ALTER TABLE llm_runs ALTER COLUMN provider_name DROP DEFAULT")
        else:
            op.add_column("llm_runs", sa.Column("provider_name", sa.String(length=64), nullable=False, server_default="stub"))
            op.alter_column("llm_runs", "provider_name", server_default=None)
    if "provider_response_id" not in llm_run_columns:
        op.add_column("llm_runs", sa.Column("provider_response_id", sa.String(length=255), nullable=True))
    if "input_context_hash" not in llm_run_columns:
        op.add_column("llm_runs", sa.Column("input_context_hash", sa.String(length=128), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    llm_run_columns = {column["name"] for column in inspector.get_columns("llm_runs")} if inspector.has_table("llm_runs") else set()
    for column_name in (
        "input_context_hash",
        "provider_response_id",
        "provider_name",
        "approval_status",
        "stage_index",
        "council_role",
        "workflow_name",
    ):
        if column_name in llm_run_columns:
            op.drop_column("llm_runs", column_name)

    turn_columns = {column["name"] for column in inspector.get_columns("turns")} if inspector.has_table("turns") else set()
    if "resolution_mode" in turn_columns:
        op.drop_column("turns", "resolution_mode")
