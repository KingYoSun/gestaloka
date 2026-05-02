"""dynamic quest chapters"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0029_dynamic_quest_chapters"
down_revision = "0028_play_localized_cache"
branch_labels = None
depends_on = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "chapter_tracks" in tables:
        columns = _column_names(inspector, "chapter_tracks")
        if "quest_assignment_id" not in columns:
            op.add_column("chapter_tracks", sa.Column("quest_assignment_id", sa.String(length=36), nullable=True))
        if "chapter_kind" not in columns:
            op.add_column(
                "chapter_tracks",
                sa.Column("chapter_kind", sa.String(length=32), nullable=False, server_default="ambient"),
            )
            op.alter_column("chapter_tracks", "chapter_kind", server_default=None)
        if "sequence_index" not in columns:
            op.add_column(
                "chapter_tracks",
                sa.Column("sequence_index", sa.Integer(), nullable=False, server_default="0"),
            )
            op.alter_column("chapter_tracks", "sequence_index", server_default=None)
        if "state_json" not in columns:
            op.add_column("chapter_tracks", sa.Column("state_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
            op.alter_column("chapter_tracks", "state_json", server_default=None)

        existing_fks = {fk["name"] for fk in inspector.get_foreign_keys("chapter_tracks")}
        if "fk_chapter_tracks_quest_assignment_world" not in existing_fks:
            if bind.dialect.name == "sqlite":
                with op.batch_alter_table("chapter_tracks", recreate="always") as batch:
                    batch.create_foreign_key(
                        "fk_chapter_tracks_quest_assignment_world",
                        "quest_assignments",
                        ["quest_assignment_id", "world_id"],
                        ["id", "world_id"],
                    )
            else:
                op.create_foreign_key(
                    "fk_chapter_tracks_quest_assignment_world",
                    "chapter_tracks",
                    "quest_assignments",
                    ["quest_assignment_id", "world_id"],
                    ["id", "world_id"],
                )

    if "scene_frames" in tables and "chapter_track_id" in _column_names(inspector, "scene_frames"):
        if bind.dialect.name == "sqlite":
            with op.batch_alter_table("scene_frames", recreate="always") as batch:
                batch.alter_column("chapter_track_id", existing_type=sa.String(length=36), nullable=True)
        else:
            op.alter_column("scene_frames", "chapter_track_id", existing_type=sa.String(length=36), nullable=True)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "scene_frames" in tables and "chapter_track_id" in _column_names(inspector, "scene_frames"):
        if bind.dialect.name == "sqlite":
            with op.batch_alter_table("scene_frames", recreate="always") as batch:
                batch.alter_column("chapter_track_id", existing_type=sa.String(length=36), nullable=False)
        else:
            op.alter_column("scene_frames", "chapter_track_id", existing_type=sa.String(length=36), nullable=False)

    if "chapter_tracks" in tables:
        columns = _column_names(inspector, "chapter_tracks")
        existing_fks = {fk["name"] for fk in inspector.get_foreign_keys("chapter_tracks")}
        if "fk_chapter_tracks_quest_assignment_world" in existing_fks:
            if bind.dialect.name == "sqlite":
                with op.batch_alter_table("chapter_tracks", recreate="always") as batch:
                    batch.drop_constraint("fk_chapter_tracks_quest_assignment_world", type_="foreignkey")
            else:
                op.drop_constraint("fk_chapter_tracks_quest_assignment_world", "chapter_tracks", type_="foreignkey")
        for column_name in ("state_json", "sequence_index", "chapter_kind", "quest_assignment_id"):
            if column_name in columns:
                op.drop_column("chapter_tracks", column_name)
