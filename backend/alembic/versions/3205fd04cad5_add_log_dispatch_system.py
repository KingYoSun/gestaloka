"""add log dispatch system

Revision ID: 3205fd04cad5
Revises: 30f5fb512c38
Create Date: 2025-06-22 13:14:57.794648

"""

import sqlalchemy as sa
import sqlmodel

from alembic import op

# revision identifiers, used by Alembic.
revision = "3205fd04cad5"
down_revision = "30f5fb512c38"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table(
        "log_dispatches",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("completed_log_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("dispatcher_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column(
            "objective_type",
            sa.Enum("EXPLORE", "INTERACT", "COLLECT", "GUARD", "FREE", name="dispatchobjectivetype"),
            nullable=False,
        ),
        sa.Column("objective_detail", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("initial_location", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("dispatch_duration_days", sa.Integer(), nullable=False),
        sa.Column("sp_cost", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("PREPARING", "DISPATCHED", "RETURNING", "COMPLETED", "RECALLED", name="dispatchstatus"),
            nullable=False,
        ),
        sa.Column("travel_log", sa.JSON(), nullable=True),
        sa.Column("collected_items", sa.JSON(), nullable=True),
        sa.Column("discovered_locations", sa.JSON(), nullable=True),
        sa.Column("sp_refund_amount", sa.Integer(), nullable=False),
        sa.Column("achievement_score", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(), nullable=True),
        sa.Column("expected_return_at", sa.DateTime(), nullable=True),
        sa.Column("actual_return_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["completed_log_id"],
            ["completed_logs.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dispatcher_id"],
            ["characters.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_log_dispatches_completed_log_id"), "log_dispatches", ["completed_log_id"], unique=False)
    op.create_index(op.f("ix_log_dispatches_dispatcher_id"), "log_dispatches", ["dispatcher_id"], unique=False)
    op.create_table(
        "dispatch_encounters",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("dispatch_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("encountered_character_id", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("encountered_npc_name", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("location", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("interaction_type", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("interaction_summary", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("outcome", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("relationship_change", sa.Float(), nullable=False),
        sa.Column("items_exchanged", sa.JSON(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["dispatch_id"],
            ["log_dispatches.id"],
        ),
        sa.ForeignKeyConstraint(
            ["encountered_character_id"],
            ["characters.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_dispatch_encounters_dispatch_id"), "dispatch_encounters", ["dispatch_id"], unique=False)
    op.create_table(
        "dispatch_reports",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("dispatch_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("total_distance_traveled", sa.Integer(), nullable=False),
        sa.Column("total_encounters", sa.Integer(), nullable=False),
        sa.Column("total_items_collected", sa.Integer(), nullable=False),
        sa.Column("total_locations_discovered", sa.Integer(), nullable=False),
        sa.Column("objective_completion_rate", sa.Float(), nullable=False),
        sa.Column("memorable_moments", sa.JSON(), nullable=True),
        sa.Column("personality_changes", sa.JSON(), nullable=True),
        sa.Column("new_skills_learned", sa.JSON(), nullable=True),
        sa.Column("narrative_summary", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("epilogue", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["dispatch_id"],
            ["log_dispatches.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_dispatch_reports_dispatch_id"), "dispatch_reports", ["dispatch_id"], unique=True)
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_index(op.f("ix_dispatch_reports_dispatch_id"), table_name="dispatch_reports")
    op.drop_table("dispatch_reports")
    op.drop_index(op.f("ix_dispatch_encounters_dispatch_id"), table_name="dispatch_encounters")
    op.drop_table("dispatch_encounters")
    op.drop_index(op.f("ix_log_dispatches_dispatcher_id"), table_name="log_dispatches")
    op.drop_index(op.f("ix_log_dispatches_completed_log_id"), table_name="log_dispatches")
    op.drop_table("log_dispatches")
    # ### end Alembic commands ###
