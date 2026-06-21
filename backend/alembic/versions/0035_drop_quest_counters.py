"""drop quest progress counters (ADR-003: AI-judged quest resolution)

Quest progression is the AI GM's narrative judgment, not a deterministic counter, so
quests are simply active -> completed. The numeric progress counters
(quest_assignments.progress / progress_target, quest_templates.completion_target) are
removed along with their check constraints.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0035_drop_quest_counters"
down_revision = "0034_pack_publish_overrides"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _check_constraints(table: str) -> set[str]:
    return {
        constraint["name"]
        for constraint in sa.inspect(op.get_bind()).get_check_constraints(table)
        if constraint.get("name")
    }


def upgrade() -> None:
    tables = _tables()
    if "quest_assignments" in tables:
        assignment_columns = _columns("quest_assignments")
        assignment_checks = _check_constraints("quest_assignments")
        with op.batch_alter_table("quest_assignments") as batch_op:
            if "ck_quest_assignments_progress_nonnegative" in assignment_checks:
                batch_op.drop_constraint("ck_quest_assignments_progress_nonnegative", type_="check")
            if "ck_quest_assignments_progress_target_positive" in assignment_checks:
                batch_op.drop_constraint("ck_quest_assignments_progress_target_positive", type_="check")
            if "progress" in assignment_columns:
                batch_op.drop_column("progress")
            if "progress_target" in assignment_columns:
                batch_op.drop_column("progress_target")

    if "quest_templates" in tables and "completion_target" in _columns("quest_templates"):
        with op.batch_alter_table("quest_templates") as batch_op:
            batch_op.drop_column("completion_target")


def downgrade() -> None:
    tables = _tables()
    if "quest_assignments" in tables:
        assignment_columns = _columns("quest_assignments")
        with op.batch_alter_table("quest_assignments") as batch_op:
            if "progress" not in assignment_columns:
                batch_op.add_column(sa.Column("progress", sa.Integer(), nullable=False, server_default="0"))
            if "progress_target" not in assignment_columns:
                batch_op.add_column(sa.Column("progress_target", sa.Integer(), nullable=False, server_default="2"))
            batch_op.create_check_constraint("ck_quest_assignments_progress_nonnegative", "progress >= 0")
            batch_op.create_check_constraint("ck_quest_assignments_progress_target_positive", "progress_target >= 1")

    if "quest_templates" in tables and "completion_target" not in _columns("quest_templates"):
        with op.batch_alter_table("quest_templates") as batch_op:
            batch_op.add_column(sa.Column("completion_target", sa.Integer(), nullable=False, server_default="2"))
