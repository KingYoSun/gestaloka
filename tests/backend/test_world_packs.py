from __future__ import annotations

from sqlalchemy import select

from app.models.entities import World


def test_world_pack_registry_lists_reference_and_sample_pack(client, auth_headers):
    response = client.get("/worlds/packs", headers=auth_headers)

    assert response.status_code == 200
    items = response.json()["items"]
    assert {item["pack_id"] for item in items} >= {"founders_reach", "ember_harbor"}
    ember = next(item for item in items if item["pack_id"] == "ember_harbor")
    assert ember["world_templates"][0]["template_id"] == "ember_harbor"


def test_session_can_start_from_sample_pack_and_persist_pack_metadata(client, container, auth_headers):
    response = client.post(
        "/sessions",
        json={
            "world_id": "world-ember",
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
    assert any("Tide Market" in item["label"] for item in state_payload["next_choices"])

    with container.session_factory() as db:
        world = db.execute(select(World).where(World.id == "world-ember")).scalar_one()
        assert world.state["pack_id"] == "ember_harbor"
        assert world.state["world_template_id"] == "ember_harbor"


def test_model_router_applies_world_pack_prompt_overlay(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json={
            "world_id": "world-ember-overlay",
            "pack_id": "ember_harbor",
            "world_template_id": "ember_harbor",
        },
        headers=auth_headers,
    )
    assert session_response.status_code == 200

    prompt = container.model_router._resolve_prompt_for_world("council.narrative", "world-ember-overlay")
    assert "Ember Harbor" in prompt.instructions
    assert "Cinder Breakwater" in prompt.instructions
