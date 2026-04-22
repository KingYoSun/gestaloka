"""semantic memory retrieval hardening"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0008_semantic_memory_retrieval"
down_revision = "0007_gm_council_live_provider"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    memory_columns = {column["name"] for column in inspector.get_columns("memories")}

    with op.batch_alter_table("memories", recreate="always") as batch:
        if "embedding_status" not in memory_columns:
            batch.add_column(sa.Column("embedding_status", sa.String(length=32), nullable=False, server_default="pending"))
        if "embedding_model" not in memory_columns:
            batch.add_column(sa.Column("embedding_model", sa.String(length=120), nullable=True))
        if "embedded_at" not in memory_columns:
            batch.add_column(sa.Column("embedded_at", sa.DateTime(timezone=True), nullable=True))

    if bind.dialect.name == "postgresql":
        bind.exec_driver_sql("UPDATE memories SET embedding = NULL")
        bind.exec_driver_sql("ALTER TABLE memories ALTER COLUMN embedding TYPE vector(768) USING NULL::vector(768)")
        bind.exec_driver_sql(
            """
            CREATE INDEX IF NOT EXISTS ix_memories_embedding_hnsw
            ON memories USING hnsw (embedding vector_cosine_ops)
            WHERE embedding IS NOT NULL
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        bind.exec_driver_sql("DROP INDEX IF EXISTS ix_memories_embedding_hnsw")
        bind.exec_driver_sql("ALTER TABLE memories ALTER COLUMN embedding TYPE vector(8) USING NULL::vector(8)")

    with op.batch_alter_table("memories", recreate="always") as batch:
        batch.drop_column("embedded_at")
        batch.drop_column("embedding_model")
        batch.drop_column("embedding_status")
