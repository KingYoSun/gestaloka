"""release checklist pack regression runs"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0017_release_pack_regressions"
down_revision = "0016_world_pack_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("release_gate_reports"):
        return

    columns = {column["name"] for column in inspector.get_columns("release_gate_reports")}
    if "pack_regression_run_ids" in columns:
        return

    if bind.dialect.name == "postgresql":
        op.add_column(
            "release_gate_reports",
            sa.Column("pack_regression_run_ids", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        )
        op.alter_column("release_gate_reports", "pack_regression_run_ids", server_default=None)
    else:
        op.add_column(
            "release_gate_reports",
            sa.Column("pack_regression_run_ids", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        )
        op.alter_column("release_gate_reports", "pack_regression_run_ids", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("release_gate_reports"):
        return

    columns = {column["name"] for column in inspector.get_columns("release_gate_reports")}
    if "pack_regression_run_ids" in columns:
        op.drop_column("release_gate_reports", "pack_regression_run_ids")
