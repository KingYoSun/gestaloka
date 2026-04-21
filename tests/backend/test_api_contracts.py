from __future__ import annotations

from fastapi import HTTPException, status

from app.modules.identity.oidc import UserIdentity


def test_health_reports_database_projection_and_oidc(client):
    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["database"] == "ok"
    assert payload["projection"]["backend"] == "recording"
    assert payload["projection"]["pending_outbox"] == 0
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


def test_session_and_turn_contract_and_websocket_event_order(client, auth_headers):
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
        "websocket_url",
    }

    with client.websocket_connect(f"/ws/sessions/{session_payload['session_id']}?token=dev-local-token") as websocket:
        turn_response = client.post(
            "/turns",
            json={"session_id": session_payload["session_id"], "input_text": "広場で灯をともす"},
            headers=auth_headers,
        )
        assert turn_response.status_code == 200
        turn_payload = turn_response.json()
        assert set(turn_payload) == {"turn_id", "event_id", "memory_ids", "narrative", "npc_reaction"}

        messages = [websocket.receive_json() for _ in range(9)]

    assert [message["event"] for message in messages] == [
        "turn.accepted",
        "turn.progress",
        "turn.progress",
        "turn.narrative.delta",
        "world.event.created",
        "memory.materialized",
        "turn.progress",
        "graph.projection.updated",
        "turn.resolved",
    ]
    assert [message["data"]["phase"] for message in messages if message["event"] == "turn.progress"] == [
        "routing",
        "memory_lookup",
        "projection",
    ]
    assert messages[-1]["data"] == turn_payload

