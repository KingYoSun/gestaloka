"""split paid and bonus sp balances"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0026_paid_bonus_sp"
down_revision = "0025_llm_usage_tokens"
branch_labels = None
depends_on = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _constraint_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {constraint["name"] for constraint in inspector.get_check_constraints(table_name) if constraint["name"]}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "sp_accounts" not in set(inspector.get_table_names()) or "sp_ledger" not in set(inspector.get_table_names()):
        return

    account_columns = _column_names(inspector, "sp_accounts")
    ledger_columns = _column_names(inspector, "sp_ledger")

    with op.batch_alter_table("sp_accounts") as batch:
        if "paid_balance" not in account_columns:
            batch.add_column(sa.Column("paid_balance", sa.Integer(), nullable=False, server_default="0"))
        if "bonus_balance" not in account_columns:
            batch.add_column(sa.Column("bonus_balance", sa.Integer(), nullable=False, server_default="0"))

    with op.batch_alter_table("sp_ledger") as batch:
        if "paid_delta" not in ledger_columns:
            batch.add_column(sa.Column("paid_delta", sa.Integer(), nullable=False, server_default="0"))
        if "bonus_delta" not in ledger_columns:
            batch.add_column(sa.Column("bonus_delta", sa.Integer(), nullable=False, server_default="0"))
        if "paid_balance_after" not in ledger_columns:
            batch.add_column(sa.Column("paid_balance_after", sa.Integer(), nullable=False, server_default="0"))
        if "bonus_balance_after" not in ledger_columns:
            batch.add_column(sa.Column("bonus_balance_after", sa.Integer(), nullable=False, server_default="0"))

    op.execute(sa.text("UPDATE sp_accounts SET paid_balance = 0 WHERE paid_balance IS NULL"))
    op.execute(sa.text("UPDATE sp_accounts SET bonus_balance = balance WHERE bonus_balance = 0 AND balance != 0"))
    op.execute(sa.text("UPDATE sp_ledger SET paid_delta = 0 WHERE paid_delta IS NULL"))
    op.execute(sa.text("UPDATE sp_ledger SET bonus_delta = delta WHERE bonus_delta = 0 AND delta != 0"))
    op.execute(sa.text("UPDATE sp_ledger SET paid_balance_after = 0 WHERE paid_balance_after IS NULL"))
    op.execute(
        sa.text(
            "UPDATE sp_ledger SET bonus_balance_after = balance_after "
            "WHERE bonus_balance_after = 0 AND balance_after != 0"
        )
    )

    account_constraints = _constraint_names(sa.inspect(bind), "sp_accounts")
    ledger_constraints = _constraint_names(sa.inspect(bind), "sp_ledger")

    with op.batch_alter_table("sp_accounts") as batch:
        if "ck_sp_accounts_paid_balance_nonnegative" not in account_constraints:
            batch.create_check_constraint("ck_sp_accounts_paid_balance_nonnegative", "paid_balance >= 0")
        if "ck_sp_accounts_bonus_balance_nonnegative" not in account_constraints:
            batch.create_check_constraint("ck_sp_accounts_bonus_balance_nonnegative", "bonus_balance >= 0")

    with op.batch_alter_table("sp_ledger") as batch:
        if "ck_sp_ledger_bucket_delta_sum" not in ledger_constraints:
            batch.create_check_constraint("ck_sp_ledger_bucket_delta_sum", "paid_delta + bonus_delta = delta")
        if "ck_sp_ledger_bucket_balance_sum" not in ledger_constraints:
            batch.create_check_constraint(
                "ck_sp_ledger_bucket_balance_sum",
                "paid_balance_after + bonus_balance_after = balance_after",
            )
        if "ck_sp_ledger_bucket_nonzero_delta" not in ledger_constraints:
            batch.create_check_constraint("ck_sp_ledger_bucket_nonzero_delta", "paid_delta != 0 OR bonus_delta != 0")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "sp_accounts" not in set(inspector.get_table_names()) or "sp_ledger" not in set(inspector.get_table_names()):
        return

    account_columns = _column_names(inspector, "sp_accounts")
    ledger_columns = _column_names(inspector, "sp_ledger")

    with op.batch_alter_table("sp_ledger") as batch:
        for constraint_name in (
            "ck_sp_ledger_bucket_nonzero_delta",
            "ck_sp_ledger_bucket_balance_sum",
            "ck_sp_ledger_bucket_delta_sum",
        ):
            batch.drop_constraint(constraint_name, type_="check")
        for column_name in ("bonus_balance_after", "paid_balance_after", "bonus_delta", "paid_delta"):
            if column_name in ledger_columns:
                batch.drop_column(column_name)

    with op.batch_alter_table("sp_accounts") as batch:
        for constraint_name in (
            "ck_sp_accounts_bonus_balance_nonnegative",
            "ck_sp_accounts_paid_balance_nonnegative",
        ):
            batch.drop_constraint(constraint_name, type_="check")
        for column_name in ("bonus_balance", "paid_balance"):
            if column_name in account_columns:
                batch.drop_column(column_name)
