from __future__ import annotations

from sqlalchemy import select

from app.models.entities import ChapterTrack, Memory, RoutePressure, Turn


def test_ember_harbor_followup_can_commit_to_pack_defined_branch_and_retrieval_uses_new_keys(
    client,
    container,
    auth_headers,
):
    session_response = client.post(
        "/sessions",
        json={
            "world_id": "ember_harbor",
            "pack_id": "ember_harbor",
            "world_template_id": "ember_harbor",
        },
        headers=auth_headers,
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()

    for _ in range(2):
        turn = client.post(
            "/turns",
            json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
            headers=auth_headers,
        )
        assert turn.status_code == 200

    use_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert use_turn.status_code == 200
    assert use_turn.json()["action_type"] == "use_reward_item"

    topup = client.post(
        "/ops/sp/adjustments",
        json={
            "user_sub": "local-player",
            "delta": 12,
            "reason_code": "admin_adjustment",
            "world_id": session_payload["world_id"],
            "note": "ember branch test budget topup",
        },
        headers=auth_headers,
    )
    assert topup.status_code == 200

    travel_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert travel_turn.status_code == 200
    assert travel_turn.json()["action_type"] == "travel"
    assert travel_turn.json()["current_location"]["key"] == "breakwater"

    committed_payload = None
    for _ in range(4):
        response = client.post(
            "/turns",
            json={
                "session_id": session_payload["session_id"],
                "input_mode": "free_text",
                "input_text": "Tide-Scribe Miroとの約束を守り、Beacon OathとしてHarbor Sealの務めを引き受ける",
            },
            headers=auth_headers,
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["crossroads_summary"]
        if any(item["action"] == "committed" for item in payload["branch_updates"]):
            committed_payload = payload
            break

    assert committed_payload is not None
    assert "Beacon Oath" in committed_payload["crossroads_summary"]

    followup_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert followup_turn.status_code == 200
    followup_payload = followup_turn.json()

    state_response = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert state_response.status_code == 200
    state_payload = state_response.json()
    assert state_payload["world_pack"]["followup_branches"]["formal_path"]["branch_key"] == "beacon_oath"
    assert state_payload["world_pack"]["followup_branches"]["undercurrent_path"]["branch_key"] == "tide_whispers"
    assert "Beacon Oath" in state_payload["chapter"]["crossroads_summary"]
    assert state_payload["chapter"]["branch_hint"]
    assert state_payload["recent_branch_echoes"]

    chapter_branches = client.get(f"/ops/worlds/{session_payload['world_id']}/chapter-branches", headers=auth_headers)
    route_pressures = client.get(f"/ops/worlds/{session_payload['world_id']}/route-pressures", headers=auth_headers)
    assert chapter_branches.status_code == 200
    assert route_pressures.status_code == 200
    assert any(item["branch_key"] == "beacon_oath" for item in chapter_branches.json()["items"])
    assert any(item["route_key"] == "beacon_oath" for item in route_pressures.json()["items"])
    assert any(item["route_key"] == "tide_whispers" for item in route_pressures.json()["items"])

    with container.session_factory() as db:
        chapter = db.execute(
            select(ChapterTrack).where(
                ChapterTrack.world_id == session_payload["world_id"],
                ChapterTrack.chapter_key == "ember_breakwater_followup",
            )
        ).scalar_one()
        assert chapter.branch_key == "beacon_oath"
        pressures = {
            item.route_key: float(item.pressure)
            for item in db.execute(
                select(RoutePressure).where(
                    RoutePressure.world_id == session_payload["world_id"],
                    RoutePressure.chapter_key == "ember_breakwater_followup",
                )
            ).scalars()
        }
        assert pressures["beacon_oath"] >= 0.6
        assert pressures["beacon_oath"] - pressures["tide_whispers"] >= 0.2

        resolved_turn = db.execute(select(Turn).where(Turn.id == followup_payload["turn_id"])).scalar_one()
        retrieval_trace = resolved_turn.resolved_output["retrieval_trace"]
        assert retrieval_trace["status"] == "ready"
        retrieved_texts = [
            db.execute(select(Memory).where(Memory.id == memory_id)).scalar_one().text
            for memory_id in retrieval_trace["retrieved_memory_ids"]
        ]
        assert any("Beacon Oath" in text for text in retrieved_texts)
