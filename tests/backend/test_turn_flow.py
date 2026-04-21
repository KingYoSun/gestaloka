from __future__ import annotations

from sqlalchemy import func, select

from app.models.entities import OutboxEvent, ProjectionRecord


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
        json={"session_id": session_payload["session_id"], "input_text": "広場で灯をともす"},
        headers=auth_headers,
    )
    assert first_turn.status_code == 200

    second_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_text": "広場を見回し、気配を探る"},
        headers=auth_headers,
    )
    assert second_turn.status_code == 200
    second_payload = second_turn.json()
    assert "灯をともす" in second_payload["npc_reaction"]

    events = client.get(f"/worlds/{session_payload['world_id']}/events", headers=auth_headers)
    memories = client.get(f"/worlds/{session_payload['world_id']}/memories", headers=auth_headers)
    assert events.status_code == 200
    assert memories.status_code == 200
    assert len(events.json()["items"]) == 2
    assert any("灯をともす" in item["text"] for item in memories.json()["items"])

    with container.session_factory() as db:
        pending = list(db.execute(select(OutboxEvent).where(OutboxEvent.status == "projected")).scalars())
        projected = list(db.execute(select(ProjectionRecord)).scalars())
        assert pending
        assert projected
        projected_count = db.execute(select(func.count(ProjectionRecord.id))).scalar_one()

        processed_again = container.projection_service.process_pending(db)
        db.commit()
        assert processed_again == []
        assert db.execute(select(func.count(ProjectionRecord.id))).scalar_one() == projected_count

        rebuilt = container.projection_service.rebuild(db, session_payload["world_id"])
        db.commit()
        assert rebuilt
