from __future__ import annotations

import shutil
from pathlib import Path
from typing import Callable

import pytest
import yaml
from sqlalchemy import select

from app.models.entities import World
from app.modules.world_pack.service import PackRegistry


REPO_ROOT = Path(__file__).resolve().parents[2]


def _copy_pack_dir(tmp_path: Path, pack_name: str = "founders_reach") -> Path:
    pack_dir = tmp_path / "packs"
    shutil.copytree(REPO_ROOT / "packs" / pack_name, pack_dir / pack_name)
    return pack_dir


def _rewrite_world_template(pack_dir: Path, pack_name: str, mutate: Callable[[dict[str, object]], None]) -> None:
    template_path = pack_dir / pack_name / "world_templates.yaml"
    payload = yaml.safe_load(template_path.read_text(encoding="utf-8"))
    mutate(payload)
    template_path.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True), encoding="utf-8")


def test_world_pack_registry_lists_reference_and_sample_pack(client, auth_headers):
    response = client.get("/worlds/packs", headers=auth_headers)

    assert response.status_code == 200
    items = response.json()["items"]
    assert {item["pack_id"] for item in items} >= {"founders_reach", "ember_harbor"}
    ember = next(item for item in items if item["pack_id"] == "ember_harbor")
    assert ember["world_templates"][0]["template_id"] == "ember_harbor"


def test_pack_registry_rejects_missing_followup_branches(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        del payload["world_templates"]["founders_reach"]["roles"]["followup_branches"]  # type: ignore[index]

    _rewrite_world_template(pack_dir, "founders_reach", mutate)

    with pytest.raises(ValueError, match="followup_branches"):
        PackRegistry(pack_dir)


def test_pack_registry_rejects_missing_followup_branch_slot(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        del payload["world_templates"]["founders_reach"]["roles"]["followup_branches"]["undercurrent_path"]  # type: ignore[index]

    _rewrite_world_template(pack_dir, "founders_reach", mutate)

    with pytest.raises(ValueError, match="undercurrent_path"):
        PackRegistry(pack_dir)


def test_pack_registry_rejects_duplicate_followup_branch_keys(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        roles = payload["world_templates"]["founders_reach"]["roles"]  # type: ignore[index]
        roles["followup_branches"]["undercurrent_path"]["branch_key"] = "watch_oath"  # type: ignore[index]

    _rewrite_world_template(pack_dir, "founders_reach", mutate)

    with pytest.raises(ValueError, match="unique"):
        PackRegistry(pack_dir)


def test_pack_registry_rejects_unknown_followup_branch_anchor_npc(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        roles = payload["world_templates"]["founders_reach"]["roles"]  # type: ignore[index]
        roles["followup_branches"]["formal_path"]["anchor_npcs"] = ["Unknown Anchor"]  # type: ignore[index]

    _rewrite_world_template(pack_dir, "founders_reach", mutate)

    with pytest.raises(ValueError, match="anchor_npcs"):
        PackRegistry(pack_dir)


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
    assert state_payload["world_pack"]["followup_branches"]["formal_path"]["branch_key"] == "beacon_oath"
    assert state_payload["world_pack"]["followup_branches"]["undercurrent_path"]["branch_key"] == "tide_whispers"
    assert state_payload["quests"][0]["stage_key"] == "starter_harbor"
    assert state_payload["chapter"]["key"] == "ember_harbor_opening"
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


def test_sample_pack_choice_progression_reaches_breakwater_without_schema_failures(client, auth_headers):
    session_response = client.post(
        "/sessions",
        json={
            "world_id": "world-ember-runtime",
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
