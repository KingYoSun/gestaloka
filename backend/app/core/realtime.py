from __future__ import annotations

from collections import defaultdict
from typing import Any, Mapping

from fastapi import WebSocket


REQUIRED_WORLD_CONTEXT_KEYS = {
    "world_id",
    "world_name",
    "pack_id",
    "pack_display_name",
    "world_template_id",
    "world_template_display_name",
    "semantic_tags",
}


def with_world_context(data: Mapping[str, Any], world_context: Mapping[str, Any]) -> dict[str, Any]:
    missing = REQUIRED_WORLD_CONTEXT_KEYS - set(world_context)
    if missing:
        raise ValueError(f"Realtime world_context is missing required keys: {sorted(missing)}")
    return {**dict(data), "world_context": dict(world_context)}


class RealtimeHub:
    def __init__(self) -> None:
        self._connections: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[session_id].append(websocket)

    def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        connections = self._connections.get(session_id, [])
        if websocket in connections:
            connections.remove(websocket)
        if not connections and session_id in self._connections:
            del self._connections[session_id]

    async def emit(self, session_id: str, event: str, data: dict[str, Any]) -> None:
        payload = {"event": event, "data": data}
        for websocket in list(self._connections.get(session_id, [])):
            await websocket.send_json(payload)

    async def emit_with_world_context(
        self,
        session_id: str,
        event: str,
        data: Mapping[str, Any],
        world_context: Mapping[str, Any],
    ) -> None:
        await self.emit(session_id, event, with_world_context(data, world_context))


realtime_hub = RealtimeHub()
