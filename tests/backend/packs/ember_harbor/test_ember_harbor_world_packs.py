from __future__ import annotations

from sqlalchemy import select

from app.models.entities import World


def test_session_can_start_from_sample_pack_and_persist_pack_metadata(client, container, auth_headers):
    response = client.post(
        "/sessions",
        json={
            "world_id": "ember_harbor",
            "pack_id": "ember_harbor",
            "world_template_id": "ember_harbor",
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["pack_id"] == "ember_harbor"
    assert payload["world_template_id"] == "ember_harbor"
    assert payload["world_name"] == "Ember Harbor"

    state = client.get(f"/sessions/{payload['session_id']}/state", headers=auth_headers)
    assert state.status_code == 200
    state_payload = state.json()
    assert state_payload["current_location"]["name"] == "Ember Quay"
    assert state_payload["world_pack"]["pack_id"] == "ember_harbor"
    assert state_payload["world_pack"]["followup_location_name"] == "Cinder Breakwater"
    assert state_payload["world_pack"]["followup_branches"]["formal_path"]["branch_key"] == "beacon_oath"
    assert state_payload["world_pack"]["followup_branches"]["undercurrent_path"]["branch_key"] == "tide_whispers"
    assert state_payload["quests"][0]["stage_key"] == "starter_harbor"
    assert state_payload["chapter"]["key"] == "ember_harbor_opening"
    assert any("Tide Market" in item["label"] for item in state_payload["next_choices"])

    with container.session_factory() as db:
        world = db.execute(select(World).where(World.id == "ember_harbor")).scalar_one()
        assert world.state["pack_id"] == "ember_harbor"
        assert world.state["world_template_id"] == "ember_harbor"


def test_model_router_applies_world_pack_prompt_overlay(client, container, auth_headers):
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

    prompt = container.model_router._resolve_prompt_for_world("council.narrative", "ember_harbor")
    assert "Ember Harbor" in prompt.instructions
    assert "Cinder Breakwater" in prompt.instructions


def test_sample_pack_choice_progression_reaches_breakwater_without_schema_failures(client, auth_headers):
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

    first_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert first_turn.status_code == 200
    assert first_turn.json()["action_type"] == "narrative"

    second_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert second_turn.status_code == 200
    second_payload = second_turn.json()
    assert second_payload["inventory_updates"][0]["effect_kind"] == "unlock_breakwater_route"

    post_reward_state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert post_reward_state.status_code == 200
    assert post_reward_state.json()["next_choices"][1]["action_kind"] == "use_reward_item"

    use_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert use_turn.status_code == 200
    use_payload = use_turn.json()
    assert use_payload["action_type"] == "use_reward_item"
    assert use_payload["quest_updates"][0]["stage_key"] == "breakwater_unsealed"
    assert use_payload["chapter_updates"][-1]["key"] == "ember_breakwater_followup"

    post_use_state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert post_use_state.status_code == 200
    assert any(
        item["destination_key"] == "breakwater" and item["available"]
        for item in post_use_state.json()["nearby_routes"]
    )

    travel_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert travel_turn.status_code == 200
    travel_payload = travel_turn.json()
    assert travel_payload["action_type"] == "travel"
    assert travel_payload["current_location"]["key"] == "breakwater"
