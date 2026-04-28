"""admin management tables"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0023_admin_management"
down_revision = "0022_llm_cache_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "admin_app_users" not in existing:
        op.create_table(
            "admin_app_users",
            sa.Column("user_sub", sa.String(length=128), nullable=False),
            sa.Column("email", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("display_name", sa.String(length=120), nullable=False, server_default=""),
            sa.Column("role", sa.String(length=32), nullable=False, server_default="viewer"),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
            sa.Column("permissions", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("user_sub"),
        )
    if "admin_runtime_configs" not in existing:
        op.create_table(
            "admin_runtime_configs",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("provider", sa.String(length=64), nullable=False, server_default="settings"),
            sa.Column("base_url_secret_ref", sa.String(length=160), nullable=False, server_default=""),
            sa.Column("api_key_secret_ref", sa.String(length=160), nullable=False, server_default=""),
            sa.Column("embedding_provider", sa.String(length=64), nullable=False, server_default="settings"),
            sa.Column("embedding_base_url_secret_ref", sa.String(length=160), nullable=False, server_default=""),
            sa.Column("embedding_api_key_secret_ref", sa.String(length=160), nullable=False, server_default=""),
            sa.Column("model_ids", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("admin_debug_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    if "admin_prompt_overrides" not in existing:
        op.create_table(
            "admin_prompt_overrides",
            sa.Column("prompt_id", sa.String(length=160), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("instructions", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("prompt_id"),
        )


def downgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "admin_prompt_overrides" in existing:
        op.drop_table("admin_prompt_overrides")
    if "admin_runtime_configs" in existing:
        op.drop_table("admin_runtime_configs")
    if "admin_app_users" in existing:
        op.drop_table("admin_app_users")
