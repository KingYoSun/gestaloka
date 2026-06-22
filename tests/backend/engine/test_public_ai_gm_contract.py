from __future__ import annotations

from typing import Any

from sqlalchemy import select

from app.models.entities import Actor, Event, Location, Memory, Turn
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


def _post_turn_and_wait(
    client,
    session_id: str,
    auth_headers: dict[str, str],
    player_action_text: str,
    *,
    expected_event: str = "turn.resolved",
) -> dict[str, Any]:
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
    assert messages[-1]["event"] == expected_event, messages[-1]
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


def test_turn_api_rejects_quest_lifecycle_action_metadata(client, auth_headers):
    # AGENTS.md: /turns is canonically session_id + player_action_text. Quest journal actions
    # (including leave/resume) must arrive as display-body player_action_text, never as hidden
    # action metadata. The strict request model rejects such fields.
    session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_id = session_response.json()["session_id"]

    response = client.post(
        "/turns",
        json={
            "session_id": session_id,
            "player_action_text": "クエストから離脱: 来訪者ログ登録",
            "action_type": "leave_quest",
            "quest_assignment_id": "some-assignment",
        },
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
    # The legacy multi-agent council roles must not run for public turns. The
    # context_planner (ADR-005) is the only council-namespaced prompt allowed here.
    legacy_council_prompt_ids = {
        prompt_id
        for prompt_id in captured_prompt_ids
        if prompt_id.startswith("council.") and prompt_id != "council.context_planner"
    }
    assert not legacy_council_prompt_ids
    assert "council.context_planner" in captured_prompt_ids
    assert len(captured_inputs) == 1
    _assert_no_forbidden_keys(captured_inputs[0])
    public_context = captured_inputs[0]["public_game_context"]
    assert "referenced_context" in public_context
    _assert_no_forbidden_keys(public_context["referenced_context"], path="referenced_context")
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
    assert "historian AI" in library_exit["destination_description"]
    assert any("歴史家AI" in item["name"] for item in library_exit["arrival_people"])
    assert any("visitor log" in item.lower() or "来訪者ログ" in item for item in library_exit["related_memory_snippets"])


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
                "current_situation": "万象図書館では、古い記録と来訪者ログの照合端末が使える状態で開いている。",
                "current_location_name": "万象図書館 / 来訪者ログ",
                "suggested_actions": [
                    "歴史家AI端末で到着ログを検索する",
                    "正史索引と来訪者ログの差分を確認する",
                    {"label": "確認した記録をカナタに伝えに戻る", "summary": "図書館で得た情報をネクサス市側の案内役へ持ち帰る。"},
                ],
                "internal_summary": "ヌートは万象図書館に到着し、記録照合の入口を確認した。",
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
                        "role": "archive",
                        "key_candidate": "universal_library",
                        "confidence": 0.8,
                    }
                ],
                "present_people": [{"name": "万象図書館の歴史家AI"}],
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
    assert payload["npc_reaction"] == ""

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
        assert turn.resolved_output["interpreted_intent"]["public_claims"][0]["role"] == "mentioned"
        assert "string suggested_action was normalized to object" in turn.resolved_output["interpreted_intent"]["normalization_warnings"]


def test_public_claim_key_candidate_cannot_move_without_matching_surface_text(client, container, auth_headers):
    original_generate = container.model_router.provider.generate

    def bad_candidate_generate(**kwargs):
        prompt = kwargs["prompt"]
        if prompt.prompt_id not in {"session.turn_resolution", "session.turn_resolution_repair"}:
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
        payload = _post_turn_and_wait(
            client,
            session_id,
            auth_headers,
            "虚無領域へ向かう",
        )
        after_state = client.get(f"/sessions/{session_id}/state", headers=auth_headers).json()
    finally:
        container.model_router.provider.generate = original_generate

    # The unmatched key_candidate still cannot move the player. Instead of failing
    # the whole turn (and re-hallucinating on retry), the harness deterministically
    # resolves a minimal narrative at the canonical current location (Issue #5 / I3).
    assert before_state["current_location"]["key"] == "nexus_city"
    assert payload["current_location"]["key"] == "nexus_city"
    assert after_state["current_location"]["key"] == "nexus_city"
    assert payload["location_updates"] == []
    assert payload.get("system_message") is None
    assert payload.get("failure") is None
    assert payload.get("refund_ledger_id") is None
    assert payload["event_id"]
    with container.session_factory() as db:
        turn = db.get(Turn, payload["turn_id"])
        assert turn is not None
        assert turn.resolved_output["status"] == "resolved"
        assert turn.resolved_output["used_fallback"] is True
        # The fallback payload only claims the current location, so the harness
        # accepts it cleanly; no hallucinated move enters canonical state.
        assert turn.resolved_output["rejected_claims"] == []
        assert not any(
            item.get("change_kind") == "location" for item in turn.resolved_output["accepted_state_changes"]
        )
        # The unreachable place is named in-world as unreachable, not as a move.
        assert "虚無領域" in turn.resolved_output["narrative"]
        assert "見当たらない" in turn.resolved_output["narrative"]
        # The original hallucination is recorded on the fallback for audit.
        event = db.get(Event, payload["event_id"])
        assert event is not None
        fallback = event.payload["deterministic_fallback"]
        assert fallback["reason"] == "consistency_failed"
        assert any(item.get("claim") == "虚無領域" for item in fallback["rejected_claims"])


def test_public_visible_item_reference_is_not_unowned_item_use_failure(client, container, auth_headers):
    original_generate = container.model_router.provider.generate

    def visible_record_generate(**kwargs):
        prompt = kwargs["prompt"]
        if prompt.prompt_id != "session.turn_resolution":
            return original_generate(**kwargs)
        return ProviderResponse(
            raw_output={
                "action_interpretation": "ヌートは来訪者ログ登録を最後まで進めようとしている。",
                "narrative": "ヌートは公開証言ホールで確認済みの来訪者ログを確定し、案内担当へ完了報告を届けた。",
                "current_situation": "ネクサス市の公開証言ホールでは、到着ログの確認結果が登録手続きに反映されている。",
                "current_location_name": "ネクサス市",
                "suggested_actions": [
                    {"label": "カナタに登録結果を確認する", "summary": "登録がどの制度へ接続されたかを尋ねる。"},
                    {"label": "万象図書館へ記録を照合しに行く", "summary": "公開された登録結果と正史の整合を見る。"},
                ],
                "internal_summary": "ヌートは公開証言ホールで来訪者ログ登録を進めた。",
                "world_tags": ["aid_local"],
                "consequence_tags": ["trust_gain"],
                "scene_tone": "measured",
                "scene_move": "deepen",
                "scene_pressure": "medium",
                "memories": [{"scope": "world", "text": "ヌートは来訪者ログ登録の確認結果をまとめた。", "salience": 0.7}],
                "language_context": {
                    "pack_source_language": "en",
                    "play_language": "ja",
                    "output_language_requested": "ja",
                },
                "public_claims": [
                    {"kind": "item", "surface_text": "来訪者ログ", "language": "ja", "role": "used"},
                    {"kind": "actor", "surface_text": "ネクサス案内担当カナタ", "language": "ja", "role": "present"},
                ],
                "present_people": ["ネクサス案内担当カナタ"],
                "visible_items": ["来訪者ログ"],
                "used_item_names": ["来訪者ログ"],
            },
            provider_name="test",
            provider_response_id=None,
        )

    container.model_router.provider.generate = visible_record_generate
    try:
        session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
        assert session_response.status_code == 200
        payload = _post_turn_and_wait(
            client,
            session_response.json()["session_id"],
            auth_headers,
            "再開した来訪者ログ登録を最後まで手伝い、公開証言ホールで確認済みログを確定し、案内担当へ完了報告を届ける。",
        )
    finally:
        container.model_router.provider.generate = original_generate

    assert payload["event_id"]
    assert payload.get("system_message") is None
    with container.session_factory() as db:
        turn = db.get(Turn, payload["turn_id"])
        assert turn is not None
        assert turn.resolved_output["status"] == "resolved"
        assert not [
            item
            for item in turn.resolved_output["rejected_claims"]
            if item.get("claim_kind") == "item_use" and item.get("claim") == "来訪者ログ"
        ]


def test_harness_unavailable_location_claim_falls_back_without_moving_player(client, container, auth_headers):
    original_generate = container.model_router.provider.generate

    def impossible_location_generate(**kwargs):
        prompt = kwargs["prompt"]
        if prompt.prompt_id not in {"session.turn_resolution", "session.turn_resolution_repair"}:
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
        payload = _post_turn_and_wait(
            client,
            session_id,
            auth_headers,
            "周囲を確認する",
        )
        after_state = client.get(f"/sessions/{session_id}/state", headers=auth_headers).json()
    finally:
        container.model_router.provider.generate = original_generate

    # The hallucinated move is rejected (player does not relocate), but instead of
    # failing the turn the harness resolves a minimal narrative in place (Issue #5).
    assert payload["current_location"]["name"] == before_state["current_location"]["name"]
    assert after_state["current_location"]["name"] == before_state["current_location"]["name"]
    assert payload["location_updates"] == []
    assert payload.get("system_message") is None
    assert payload.get("failure") is None
    assert payload.get("refund_ledger_id") is None

    with container.session_factory() as db:
        turn = db.get(Turn, payload["turn_id"])
        memories = db.execute(select(Memory).where(Memory.source_event_id == payload["event_id"])).scalars().all()
        assert turn is not None
        assert turn.resolved_output["status"] == "resolved"
        assert turn.resolved_output["used_fallback"] is True
        assert turn.resolved_output["rejected_claims"] == []
        # The hallucinated NPC ("番人") is never materialized into canonical memory.
        assert all("番人" not in memory.text for memory in memories)
        event = db.get(Event, payload["event_id"])
        assert event is not None
        assert event.payload["deterministic_fallback"]["reason"] == "consistency_failed"


def test_harness_repeated_absent_npc_hallucination_falls_back_in_place(client, container, auth_headers):
    """Issue #5 (I3) regression: when both the first AI GM output and its repair
    re-hallucinate the same absent NPC, the turn must not fail forever. The harness
    deterministically resolves a minimal narrative in place that names the person as
    absent, instead of returning repair_failed and refunding SP."""
    original_generate = container.model_router.provider.generate
    absent_npc_name = "忘却の審判官ヴェル"

    def absent_npc_generate(**kwargs):
        prompt = kwargs["prompt"]
        if prompt.prompt_id not in {"session.turn_resolution", "session.turn_resolution_repair"}:
            return original_generate(**kwargs)
        # Both the initial output and the repair keep claiming the same NPC is here.
        return ProviderResponse(
            raw_output={
                "action_interpretation": f"ヌートは{absent_npc_name}に話しかけようとしている。",
                "narrative": f"{absent_npc_name}はヌートの問いに静かに頷いた。",
                "npc_reaction": f"{absent_npc_name}は古い裁定の記憶を語り始めた。",
                "current_situation": f"{absent_npc_name}が傍らに立っている。",
                "suggested_actions": [
                    {"label": "さらに尋ねる", "summary": "裁定の記憶を深掘りする。"},
                    {"label": "周囲を見回す", "summary": "現在地の様子を確かめる。"},
                ],
                "consequence_summary": f"{absent_npc_name}との対話が始まった。",
                "world_tags": ["investigate"],
                "consequence_tags": ["careful_observation"],
                "scene_tone": "measured",
                "scene_move": "deepen",
                "scene_pressure": "medium",
                "memories": [{"scope": "world", "text": f"{absent_npc_name}が裁定の記憶を語った。", "salience": 0.7}],
                "language_context": {
                    "pack_source_language": "en",
                    "play_language": "ja",
                    "output_language_requested": "ja",
                },
                "present_people": [absent_npc_name],
                "public_claims": [
                    {"kind": "actor", "surface_text": absent_npc_name, "language": "ja", "role": "present"},
                ],
            },
            provider_name="test",
            provider_response_id=None,
        )

    container.model_router.provider.generate = absent_npc_generate
    try:
        session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
        assert session_response.status_code == 200
        session_id = session_response.json()["session_id"]
        before_state = client.get(f"/sessions/{session_id}/state", headers=auth_headers).json()
        payload = _post_turn_and_wait(
            client,
            session_id,
            auth_headers,
            f"{absent_npc_name}に話しかける",
        )
        after_state = client.get(f"/sessions/{session_id}/state", headers=auth_headers).json()
    finally:
        container.model_router.provider.generate = original_generate

    assert payload["current_location"]["name"] == before_state["current_location"]["name"]
    assert after_state["current_location"]["name"] == before_state["current_location"]["name"]
    assert payload.get("system_message") is None
    assert payload.get("failure") is None
    assert payload.get("refund_ledger_id") is None

    with container.session_factory() as db:
        turn = db.get(Turn, payload["turn_id"])
        memories = db.execute(select(Memory).where(Memory.source_event_id == payload["event_id"])).scalars().all()
        assert turn is not None
        assert turn.resolved_output["status"] == "resolved"
        assert turn.resolved_output["used_fallback"] is True
        assert turn.resolved_output["rejected_claims"] == []
        # The absent NPC is named as absent in the fallback narrative, not present.
        assert absent_npc_name in turn.resolved_output["narrative"]
        assert "見当たらない" in turn.resolved_output["narrative"]
        # The hallucinated NPC dialogue is never materialized into canonical memory.
        assert all("裁定の記憶" not in memory.text for memory in memories)
        event = db.get(Event, payload["event_id"])
        assert event is not None
        fallback = event.payload["deterministic_fallback"]
        assert fallback["reason"] == "consistency_failed"
        assert any(item.get("claim") == absent_npc_name for item in fallback["rejected_claims"])


def test_addressed_absent_npc_repair_can_resolve_with_absence_notice(client, container, auth_headers):
    original_generate = container.model_router.provider.generate
    captured: dict[str, str] = {}

    def repaired_address_generate(**kwargs):
        prompt = kwargs["prompt"]
        if prompt.prompt_id not in {"session.turn_resolution", "session.turn_resolution_repair"}:
            return original_generate(**kwargs)
        public_context = kwargs["input_payload"]["public_game_context"]
        current_location = public_context["current_location"]["name"]
        substitute_person = public_context["visible_people"][0]["name"]
        target_person = next(
            person["name"]
            for route in public_context["visible_exits"]
            for person in route.get("arrival_people") or []
        )
        captured["target"] = target_person
        captured["substitute"] = substitute_person
        if prompt.prompt_id == "session.turn_resolution_repair":
            return ProviderResponse(
                raw_output={
                    "action_interpretation": f"ヌートは{target_person}に尋ねようとしたが、この場にはいないことを確認する。",
                    "narrative": f"{target_person}の姿は、この場には見当たらない。{current_location}で確認できる範囲では、会うには別の場所へ向かう必要がある。",
                    "npc_reaction": "案内役は、現在地で確認できることだけを整理する。",
                    "current_situation": f"{current_location}では、指名した人物は同席していない。",
                    "current_location_name": current_location,
                    "suggested_actions": [
                        {"label": "行き先を確認する", "summary": "見えている出口から会いに行けるか確かめる。"},
                        {"label": "この場で聞き込みを続ける", "summary": "現在地で得られる公開情報だけを集める。"},
                    ],
                    "consequence_summary": f"{target_person}はこの場にはいないと確認された。",
                    "world_tags": ["investigate"],
                    "consequence_tags": ["careful_observation"],
                    "scene_tone": "measured",
                    "scene_move": "deepen",
                    "scene_pressure": "medium",
                    "memories": [{"scope": "world", "text": f"{target_person}は現在地にいないと確認された。", "salience": 0.7}],
                    "language_context": {
                        "pack_source_language": "en",
                        "play_language": "ja",
                        "output_language_requested": "ja",
                    },
                    "present_people": [],
                    "addressed_people": [target_person],
                    "public_claims": [
                        {"kind": "actor", "surface_text": target_person, "language": "ja", "role": "addressed"},
                    ],
                },
                provider_name="test",
                provider_response_id=None,
            )
        return ProviderResponse(
            raw_output={
                "action_interpretation": f"ヌートは{substitute_person}に街道の霧について尋ねる。",
                "narrative": f"{substitute_person}は帳簿を閉じ、街道の霧について答えた。",
                "npc_reaction": f"{substitute_person}は今見える範囲の話だけを返した。",
                "current_situation": f"{current_location}では{substitute_person}が近くにいる。",
                "current_location_name": current_location,
                "suggested_actions": [
                    {"label": "この場で確認する", "summary": "現在地で見える情報だけを整理する。"},
                    {"label": "出口を確認する", "summary": "会いたい人物のいる場所へ行けるか確かめる。"},
                ],
                "consequence_summary": f"{substitute_person}が街道の霧について答えた。",
                "world_tags": ["investigate"],
                "consequence_tags": ["careful_observation"],
                "scene_tone": "measured",
                "scene_move": "deepen",
                "scene_pressure": "medium",
                "memories": [{"scope": "world", "text": f"{substitute_person}が{target_person}の代わりに応答した。", "salience": 0.7}],
                "language_context": {
                    "pack_source_language": "en",
                    "play_language": "ja",
                    "output_language_requested": "ja",
                },
                "present_people": [substitute_person],
                "addressed_people": [target_person],
                "public_claims": [
                    {"kind": "actor", "surface_text": target_person, "language": "ja", "role": "addressed"},
                    {"kind": "actor", "surface_text": substitute_person, "language": "ja", "role": "present"},
                ],
            },
            provider_name="test",
            provider_response_id=None,
        )

    container.model_router.provider.generate = repaired_address_generate
    try:
        session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
        assert session_response.status_code == 200
        session_id = session_response.json()["session_id"]
        payload = _post_turn_and_wait(client, session_id, auth_headers, "万象図書館の歴史家AIに街道の霧について尋ねる")
    finally:
        container.model_router.provider.generate = original_generate

    target_person = captured["target"]
    substitute_person = captured["substitute"]
    with container.session_factory() as db:
        turn = db.get(Turn, payload["turn_id"])
        memories = db.execute(select(Memory).where(Memory.source_event_id == payload["event_id"])).scalars().all()
        event = db.get(Event, payload["event_id"])
        assert turn is not None
        assert event is not None
        assert turn.resolved_output["status"] == "resolved"
        assert turn.resolved_output["used_fallback"] is False
        assert turn.resolved_output["rejected_claims"] == []
        assert target_person in turn.resolved_output["narrative"]
        assert "見当たらない" in turn.resolved_output["narrative"]
        assert all("代わりに応答" not in memory.text for memory in memories)
        assert "deterministic_fallback" not in event.payload
        assert any(
            item["kind"] == "addressed_absent" and item["claim"] == target_person and item["resolved_by"] == "repair"
            for item in turn.resolved_output["consistency_interventions"]
        )
        assert substitute_person not in turn.resolved_output["narrative"]


def test_addressed_absent_npc_substitution_records_intervention_and_falls_back(client, container, auth_headers):
    original_generate = container.model_router.provider.generate
    captured: dict[str, str] = {}

    def substituted_address_generate(**kwargs):
        prompt = kwargs["prompt"]
        if prompt.prompt_id not in {"session.turn_resolution", "session.turn_resolution_repair"}:
            return original_generate(**kwargs)
        public_context = kwargs["input_payload"]["public_game_context"]
        current_location = public_context["current_location"]["name"]
        substitute_person = public_context["visible_people"][0]["name"]
        target_person = next(
            person["name"]
            for route in public_context["visible_exits"]
            for person in route.get("arrival_people") or []
        )
        captured["target"] = target_person
        captured["substitute"] = substitute_person
        return ProviderResponse(
            raw_output={
                "action_interpretation": f"ヌートは{substitute_person}に街道の霧について尋ねる。",
                "narrative": f"{substitute_person}は帳簿を閉じ、街道の霧について答えた。",
                "npc_reaction": f"{substitute_person}は今見える範囲の話だけを返した。",
                "current_situation": f"{current_location}では{substitute_person}が近くにいる。",
                "current_location_name": current_location,
                "suggested_actions": [
                    {"label": "この場で確認する", "summary": "現在地で見える情報だけを整理する。"},
                    {"label": "出口を確認する", "summary": "会いたい人物のいる場所へ行けるか確かめる。"},
                ],
                "consequence_summary": f"{substitute_person}が街道の霧について答えた。",
                "world_tags": ["investigate"],
                "consequence_tags": ["careful_observation"],
                "scene_tone": "measured",
                "scene_move": "deepen",
                "scene_pressure": "medium",
                "memories": [{"scope": "world", "text": f"{substitute_person}が{target_person}の代わりに応答した。", "salience": 0.7}],
                "language_context": {
                    "pack_source_language": "en",
                    "play_language": "ja",
                    "output_language_requested": "ja",
                },
                "present_people": [substitute_person],
                "addressed_people": [target_person],
                "public_claims": [
                    {"kind": "actor", "surface_text": target_person, "language": "ja", "role": "addressed"},
                    {"kind": "actor", "surface_text": substitute_person, "language": "ja", "role": "present"},
                ],
            },
            provider_name="test",
            provider_response_id=None,
        )

    container.model_router.provider.generate = substituted_address_generate
    try:
        session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
        assert session_response.status_code == 200
        session_id = session_response.json()["session_id"]
        before_state = client.get(f"/sessions/{session_id}/state", headers=auth_headers).json()
        payload = _post_turn_and_wait(client, session_id, auth_headers, f"{captured.get('target') or '万象図書館の歴史家AI'}に街道の霧について尋ねる")
        after_state = client.get(f"/sessions/{session_id}/state", headers=auth_headers).json()
    finally:
        container.model_router.provider.generate = original_generate

    target_person = captured["target"]
    substitute_person = captured["substitute"]
    assert payload["current_location"]["name"] == before_state["current_location"]["name"]
    assert after_state["current_location"]["name"] == before_state["current_location"]["name"]
    assert payload.get("system_message") is None
    assert payload.get("failure") is None
    assert payload.get("refund_ledger_id") is None

    with container.session_factory() as db:
        turn = db.get(Turn, payload["turn_id"])
        memories = db.execute(select(Memory).where(Memory.source_event_id == payload["event_id"])).scalars().all()
        event = db.get(Event, payload["event_id"])
        assert turn is not None
        assert event is not None
        assert turn.resolved_output["status"] == "resolved"
        assert turn.resolved_output["used_fallback"] is True
        assert turn.resolved_output["rejected_claims"] == []
        assert target_person in turn.resolved_output["narrative"]
        assert "見当たらない" in turn.resolved_output["narrative"]
        assert all("代わりに応答" not in memory.text for memory in memories)
        interventions = turn.resolved_output["consistency_interventions"]
        assert any(item["kind"] == "addressed_absent" and item["claim"] == target_person and item["resolved_by"] == "fallback" for item in interventions)
        fallback = event.payload["deterministic_fallback"]
        assert any(
            item.get("claim") == target_person and item.get("reason") == "addressed_absent"
            for item in fallback["rejected_claims"]
        )
        assert substitute_person not in turn.resolved_output["narrative"] or "見当たらない" in turn.resolved_output["narrative"]


def test_absent_npc_mentioned_only_does_not_trigger_addressed_absent(client, container, auth_headers):
    original_generate = container.model_router.provider.generate
    captured: dict[str, str] = {}

    def mentioned_generate(**kwargs):
        prompt = kwargs["prompt"]
        if prompt.prompt_id != "session.turn_resolution":
            return original_generate(**kwargs)
        public_context = kwargs["input_payload"]["public_game_context"]
        current_location = public_context["current_location"]["name"]
        visible_person = public_context["visible_people"][0]["name"]
        mentioned_person = next(
            person["name"]
            for route in public_context["visible_exits"]
            for person in route.get("arrival_people") or []
        )
        captured["mentioned"] = mentioned_person
        return ProviderResponse(
            raw_output={
                "action_interpretation": f"ヌートは{mentioned_person}についての噂を思い出す。",
                "narrative": f"ヌートは{current_location}で、{mentioned_person}に関する噂を整理した。",
                "npc_reaction": f"{visible_person}は噂を確定情報として扱わないよう促した。",
                "current_situation": f"{current_location}では記録の確認が続いている。",
                "current_location_name": current_location,
                "suggested_actions": [
                    {"label": "噂の出所を確認する", "summary": "現在地で確認できる情報源を探す。"},
                    {"label": "別の場所へ向かう", "summary": "見えている出口から手がかりを追う。"},
                ],
                "consequence_summary": f"{mentioned_person}は噂として言及された。",
                "world_tags": ["investigate"],
                "consequence_tags": ["careful_observation"],
                "scene_tone": "measured",
                "scene_move": "deepen",
                "scene_pressure": "medium",
                "memories": [{"scope": "world", "text": f"{mentioned_person}についての噂が整理された。", "salience": 0.7}],
                "language_context": {
                    "pack_source_language": "en",
                    "play_language": "ja",
                    "output_language_requested": "ja",
                },
                "present_people": [visible_person],
                "addressed_people": [],
                "public_claims": [
                    {"kind": "actor", "surface_text": mentioned_person, "language": "ja", "role": "mentioned"},
                    {"kind": "actor", "surface_text": visible_person, "language": "ja", "role": "present"},
                ],
            },
            provider_name="test",
            provider_response_id=None,
        )

    container.model_router.provider.generate = mentioned_generate
    try:
        session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
        assert session_response.status_code == 200
        payload = _post_turn_and_wait(client, session_response.json()["session_id"], auth_headers, "別地点の人物についての噂を整理する")
    finally:
        container.model_router.provider.generate = original_generate

    with container.session_factory() as db:
        turn = db.get(Turn, payload["turn_id"])
        assert turn is not None
        assert turn.resolved_output["status"] == "resolved"
        assert turn.resolved_output["used_fallback"] is False
        assert turn.resolved_output["rejected_claims"] == []
        assert turn.resolved_output["consistency_interventions"] == []
        assert captured["mentioned"] in turn.resolved_output["narrative"]


def test_present_addressed_npc_passes_without_intervention(client, container, auth_headers):
    original_generate = container.model_router.provider.generate
    captured: dict[str, str] = {}

    def present_address_generate(**kwargs):
        prompt = kwargs["prompt"]
        if prompt.prompt_id != "session.turn_resolution":
            return original_generate(**kwargs)
        public_context = kwargs["input_payload"]["public_game_context"]
        current_location = public_context["current_location"]["name"]
        visible_person = public_context["visible_people"][0]["name"]
        captured["visible"] = visible_person
        return ProviderResponse(
            raw_output={
                "action_interpretation": f"ヌートは{visible_person}に確認を求める。",
                "narrative": f"ヌートが問いかけると、{visible_person}は現在地で確認できる情報だけを返した。",
                "npc_reaction": f"{visible_person}は穏やかに頷いた。",
                "current_situation": f"{current_location}では{visible_person}が同席している。",
                "current_location_name": current_location,
                "suggested_actions": [
                    {"label": "さらに確認する", "summary": "同席者へ公開情報を尋ねる。"},
                    {"label": "周囲を見回す", "summary": "現在地で見えるものを確認する。"},
                ],
                "consequence_summary": f"{visible_person}への問いかけが現在地で解決された。",
                "world_tags": ["investigate"],
                "consequence_tags": ["careful_observation"],
                "scene_tone": "measured",
                "scene_move": "deepen",
                "scene_pressure": "medium",
                "memories": [{"scope": "world", "text": f"{visible_person}が公開情報を返した。", "salience": 0.7}],
                "language_context": {
                    "pack_source_language": "en",
                    "play_language": "ja",
                    "output_language_requested": "ja",
                },
                "present_people": [visible_person],
                "addressed_people": [visible_person],
                "public_claims": [
                    {"kind": "actor", "surface_text": visible_person, "language": "ja", "role": "addressed"},
                    {"kind": "actor", "surface_text": visible_person, "language": "ja", "role": "present"},
                ],
            },
            provider_name="test",
            provider_response_id=None,
        )

    container.model_router.provider.generate = present_address_generate
    try:
        session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
        assert session_response.status_code == 200
        payload = _post_turn_and_wait(client, session_response.json()["session_id"], auth_headers, "同席している案内担当に確認を求める")
    finally:
        container.model_router.provider.generate = original_generate

    with container.session_factory() as db:
        turn = db.get(Turn, payload["turn_id"])
        assert turn is not None
        assert turn.resolved_output["status"] == "resolved"
        assert turn.resolved_output["used_fallback"] is False
        assert turn.resolved_output["rejected_claims"] == []
        assert turn.resolved_output["consistency_interventions"] == []
        assert captured["visible"] in turn.resolved_output["narrative"]


def _self_state_turn_generate(original_generate, *, self_state_claims, state_drafts=None, outcome_band="steady", scene_pressure="medium", world_memory_text="ヌートは現在地で次の手がかりを確かめた。"):
    def generate(**kwargs):
        prompt = kwargs["prompt"]
        if prompt.prompt_id not in {"session.turn_resolution", "session.turn_resolution_repair"}:
            return original_generate(**kwargs)
        public_context = kwargs["input_payload"]["public_game_context"]
        current_location = public_context["current_location"]["name"]
        raw: dict[str, Any] = {
            "action_interpretation": "ヌートは強い衝動に駆られて行動した。",
            "narrative": f"{current_location}で、ヌートは激しい痛みと新たな感覚に襲われた。",
            "current_situation": f"{current_location}で、ヌートは自分の身に起きた変化を確かめている。",
            "current_location_name": current_location,
            "suggested_actions": [
                {"label": "案内役に今の状態を伝える", "summary": "起きた変化を言葉にして共有する。"},
                {"label": "周囲の反応を確かめる", "summary": "現在地で見える範囲の変化だけを確認する。"},
            ],
            "consequence_summary": "ヌートは自分の状態の変化を主張した。",
            "world_tags": ["investigate"],
            "consequence_tags": ["careful_observation"],
            "self_state_claims": self_state_claims,
            "outcome_band": outcome_band,
            "scene_tone": "measured",
            "scene_move": "deepen",
            "scene_pressure": scene_pressure,
            "memories": [{"scope": "world", "text": world_memory_text, "salience": 0.7}],
            "language_context": {
                "pack_source_language": "en",
                "play_language": "ja",
                "output_language_requested": "ja",
            },
            "present_people": [],
            "public_claims": [
                {"kind": "location", "surface_text": current_location, "language": "ja", "role": "current_location"},
            ],
        }
        if state_drafts is not None:
            raw["state_drafts"] = state_drafts
        return ProviderResponse(raw_output=raw, provider_name="test", provider_response_id=None)

    return generate


def test_public_ai_gm_input_includes_player_self_state(client, container, auth_headers):
    captured_inputs: list[dict[str, Any]] = []
    original_generate = container.model_router.provider.generate

    def capturing_generate(**kwargs):
        prompt = kwargs["prompt"]
        if prompt.prompt_id == "session.turn_resolution":
            captured_inputs.append(dict(kwargs["input_payload"]))
        return original_generate(**kwargs)

    container.model_router.provider.generate = capturing_generate
    try:
        session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
        assert session_response.status_code == 200
        _post_turn_and_wait(
            client,
            session_response.json()["session_id"],
            auth_headers,
            "周囲の様子を確かめる",
        )
    finally:
        container.model_router.provider.generate = original_generate

    assert captured_inputs
    _assert_no_forbidden_keys(captured_inputs[0])
    public_context = captured_inputs[0]["public_game_context"]
    condition = public_context["player_condition"]
    assert set(condition) == {"vitality", "clarity", "standing"}
    assert all(isinstance(value, str) and value for value in condition.values())
    assert isinstance(public_context["player_capabilities"], list)
    for capability in public_context["player_capabilities"]:
        assert set(capability) <= {"title", "summary"}


def test_unbacked_canonical_self_state_claim_stays_subjective(client, container, auth_headers):
    original_generate = container.model_router.provider.generate
    generate = _self_state_turn_generate(
        original_generate,
        self_state_claims=[
            {"kind": "vitality", "surface_text": "死んで蘇った", "persistence": "canonical"},
            {"kind": "ability", "surface_text": "新たな力を得た", "persistence": "canonical"},
        ],
        world_memory_text="ヌートは死から蘇り新たな力を得た。",
    )
    container.model_router.provider.generate = generate
    try:
        session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
        assert session_response.status_code == 200
        payload = _post_turn_and_wait(
            client,
            session_response.json()["session_id"],
            auth_headers,
            "死の淵から蘇り新たな力を得た",
        )
    finally:
        container.model_router.provider.generate = original_generate

    assert payload.get("failure") is None
    with container.session_factory() as db:
        turn = db.get(Turn, payload["turn_id"])
        event = db.get(Event, payload["event_id"])
        memories = db.execute(select(Memory).where(Memory.source_event_id == payload["event_id"])).scalars().all()
        assert turn is not None and event is not None
        assert turn.resolved_output["status"] == "resolved"
        unconfirmed = turn.resolved_output["unconfirmed_self_claims"]
        assert {item["kind"] for item in unconfirmed} == {"vitality", "ability"}
        assert event.payload["unconfirmed_self_claims"] == unconfirmed
        assert not turn.resolved_output["skill_updates"]
        # The unbacked subjective experience must not become canonical world fact.
        assert all("蘇り新たな力" not in memory.text for memory in memories if memory.scope == "world")


def test_backed_ability_self_state_claim_materializes_skill(client, container, auth_headers):
    original_generate = container.model_router.provider.generate
    generate = _self_state_turn_generate(
        original_generate,
        self_state_claims=[
            {"kind": "ability", "surface_text": "偽装ログ生成の技法", "persistence": "canonical", "backing": "skills"},
        ],
        state_drafts={
            "skills": [
                {"title": "偽装ログ生成の技法", "summary": "観測を一時的に逸らすため来訪者ログへノイズを編む方法。"}
            ]
        },
    )
    container.model_router.provider.generate = generate
    try:
        session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
        assert session_response.status_code == 200
        payload = _post_turn_and_wait(
            client,
            session_response.json()["session_id"],
            auth_headers,
            "偽装ログの生成方法を習得する",
        )
    finally:
        container.model_router.provider.generate = original_generate

    with container.session_factory() as db:
        turn = db.get(Turn, payload["turn_id"])
        assert turn is not None
        assert turn.resolved_output["status"] == "resolved"
        assert turn.resolved_output["unconfirmed_self_claims"] == []
        assert turn.resolved_output["skill_updates"]
        assert any("偽装ログ" in str(item.get("title")) for item in turn.resolved_output["skill_updates"])


def test_outcome_band_reflects_ai_gm_narrative_risk(client, container, auth_headers):
    original_generate = container.model_router.provider.generate
    generate = _self_state_turn_generate(
        original_generate,
        self_state_claims=[],
        outcome_band="setback",
        scene_pressure="high",
        world_memory_text="ヌートは危険な賭けに出て手痛い反動を受けた。",
    )
    container.model_router.provider.generate = generate
    try:
        session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
        assert session_response.status_code == 200
        payload = _post_turn_and_wait(
            client,
            session_response.json()["session_id"],
            auth_headers,
            "危険を承知で霧の奥へ全力で踏み込む",
        )
    finally:
        container.model_router.provider.generate = original_generate

    with container.session_factory() as db:
        turn = db.get(Turn, payload["turn_id"])
        assert turn is not None
        assert turn.resolved_output["status"] == "resolved"
        # AI GM judged a setback even though no deterministic social tag forced one.
        assert turn.resolved_output["outcome_band"] == "setback"
        assert turn.resolved_output["scene_tone"] != "steady"


def _seed_offscene_npc_memory(container, *, world_id: str, npc_display_name: str, memory_text: str) -> str:
    """Attach a canonical memory to an off-scene NPC and make it retrievable.

    Returns the resolved canonical NPC display name."""
    with container.session_factory() as db:
        npc = db.execute(
            select(Actor).where(
                Actor.world_id == world_id,
                Actor.actor_type == "npc",
                Actor.display_name == npc_display_name,
            )
        ).scalar_one()
        event = db.execute(
            select(Event).where(Event.world_id == world_id).order_by(Event.created_at.asc())
        ).scalars().first()
        assert event is not None
        memory = Memory(
            world_id=world_id,
            source_event_id=event.id,
            actor_id=npc.id,
            location_id=npc.current_location_id,
            scope="actor",
            text=memory_text,
            salience=0.9,
            embedding=None,
            embedding_status="pending",
        )
        db.add(memory)
        db.commit()
        container.memory_service.reindex(db, world_id=world_id)
        db.commit()
        return npc.display_name


def test_public_turn_injects_referenced_context_for_offscene_reference(client, container, auth_headers):
    """Issue #20: when the player brings a not-in-scene entity into the turn (here an
    NPC who lives in a different location), the deterministic context planner must
    resolve it and inject its canonical card plus target memories into the AI GM input,
    so the turn stays consistent even though the entity was never in the conversation."""
    captured_inputs: list[dict[str, Any]] = []
    captured_prompt_ids: list[str] = []
    original_generate = container.model_router.provider.generate

    def capturing_generate(**kwargs):
        prompt = kwargs["prompt"]
        captured_prompt_ids.append(prompt.prompt_id)
        if prompt.prompt_id == "session.turn_resolution":
            captured_inputs.append(dict(kwargs["input_payload"]))
        return original_generate(**kwargs)

    session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_id = session_response.json()["session_id"]
    world_id = _session_payload()["world_id"]

    memory_text = "万象図書館の歴史家AIは、空白の来訪者ログを異常値として固定しようとする。"
    _seed_offscene_npc_memory(
        container,
        world_id=world_id,
        npc_display_name="Historian AI of the Universal Library",
        memory_text=memory_text,
    )

    container.model_router.provider.generate = capturing_generate
    try:
        payload = _post_turn_and_wait(
            client,
            session_id,
            auth_headers,
            "ところで、万象図書館の歴史家AIについて知っていることを教えて",
        )
    finally:
        container.model_router.provider.generate = original_generate

    assert payload["suggested_actions"]
    assert "council.context_planner" in captured_prompt_ids
    assert len(captured_inputs) == 1
    public_context = captured_inputs[0]["public_game_context"]
    referenced = public_context["referenced_context"]
    # The off-scene historian was resolved and injected as canonical context.
    historian = next(
        (
            entry
            for entry in referenced
            if "Historian" in entry["name"] or "歴史家AI" in entry["name"]
        ),
        None,
    )
    assert historian is not None, referenced
    assert historian["category"] == "person"
    # The memory tied to that specific NPC was target-retrieved into related_memories.
    assert any(memory_text in memory for memory in historian["related_memories"]), historian
    # Public-only contract: no internal ids leak through referenced_context.
    _assert_no_forbidden_keys(referenced, path="referenced_context")


def test_public_turn_referenced_context_is_fail_open_when_planner_fails(client, container, auth_headers):
    """Planner failure must degrade to baseline-only context (ADR-005 fail-open):
    referenced_context is empty and the turn still resolves normally."""
    captured_inputs: list[dict[str, Any]] = []
    original_generate = container.model_router.provider.generate

    def failing_planner_generate(**kwargs):
        prompt = kwargs["prompt"]
        if prompt.prompt_id == "council.context_planner":
            raise RuntimeError("planner provider exploded")
        if prompt.prompt_id == "session.turn_resolution":
            captured_inputs.append(dict(kwargs["input_payload"]))
        return original_generate(**kwargs)

    session_response = client.post("/sessions", json=_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_id = session_response.json()["session_id"]

    container.model_router.provider.generate = failing_planner_generate
    try:
        payload = _post_turn_and_wait(
            client,
            session_id,
            auth_headers,
            "万象図書館の歴史家AIについて尋ねる",
        )
    finally:
        container.model_router.provider.generate = original_generate

    # The turn still resolves despite the planner failure.
    assert payload["suggested_actions"]
    assert payload.get("failure") is None
    assert len(captured_inputs) == 1
    public_context = captured_inputs[0]["public_game_context"]
    assert public_context["referenced_context"] == []
    with container.session_factory() as db:
        turn = db.get(Turn, payload["turn_id"])
        assert turn is not None
        assert turn.resolved_output["status"] == "resolved"
