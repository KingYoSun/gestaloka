"""turn resolution background jobs"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0027_turn_resolution_jobs"
down_revision = "0026_paid_bonus_sp"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "turn_resolution_jobs" in set(inspector.get_table_names()):
        return

    op.create_table(
        "turn_resolution_jobs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("turn_id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("world_id", sa.String(length=64), nullable=False),
        sa.Column("user_sub", sa.String(length=128), nullable=False),
        sa.Column("request_payload", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("result_payload", sa.JSON(), nullable=False),
        sa.Column("error_payload", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["session_id", "world_id"], ["sessions.id", "sessions.world_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("turn_id", "world_id", name="uq_turn_resolution_jobs_turn_world"),
    )
    op.create_index(op.f("ix_turn_resolution_jobs_status"), "turn_resolution_jobs", ["status"], unique=False)
    op.create_index(op.f("ix_turn_resolution_jobs_turn_id"), "turn_resolution_jobs", ["turn_id"], unique=False)
    op.create_index(op.f("ix_turn_resolution_jobs_user_sub"), "turn_resolution_jobs", ["user_sub"], unique=False)
    op.create_index(op.f("ix_turn_resolution_jobs_world_id"), "turn_resolution_jobs", ["world_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "turn_resolution_jobs" not in set(inspector.get_table_names()):
        return

    op.drop_index(op.f("ix_turn_resolution_jobs_world_id"), table_name="turn_resolution_jobs")
    op.drop_index(op.f("ix_turn_resolution_jobs_user_sub"), table_name="turn_resolution_jobs")
    op.drop_index(op.f("ix_turn_resolution_jobs_turn_id"), table_name="turn_resolution_jobs")
    op.drop_index(op.f("ix_turn_resolution_jobs_status"), table_name="turn_resolution_jobs")
    op.drop_table("turn_resolution_jobs")
