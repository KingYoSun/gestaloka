from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, status

from app.modules.identity.oidc import UserIdentity
from app.modules.observability.service import CanaryProbeResult
from app.modules.world_pack.service import PackRegistry


def engine_session_payload(*, world_id: str = "world-alpha") -> dict[str, str]:
    return {
        "world_id": world_id,
        "pack_id": "ember_harbor",
        "world_template_id": "ember_harbor",
        "world_name": "Ember Harbor",
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
    assert payload["sp"]["default_balance"] == 10
    assert payload["sp"]["turn_cost"] == 1
    assert payload["sp"]["choice_turn_cost"] == 1
    assert payload["sp"]["free_text_turn_cost"] == 3
    assert payload["sp"]["budget_scope"] == "execution_only"
    assert payload["embedding"]["dimension"] == 768
    assert payload["embedding"]["runtime_status"] == "ready"
    assert payload["world_packs"] == {
        "status": "ready",
        "engine_api_version": "v2",
        "pack_count": 2,
        "template_count": 2,
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


def test_session_requires_explicit_pack_id(client, auth_headers):
    response = client.post(
        "/sessions",
        json={
            "world_id": "world-alpha",
            "world_template_id": "ember_harbor",
            "world_name": "Ember Harbor",
        },
        headers=auth_headers,
    )

    assert response.status_code == 422
    assert any(item["loc"] == ["body", "pack_id"] and item["type"] == "missing" for item in response.json()["detail"])


def test_session_requires_explicit_world_template_id(client, auth_headers):
    response = client.post(
        "/sessions",
        json={
            "world_id": "world-alpha",
            "pack_id": "ember_harbor",
            "world_name": "Ember Harbor",
        },
        headers=auth_headers,
    )

    assert response.status_code == 422
    assert any(
        item["loc"] == ["body", "world_template_id"] and item["type"] == "missing"
        for item in response.json()["detail"]
    )


def test_session_unknown_pack_id_returns_422(client, auth_headers):
    payload = engine_session_payload(world_id="world-unknown-pack")
    payload["pack_id"] = "missing_pack"

    response = client.post("/sessions", json=payload, headers=auth_headers)

    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "unknown_pack"
    assert response.json()["detail"]["pack_id"] == "missing_pack"


def test_session_unknown_world_template_id_returns_422(client, auth_headers):
    payload = engine_session_payload(world_id="world-unknown-template")
    payload["world_template_id"] = "missing_template"

    response = client.post("/sessions", json=payload, headers=auth_headers)

    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "unknown_template"
    assert response.json()["detail"]["pack_id"] == "ember_harbor"


def test_session_pack_catalog_error_returns_503(client, container, tmp_path: Path, auth_headers):
    container.pack_registry = PackRegistry(tmp_path / "missing-packs")
    response = client.post("/sessions", json=engine_session_payload(world_id="world-catalog-error"), headers=auth_headers)

    assert response.status_code == 503
    assert response.json()["detail"]["error"] == "world_pack_catalog_unavailable"
    assert response.json()["detail"]["failure_count"] == 1


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
        "/worlds/world-alpha/events",
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
    assert wallet_response.json()["balance"] == 10

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
        "npc_actor_id",
        "location_id",
        "websocket_url",
        "world_context",
    }
    assert session_payload["world_context"] == {
        "world_id": session_payload["world_id"],
        "world_name": session_payload["world_name"],
        "pack_id": "ember_harbor",
        "pack_display_name": "Ember Harbor",
        "world_template_id": "ember_harbor",
        "world_template_display_name": "Ember Harbor",
        "semantic_tags": ["harbor", "beacon", "rumor", "wardens"],
    }
    state_response = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert state_response.status_code == 200
    assert {
        "world_id",
        "location",
        "current_location",
        "character",
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
        assert turn_response.status_code == 200
        turn_payload = turn_response.json()
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
        }
        assert turn_payload["world_context"]["pack_id"] == "ember_harbor"
        assert turn_payload["world_context"]["world_template_id"] == "ember_harbor"
        assert turn_payload["action_type"] == "narrative"
        assert turn_payload["input_mode"] == "choice"
        assert turn_payload["sp_delta"] == -1
        assert turn_payload["sp_balance"] == 9
        assert turn_payload["quest_updates"][0]["progress"] == 1
        assert turn_payload["inventory_updates"] == []
        assert turn_payload["interpreted_intent"]["requested_choice_posture"] == "progress"
        assert [item["choice_id"] for item in turn_payload["next_choices"]] == ["safe", "progress", "explore"]

        messages = [websocket.receive_json() for _ in range(24)]

    assert [message["event"] for message in messages] == [
        "session.connected",
        "turn.accepted",
        "turn.progress",
        "turn.progress",
        "turn.progress",
        "turn.progress",
        "turn.progress",
        "turn.progress",
        "turn.progress",
        "turn.progress",
        "turn.progress",
        "turn.progress",
        "turn.progress",
        "turn.narrative.delta",
        "world.event.created",
        "memory.materialized",
        "quest.updated",
        "faction.standing.updated",
        "relationship.updated",
        "scene.updated",
        "chapter.updated",
        "ambient.updated",
        "graph.projection.updated",
        "turn.resolved",
    ]
    assert messages[0]["data"] == {
        "session_id": session_payload["session_id"],
        "world_context": session_payload["world_context"],
    }
    assert [message["data"]["phase"] for message in messages if message["event"] == "turn.progress"] == [
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
    assert messages[-1]["data"] == turn_payload
    assert messages[-2]["data"]["world_id"] == session_payload["world_id"]
    assert {"vertex_count", "edge_count"} <= set(messages[-2]["data"])
    for message in messages:
        assert_realtime_world_context(message, session_payload["world_context"])
        assert message["data"]["world_context"]["pack_id"] == "ember_harbor"
        assert message["data"]["world_context"]["world_template_id"] == "ember_harbor"


def test_use_reward_item_contract_and_websocket_event_order(client, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()

    first_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_mode": "choice",
            "choice_id": "progress",
        },
        headers=auth_headers,
    )
    assert first_turn.status_code == 200
    second_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_mode": "choice",
            "choice_id": "progress",
        },
        headers=auth_headers,
    )
    assert second_turn.status_code == 200

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
        assert use_response.status_code == 200
        payload = use_response.json()
        assert payload["world_context"]["pack_id"] == "ember_harbor"
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

        messages = [websocket.receive_json() for _ in range(20)]

    assert [message["event"] for message in messages] == [
        "session.connected",
        "turn.accepted",
        "turn.progress",
        "turn.progress",
        "turn.progress",
        "turn.progress",
        "turn.progress",
        "turn.narrative.delta",
        "world.event.created",
        "memory.materialized",
        "quest.updated",
        "faction.standing.updated",
        "inventory.changed",
        "relationship.updated",
        "consequence.updated",
        "scene.updated",
        "chapter.updated",
        "ambient.updated",
        "graph.projection.updated",
        "turn.resolved",
    ]
    assert [message["data"]["phase"] for message in messages if message["event"] == "turn.progress"] == [
        "item_use",
        "consequence_resolution",
        "scene_framing",
        "ambient_world_pass",
        "choice_generation",
    ]
    assert messages[-1]["data"] == payload
    for message in messages:
        assert_realtime_world_context(message, session_payload["world_context"])
        assert message["data"]["world_context"]["pack_id"] == "ember_harbor"
        assert message["data"]["world_context"]["world_template_id"] == "ember_harbor"
    assert payload["scene_updates"]
    assert payload["chapter_updates"]


def test_idle_pass_websocket_event_keeps_world_context(client, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(world_id="world-idle-realtime"),
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
        assert idle_payload["world_context"]["pack_id"] == "ember_harbor"
        assert idle_payload["world_context"]["world_template_id"] == "ember_harbor"

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

    turn_response = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert turn_response.status_code == 200

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
    assert world_item["world_context"]["pack_id"] == "ember_harbor"
    assert world_item["world_context"]["world_template_id"] == "ember_harbor"
    assert world_item["status"] == "active"
    assert world_item["active_session_count"] >= 1
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

    first_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert first_turn.status_code == 200

    second_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_mode": "choice",
            "choice_id": "progress",
        },
        headers=auth_headers,
    )
    assert second_turn.status_code == 200

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
    turn_response = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert turn_response.status_code == 200

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
        ("ember_harbor", "Ember Harbor", "ember_harbor", "Ember Harbor"),
        ("founders_reach", "Founders Reach", "founders_reach", "Founders Reach"),
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
        ("ember_harbor", "Ember Harbor", "ember_harbor", "Ember Harbor"),
        ("founders_reach", "Founders Reach", "founders_reach", "Founders Reach"),
    }
    assert detail_response.json()["langfuse_trace_url"].startswith("http://langfuse.test/project/gestaloka-v2/traces/")

    observability_response = client.get("/ops/observability/summary", headers=auth_headers)
    assert observability_response.status_code == 200
    observability_payload = observability_response.json()
    assert {"primary", "canary", "langfuse", "recent_traces", "metrics"} <= set(observability_payload)
    assert observability_payload["langfuse"]["runtime_status"] == "ready"

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
    assert set(checklist_payload["checks"]["pack_regressions"]) == {
        "turn_resolution_founders_regression",
        "turn_resolution_ember_regression",
    }
    assert checklist_payload["checks"]["pack_regressions"]["turn_resolution_founders_regression"]["pack_scope"] == [
        {
            "pack_id": "founders_reach",
            "pack_display_name": "Founders Reach",
            "world_template_id": "founders_reach",
            "world_template_display_name": "Founders Reach",
        }
    ]
    assert checklist_payload["checks"]["pack_regressions"]["turn_resolution_ember_regression"]["pack_scope"] == [
        {
            "pack_id": "ember_harbor",
            "pack_display_name": "Ember Harbor",
            "world_template_id": "ember_harbor",
            "world_template_display_name": "Ember Harbor",
        }
    ]
    assert set(checklist_payload["runs"]["pack_regressions"]) == {
        "turn_resolution_founders_regression",
        "turn_resolution_ember_regression",
    }
    assert checklist_payload["cutover_status"]["promote_ready"] is True
    assert checklist_payload["cutover_status"]["bundled_pack_regressions"] == [
        "turn_resolution_founders_regression",
        "turn_resolution_ember_regression",
    ]
    assert checklist_payload["runbook"]["canary_up"] == "make canary-up"
    assert checklist_payload["runbook"]["canary_probe"] == "make canary-probe"
    assert checklist_payload["runbook"]["pre_promote_checklist"] == "make release-checklist"
    assert checklist_payload["runbook"]["nightly_gate"] == "make nightly-eval"
    assert checklist_payload["runbook"]["promote_condition"] == "verdict == passed and canary_promote_status == ready"
    assert checklist_payload["langfuse_trace_url"].startswith("http://langfuse.test/project/gestaloka-v2/traces/")

    latest_response = client.get("/ops/release/checklists/latest", headers=auth_headers)
    assert latest_response.status_code == 200
    assert latest_response.json()["report_id"] == checklist_payload["report_id"]
    assert latest_response.json()["cutover_status"] == checklist_payload["cutover_status"]
    assert latest_response.json()["langfuse_trace_url"].startswith("http://langfuse.test/project/gestaloka-v2/traces/")

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


def test_canary_runtime_blocks_gameplay_writes(client, container, auth_headers):
    container.settings.app_runtime_role = "canary"

    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )

    assert session_response.status_code == 403
    assert session_response.json()["detail"] == "This runtime only accepts eval and ops traffic"
