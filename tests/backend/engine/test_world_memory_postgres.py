from __future__ import annotations

import os
from pathlib import Path

import pytest
from sqlalchemy import text

from app.core.config import Settings
from app.models.base import Base
from app.models.entities import Actor, Event, Session as GameSession, Turn, World
from app.modules.world_memory.service import MemoryService


REPO_ROOT = next(parent for parent in Path(__file__).resolve().parents if (parent / "AGENTS.md").exists() and (parent / "backend").is_dir())


@pytest.mark.skipif(
    not os.getenv("PGVECTOR_TEST_DATABASE_URL"),
    reason="PGVECTOR_TEST_DATABASE_URL is not configured",
)
def test_postgres_pgvector_search_uses_hnsw_and_respects_world_filter():
    database_url = os.environ["PGVECTOR_TEST_DATABASE_URL"]
    settings = Settings(
        database_url=database_url,
        alembic_database_url=database_url,
        oidc_dev_mode=True,
        graph_projection_backend="recording",
        model_provider="stub",
        embedding_provider="stub",
        prompt_dir=REPO_ROOT / "prompts",
        eval_dataset_dir=REPO_ROOT / "evals" / "datasets",
        release_config_dir=REPO_ROOT / "config" / "release",
        otel_metrics_port=0,
    )

    from app.core.container import build_container

    container = build_container(settings)
    engine = container.session_factory.kw["bind"]
    Base.metadata.drop_all(bind=engine)
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            """
            CREATE INDEX IF NOT EXISTS ix_memories_embedding_hnsw
            ON memories USING hnsw (embedding vector_cosine_ops)
            WHERE embedding IS NOT NULL
            """
        )

    memory_service = MemoryService(settings)

    with container.session_factory() as db:
        world_a = World(id="pg-world-a", name="World A", status="active")
        world_b = World(id="pg-world-b", name="World B", status="active")
        db.add_all([world_a, world_b])
        db.flush()

        actor_a = Actor(world_id=world_a.id, actor_type="player", user_sub="pg-a", display_name="Player A")
        actor_b = Actor(world_id=world_b.id, actor_type="player", user_sub="pg-b", display_name="Player B")
        db.add_all([actor_a, actor_b])
        db.flush()

        session_a = GameSession(world_id=world_a.id, player_actor_id=actor_a.id, status="active")
        session_b = GameSession(world_id=world_b.id, player_actor_id=actor_b.id, status="active")
        db.add_all([session_a, session_b])
        db.flush()

        turn_a = Turn(world_id=world_a.id, session_id=session_a.id, actor_id=actor_a.id, input_text="a", resolved_output={}, model_lane="main_lane")
        turn_b = Turn(world_id=world_b.id, session_id=session_b.id, actor_id=actor_b.id, input_text="b", resolved_output={}, model_lane="main_lane")
        db.add_all([turn_a, turn_b])
        db.flush()

        event_a = Event(
            world_id=world_a.id,
            session_id=session_a.id,
            turn_id=turn_a.id,
            event_type="player.turn.resolved",
            source_actor_id=actor_a.id,
            payload={"world_id": world_a.id},
            narrative="Player A helped a traveler in the plaza.",
        )
        event_b = Event(
            world_id=world_b.id,
            session_id=session_b.id,
            turn_id=turn_b.id,
            event_type="player.turn.resolved",
            source_actor_id=actor_b.id,
            payload={"world_id": world_b.id},
            narrative="Player B guarded a different gate.",
        )
        db.add_all([event_a, event_b])
        db.flush()

        memory_service.materialize_memories(
            db,
            world_id=world_a.id,
            source_event_id=event_a.id,
            drafts=[{"scope": "world", "text": "旅人を助けて広場の灯を守った。", "salience": 0.9}],
        )
        memory_service.materialize_memories(
            db,
            world_id=world_b.id,
            source_event_id=event_b.id,
            drafts=[{"scope": "world", "text": "別の門で見張りを続けた。", "salience": 0.9}],
        )
        db.commit()

        index_names = {
            row[0]
            for row in db.execute(
                text("SELECT indexname FROM pg_indexes WHERE tablename = 'memories'")
            ).all()
        }
        assert "ix_memories_embedding_hnsw" in index_names

        result = memory_service.search(
            db,
            world_id=world_a.id,
            query_text="旅人を助けた報告をする",
            actor_id=actor_a.id,
            limit=4,
        )
        assert result.trace.status == "ready"
        assert result.trace.used_fallback is False
        assert result.trace.retrieved_memory_ids
        assert result.trace.top_scores
        assert result.trace.top_scores[0] > 0
        assert all(hit.id in result.trace.retrieved_memory_ids for hit in result.hits)
        assert all("別の門" not in hit.text for hit in result.hits)
        assert "旅人を助け" in result.hits[0].text
