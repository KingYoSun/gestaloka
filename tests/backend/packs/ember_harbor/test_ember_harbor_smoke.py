from __future__ import annotations


def test_ember_harbor_starter_slice_unlocks_breakwater_and_travels_there(client, auth_headers):
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

    initial_state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert initial_state.status_code == 200
    initial_payload = initial_state.json()
    assert initial_payload["chapter"]["key"] == "ember_harbor_opening"
    assert initial_payload["quests"][0]["stage_key"] == "starter_harbor"
    assert initial_payload["current_location"]["key"] == "quay"

    for _ in range(2):
        turn_response = client.post(
            "/turns",
            json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
            headers=auth_headers,
        )
        assert turn_response.status_code == 200

    reward_state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert reward_state.status_code == 200
    reward_payload = reward_state.json()
    assert reward_payload["inventory"][0]["effect_kind"] == "unlock_breakwater_route"
    assert reward_payload["next_choices"][1]["action_kind"] == "use_reward_item"

    use_response = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert use_response.status_code == 200
    use_payload = use_response.json()
    assert use_payload["action_type"] == "use_reward_item"
    assert use_payload["quest_updates"][0]["stage_key"] == "breakwater_unsealed"
    assert use_payload["chapter_updates"][-1]["key"] == "ember_breakwater_followup"

    post_use_state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert post_use_state.status_code == 200
    assert any(
        item["destination_key"] == "breakwater" and item["available"]
        for item in post_use_state.json()["nearby_routes"]
    )

    travel_response = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert travel_response.status_code == 200
    travel_payload = travel_response.json()
    assert travel_payload["action_type"] == "travel"
    assert travel_payload["current_location"]["key"] == "breakwater"
