from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException, status
from sqlalchemy import select

import app.modules.identity.oidc as oidc_module
from app.core.config import Settings
from app.models.entities import Event, Memory, ObservabilitySnapshot, OutboxEvent, PlayerProfile, ProjectionRecord, World
from app.modules.identity.oidc import KeycloakOIDCAdapter, UserIdentity
from app.modules.llm_harness.service import CouncilRoleRun, TurnResolutionOutcome
from app.modules.observability.service import CanaryProbeResult
from app.modules.world_pack.service import PackRegistry


def engine_session_payload(*, world_id: str = "gestaloka_reference") -> dict[str, str]:
    return {
        "world_id": world_id,
        "world_name": "GESTALOKA: Nexus Foundation",
        "player_display_name": "Demo Player",
    }


REALTIME_WORLD_CONTEXT_KEYS = {
    "world_id",
    "world_name",
    "pack_id",
    "pack_display_name",
    "world_template_id",
    "world_template_display_name",
    "semantic_tags",
}


def assert_realtime_world_context(message: dict, expected: dict) -> None:
    assert message["data"]["world_context"] == expected
    assert REALTIME_WORLD_CONTEXT_KEYS <= set(message["data"]["world_context"])


def test_health_reports_database_projection_and_oidc(client):
    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["database"] == "ok"
    assert payload["projection"]["backend"] == "recording"
    assert payload["projection"]["pending_outbox"] == 0
    assert payload["projection_runtime"]["graph_runtime_status"] == "recording"
    assert payload["sp"]["default_balance"] == 30
    assert payload["sp"]["initial_bonus_sp"] == 30
    assert payload["sp"]["turn_cost"] == 1
    assert payload["sp"]["choice_turn_cost"] == 1
    assert payload["sp"]["free_text_turn_cost"] == 3
    assert payload["sp"]["budget_scope"] == "execution_only"
    assert payload["embedding"]["dimension"] == 768
    assert payload["embedding"]["runtime_status"] == "ready"
    assert payload["world_packs"] == {
        "status": "ready",
        "engine_api_version": "v2",
        "pack_count": 1,
        "template_count": 1,
        "failure_count": 0,
    }
    assert "pack_dir" not in payload["world_packs"]
    assert {"projection_lag_seconds", "outbox_pending_count", "llm_schema_valid_rate"} <= set(payload["observability"])
    assert {"verdict", "blocked_reasons", "canary_promote_status"} <= set(payload["release_gate"])
    assert payload["llm_observability"]["stack"] == "langfuse"
    assert payload["llm_observability"]["enabled"] is True
    assert payload["llm_observability"]["runtime_status"] == "ready"
    assert payload["llm_observability"]["base_url"] == "http://langfuse.test"
    assert payload["oidc_mode"] == "development"


def test_missing_bearer_token_returns_401(client):
    response = client.get("/auth/me")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token"


def test_keycloak_oidc_allows_configured_admin_client_id(monkeypatch):
    settings = Settings(
        oidc_public_issuer_url="http://issuer.test/realms/gestaloka",
        oidc_client_id="gestaloka-frontend",
        oidc_allowed_client_ids="gestaloka-admin-frontend",
        oidc_audience="account",
    )
    adapter = KeycloakOIDCAdapter(settings)
    adapter.__dict__["_jwk_client"] = SimpleNamespace(
        get_signing_key_from_jwt=lambda token: SimpleNamespace(key="test-key")
    )

    def decode(*args, **kwargs):
        del args, kwargs
        return {
            "sub": "demo-player-sub",
            "name": "Demo Player",
            "azp": "gestaloka-admin-frontend",
            "aud": ["not-account"],
        }

    monkeypatch.setattr(oidc_module.jwt, "decode", decode)

    assert adapter.resolve_token("admin-token").sub == "demo-player-sub"


def test_keycloak_oidc_rejects_unknown_client_id(monkeypatch):
    settings = Settings(
        oidc_public_issuer_url="http://issuer.test/realms/gestaloka",
        oidc_client_id="gestaloka-frontend",
        oidc_allowed_client_ids="gestaloka-admin-frontend",
        oidc_audience="account",
    )
    adapter = KeycloakOIDCAdapter(settings)
    adapter.__dict__["_jwk_client"] = SimpleNamespace(
        get_signing_key_from_jwt=lambda token: SimpleNamespace(key="test-key")
    )
    monkeypatch.setattr(
        oidc_module.jwt,
        "decode",
        lambda *args, **kwargs: {"sub": "demo-player-sub", "azp": "unknown-client", "aud": ["not-account"]},
    )

    try:
        adapter.resolve_token("unknown-token")
    except HTTPException as exc:
        assert exc.status_code == status.HTTP_401_UNAUTHORIZED
        assert exc.detail == "Unexpected token audience"
    else:
        raise AssertionError("unknown OIDC client should be rejected")


def test_playable_world_catalog_is_world_visible_and_keeps_pack_as_context(client, auth_headers):
    response = client.get("/worlds/playable", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    reference = next(item for item in payload["items"] if item["world_id"] == "gestaloka_reference")
    assert reference["display_name"] == "GESTALOKA: Nexus Foundation"
    assert reference["health_url"] == "/worlds/gestaloka_reference/health"
    assert reference["status"] == "playable"
    assert reference["pack_context"]["pack_id"] == "gestaloka_reference"


def test_world_health_reports_playable_world(client, auth_headers):
    response = client.get("/worlds/gestaloka_reference/health", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["status"] == "playable"
    assert response.json()["pack_context"]["world_template_id"] == "nexus_foundation"


def test_session_rejects_unknown_world_as_unavailable(client, auth_headers):
    payload = engine_session_payload(world_id="world-unknown")

    response = client.post("/sessions", json=payload, headers=auth_headers)

    assert response.status_code == 503
    assert response.json()["detail"]["error"] == "world_unavailable"


def test_session_rejects_pack_candidate_mismatch_as_immutable(client, auth_headers):
    payload = engine_session_payload()
    payload["pack_id"] = "alternate_reference_world"
    payload["world_template_id"] = "alternate_reference_world"

    response = client.post("/sessions", json=payload, headers=auth_headers)

    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "world_pack_immutable"


def test_existing_world_pack_metadata_is_immutable(client, auth_headers):
    created = client.post("/sessions", json=engine_session_payload(), headers=auth_headers)
    assert created.status_code == 200

    payload = engine_session_payload()
    payload["pack_id"] = "alternate_reference_world"
    payload["world_template_id"] = "alternate_reference_world"
    response = client.post("/sessions", json=payload, headers=auth_headers)

    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "world_pack_immutable"


def test_world_health_blocks_world_with_missing_pack_metadata(client, container, auth_headers):
    with container.session_factory() as db:
        db.add(World(id="gestaloka_reference", name="GESTALOKA: Nexus Foundation", status="active", state={}))
        db.commit()

    response = client.get("/worlds/gestaloka_reference/health", headers=auth_headers)

    assert response.status_code == 503
    assert response.json()["detail"]["error"] == "world_pack_metadata_missing"


def test_player_profiles_are_world_scoped_multi_owned_and_materialized_once(client, container, auth_headers):
    first = client.post(
        "/worlds/gestaloka_reference/player-profiles",
        json={
            "display_name": "Akari",
            "gender": "female",
            "background": "境界標識を読む旅人。",
            "free_text": "静かに観察する。",
            "narrative_preferences": {
                "perspective": "first_person",
                "tone": "logical",
                "density": "ornate",
                "dialogue_style": "dialogue_forward",
            },
            "play_language": {"mode": "custom", "custom": "  Pirate\nCant  "},
        },
        headers=auth_headers,
    )
    second = client.post(
        "/worlds/gestaloka_reference/player-profiles",
        json={"display_name": "Ren", "gender": "other"},
        headers=auth_headers,
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["play_language"]["mode"] == "custom"
    assert first.json()["play_language"]["prompt_name"] == "Pirate Cant"
    assert second.json()["play_language"]["preset"] == "ja"
    profile_list = client.get("/worlds/gestaloka_reference/player-profiles", headers=auth_headers)
    assert [item["display_name"] for item in profile_list.json()["items"]] == ["Akari", "Ren"]

    session_payload = {
        "world_id": "gestaloka_reference",
        "player_actor_id": first.json()["actor_id"],
        "world_name": "GESTALOKA: Nexus Foundation",
    }
    first_session = client.post("/sessions", json=session_payload, headers=auth_headers)
    second_session = client.post("/sessions", json=session_payload, headers=auth_headers)
    assert first_session.status_code == 200
    assert second_session.status_code == 200
    assert first_session.json()["player_profile"]["locked"] is True
    state = client.get(f"/sessions/{first_session.json()['session_id']}/state", headers=auth_headers)
    assert state.json()["player_profile"]["narrative_preferences"]["perspective"] == "first_person"
    assert state.json()["player_profile"]["play_language"]["prompt_name"] == "Pirate Cant"

    identity_patch = client.patch(
        f"/worlds/gestaloka_reference/player-profiles/{first.json()['actor_id']}",
        json={"display_name": "Changed"},
        headers=auth_headers,
    )
    style_patch = client.patch(
        f"/worlds/gestaloka_reference/player-profiles/{first.json()['actor_id']}",
        json={
            "narrative_preferences": {"perspective": "third_person", "tone": "lyrical", "density": "concise", "dialogue_style": "literary"},
            "play_language": {"mode": "preset", "preset": "en"},
        },
        headers=auth_headers,
    )
    assert identity_patch.status_code == 409
    assert style_patch.status_code == 200
    assert style_patch.json()["narrative_preferences"]["perspective"] == "third_person"
    assert style_patch.json()["play_language"]["prompt_name"] == "English"

    _post_turn_and_wait_for_resolution(
        client,
        first_session.json()["session_id"],
        auth_headers,
        {"input_mode": "choice", "choice_id": "safe"},
    )
    langfuse_records = container.observability_service._langfuse_client.records
    world_progress_inputs = [
        item["input"]
        for item in langfuse_records
        if item.get("event") == "enter" and item.get("name") == "council.world_progress"
    ]
    narrative_inputs = [
        item["input"]
        for item in langfuse_records
        if item.get("event") == "enter" and item.get("name") == "council.narrative"
    ]
    assert world_progress_inputs[-1]["play_language"]["prompt_name"] == "English"
    assert narrative_inputs[-1]["play_language"]["prompt_name"] == "English"

    with container.session_factory() as db:
        profile = db.get(PlayerProfile, {"actor_id": first.json()["actor_id"], "world_id": "gestaloka_reference"})
        profile_events = list(
            db.execute(
                select(Event).where(
                    Event.world_id == "gestaloka_reference",
                    Event.source_actor_id == first.json()["actor_id"],
                    Event.event_type == "player.profile.created",
                )
            ).scalars()
        )
        profile_memories = list(
            db.execute(
                select(Memory).where(
                    Memory.world_id == "gestaloka_reference",
                    Memory.source_event_id == profile.profile_setup_event_id,
                )
            ).scalars()
        )
    assert len(profile_events) == 1
    assert {item.scope for item in profile_memories} == {"actor", "world"}


def test_english_player_profile_initial_choices_are_english(client, auth_headers):
    profile = client.post(
        "/worlds/gestaloka_reference/player-profiles",
        json={
            "display_name": "English Tester",
            "play_language": {"mode": "preset", "preset": "en"},
        },
        headers=auth_headers,
    )
    assert profile.status_code == 200
    session = client.post(
        "/sessions",
        json={
            "world_id": "gestaloka_reference",
            "player_actor_id": profile.json()["actor_id"],
            "world_name": "GESTALOKA: Nexus Foundation",
        },
        headers=auth_headers,
    )
    assert session.status_code == 200

    state = client.get(f"/sessions/{session.json()['session_id']}/state", headers=auth_headers)
    assert state.status_code == 200
    choices = state.json()["next_choices"]
    assert [item["choice_id"] for item in choices] == ["safe", "progress", "explore"]
    assert choices[0]["label"] == "Watch Nexus Gate without disturbing the flow"
    assert choices[1]["label"] == "Help the person in need and create the next opening"
    assert choices[2]["summary"] == "Change places and widen the investigation."


def test_failed_turn_response_exposes_structured_failure(client, container, auth_headers, monkeypatch):
    def reject_turn(request):
        del request
        return TurnResolutionOutcome(
            role_runs=[
                CouncilRoleRun(
                    council_role="rules_arbiter",
                    stage_index=5,
                    prompt_id="council.rules_arbiter",
                    approval_status="rejected",
                    attempts=[],
                    final_lane="lite",
                    final_payload=None,
                    failure_reason="Rule arbiter rejected the turn.",
                )
            ],
            final_lane="lite",
            final_payload=None,
            failure_reason="Rule arbiter rejected the turn.",
            rejection_role="rules_arbiter",
        )

    monkeypatch.setattr(container.council_service, "resolve_turn", reject_turn)
    session = client.post("/sessions", json=engine_session_payload(), headers=auth_headers)
    assert session.status_code == 200

    with client.websocket_connect(f"/ws/sessions/{session.json()['session_id']}?token=dev-local-token") as websocket:
        response = client.post(
            "/turns",
            json={
                "session_id": session.json()["session_id"],
                "input_mode": "free_text",
                "input_text": "force a rejected turn",
            },
            headers=auth_headers,
        )
        assert response.status_code == 202
        messages = _receive_until_turn_failed(websocket)

    payload = messages[-1]["data"]
    assert payload["detail"] == "council_rejected"
    assert payload["failure"]["reason"] == "council_rejected"
    assert payload["failure"]["rejection_role"] == "rules_arbiter"
    assert payload["failure"]["final_lane"]
    assert payload["failure"]["retryable_choice_id"] in {"safe", "progress", "explore"}
    assert payload["failure"]["council_trace"]


def test_player_profile_ownership_is_enforced(client, container, auth_headers):
    profile_response = client.post(
        "/worlds/gestaloka_reference/player-profiles",
        json={"display_name": "Owner"},
        headers=auth_headers,
    )
    assert profile_response.status_code == 200

    def resolve_token(token: str) -> UserIdentity:
        if token == "owner":
            return UserIdentity(sub="local-player", name="Owner")
        if token == "other":
            return UserIdentity(sub="other-player", name="Other")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    container.oidc_adapter.resolve_token = resolve_token  # type: ignore[method-assign]
    other_headers = {"Authorization": "Bearer other"}

    assert client.get("/worlds/gestaloka_reference/player-profiles", headers=other_headers).json()["items"] == []
    edit_response = client.patch(
        f"/worlds/gestaloka_reference/player-profiles/{profile_response.json()['actor_id']}",
        json={"narrative_preferences": {"perspective": "third_person", "tone": "lyrical", "density": "concise", "dialogue_style": "literary"}},
        headers=other_headers,
    )
    start_response = client.post(
        "/sessions",
        json={"world_id": "gestaloka_reference", "player_actor_id": profile_response.json()["actor_id"]},
        headers=other_headers,
    )
    missing_response = client.post(
        "/sessions",
        json={"world_id": "gestaloka_reference"},
        headers={"Authorization": "Bearer owner"},
    )
    assert edit_response.status_code == 404
    assert start_response.status_code == 404
    assert missing_response.status_code == 422


def test_session_pack_catalog_error_returns_503(client, container, tmp_path: Path, auth_headers):
    container.pack_registry = PackRegistry(tmp_path / "missing-packs")
    response = client.post("/sessions", json=engine_session_payload(world_id="world-catalog-error"), headers=auth_headers)

    assert response.status_code == 503
    assert response.json()["detail"]["error"] == "world_pack_catalog_unavailable"
    assert response.json()["detail"]["failure_count"] == 1


def test_turn_rejects_when_world_health_is_not_playable(client, container, tmp_path: Path, auth_headers):
    session_response = client.post("/sessions", json=engine_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    container.pack_registry = PackRegistry(tmp_path / "missing-packs")

    turn_response = client.post(
        "/turns",
        json={"session_id": session_response.json()["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )

    assert turn_response.status_code == 503
    assert turn_response.json()["detail"]["error"] == "world_unavailable"


def test_world_membership_mismatch_returns_404(client, container):
    def resolve_token(token: str) -> UserIdentity:
        if token == "player-a":
            return UserIdentity(sub="player-a", name="Player A")
        if token == "player-b":
            return UserIdentity(sub="player-b", name="Player B")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    container.oidc_adapter.resolve_token = resolve_token  # type: ignore[method-assign]

    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers={"Authorization": "Bearer player-a"},
    )
    assert session_response.status_code == 200

    access_response = client.get(
        "/worlds/gestaloka_reference/events",
        headers={"Authorization": "Bearer player-b"},
    )
    assert access_response.status_code == 404


def test_ops_routes_require_admin_when_dev_mode_disabled(client, container):
    def resolve_token(token: str) -> UserIdentity:
        if token == "admin-token":
            return UserIdentity(sub="admin-sub", name="Admin")
        if token == "user-token":
            return UserIdentity(sub="user-sub", name="User")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    container.settings.oidc_dev_mode = False
    container.settings.ops_admin_subs = "admin-sub"
    container.oidc_adapter.resolve_token = resolve_token  # type: ignore[method-assign]

    forbidden = client.get("/ops/projection/status", headers={"Authorization": "Bearer user-token"})
    allowed = client.get("/ops/projection/status", headers={"Authorization": "Bearer admin-token"})
    forbidden_packs = client.get("/ops/world-packs", headers={"Authorization": "Bearer user-token"})
    allowed_packs = client.get("/ops/world-packs", headers={"Authorization": "Bearer admin-token"})
    forbidden_eval = client.get("/ops/evals/runs", headers={"Authorization": "Bearer user-token"})
    allowed_eval = client.get("/ops/evals/runs", headers={"Authorization": "Bearer admin-token"})

    assert forbidden.status_code == 403
    assert allowed.status_code == 200
    assert forbidden_packs.status_code == 403
    assert allowed_packs.status_code == 200
    assert "pack_dir" in allowed_packs.json()
    assert forbidden_eval.status_code == 403
    assert allowed_eval.status_code == 200


def test_session_and_turn_contract_and_websocket_event_order(client, auth_headers):
    wallet_response = client.get("/economy/sp/me", headers=auth_headers)
    assert wallet_response.status_code == 200
    assert wallet_response.json()["balance"] == 30
    assert wallet_response.json()["paid_sp"] == 0
    assert wallet_response.json()["bonus_sp"] == 30

    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()
    assert set(session_payload) == {
        "session_id",
        "world_id",
        "world_name",
        "pack_id",
        "world_template_id",
        "player_actor_id",
        "player_profile",
        "npc_actor_id",
        "location_id",
        "websocket_url",
        "world_context",
    }
    assert session_payload["world_context"] == {
        "world_id": session_payload["world_id"],
        "world_name": session_payload["world_name"],
        "pack_id": "gestaloka_reference",
        "pack_display_name": "GESTALOKA Reference",
        "world_template_id": "nexus_foundation",
        "world_template_display_name": "Nexus Foundation",
        "semantic_tags": ["layered-world", "archive", "corruption", "factions"],
    }
    assert session_payload["player_profile"]["display_name"] == "Demo Player"
    assert session_payload["player_profile"]["locked"] is True
    state_response = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert state_response.status_code == 200
    assert {
        "world_id",
        "location",
        "current_location",
        "character",
        "player_profile",
        "quests",
        "factions",
        "inventory",
        "chapter",
        "current_scene",
        "recent_scene_history",
        "recent_branch_echoes",
        "local_figures",
        "nearby_routes",
        "recent_travel_history",
        "plaza_figures",
        "recent_world_beats",
        "ambient_murmurs",
        "npc_locations",
        "recent_offstage_beats",
        "offstage_murmurs",
        "relationships",
        "active_consequence_threads",
        "recent_consequence_history",
        "next_choices",
        "narrative_state_bands",
        "important_inventory_affordances",
    } <= set(state_response.json())
    world_pack = state_response.json()["world_pack"]
    assert state_response.json()["player_profile"]["actor_id"] == session_payload["player_actor_id"]
    assert state_response.json()["quests"][0]["progress"] == 0
    assert state_response.json()["quests"][0]["stage_key"] == world_pack["starter_stage_key"]
    assert state_response.json()["chapter"]["key"] == world_pack["opening_chapter_key"]
    assert state_response.json()["current_location"]["name"] in state_response.json()["current_scene"]["summary"]
    assert state_response.json()["current_location"]["key"] == world_pack["starter_location_key"]
    assert state_response.json()["local_figures"]
    assert state_response.json()["plaza_figures"] == state_response.json()["local_figures"]
    assert state_response.json()["nearby_routes"]
    assert state_response.json()["inventory"] == []
    assert [item["choice_id"] for item in state_response.json()["next_choices"]] == ["safe", "progress", "explore"]

    with client.websocket_connect(f"/ws/sessions/{session_payload['session_id']}?token=dev-local-token") as websocket:
        turn_response = client.post(
            "/turns",
            json={
                "session_id": session_payload["session_id"],
                "input_mode": "choice",
                "choice_id": "progress",
            },
            headers=auth_headers,
        )
        assert turn_response.status_code == 202
        accepted_payload = turn_response.json()
        assert accepted_payload == {
            "status": "accepted",
            "turn_id": accepted_payload["turn_id"],
            "session_id": session_payload["session_id"],
            "world_context": session_payload["world_context"],
        }
        messages = _receive_until_turn_resolved(websocket)
        turn_payload = messages[-1]["data"]
        assert set(turn_payload) == {
            "turn_id",
            "action_type",
            "input_mode",
            "event_id",
            "memory_ids",
            "narrative",
            "npc_reaction",
            "sp_delta",
            "sp_balance",
            "paid_sp",
            "bonus_sp",
            "sp_ledger_id",
            "interpreted_intent",
            "next_choices",
            "consequence_summary",
            "scene_tone",
            "quest_updates",
            "faction_updates",
            "inventory_updates",
            "location_updates",
            "current_location",
            "travel_summary",
            "relationship_updates",
            "consequence_updates",
            "scene_updates",
            "chapter_updates",
            "branch_updates",
            "ambient_updates",
            "scene_summary",
            "crossroads_summary",
            "recent_world_beats",
            "recent_offstage_beats",
            "idle_updates",
            "world_context",
            "shared_action_tag",
            "shared_consequence_updates",
        }
        assert turn_payload["shared_action_tag"] == "help"
        assert turn_payload["shared_consequence_updates"]["shared_action_tag"] == "help"
        assert turn_payload["shared_consequence_updates"]["applied_rule_ids"]
        assert turn_payload["shared_consequence_updates"]["axis_updates"]
        assert turn_payload["world_context"]["pack_id"] == "gestaloka_reference"
        assert turn_payload["world_context"]["world_template_id"] == "nexus_foundation"
        assert turn_payload["action_type"] == "narrative"
        assert turn_payload["input_mode"] == "choice"
        assert turn_payload["sp_delta"] == -1
        assert turn_payload["sp_balance"] == 29
        assert turn_payload["paid_sp"] == 0
        assert turn_payload["bonus_sp"] == 29
        assert turn_payload["quest_updates"][0]["progress"] == 1
        assert turn_payload["inventory_updates"] == []
        assert turn_payload["interpreted_intent"]["requested_choice_posture"] == "progress"
        assert [item["choice_id"] for item in turn_payload["next_choices"]] == ["safe", "progress", "explore"]

    assert [message["event"] for message in messages[:2]] == [
        "session.connected",
        "turn.accepted",
    ]
    assert [message["event"] for message in messages[-11:]] == [
        "turn.narrative.delta",
        "world.event.created",
        "world.broadcast.available",
        "memory.materialized",
        "quest.updated",
        "faction.standing.updated",
        "relationship.updated",
        "scene.updated",
        "chapter.updated",
        "ambient.updated",
        "turn.resolved",
    ]
    progress_messages = [message for message in messages if message["event"] == "turn.progress"]
    assert [message["data"]["phase"] for message in progress_messages if message["data"].get("status") == "completed"] == [
        "intent_interpretation",
        "memory_council",
        "npc_council",
        "world_progress",
        "rules_arbiter",
        "safety_guard",
        "narrative",
        "consequence_resolution",
        "scene_framing",
        "ambient_world_pass",
        "choice_generation",
    ]
    assert {message["data"].get("status") for message in progress_messages[:14]} <= {"started", "completed"}
    assert all("elapsed_ms" in message["data"] for message in progress_messages)
    assert messages[0]["data"] == {
        "session_id": session_payload["session_id"],
        "world_context": session_payload["world_context"],
    }
    assert messages[1]["data"]["turn_id"] == accepted_payload["turn_id"]
    assert messages[1]["data"]["session_id"] == session_payload["session_id"]
    assert messages[-1]["data"] == turn_payload
    broadcast_message = next(message for message in messages if message["event"] == "world.broadcast.available")
    assert broadcast_message["data"]["semantic_key"]
    assert broadcast_message["data"]["status"] == "active"
    for message in messages:
        assert_realtime_world_context(message, session_payload["world_context"])
        assert message["data"]["world_context"]["pack_id"] == "gestaloka_reference"
        assert message["data"]["world_context"]["world_template_id"] == "nexus_foundation"


def _receive_until_turn_resolved(websocket, *, limit: int = 64):
    messages = []
    for _ in range(limit):
        message = websocket.receive_json()
        messages.append(message)
        if message.get("event") == "turn.resolved":
            return messages
    raise AssertionError("turn.resolved was not received")


def _receive_until_turn_failed(websocket, *, limit: int = 64):
    messages = []
    for _ in range(limit):
        message = websocket.receive_json()
        messages.append(message)
        if message.get("event") == "turn.failed":
            return messages
    raise AssertionError("turn.failed was not received")


def _post_turn_and_wait_for_resolution(client, session_id: str, auth_headers: dict, payload: dict):
    with client.websocket_connect(f"/ws/sessions/{session_id}?token=dev-local-token") as websocket:
        response = client.post(
            "/turns",
            json={"session_id": session_id, **payload},
            headers=auth_headers,
        )
        assert response.status_code == 202
        messages = _receive_until_turn_resolved(websocket)
    return response.json(), messages[-1]["data"], messages


def test_free_text_world_state_query_uses_read_only_turn_path(client, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()

    _, payload, _ = _post_turn_and_wait_for_resolution(
        client,
        session_payload["session_id"],
        auth_headers,
        {
            "input_mode": "free_text",
            "input_text": "現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。",
        },
    )
    assert payload["input_mode"] == "free_text"
    assert payload["action_type"] == "narrative"
    assert payload["interpreted_intent"]["canonical_action_kind"] == "read_world_state_query"
    assert payload["quest_updates"] == []
    assert payload["faction_updates"] == []
    assert payload["inventory_updates"] == []
    assert payload["relationship_updates"] == []
    assert payload["shared_action_tag"] == "none"


def test_use_reward_item_contract_and_websocket_event_order(client, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()

    _post_turn_and_wait_for_resolution(
        client,
        session_payload["session_id"],
        auth_headers,
        {"input_mode": "choice", "choice_id": "progress"},
    )
    _post_turn_and_wait_for_resolution(
        client,
        session_payload["session_id"],
        auth_headers,
        {"input_mode": "choice", "choice_id": "progress"},
    )

    state_response = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert state_response.json()["inventory"][0]["id"]
    assert state_response.json()["next_choices"][1]["action_kind"] == "use_reward_item"
    world_pack = state_response.json()["world_pack"]

    with client.websocket_connect(f"/ws/sessions/{session_payload['session_id']}?token=dev-local-token") as websocket:
        use_response = client.post(
            "/turns",
            json={
                "session_id": session_payload["session_id"],
                "input_mode": "choice",
                "choice_id": "progress",
            },
            headers=auth_headers,
        )
        assert use_response.status_code == 202
        accepted_payload = use_response.json()
        messages = _receive_until_turn_resolved(websocket)
        payload = messages[-1]["data"]
        assert accepted_payload["turn_id"] == payload["turn_id"]
        assert payload["world_context"]["pack_id"] == "gestaloka_reference"
        assert payload["action_type"] == "use_reward_item"
        assert payload["input_mode"] == "choice"
        assert payload["quest_updates"][0]["stage_key"] == world_pack["followup_stage_key"]
        assert payload["inventory_updates"][0]["status"] == "used"
        assert payload["inventory_updates"][0]["action"] == "used"
        assert payload["faction_updates"][0]["delta"] == 0.1
        assert payload["location_updates"] == []
        assert payload["current_location"]["key"] == world_pack["starter_location_key"]
        assert payload["travel_summary"] is None
        assert payload["relationship_updates"]

    assert [message["event"] for message in messages[:2]] == [
        "session.connected",
        "turn.accepted",
    ]
    assert [message["event"] for message in messages[-12:]] == [
        "turn.narrative.delta",
        "world.event.created",
        "world.broadcast.available",
        "memory.materialized",
        "quest.updated",
        "faction.standing.updated",
        "inventory.changed",
        "relationship.updated",
        "scene.updated",
        "chapter.updated",
        "ambient.updated",
        "turn.resolved",
    ]
    progress_messages = [message for message in messages if message["event"] == "turn.progress"]
    assert [message["data"]["phase"] for message in progress_messages if message["data"].get("status") == "completed"] == [
        "intent_interpretation",
        "item_use",
        "consequence_resolution",
        "scene_framing",
        "ambient_world_pass",
        "choice_generation",
    ]
    assert all("elapsed_ms" in message["data"] for message in progress_messages)
    assert messages[-1]["data"] == payload
    broadcast_message = next(message for message in messages if message["event"] == "world.broadcast.available")
    assert broadcast_message["data"]["semantic_key"]
    assert broadcast_message["data"]["status"] == "active"
    for message in messages:
        assert_realtime_world_context(message, session_payload["world_context"])
        assert message["data"]["world_context"]["pack_id"] == "gestaloka_reference"
        assert message["data"]["world_context"]["world_template_id"] == "nexus_foundation"
    assert payload["scene_updates"]

    assert payload["chapter_updates"]


def test_idle_pass_websocket_event_keeps_world_context(client, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()

    with client.websocket_connect(f"/ws/sessions/{session_payload['session_id']}?token=dev-local-token") as websocket:
        connected = websocket.receive_json()
        assert connected["event"] == "session.connected"
        assert_realtime_world_context(connected, session_payload["world_context"])

        idle_response = client.post(f"/ops/worlds/{session_payload['world_id']}/idle-pass", headers=auth_headers)
        assert idle_response.status_code == 200
        idle_payload = idle_response.json()
        assert idle_payload["world_context"]["pack_id"] == "gestaloka_reference"
        assert idle_payload["world_context"]["world_template_id"] == "nexus_foundation"

        message = websocket.receive_json()
        moved_items = [item for item in idle_payload["idle_updates"] if item.get("moved")]
        location_message = websocket.receive_json() if moved_items else None

    assert message["event"] == "idle.updated"
    assert_realtime_world_context(message, session_payload["world_context"])
    assert message["data"]["world_context"] == idle_payload["world_context"]
    assert message["data"]["world_id"] == session_payload["world_id"]
    assert message["data"]["tick"]["tick_id"] == idle_payload["tick"]["tick_id"]
    assert message["data"]["items"] == idle_payload["idle_updates"]
    if location_message is not None:
        assert location_message["event"] == "location.updated"
        assert_realtime_world_context(location_message, session_payload["world_context"])
        assert location_message["data"]["world_context"] == idle_payload["world_context"]
        assert location_message["data"]["items"] == moved_items


def test_ops_projection_status_and_rebuild_contract(client, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()

    _post_turn_and_wait_for_resolution(
        client,
        session_payload["session_id"],
        auth_headers,
        {"input_mode": "choice", "choice_id": "progress"},
    )
    status_response = client.get("/ops/projection/status", headers=auth_headers)
    assert status_response.status_code == 200
    status_payload = status_response.json()
    assert {
        "backend",
        "space",
        "pending",
        "failed",
        "projected",
        "last_error",
        "graph_read_mode",
        "graph_runtime_status",
        "recent_failures",
    } <= set(status_payload)

    summary_response = client.get(f"/ops/worlds/{session_payload['world_id']}/graph-summary", headers=auth_headers)
    assert summary_response.status_code == 200
    summary_payload = summary_response.json()
    assert summary_payload["world_id"] == session_payload["world_id"]
    assert summary_payload["world_context"] == session_payload["world_context"]
    worlds_response = client.get("/ops/worlds", headers=auth_headers)
    assert worlds_response.status_code == 200
    worlds_payload = worlds_response.json()
    world_item = next(item for item in worlds_payload["items"] if item["world_context"]["world_id"] == session_payload["world_id"])
    assert world_item["world_context"]["pack_id"] == "gestaloka_reference"
    assert world_item["world_context"]["world_template_id"] == "nexus_foundation"
    assert world_item["status"] == "active"
    assert world_item["active_session_count"] >= 1
    filtered_worlds_response = client.get("/ops/worlds?pack_id=gestaloka_reference&world_template_id=nexus_foundation", headers=auth_headers)
    assert filtered_worlds_response.status_code == 200
    assert {item["world_context"]["world_id"] for item in filtered_worlds_response.json()["items"]} == {
        session_payload["world_id"]
    }
    assert summary_payload["vertex_count"] >= 6
    assert summary_payload["edge_count"] >= 6
    assert summary_payload["label_counts"]["Faction"] >= 1
    assert summary_payload["label_counts"]["Quest"] >= 1

    rebuild_response = client.post(
        "/ops/projection/rebuild",
        json={"world_id": session_payload["world_id"]},
        headers=auth_headers,
    )
    assert rebuild_response.status_code == 200
    rebuild_payload = rebuild_response.json()
    assert rebuild_payload["world_id"] == session_payload["world_id"]
    assert rebuild_payload["world_context"] == session_payload["world_context"]
    assert rebuild_payload["records"] >= 1

    retry_response = client.post(
        "/ops/projection/retry-failed",
        json={"world_id": session_payload["world_id"], "limit": 10},
        headers=auth_headers,
    )
    assert retry_response.status_code == 200
    retry_payload = retry_response.json()
    assert retry_payload["world_id"] == session_payload["world_id"]
    assert retry_payload["world_context"] == session_payload["world_context"]
    assert retry_payload["target_count"] == 0
    assert retry_payload["remaining_failed"] == 0
    assert {"vertex_count", "edge_count", "records"} <= set(retry_payload)

    council_turns_response = client.get(
        f"/ops/council/turns?session_id={session_payload['session_id']}",
        headers=auth_headers,
    )
    assert council_turns_response.status_code == 200
    council_turns_payload = council_turns_response.json()
    assert council_turns_payload["items"][0]["resolution_mode"] == "gm_council"
    assert council_turns_payload["items"][0]["world_context"] == session_payload["world_context"]
    assert council_turns_payload["items"][0]["langfuse_trace_id"]
    assert council_turns_payload["items"][0]["langfuse_trace_url"].startswith("http://langfuse.test/project/gestaloka-v2/traces/")
    assert council_turns_payload["items"][0]["langfuse_status"] == "ok"
    assert [item["council_role"] for item in council_turns_payload["items"][0]["roles"]] == [
        "intent_interpreter",
        "memory_manager",
        "npc_manager",
        "world_progress",
        "rules_arbiter",
        "safety_guard",
        "narrative",
    ]
    assert {
        "prompt_cache_hit_tokens",
        "prompt_cache_miss_tokens",
    } <= set(council_turns_payload["items"][0]["roles"][-1])
    council_turn_id = council_turns_payload["items"][0]["turn_id"]
    council_detail_response = client.get(f"/ops/council/turns/{council_turn_id}", headers=auth_headers)
    assert council_detail_response.status_code == 200
    council_detail_payload = council_detail_response.json()
    assert council_detail_payload["turn_id"] == council_turn_id
    assert council_detail_payload["roles"][-1]["model_lane"] in {"main_lane", "pro_lane"}
    assert "attempts" in council_detail_payload["roles"][-1]
    assert council_detail_payload["resolved_output"]["retrieval_trace"]["status"] == "ready"
    assert council_detail_payload["langfuse_trace_url"].startswith("http://langfuse.test/project/gestaloka-v2/traces/")
    assert council_detail_payload["roles"][-1]["langfuse_trace_url"].startswith(
        "http://langfuse.test/project/gestaloka-v2/traces/"
    )
    assert council_detail_payload["roles"][-1]["attempts"][-1]["langfuse_observation_id"]
    assert {
        "prompt_cache_hit_tokens",
        "prompt_cache_miss_tokens",
    } <= set(council_detail_payload["roles"][-1]["attempts"][-1])


def test_ops_projection_retry_failed_reprocesses_only_explicit_failed_outbox(client, container, auth_headers, monkeypatch):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()

    original_project_bundle = container.projection_service.repository.project_bundle

    def fail_projection(bundle):
        del bundle
        raise RuntimeError("forced projection failure")

    monkeypatch.setattr(container.projection_service.repository, "project_bundle", fail_projection)
    _post_turn_and_wait_for_resolution(
        client,
        session_payload["session_id"],
        auth_headers,
        {"input_mode": "choice", "choice_id": "progress"},
    )

    with container.session_factory() as db:
        pending_before = list(db.execute(select(OutboxEvent).where(OutboxEvent.status == "pending")).scalars())
        failed_ids = [item.id for item in pending_before]
        assert failed_ids
        assert {item.world_id for item in pending_before} == {session_payload["world_id"]}
        assert container.projection_service.process_pending(db) == []
        db.flush()
        failed_before = list(db.execute(select(OutboxEvent).where(OutboxEvent.id.in_(failed_ids))).scalars())
        assert {item.status for item in failed_before} == {"failed"}
        assert {item.last_error for item in failed_before} == {"forced projection failure"}
        db.commit()

    monkeypatch.setattr(container.projection_service.repository, "project_bundle", original_project_bundle)

    retry_response = client.post(
        "/ops/projection/retry-failed",
        json={"world_id": session_payload["world_id"], "limit": 10},
        headers=auth_headers,
    )
    assert retry_response.status_code == 200
    retry_payload = retry_response.json()
    assert retry_payload["world_context"] == session_payload["world_context"]
    assert retry_payload["target_count"] == len(failed_ids)
    assert retry_payload["processed_count"] >= 1
    assert retry_payload["remaining_failed"] == 0
    assert retry_payload["vertex_count"] >= 1

    with container.session_factory() as db:
        assert {
            item.status
            for item in db.execute(select(OutboxEvent).where(OutboxEvent.id.in_(failed_ids))).scalars()
        } == {"projected"}
        assert db.execute(select(ProjectionRecord).where(ProjectionRecord.outbox_event_id.in_(failed_ids))).scalars().first()


def test_ops_relationship_chapter_scene_and_memory_contracts(client, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()
    _post_turn_and_wait_for_resolution(
        client,
        session_payload["session_id"],
        auth_headers,
        {"input_mode": "choice", "choice_id": "progress"},
    )

    relationships_response = client.get(
        f"/ops/worlds/{session_payload['world_id']}/relationships",
        headers=auth_headers,
    )
    assert relationships_response.status_code == 200
    relationships_payload = relationships_response.json()
    assert relationships_payload["world_context"] == session_payload["world_context"]
    assert relationships_payload["items"]
    assert {"strength", "band"} <= set(relationships_payload["items"][0])

    threads_response = client.get(
        f"/ops/worlds/{session_payload['world_id']}/consequence-threads",
        headers=auth_headers,
    )
    assert threads_response.status_code == 200
    assert threads_response.json()["world_context"] == session_payload["world_context"]
    assert "items" in threads_response.json()

    chapters_response = client.get(
        f"/ops/worlds/{session_payload['world_id']}/chapters",
        headers=auth_headers,
    )
    assert chapters_response.status_code == 200
    assert chapters_response.json()["world_context"] == session_payload["world_context"]
    assert chapters_response.json()["items"]

    chapter_branches_response = client.get(
        f"/ops/worlds/{session_payload['world_id']}/chapter-branches",
        headers=auth_headers,
    )
    assert chapter_branches_response.status_code == 200
    assert chapter_branches_response.json()["world_context"] == session_payload["world_context"]
    assert "items" in chapter_branches_response.json()

    scenes_response = client.get(
        f"/ops/worlds/{session_payload['world_id']}/scenes",
        headers=auth_headers,
    )
    assert scenes_response.status_code == 200
    assert scenes_response.json()["world_context"] == session_payload["world_context"]
    assert scenes_response.json()["items"]

    npc_routines_response = client.get(
        f"/ops/worlds/{session_payload['world_id']}/npc-routines",
        headers=auth_headers,
    )
    assert npc_routines_response.status_code == 200
    assert npc_routines_response.json()["world_context"] == session_payload["world_context"]
    assert len(npc_routines_response.json()["items"]) >= 3
    assert {"routine_role", "beat_state", "last_ambient_turn_id"} <= set(
        npc_routines_response.json()["items"][0]["routine_state"]
    )

    ambient_beats_response = client.get(
        f"/ops/worlds/{session_payload['world_id']}/ambient-beats",
        headers=auth_headers,
    )
    assert ambient_beats_response.status_code == 200
    assert ambient_beats_response.json()["world_context"] == session_payload["world_context"]
    assert ambient_beats_response.json()["items"]
    assert {"beat_kind", "visible_summary"} <= set(ambient_beats_response.json()["items"][0])

    route_pressures_response = client.get(
        f"/ops/worlds/{session_payload['world_id']}/route-pressures",
        headers=auth_headers,
    )
    assert route_pressures_response.status_code == 200
    assert route_pressures_response.json()["world_context"] == session_payload["world_context"]
    assert "items" in route_pressures_response.json()

    locations_response = client.get(
        f"/ops/worlds/{session_payload['world_id']}/locations",
        headers=auth_headers,
    )
    assert locations_response.status_code == 200
    assert locations_response.json()["world_context"] == session_payload["world_context"]
    assert len(locations_response.json()["items"]) >= 3

    travel_log_response = client.get(
        f"/ops/worlds/{session_payload['world_id']}/travel-log",
        headers=auth_headers,
    )
    assert travel_log_response.status_code == 200
    assert travel_log_response.json()["world_context"] == session_payload["world_context"]
    assert "items" in travel_log_response.json()

    world_ticks_response = client.get(
        f"/ops/worlds/{session_payload['world_id']}/world-ticks",
        headers=auth_headers,
    )
    assert world_ticks_response.status_code == 200
    assert world_ticks_response.json()["world_context"] == session_payload["world_context"]
    assert "items" in world_ticks_response.json()

    npc_locations_response = client.get(
        f"/ops/worlds/{session_payload['world_id']}/npc-locations",
        headers=auth_headers,
    )
    assert npc_locations_response.status_code == 200
    assert npc_locations_response.json()["world_context"] == session_payload["world_context"]
    assert "items" in npc_locations_response.json()

    offstage_beats_response = client.get(
        f"/ops/worlds/{session_payload['world_id']}/offstage-beats",
        headers=auth_headers,
    )
    assert offstage_beats_response.status_code == 200
    assert offstage_beats_response.json()["world_context"] == session_payload["world_context"]
    assert "items" in offstage_beats_response.json()


def test_ops_memory_status_search_and_reindex_contract(client, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()

    _post_turn_and_wait_for_resolution(
        client,
        session_payload["session_id"],
        auth_headers,
        {"input_mode": "choice", "choice_id": "progress"},
    )
    _post_turn_and_wait_for_resolution(
        client,
        session_payload["session_id"],
        auth_headers,
        {"input_mode": "choice", "choice_id": "progress"},
    )

    status_response = client.get("/ops/memories/status", headers=auth_headers)
    assert status_response.status_code == 200
    status_payload = status_response.json()
    assert {"provider", "model", "dimension", "pending_count", "failed_count", "runtime_status"} <= set(status_payload)

    search_response = client.get(
        f"/ops/worlds/{session_payload['world_id']}/memory-search?query=%E6%97%85%E4%BA%BA%E3%82%92%E5%8A%A9%E3%81%91%E3%81%9F&limit=4",
        headers=auth_headers,
    )
    assert search_response.status_code == 200
    search_payload = search_response.json()
    assert search_payload["world_context"] == session_payload["world_context"]
    assert search_payload["trace"]["status"] == "ready"
    assert len(search_payload["hits"]) >= 1
    assert any("旅人を助け" in item["text"] for item in search_payload["hits"])

    reindex_response = client.post(
        "/ops/memories/reindex",
        json={"world_id": session_payload["world_id"], "limit": 10},
        headers=auth_headers,
    )
    assert reindex_response.status_code == 200
    reindex_payload = reindex_response.json()
    assert reindex_payload["world_id"] == session_payload["world_id"]
    assert reindex_payload["processed"] >= 1


def test_ops_eval_contracts(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()
    _post_turn_and_wait_for_resolution(
        client,
        session_payload["session_id"],
        auth_headers,
        {"input_mode": "choice", "choice_id": "progress"},
    )

    container.observability_service.probe_canary_health = lambda: CanaryProbeResult(  # type: ignore[method-assign]
        status="healthy",
        url="http://backend-canary:8000/health",
        http_status=200,
        detail="ok",
        graph_runtime_status="ready",
        release_gate_verdict="passed",
        projection_lag_seconds=0.0,
        outbox_pending_count=0,
        outbox_failed_count=0,
        llm_schema_valid_rate=1.0,
        llm_fallback_rate=0.0,
    )

    run_response = client.post(
        "/ops/evals/run",
        json={"source": "dataset", "dataset_name": "turn_resolution_smoke"},
        headers=auth_headers,
    )
    assert run_response.status_code == 200
    run_payload = run_response.json()
    assert run_payload["dataset_name"] == "turn_resolution_smoke"
    assert {
        (item["pack_id"], item["pack_display_name"], item["world_template_id"], item["world_template_display_name"])
        for item in run_payload["summary"]["pack_scope"]
    } == {
        ("gestaloka_reference", "GESTALOKA Reference", "nexus_foundation", "Nexus Foundation"),
    }
    assert run_payload["summary"]["variants"]["current"]["gate_passed"] is True
    assert run_payload["langfuse_trace_id"]
    assert run_payload["langfuse_trace_url"].startswith("http://langfuse.test/project/gestaloka-v2/traces/")
    assert run_payload["langfuse_status"] == "ok"

    runs_response = client.get("/ops/evals/runs", headers=auth_headers)
    assert runs_response.status_code == 200
    runs_payload = runs_response.json()
    assert runs_payload["items"][0]["id"] == run_payload["id"]
    assert runs_payload["items"][0]["summary"]["pack_scope"] == run_payload["summary"]["pack_scope"]
    assert runs_payload["items"][0]["langfuse_trace_url"].startswith("http://langfuse.test/project/gestaloka-v2/traces/")
    reference_runs_response = client.get(
        "/ops/evals/runs?pack_id=gestaloka_reference&world_template_id=nexus_foundation",
        headers=auth_headers,
    )
    assert reference_runs_response.status_code == 200
    assert reference_runs_response.json()["items"][0]["id"] == run_payload["id"]
    missing_runs_response = client.get("/ops/evals/runs?pack_id=missing_pack", headers=auth_headers)
    assert missing_runs_response.status_code == 200
    assert missing_runs_response.json()["items"] == []

    detail_response = client.get(f"/ops/evals/runs/{run_payload['id']}", headers=auth_headers)
    assert detail_response.status_code == 200
    assert len(detail_response.json()["results"]) >= 2
    assert detail_response.json()["summary"]["pack_scope"] == run_payload["summary"]["pack_scope"]
    assert {
        (
            item["pack_context"]["pack_id"],
            item["pack_context"]["pack_display_name"],
            item["pack_context"]["world_template_id"],
            item["pack_context"]["world_template_display_name"],
        )
        for item in detail_response.json()["results"]
    } == {
        ("gestaloka_reference", "GESTALOKA Reference", "nexus_foundation", "Nexus Foundation"),
    }
    assert detail_response.json()["langfuse_trace_url"].startswith("http://langfuse.test/project/gestaloka-v2/traces/")
    reference_detail_response = client.get(
        f"/ops/evals/runs/{run_payload['id']}?pack_id=gestaloka_reference&world_template_id=nexus_foundation",
        headers=auth_headers,
    )
    assert reference_detail_response.status_code == 200
    assert {
        item["pack_context"]["pack_id"]
        for item in reference_detail_response.json()["results"]
    } == {"gestaloka_reference"}
    assert len(reference_detail_response.json()["results"]) == len(detail_response.json()["results"])

    observability_response = client.get("/ops/observability/summary", headers=auth_headers)
    assert observability_response.status_code == 200
    observability_payload = observability_response.json()
    assert {"primary", "canary", "langfuse", "recent_traces", "metrics"} <= set(observability_payload)
    assert observability_payload["snapshot_id"]
    assert observability_payload["langfuse"]["runtime_status"] == "ready"
    scoped_observability_response = client.get(
        "/ops/observability/summary?pack_id=gestaloka_reference&world_template_id=nexus_foundation",
        headers=auth_headers,
    )
    assert scoped_observability_response.status_code == 200
    scoped_observability_payload = scoped_observability_response.json()
    scoped_traces = scoped_observability_payload["recent_traces"]
    assert scoped_traces
    for trace in scoped_traces:
        attributes = trace["attributes"]
        assert (
            attributes.get("pack_id") == "gestaloka_reference"
            or "gestaloka_reference" in str(attributes.get("eval.pack_ids", "")).split(",")
        )
        assert (
            attributes.get("world_template_id") == "nexus_foundation"
            or "nexus_foundation" in str(attributes.get("eval.world_template_ids", "")).split(",")
        )
    missing_observability_response = client.get("/ops/observability/summary?pack_id=missing_pack", headers=auth_headers)
    assert missing_observability_response.status_code == 200
    assert missing_observability_response.json()["recent_traces"] == []
    scoped_snapshots_response = client.get(
        "/ops/observability/snapshots?pack_id=gestaloka_reference&world_template_id=nexus_foundation",
        headers=auth_headers,
    )
    assert scoped_snapshots_response.status_code == 200
    scoped_snapshots = scoped_snapshots_response.json()["items"]
    assert scoped_snapshots[0]["id"] == scoped_observability_payload["snapshot_id"]
    assert scoped_snapshots[0]["snapshot_kind"] == "summary"
    assert scoped_snapshots[0]["pack_id"] == "gestaloka_reference"
    assert scoped_snapshots[0]["world_template_id"] == "nexus_foundation"
    assert scoped_snapshots[0]["trace_count"] == len(scoped_traces)
    missing_snapshots_response = client.get("/ops/observability/snapshots?pack_id=missing_pack", headers=auth_headers)
    assert missing_snapshots_response.status_code == 200
    assert missing_snapshots_response.json()["items"] == []

    langfuse_status_response = client.get("/ops/observability/langfuse/status", headers=auth_headers)
    assert langfuse_status_response.status_code == 200
    assert langfuse_status_response.json()["stack"] == "langfuse"
    assert langfuse_status_response.json()["runtime_status"] == "ready"

    checklist_run_response = client.post(
        "/ops/release/checklists/run",
        json={"trigger_type": "manual", "shadow_limit": 3},
        headers=auth_headers,
    )
    assert checklist_run_response.status_code == 200
    checklist_payload = checklist_run_response.json()
    assert {
        "report_id",
        "verdict",
        "checks",
        "runs",
        "diff_summary",
        "runbook",
        "cutover_status",
        "slo_snapshot",
        "langfuse_trace_id",
        "langfuse_trace_url",
        "langfuse_status",
        "langfuse_delivery",
    } <= set(checklist_payload)
    assert set(checklist_payload["checks"]["pack_regressions"]) == {"turn_resolution_gestaloka_regression"}
    assert checklist_payload["checks"]["pack_regressions"]["turn_resolution_gestaloka_regression"]["pack_scope"] == [
        {
            "pack_id": "gestaloka_reference",
            "pack_display_name": "GESTALOKA Reference",
            "world_template_id": "nexus_foundation",
            "world_template_display_name": "Nexus Foundation",
        }
    ]
    assert checklist_payload["checks"]["shared_world_health"]["status"] == "ready"
    assert set(checklist_payload["runs"]["pack_regressions"]) == {"turn_resolution_gestaloka_regression"}
    assert checklist_payload["cutover_status"]["promote_ready"] is True
    assert checklist_payload["cutover_status"]["bundled_pack_regressions"] == [
        "turn_resolution_gestaloka_regression",
    ]
    assert checklist_payload["runbook"]["canary_up"] == "make canary-up"
    assert checklist_payload["runbook"]["canary_probe"] == "make canary-probe"
    assert checklist_payload["runbook"]["pre_promote_checklist"] == "make release-checklist"
    assert checklist_payload["runbook"]["nightly_gate"] == "make nightly-eval"
    assert checklist_payload["runbook"]["promote_condition"] == "verdict == passed and canary_promote_status == ready"
    assert checklist_payload["langfuse_trace_url"].startswith("http://langfuse.test/project/gestaloka-v2/traces/")
    release_snapshots_response = client.get("/ops/observability/snapshots?limit=20", headers=auth_headers)
    assert release_snapshots_response.status_code == 200
    assert any(
        item["snapshot_kind"] == "release_checklist"
        and item["release_gate_report_id"] == checklist_payload["report_id"]
        for item in release_snapshots_response.json()["items"]
    )

    latest_response = client.get("/ops/release/checklists/latest", headers=auth_headers)
    assert latest_response.status_code == 200
    assert latest_response.json()["report_id"] == checklist_payload["report_id"]
    assert latest_response.json()["cutover_status"] == checklist_payload["cutover_status"]
    assert latest_response.json()["langfuse_trace_url"].startswith("http://langfuse.test/project/gestaloka-v2/traces/")
    progress_response = client.get("/ops/release/checklists/progress", headers=auth_headers)
    assert progress_response.status_code == 200
    progress_payload = progress_response.json()
    assert progress_payload["status"] == "completed"
    assert progress_payload["completed_report_id"] == checklist_payload["report_id"]
    assert "elapsed_seconds" in progress_payload
    admin_progress_response = client.get("/admin/release/checklists/progress", headers=auth_headers)
    assert admin_progress_response.status_code == 200
    assert admin_progress_response.json()["completed_report_id"] == checklist_payload["report_id"]
    scoped_latest_response = client.get(
        "/ops/release/checklists/latest?pack_id=gestaloka_reference&world_template_id=nexus_foundation",
        headers=auth_headers,
    )
    assert scoped_latest_response.status_code == 200
    scoped_latest_payload = scoped_latest_response.json()
    assert scoped_latest_payload["report_id"] == checklist_payload["report_id"]
    assert scoped_latest_payload["cutover_status"] == checklist_payload["cutover_status"]
    assert set(scoped_latest_payload["checks"]["pack_regressions"]) == {"turn_resolution_gestaloka_regression"}
    assert set(scoped_latest_payload["runs"]["pack_regressions"]) == {"turn_resolution_gestaloka_regression"}
    assert all(
        item["pack_context"]["pack_id"] == "gestaloka_reference"
        for item in scoped_latest_payload["shadow_failures"]
    )
    missing_latest_response = client.get("/ops/release/checklists/latest?pack_id=missing_pack", headers=auth_headers)
    assert missing_latest_response.status_code == 200
    assert missing_latest_response.json()["checks"]["pack_regressions"] == {}
    assert missing_latest_response.json()["runs"]["pack_regressions"] == {}
    assert missing_latest_response.json()["shadow_failures"] == []

    detail_gate_response = client.get(
        f"/ops/release/checklists/{checklist_payload['report_id']}",
        headers=auth_headers,
    )
    assert detail_gate_response.status_code == 200
    assert detail_gate_response.json()["report_id"] == checklist_payload["report_id"]
    assert detail_gate_response.json()["langfuse_trace_url"].startswith("http://langfuse.test/project/gestaloka-v2/traces/")

    gate_alias_response = client.get("/ops/release/gates/latest", headers=auth_headers)
    assert gate_alias_response.status_code == 200
    assert gate_alias_response.json()["report_id"] == checklist_payload["report_id"]
    assert gate_alias_response.json()["langfuse_trace_url"].startswith("http://langfuse.test/project/gestaloka-v2/traces/")
    scoped_gate_alias_response = client.get("/ops/release/gates/latest?pack_id=missing_pack", headers=auth_headers)
    assert scoped_gate_alias_response.status_code == 200
    assert scoped_gate_alias_response.json()["report_id"] == checklist_payload["report_id"]
    assert scoped_gate_alias_response.json()["checks"]["pack_regressions"] == {}


def test_observability_snapshot_retention_cleanup(client, container, auth_headers):
    with container.session_factory() as db:
        old_snapshot = ObservabilitySnapshot(
            snapshot_kind="summary",
            runtime_role="primary",
            primary_slo={},
            canary_health={},
            langfuse_status={},
            metrics={},
            trace_count=0,
            created_at=datetime(2000, 1, 1, tzinfo=timezone.utc),
            updated_at=datetime(2000, 1, 1, tzinfo=timezone.utc),
        )
        db.add(old_snapshot)
        db.commit()
        old_snapshot_id = old_snapshot.id

    response = client.get("/ops/observability/summary", headers=auth_headers)
    assert response.status_code == 200

    with container.session_factory() as db:
        assert db.execute(
            select(ObservabilitySnapshot).where(ObservabilitySnapshot.id == old_snapshot_id)
        ).scalar_one_or_none() is None
        assert db.execute(
            select(ObservabilitySnapshot).where(ObservabilitySnapshot.id == response.json()["snapshot_id"])
        ).scalar_one_or_none() is not None


def test_canary_runtime_blocks_gameplay_writes(client, container, auth_headers):
    container.settings.app_runtime_role = "canary"

    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )

    assert session_response.status_code == 403
    assert session_response.json()["detail"] == "This runtime only accepts eval and ops traffic"
