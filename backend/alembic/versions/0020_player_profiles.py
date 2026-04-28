"""player profiles"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0020_player_profiles"
down_revision = "0019_shared_world_projection"
branch_labels = None
depends_on = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "actors" in tables:
        actor_constraints = {constraint["name"] for constraint in inspector.get_unique_constraints("actors")}
        if "uq_actors_world_user_sub" in actor_constraints:
            with op.batch_alter_table("actors", recreate="always") as batch:
                batch.drop_constraint("uq_actors_world_user_sub", type_="unique")

    if "player_profiles" not in tables:
        return

    columns = _column_names(inspector, "player_profiles")
    with op.batch_alter_table("player_profiles") as batch:
        if "gender" not in columns:
            batch.add_column(sa.Column("gender", sa.String(length=32), nullable=False, server_default="unspecified"))
        if "background" not in columns:
            batch.add_column(sa.Column("background", sa.Text(), nullable=False, server_default=""))
        if "free_text" not in columns:
            batch.add_column(sa.Column("free_text", sa.Text(), nullable=False, server_default=""))
        if "narrative_preferences" not in columns:
            batch.add_column(sa.Column("narrative_preferences", sa.JSON(), nullable=False, server_default="{}"))
        if "locked_at" not in columns:
            batch.add_column(sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True))
        if "profile_setup_event_id" not in columns:
            batch.add_column(sa.Column("profile_setup_event_id", sa.String(length=36), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "player_profiles" in tables:
        columns = _column_names(inspector, "player_profiles")
        with op.batch_alter_table("player_profiles") as batch:
            for column_name in (
                "profile_setup_event_id",
                "locked_at",
                "narrative_preferences",
                "free_text",
                "background",
                "gender",
            ):
                if column_name in columns:
                    batch.drop_column(column_name)
