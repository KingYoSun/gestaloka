from __future__ import annotations

from sqlalchemy import func, select

from app.models.entities import Item, OutboxEvent, ProjectionRecord, QuestAssignment


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

    events = client.get(f"/worlds/{session_payload['world_id']}/events", headers=auth_headers)
    memories = client.get(f"/worlds/{session_payload['world_id']}/memories", headers=auth_headers)
    state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert events.status_code == 200
    assert memories.status_code == 200
    assert state.status_code == 200
    assert len(events.json()["items"]) == 3
    assert events.json()["items"][-1]["event_type"] == "session.started"
    assert any("旅人を助け" in item["text"] for item in memories.json()["items"])
    assert state.json()["quests"][0]["status"] == "completed"
    assert state.json()["quests"][0]["progress"] == 2
    assert state.json()["inventory"][0]["template_key"] == "lantern_sigils"

    with container.session_factory() as db:
        pending = list(db.execute(select(OutboxEvent).where(OutboxEvent.status == "projected")).scalars())
        projected = list(db.execute(select(ProjectionRecord)).scalars())
        assignments = list(db.execute(select(QuestAssignment)).scalars())
        items = list(db.execute(select(Item)).scalars())
        assert pending
        assert projected
        assert assignments[0].status == "completed"
        assert items[0].template_key == "lantern_sigils"
        projected_count = db.execute(select(func.count(ProjectionRecord.id))).scalar_one()

        processed_again = container.projection_service.process_pending(db)
        db.commit()
        assert processed_again == []
        assert db.execute(select(func.count(ProjectionRecord.id))).scalar_one() == projected_count

        rebuilt = container.projection_service.rebuild(db, session_payload["world_id"])
        db.commit()
        assert rebuilt
