"""sp ledger and account tables"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0003_sp_ledger"
down_revision = "0002_graph_runtime_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("sp_accounts"):
        op.create_table(
            "sp_accounts",
            sa.Column("user_sub", sa.String(length=128), nullable=False),
            sa.Column("balance", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint("balance >= 0", name="ck_sp_accounts_balance_nonnegative"),
            sa.PrimaryKeyConstraint("user_sub"),
        )

    if not inspector.has_table("sp_ledger"):
        op.create_table(
            "sp_ledger",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_sub", sa.String(length=128), nullable=False),
            sa.Column("world_id", sa.String(length=64), nullable=True),
            sa.Column("actor_id", sa.String(length=36), nullable=True),
            sa.Column("delta", sa.Integer(), nullable=False),
            sa.Column("reason_code", sa.String(length=64), nullable=False),
            sa.Column("reference_type", sa.String(length=64), nullable=False),
            sa.Column("reference_id", sa.String(length=96), nullable=False),
            sa.Column("balance_after", sa.Integer(), nullable=False),
            sa.Column("created_by_sub", sa.String(length=128), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint("delta != 0", name="ck_sp_ledger_nonzero_delta"),
            sa.CheckConstraint("actor_id IS NULL OR world_id IS NOT NULL", name="ck_sp_ledger_actor_requires_world"),
            sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_sp_ledger_user_sub", "sp_ledger", ["user_sub"], unique=False)
        op.create_index("ix_sp_ledger_world_id", "sp_ledger", ["world_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("sp_ledger"):
        existing_indexes = {index["name"] for index in inspector.get_indexes("sp_ledger")}
        if "ix_sp_ledger_user_sub" in existing_indexes:
            op.drop_index("ix_sp_ledger_user_sub", table_name="sp_ledger")
        if "ix_sp_ledger_world_id" in existing_indexes:
            op.drop_index("ix_sp_ledger_world_id", table_name="sp_ledger")
        op.drop_table("sp_ledger")

    if inspector.has_table("sp_accounts"):
        op.drop_table("sp_accounts")
