from __future__ import annotations

from fastapi import HTTPException, status

from app.modules.identity.oidc import UserIdentity
from app.modules.observability.service import CanaryProbeResult


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
    assert payload["sp"]["budget_scope"] == "execution_only"
    assert payload["embedding"]["dimension"] == 768
    assert payload["embedding"]["runtime_status"] == "ready"
    assert {"projection_lag_seconds", "outbox_pending_count", "llm_schema_valid_rate"} <= set(payload["observability"])
    assert {"verdict", "blocked_reasons", "canary_promote_status"} <= set(payload["release_gate"])
    assert payload["oidc_mode"] == "development"


def test_missing_bearer_token_returns_401(client):
    response = client.get("/auth/me")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token"


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
        json={"world_id": "world-alpha", "world_name": "Founders Reach"},
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
    forbidden_eval = client.get("/ops/evals/runs", headers={"Authorization": "Bearer user-token"})
    allowed_eval = client.get("/ops/evals/runs", headers={"Authorization": "Bearer admin-token"})

    assert forbidden.status_code == 403
    assert allowed.status_code == 200
    assert forbidden_eval.status_code == 403
    assert allowed_eval.status_code == 200


def test_session_and_turn_contract_and_websocket_event_order(client, auth_headers):
    wallet_response = client.get("/economy/sp/me", headers=auth_headers)
    assert wallet_response.status_code == 200
    assert wallet_response.json()["balance"] == 10

    session_response = client.post(
        "/sessions",
        json={"world_id": "world-alpha", "world_name": "Founders Reach"},
        headers=auth_headers,
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()
    assert set(session_payload) == {
        "session_id",
        "world_id",
        "player_actor_id",
        "npc_actor_id",
        "location_id",
        "websocket_url",
    }
    state_response = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert state_response.status_code == 200
    assert {"world_id", "location", "character", "quests", "factions", "inventory"} <= set(state_response.json())
    assert state_response.json()["quests"][0]["progress"] == 0
    assert state_response.json()["quests"][0]["stage_key"] == "starter_watch"
    assert state_response.json()["inventory"] == []

    with client.websocket_connect(f"/ws/sessions/{session_payload['session_id']}?token=dev-local-token") as websocket:
        turn_response = client.post(
            "/turns",
            json={
                "session_id": session_payload["session_id"],
                "action_type": "narrative",
                "input_text": "広場で旅人を助け、灯をともす",
            },
            headers=auth_headers,
        )
        assert turn_response.status_code == 200
        turn_payload = turn_response.json()
        assert set(turn_payload) == {
            "turn_id",
            "action_type",
            "event_id",
            "memory_ids",
            "narrative",
            "npc_reaction",
            "sp_delta",
            "sp_balance",
            "sp_ledger_id",
            "quest_updates",
            "faction_updates",
            "inventory_updates",
        }
        assert turn_payload["action_type"] == "narrative"
        assert turn_payload["sp_delta"] == -1
        assert turn_payload["sp_balance"] == 9
        assert turn_payload["quest_updates"][0]["progress"] == 1
        assert turn_payload["inventory_updates"] == []

        messages = [websocket.receive_json() for _ in range(14)]

    assert [message["event"] for message in messages] == [
        "turn.accepted",
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
        "graph.projection.updated",
        "turn.resolved",
    ]
    assert [message["data"]["phase"] for message in messages if message["event"] == "turn.progress"] == [
        "memory_council",
        "npc_council",
        "world_progress",
        "rules_arbiter",
        "safety_guard",
        "narrative",
    ]
    assert messages[-1]["data"] == turn_payload
    assert messages[-2]["data"]["world_id"] == session_payload["world_id"]
    assert {"vertex_count", "edge_count"} <= set(messages[-2]["data"])


def test_use_reward_item_contract_and_websocket_event_order(client, auth_headers):
    session_response = client.post(
        "/sessions",
        json={"world_id": "world-alpha", "world_name": "Founders Reach"},
        headers=auth_headers,
    )
    session_payload = session_response.json()

    first_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "action_type": "narrative",
            "input_text": "広場で旅人を助け、灯をともす",
        },
        headers=auth_headers,
    )
    assert first_turn.status_code == 200
    second_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "action_type": "narrative",
            "input_text": "旅人へ報告し、広場を見回して次の見回りを約束する",
        },
        headers=auth_headers,
    )
    assert second_turn.status_code == 200

    state_response = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    item_id = state_response.json()["inventory"][0]["id"]

    with client.websocket_connect(f"/ws/sessions/{session_payload['session_id']}?token=dev-local-token") as websocket:
        use_response = client.post(
            "/turns",
            json={
                "session_id": session_payload["session_id"],
                "action_type": "use_reward_item",
                "item_id": item_id,
            },
            headers=auth_headers,
        )
        assert use_response.status_code == 200
        payload = use_response.json()
        assert payload["action_type"] == "use_reward_item"
        assert payload["quest_updates"][0]["stage_key"] == "watch_path_followup"
        assert payload["inventory_updates"][0]["status"] == "used"
        assert payload["inventory_updates"][0]["action"] == "used"
        assert payload["faction_updates"][0]["delta"] == 0.1

        messages = [websocket.receive_json() for _ in range(10)]

    assert [message["event"] for message in messages] == [
        "turn.accepted",
        "turn.progress",
        "turn.narrative.delta",
        "world.event.created",
        "memory.materialized",
        "quest.updated",
        "faction.standing.updated",
        "inventory.changed",
        "graph.projection.updated",
        "turn.resolved",
    ]
    assert [message["data"]["phase"] for message in messages if message["event"] == "turn.progress"] == ["item_use"]
    assert messages[-1]["data"] == payload


def test_ops_projection_status_and_rebuild_contract(client, auth_headers):
    session_response = client.post(
        "/sessions",
        json={"world_id": "world-alpha", "world_name": "Founders Reach"},
        headers=auth_headers,
    )
    session_payload = session_response.json()

    turn_response = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_text": "広場で灯をともす"},
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
    assert rebuild_payload["records"] >= 1

    council_turns_response = client.get(
        f"/ops/council/turns?session_id={session_payload['session_id']}",
        headers=auth_headers,
    )
    assert council_turns_response.status_code == 200
    council_turns_payload = council_turns_response.json()
    assert council_turns_payload["items"][0]["resolution_mode"] == "gm_council"
    assert [item["council_role"] for item in council_turns_payload["items"][0]["roles"]] == [
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


def test_ops_memory_status_search_and_reindex_contract(client, auth_headers):
    session_response = client.post(
        "/sessions",
        json={"world_id": "world-alpha", "world_name": "Founders Reach"},
        headers=auth_headers,
    )
    session_payload = session_response.json()

    first_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_text": "広場で旅人を助け、灯をともす"},
        headers=auth_headers,
    )
    assert first_turn.status_code == 200

    second_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_text": "旅人へ報告し、広場を見回して次の見回りを約束する",
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
        json={"world_id": "world-alpha", "world_name": "Founders Reach"},
        headers=auth_headers,
    )
    session_payload = session_response.json()
    turn_response = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_text": "広場で灯をともす"},
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
    assert run_payload["summary"]["variants"]["current"]["gate_passed"] is True

    runs_response = client.get("/ops/evals/runs", headers=auth_headers)
    assert runs_response.status_code == 200
    runs_payload = runs_response.json()
    assert runs_payload["items"][0]["id"] == run_payload["id"]

    detail_response = client.get(f"/ops/evals/runs/{run_payload['id']}", headers=auth_headers)
    assert detail_response.status_code == 200
    assert len(detail_response.json()["results"]) >= 2

    observability_response = client.get("/ops/observability/summary", headers=auth_headers)
    assert observability_response.status_code == 200
    observability_payload = observability_response.json()
    assert {"primary", "canary", "recent_traces", "metrics"} <= set(observability_payload)

    checklist_run_response = client.post(
        "/ops/release/checklists/run",
        json={"trigger_type": "manual", "shadow_limit": 3},
        headers=auth_headers,
    )
    assert checklist_run_response.status_code == 200
    checklist_payload = checklist_run_response.json()
    assert {"report_id", "verdict", "checks", "diff_summary", "runbook", "slo_snapshot"} <= set(checklist_payload)

    latest_response = client.get("/ops/release/checklists/latest", headers=auth_headers)
    assert latest_response.status_code == 200
    assert latest_response.json()["report_id"] == checklist_payload["report_id"]

    detail_gate_response = client.get(
        f"/ops/release/checklists/{checklist_payload['report_id']}",
        headers=auth_headers,
    )
    assert detail_gate_response.status_code == 200
    assert detail_gate_response.json()["report_id"] == checklist_payload["report_id"]

    gate_alias_response = client.get("/ops/release/gates/latest", headers=auth_headers)
    assert gate_alias_response.status_code == 200
    assert gate_alias_response.json()["report_id"] == checklist_payload["report_id"]


def test_canary_runtime_blocks_gameplay_writes(client, container, auth_headers):
    container.settings.app_runtime_role = "canary"

    session_response = client.post(
        "/sessions",
        json={"world_id": "world-alpha", "world_name": "Founders Reach"},
        headers=auth_headers,
    )

    assert session_response.status_code == 403
    assert session_response.json()["detail"] == "This runtime only accepts eval and ops traffic"
