from __future__ import annotations

from typing import Any


def _choice_index(choice_id: str) -> int | None:
    if not choice_id.startswith("choice_"):
        return None
    try:
        index = int(choice_id.removeprefix("choice_")) - 1
    except ValueError:
        return None
    return index if index >= 0 else None


def _action_text(label: str, summary: str | None = None) -> str:
    label = label.strip()
    summary = (summary or "").strip()
    if summary and summary != label:
        return f"{label}。{summary}"
    return label


def public_turn_request_payload(
    client,
    *,
    session_id: str,
    auth_headers: dict[str, str],
    payload: dict[str, Any],
) -> dict[str, str]:
    if payload.get("player_action_text"):
        return {"player_action_text": str(payload["player_action_text"]).strip()}
    if payload.get("input_text"):
        return {"player_action_text": str(payload["input_text"]).strip()}

    state_response = client.get(f"/sessions/{session_id}/state", headers=auth_headers)
    state = state_response.json() if state_response.status_code == 200 else {}
    if payload.get("choice_id"):
        actions = state.get("suggested_actions") or state.get("next_choices") or []
        index = _choice_index(str(payload["choice_id"]))
        if index is not None and index < len(actions) and isinstance(actions[index], dict):
            action = actions[index]
            return {"player_action_text": _action_text(str(action.get("label") or ""), str(action.get("summary") or ""))}

    action_type = str(payload.get("action_type") or "").strip()
    if action_type in {"accept_quest", "decline_quest", "ignore_quest"}:
        assignment_id = str(payload.get("quest_assignment_id") or "")
        quest = next(
            (
                item
                for item in state.get("quests") or []
                if isinstance(item, dict) and str(item.get("assignment_id") or "") == assignment_id
            ),
            None,
        )
        title = str((quest or {}).get("title") or "提示された依頼").strip()
        labels = {
            "accept_quest": f"「{title}」を引き受ける",
            "decline_quest": f"「{title}」を断る",
            "ignore_quest": f"「{title}」はいったん保留し、今の場面を続ける",
        }
        return {"player_action_text": labels[action_type]}
    if action_type == "use_reward_item":
        item_id = str(payload.get("item_id") or "")
        item = next(
            (
                candidate
                for candidate in state.get("inventory") or []
                if isinstance(candidate, dict)
                and str(candidate.get("item_id") or candidate.get("id") or "") == item_id
            ),
            None,
        )
        item_name = str((item or {}).get("name") or "手持ちの品").strip()
        return {"player_action_text": f"{item_name}を使う"}

    return {"player_action_text": "場の変化を確かめる"}


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
        request_payload = public_turn_request_payload(
            client,
            session_id=session_id,
            auth_headers=auth_headers,
            payload=payload,
        )
        response = client.post(
            "/turns",
            json={"session_id": session_id, **request_payload},
            headers=auth_headers,
        )
        assert response.status_code == 202
        messages = receive_until_turn_event(websocket, terminal_event)
    return response.json(), messages[-1]["data"], messages
