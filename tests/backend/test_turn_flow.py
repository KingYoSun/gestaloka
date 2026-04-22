from __future__ import annotations

from sqlalchemy import func, select

from app.models.entities import Item, Memory, OutboxEvent, ProjectionRecord, QuestAssignment, Turn
from app.modules.world_memory.service import build_retrieval_query_text


def test_turn_flow_materializes_memory_and_projection(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json={"world_id": "world-alpha", "world_name": "Founders Reach"},
        headers=auth_headers,
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()

    first_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_text": "広場で旅人を助け、灯をともす"},
        headers=auth_headers,
    )
    assert first_turn.status_code == 200
    first_payload = first_turn.json()
    assert first_payload["sp_balance"] == 9
    assert first_payload["quest_updates"][0]["progress"] == 1
    assert first_payload["inventory_updates"] == []

    second_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_text": "旅人へ報告し、広場を見回して次の見回りを約束する",
        },
        headers=auth_headers,
    )
    assert second_turn.status_code == 200
    second_payload = second_turn.json()
    assert "旅人を助け" in second_payload["npc_reaction"]
    assert second_payload["sp_balance"] == 8
    assert second_payload["quest_updates"][0]["progress"] == 2
    assert second_payload["inventory_updates"][0]["template_key"] == "lantern_sigils"

    state_after_reward = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert state_after_reward.status_code == 200
    reward_item = state_after_reward.json()["inventory"][0]
    assert reward_item["usable"] is True
    assert reward_item["effect_kind"] == "unlock_followup_watch_path"

    use_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "action_type": "use_reward_item",
            "item_id": reward_item["id"],
        },
        headers=auth_headers,
    )
    assert use_turn.status_code == 200
    use_payload = use_turn.json()
    assert use_payload["action_type"] == "use_reward_item"
    assert use_payload["sp_balance"] == 7
    assert use_payload["quest_updates"][0]["stage_key"] == "watch_path_followup"
    assert use_payload["inventory_updates"][0]["status"] == "used"
    assert use_payload["faction_updates"][0]["delta"] == 0.1

    third_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "action_type": "narrative",
            "input_text": "Lantern Sigilで開いた watch path の様子を観察する",
        },
        headers=auth_headers,
    )
    assert third_turn.status_code == 200
    third_payload = third_turn.json()
    assert third_payload["sp_balance"] == 6
    assert "Lantern Sigil" in third_payload["npc_reaction"]

    events = client.get(f"/worlds/{session_payload['world_id']}/events", headers=auth_headers)
    memories = client.get(f"/worlds/{session_payload['world_id']}/memories", headers=auth_headers)
    state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert events.status_code == 200
    assert memories.status_code == 200
    assert state.status_code == 200
    assert len(events.json()["items"]) == 5
    assert events.json()["items"][-1]["event_type"] == "session.started"
    assert any("旅人を助け" in item["text"] for item in memories.json()["items"])
    assert any("Lantern Sigil" in item["text"] for item in memories.json()["items"])
    assert state.json()["quests"][0]["stage_key"] == "watch_path_followup"
    assert state.json()["inventory"][0]["status"] == "used"

    with container.session_factory() as db:
        pending = list(db.execute(select(OutboxEvent).where(OutboxEvent.status == "projected")).scalars())
        projected = list(db.execute(select(ProjectionRecord)).scalars())
        assignments = list(db.execute(select(QuestAssignment)).scalars())
        items = list(db.execute(select(Item)).scalars())
        assert pending
        assert projected
        assert {assignment.status for assignment in assignments} >= {"completed"}
        assert any(assignment.status == "active" for assignment in assignments)
        assert items[0].template_key == "lantern_sigils"
        assert items[0].status == "used"
        assert items[0].used_event_id is not None
        projected_count = db.execute(select(func.count(ProjectionRecord.id))).scalar_one()

        processed_again = container.projection_service.process_pending(db)
        db.commit()
        assert processed_again == []
        assert db.execute(select(func.count(ProjectionRecord.id))).scalar_one() == projected_count

        rebuilt = container.projection_service.rebuild(db, session_payload["world_id"])
        db.commit()
        assert rebuilt


def test_reward_item_memory_is_retrieved_on_followup_turn_and_worker_backfill_can_recover(container, client, auth_headers, monkeypatch):
    session_response = client.post(
        "/sessions",
        json={"world_id": "world-alpha", "world_name": "Founders Reach"},
        headers=auth_headers,
    )
    session_payload = session_response.json()

    first_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_text": "広場で旅人を助け、灯をともす"},
        headers=auth_headers,
    )
    assert first_turn.status_code == 200

    second_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_text": "旅人へ報告し、広場を見回して次の見回りを約束する",
        },
        headers=auth_headers,
    )
    assert second_turn.status_code == 200

    reward_item = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers).json()["inventory"][0]
    use_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "action_type": "use_reward_item",
            "item_id": reward_item["id"],
        },
        headers=auth_headers,
    )
    assert use_turn.status_code == 200

    followup_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "action_type": "narrative",
            "input_text": "Lantern Sigilで開いた watch path の様子を観察する",
        },
        headers=auth_headers,
    )
    assert followup_turn.status_code == 200

    with container.session_factory() as db:
        resolved_turn = db.execute(select(Turn).where(Turn.id == followup_turn.json()["turn_id"])).scalar_one()
        retrieval_trace = resolved_turn.resolved_output["retrieval_trace"]
        assert retrieval_trace["status"] == "ready"
        assert len(retrieval_trace["retrieved_memory_ids"]) >= 1
        assert any(score >= container.settings.memory_retrieval_min_score for score in retrieval_trace["top_scores"])
        retrieved_texts = [
            db.execute(select(Memory).where(Memory.id == memory_id)).scalar_one().text
            for memory_id in retrieval_trace["retrieved_memory_ids"]
        ]
        assert any("Lantern Sigil" in text for text in retrieved_texts)

    original_embed_document = container.memory_service.provider.embed_document
    original_embed_query = container.memory_service.provider.embed_query

    def fail_embed_document(text: str) -> list[float]:
        raise RuntimeError(f"embedding unavailable for {text}")

    def fail_embed_query(text: str) -> list[float]:
        raise RuntimeError(f"query embedding unavailable for {text}")

    monkeypatch.setattr(container.memory_service.provider, "embed_document", fail_embed_document)
    monkeypatch.setattr(container.memory_service.provider, "embed_query", fail_embed_query)
    degraded_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "action_type": "narrative",
            "input_text": "Lantern Sigilで開いた巡回路の様子をさらに確かめる",
        },
        headers=auth_headers,
    )
    assert degraded_turn.status_code == 200

    with container.session_factory() as db:
        pending = list(db.execute(select(Memory).where(Memory.embedding_status == "pending")).scalars())
        assert pending
        degraded_turn_record = db.execute(select(Turn).where(Turn.id == degraded_turn.json()["turn_id"])).scalar_one()
        assert degraded_turn_record.resolved_output["retrieval_trace"]["status"] == "degraded"
        retrieval = container.memory_service.search(
            db,
            world_id=session_payload["world_id"],
            query_text=build_retrieval_query_text("Lantern Sigilで開いた巡回路の様子をさらに確かめる"),
        )
        assert retrieval.trace.status == "degraded"

    monkeypatch.setattr(container.memory_service.provider, "embed_document", original_embed_document)
    monkeypatch.setattr(container.memory_service.provider, "embed_query", original_embed_query)
    with container.session_factory() as db:
        processed = container.memory_service.process_pending(db, world_id=session_payload["world_id"], limit=16)
        db.commit()
        assert processed
        refreshed = container.memory_service.search(
            db,
            world_id=session_payload["world_id"],
            query_text=build_retrieval_query_text("Lantern Sigilで開いた巡回路の様子をさらに確かめる"),
        )
        assert refreshed.trace.status == "ready"
        assert refreshed.trace.retrieved_memory_ids
