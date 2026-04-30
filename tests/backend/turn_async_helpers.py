from __future__ import annotations

from typing import Any


def receive_until_turn_event(websocket, event_name: str, *, limit: int = 64) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for _ in range(limit):
        message = websocket.receive_json()
        messages.append(message)
        if message.get("event") == event_name:
            return messages
    raise AssertionError(f"{event_name} was not received")


def post_turn_and_wait(
    client,
    *,
    session_id: str,
    auth_headers: dict[str, str],
    payload: dict[str, Any],
    token: str = "dev-local-token",
    terminal_event: str = "turn.resolved",
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    with client.websocket_connect(f"/ws/sessions/{session_id}?token={token}") as websocket:
        response = client.post(
            "/turns",
            json={"session_id": session_id, **payload},
            headers=auth_headers,
        )
        assert response.status_code == 202
        messages = receive_until_turn_event(websocket, terminal_event)
    return response.json(), messages[-1]["data"], messages
