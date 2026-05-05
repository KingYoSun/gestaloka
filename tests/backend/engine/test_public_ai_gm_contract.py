from __future__ import annotations

from typing import Any

from sqlalchemy import select

from app.models.entities import Event, Location, Memory, Turn
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


LIBRARY_OPENING_ACTION = (
    "万象図書館へ向かい、古い記録と来訪者ログを照合する。"
    "公開や契約へ進む前に、ゲスタロカ：階層世界基盤の正史と到着ログの整合を確かめる。"
)


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
    public_context = captured_inputs[0]["public_game_context"]
    assert public_context["language_context"] == {
        "pack_source_language": "en",
        "play_language": "ja",
        "output_language_requested": "ja",
    }
    assert public_context["current_location"]["source_name"] == "Nexus City"
    assert "ネクサス市" in public_context["current_location"]["aliases_by_language"]["ja"]
    library_exit = next(item for item in public_context["visible_exits"] if item["destination_name"] == "万象図書館")
    assert library_exit["source_name"] == "Universal Library"
    assert "Universal Library" in library_exit["aliases_by_language"]["en"]
    assert "万象図書館" in library_exit["aliases_by_language"]["ja"]


def test_library_opening_action_moves_by_public_alias_without_mechanical_fallback(client, container, auth_headers):
    original_generate = container.model_router.provider.generate

    def library_alias_generate(**kwargs):
        prompt = kwargs["prompt"]
        if prompt.prompt_id != "session.turn_resolution":
            return original_generate(**kwargs)
        return ProviderResponse(
            raw_output={
                "action_interpretation": "ヌートは万象図書館で古い記録と来訪者ログを照合しようとしている。",
                "narrative": "ヌートは万象図書館へ向かい、古い記録と来訪者ログを照合しようとした。",
                "npc_reaction": "図書館の司書たちは、来訪者が正史と到着ログの整合を確かめる手続きを静かに見守る。",
                "current_situation": "万象図書館では、古い記録と来訪者ログの照合端末が使える状態で開いている。",
                "current_location_name": "万象図書館 / 来訪者ログ",
                "suggested_actions": [
                    {"label": "歴史家AI端末で到着ログを検索する", "summary": "図書館で来訪者ログの記録位置を確かめる。"},
                    {"label": "正史索引と来訪者ログの差分を確認する", "summary": "古い記録と到着ログが食い違う箇所を探す。"},
                    {"label": "確認した記録をカナタに伝えに戻る", "summary": "図書館で得た情報をネクサス市側の案内役へ持ち帰る。"},
                ],
                "consequence_summary": "ヌートは万象図書館に到着し、記録照合の入口を確認した。",
                "world_tags": ["investigate"],
                "consequence_tags": ["careful_observation"],
                "scene_tone": "measured",
                "scene_move": "deepen",
                "scene_pressure": "medium",
                "memories": [{"scope": "world", "text": "ヌートは万象図書館で記録照合を始めた。", "salience": 0.7}],
                "language_context": {
                    "pack_source_language": "en",
                    "play_language": "ja",
                    "output_language_requested": "ja",
                },
                "public_claims": [
                    {
                        "kind": "location",
                        "surface_text": "万象図書館 / 来訪者ログ",
                        "language": "ja",
                        "role": "destination",
                        "key_candidate": "universal_library",
                        "confidence": 0.8,
                    }
                ],
            },
            provider_name="test",
            provider_response_id=None,
        )

    container.model_router.provider.generate = library_alias_generate
    try:
        session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
        assert session_response.status_code == 200
        session_id = session_response.json()["session_id"]
        opening_state = client.get(f"/sessions/{session_id}/state", headers=auth_headers).json()
        opening_labels = [item["label"] for item in opening_state["suggested_actions"]]

        payload = _post_turn_and_wait(client, session_id, auth_headers, LIBRARY_OPENING_ACTION)
    finally:
        container.model_router.provider.generate = original_generate

    assert payload["current_location"]["key"] == "universal_library"
    assert payload["location_updates"]
    assert "universal_library" in str(payload["location_updates"]) or "万象図書館" in str(payload["location_updates"])
    assert payload["suggested_actions"]
    assert [item["label"] for item in payload["suggested_actions"]] != opening_labels
    assert "は「" not in payload["narrative"]
    assert "を試みた" not in payload["narrative"]
    assert "図書館" in payload["npc_reaction"]

    with container.session_factory() as db:
        turn = db.get(Turn, payload["turn_id"])
        event = db.get(Event, payload["event_id"])
        assert turn is not None
        assert event is not None
        location = db.get(Location, event.location_id)
        assert location is not None
        assert turn.resolved_output["rejected_claims"] == []
        assert any(item["change_kind"] == "location" for item in turn.resolved_output["accepted_state_changes"])
        assert location.state["key"] == "universal_library"
        assert turn.resolved_output["interpreted_intent"]["language_context"]["play_language"] == "ja"
        assert turn.resolved_output["interpreted_intent"]["public_claims"][0]["surface_text"] == "万象図書館 / 来訪者ログ"


def test_public_claim_key_candidate_cannot_move_without_matching_surface_text(client, container, auth_headers):
    original_generate = container.model_router.provider.generate

    def bad_candidate_generate(**kwargs):
        prompt = kwargs["prompt"]
        if prompt.prompt_id != "session.turn_resolution":
            return original_generate(**kwargs)
        return ProviderResponse(
            raw_output={
                "action_interpretation": "ヌートは虚無領域へ移ろうとしている。",
                "narrative": "ヌートは虚無領域へ向かい、記録のない扉を通った。",
                "npc_reaction": "虚無領域の案内人は通行を認めた。",
                "current_situation": "虚無領域の入口にいる。",
                "current_location_name": "虚無領域",
                "suggested_actions": [
                    {"label": "周囲を確認する", "summary": "現在地で見えるものだけを確かめる。"},
                    {"label": "案内役に戻って聞く", "summary": "未確認の移動を検証する。"},
                ],
                "consequence_summary": "虚無領域へ移動した。",
                "world_tags": ["investigate"],
                "consequence_tags": ["careful_observation"],
                "scene_tone": "measured",
                "scene_move": "deepen",
                "scene_pressure": "medium",
                "language_context": {
                    "pack_source_language": "en",
                    "play_language": "ja",
                    "output_language_requested": "ja",
                },
                "public_claims": [
                    {
                        "kind": "location",
                        "surface_text": "虚無領域",
                        "language": "ja",
                        "role": "destination",
                        "key_candidate": "universal_library",
                        "confidence": 0.95,
                    }
                ],
            },
            provider_name="test",
            provider_response_id=None,
        )

    container.model_router.provider.generate = bad_candidate_generate
    try:
        session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
        assert session_response.status_code == 200
        session_id = session_response.json()["session_id"]
        before_state = client.get(f"/sessions/{session_id}/state", headers=auth_headers).json()
        payload = _post_turn_and_wait(client, session_id, auth_headers, "虚無領域へ向かう")
        after_state = client.get(f"/sessions/{session_id}/state", headers=auth_headers).json()
    finally:
        container.model_router.provider.generate = original_generate

    assert before_state["current_location"]["key"] == "nexus_city"
    assert payload["current_location"]["key"] == "nexus_city"
    assert after_state["current_location"]["key"] == "nexus_city"
    assert payload["location_updates"] == []
    assert "虚無領域の案内人" not in payload["npc_reaction"]
    with container.session_factory() as db:
        turn = db.get(Turn, payload["turn_id"])
        assert turn is not None
        assert turn.resolved_output["accepted_state_changes"] == []
        assert turn.resolved_output["rejected_claims"]
        assert turn.resolved_output["interpreted_intent"]["public_claims"][0]["key_candidate"] == "universal_library"


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
                "npc_reaction": "忘却領域の番人は、移動を見届けて門を閉じた。",
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
                "memories": [{"scope": "world", "text": "忘却領域の番人がヌートを迎えた。", "salience": 0.7}],
            },
            provider_name="test",
            provider_response_id=None,
        )

    container.model_router.provider.generate = impossible_location_generate
    try:
        session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
        assert session_response.status_code == 200
        session_id = session_response.json()["session_id"]

        before_state = client.get(f"/sessions/{session_id}/state", headers=auth_headers).json()
        payload = _post_turn_and_wait(client, session_id, auth_headers, "周囲を確認する")
        after_state = client.get(f"/sessions/{session_id}/state", headers=auth_headers).json()
    finally:
        container.model_router.provider.generate = original_generate

    assert payload["current_location"]["name"] == before_state["current_location"]["name"]
    assert after_state["current_location"]["name"] == before_state["current_location"]["name"]
    assert payload["location_updates"] == []
    assert payload["interpreted_intent"]["source"] == "public_ai_gm"
    assert "は「" not in payload["narrative"]
    assert "を試みた" not in payload["narrative"]
    assert "番人" not in payload["npc_reaction"]
    assert "Oblivion Regionsにいる" not in payload["npc_reaction"]

    with container.session_factory() as db:
        turn = db.get(Turn, payload["turn_id"])
        memories = db.execute(select(Memory).where(Memory.source_event_id == payload["event_id"])).scalars().all()
        assert turn is not None
        assert turn.resolved_output["rejected_claims"]
        assert turn.resolved_output["accepted_state_changes"] == []
        assert all("番人" not in memory.text for memory in memories)
