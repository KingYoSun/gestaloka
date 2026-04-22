"""relationship pressure and consequence threads"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0010_consequence_threads"
down_revision = "0009_non_pay_to_win_progression"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "consequence_threads" in tables:
        return

    op.create_table(
        "consequence_threads",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("world_id", sa.String(length=64), nullable=False),
        sa.Column("owner_actor_id", sa.String(length=36), nullable=False),
        sa.Column("counterpart_actor_id", sa.String(length=36), nullable=True),
        sa.Column("location_id", sa.String(length=96), nullable=True),
        sa.Column("thread_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("pressure_band", sa.String(length=16), nullable=False, server_default="low"),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("source_event_id", sa.String(length=36), nullable=True),
        sa.Column("last_event_id", sa.String(length=36), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("id", "world_id", name="uq_consequence_threads_id_world"),
        sa.ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        sa.ForeignKeyConstraint(["counterpart_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        sa.ForeignKeyConstraint(["location_id", "world_id"], ["locations.id", "locations.world_id"]),
        sa.ForeignKeyConstraint(["source_event_id", "world_id"], ["events.id", "events.world_id"]),
        sa.ForeignKeyConstraint(["last_event_id", "world_id"], ["events.id", "events.world_id"]),
    )

    if bind.dialect.name == "postgresql":
        op.alter_column("consequence_threads", "status", server_default=None)
        op.alter_column("consequence_threads", "pressure_band", server_default=None)
        op.alter_column("consequence_threads", "summary", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "consequence_threads" not in tables:
        return
    op.drop_table("consequence_threads")
