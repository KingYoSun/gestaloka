"""pack publication overrides"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0034_pack_publish_overrides"
down_revision = "0033_pack_preprocess"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    existing = _tables()
    if "admin_pack_publication_overrides" not in existing:
        op.create_table(
            "admin_pack_publication_overrides",
            sa.Column("pack_id", sa.String(length=120), nullable=False),
            sa.Column("visibility", sa.String(length=32), nullable=True),
            sa.Column("publish_status", sa.String(length=32), nullable=True),
            sa.Column("updated_by_sub", sa.String(length=128), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "visibility IS NULL OR visibility IN ('public', 'private')",
                name="ck_admin_pack_publication_overrides_visibility",
            ),
            sa.CheckConstraint(
                "publish_status IS NULL OR publish_status IN ('playable', 'draft', 'archived')",
                name="ck_admin_pack_publication_overrides_publish_status",
            ),
            sa.PrimaryKeyConstraint("pack_id"),
        )
    if "admin_world_template_publication_overrides" not in existing:
        op.create_table(
            "admin_world_template_publication_overrides",
            sa.Column("pack_id", sa.String(length=120), nullable=False),
            sa.Column("world_template_id", sa.String(length=120), nullable=False),
            sa.Column("visibility", sa.String(length=32), nullable=True),
            sa.Column("publish_status", sa.String(length=32), nullable=True),
            sa.Column("updated_by_sub", sa.String(length=128), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "visibility IS NULL OR visibility IN ('public', 'private')",
                name="ck_admin_world_template_publication_overrides_visibility",
            ),
            sa.CheckConstraint(
                "publish_status IS NULL OR publish_status IN ('playable', 'draft', 'archived')",
                name="ck_admin_world_template_publication_overrides_publish_status",
            ),
            sa.PrimaryKeyConstraint("pack_id", "world_template_id"),
        )


def downgrade() -> None:
    existing = _tables()
    if "admin_world_template_publication_overrides" in existing:
        op.drop_table("admin_world_template_publication_overrides")
    if "admin_pack_publication_overrides" in existing:
        op.drop_table("admin_pack_publication_overrides")
