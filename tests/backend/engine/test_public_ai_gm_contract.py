from __future__ import annotations

from typing import Any

from app.modules.llm_harness.service import ProviderResponse


FORBIDDEN_LLM_KEYS = {
    "choice_id",
    "action_kind",
    "action_type",
    "target",
    "travel_target_key",
    "route_key",
    "destination_key",
    "item_id",
    "quest_assignment_id",
    "template_key",
    "pack_id",
    "world_template_id",
    "world_id",
    "actor_id",
    "location_id",
    "session_id",
    "turn_id",
}


def _session_payload() -> dict[str, str]:
    return {
        "world_id": "gestaloka_world_reference",
        "world_name": "GESTALOKA: Layered World Foundation",
        "player_display_name": "ヌート",
    }


def _receive_until(websocket, event_name: str, *, limit: int = 64) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for _ in range(limit):
        message = websocket.receive_json()
        messages.append(message)
        if message.get("event") == event_name:
            return messages
    raise AssertionError(f"{event_name} was not received")


def _post_turn_and_wait(client, session_id: str, auth_headers: dict[str, str], player_action_text: str) -> dict[str, Any]:
    with client.websocket_connect(f"/ws/sessions/{session_id}?token=dev-local-token") as websocket:
        response = client.post(
            "/turns",
            json={"session_id": session_id, "player_action_text": player_action_text},
            headers=auth_headers,
        )
        assert response.status_code == 202
        messages: list[dict[str, Any]] = []
        for _ in range(64):
            message = websocket.receive_json()
            messages.append(message)
            if message.get("event") in {"turn.resolved", "turn.failed"}:
                break
        else:
            raise AssertionError("turn.resolved or turn.failed was not received")
    assert messages[-1]["event"] == "turn.resolved", messages[-1]
    return messages[-1]["data"]


def _assert_no_forbidden_keys(value: Any, *, path: str = "input") -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            key_text = str(key)
            assert key_text not in FORBIDDEN_LLM_KEYS, f"{path}.{key_text} leaked"
            assert not key_text.endswith("_id"), f"{path}.{key_text} leaked"
            assert not key_text.endswith("_key"), f"{path}.{key_text} leaked"
            _assert_no_forbidden_keys(item, path=f"{path}.{key_text}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _assert_no_forbidden_keys(item, path=f"{path}[{index}]")


def test_turn_api_rejects_legacy_hidden_action_contract(client, auth_headers):
    session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_id = session_response.json()["session_id"]

    response = client.post(
        "/turns",
        json={"session_id": session_id, "input_mode": "choice", "choice_id": "choice_1"},
        headers=auth_headers,
    )

    assert response.status_code == 422


def test_session_state_exposes_public_suggested_actions_only(client, auth_headers):
    session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200

    state_response = client.get(f"/sessions/{session_response.json()['session_id']}/state", headers=auth_headers)
    assert state_response.status_code == 200
    payload = state_response.json()

    assert "suggested_actions" in payload
    assert "next_choices" not in payload
    assert payload["suggested_actions"]
    assert all(set(item) <= {"label", "summary", "risk_hint"} for item in payload["suggested_actions"])


def test_public_ai_gm_prompt_input_does_not_leak_internal_metadata(client, container, auth_headers):
    captured_inputs: list[dict[str, Any]] = []
    captured_prompt_ids: list[str] = []
    original_generate = container.model_router.provider.generate

    def capturing_generate(**kwargs):
        prompt = kwargs["prompt"]
        captured_prompt_ids.append(prompt.prompt_id)
        if prompt.prompt_id == "session.turn_resolution":
            captured_inputs.append(dict(kwargs["input_payload"]))
        return original_generate(**kwargs)

    container.model_router.provider.generate = capturing_generate
    session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200

    payload = _post_turn_and_wait(
        client,
        session_response.json()["session_id"],
        auth_headers,
        "万象図書館へ向かい、古い記録と来訪者ログを照合する",
    )

    assert payload["suggested_actions"]
    assert "session.turn_resolution" in captured_prompt_ids
    assert not any(prompt_id.startswith("council.") for prompt_id in captured_prompt_ids)
    assert len(captured_inputs) == 1
    _assert_no_forbidden_keys(captured_inputs[0])


def test_harness_rejects_unavailable_location_claim_without_moving_player(client, container, auth_headers):
    original_generate = container.model_router.provider.generate

    def impossible_location_generate(**kwargs):
        prompt = kwargs["prompt"]
        if prompt.prompt_id != "session.turn_resolution":
            return original_generate(**kwargs)
        return ProviderResponse(
            raw_output={
                "action_interpretation": "存在しない抜け道で忘却領域へ移る",
                "narrative": "ヌートは一瞬でOblivion Regionsへ移った。",
                "npc_reaction": "案内役は移動を見届けた。",
                "current_situation": "Oblivion Regionsにいる。",
                "current_location_name": "Oblivion Regions",
                "suggested_actions": [
                    {"label": "周囲を確認する", "summary": "移動先の状況を確認する。"},
                    {"label": "案内役に尋ねる", "summary": "移動の理由を確認する。"},
                ],
                "consequence_summary": "Oblivion Regionsへ移動した。",
                "world_tags": ["investigate"],
                "consequence_tags": ["careful_observation"],
                "scene_tone": "measured",
                "scene_move": "deepen",
                "scene_pressure": "medium",
                "memories": [{"scope": "world", "text": "移動を試みた。", "salience": 0.7}],
            },
            provider_name="test",
            provider_response_id=None,
        )

    container.model_router.provider.generate = impossible_location_generate
    session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_id = session_response.json()["session_id"]

    before_state = client.get(f"/sessions/{session_id}/state", headers=auth_headers).json()
    payload = _post_turn_and_wait(client, session_id, auth_headers, "周囲を確認する")
    after_state = client.get(f"/sessions/{session_id}/state", headers=auth_headers).json()

    assert payload["current_location"]["name"] == before_state["current_location"]["name"]
    assert after_state["current_location"]["name"] == before_state["current_location"]["name"]
    assert payload["location_updates"] == []
    assert payload["interpreted_intent"]["source"] == "public_ai_gm"
