from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import logging
from typing import Any, Mapping

from fastapi import WebSocket, WebSocketDisconnect


logger = logging.getLogger(__name__)


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

    async def emit(self, session_id: str, event: str, data: dict[str, Any]) -> "RealtimeEmitResult":
        payload = {"event": event, "data": data}
        attempted = 0
        delivered = 0
        dropped = 0
        for websocket in list(self._connections.get(session_id, [])):
            attempted += 1
            try:
                await websocket.send_json(payload)
                delivered += 1
            except Exception as exc:
                if not is_stale_websocket_error(exc):
                    raise
                dropped += 1
                self.disconnect(session_id, websocket)
                logger.warning(
                    "realtime stale websocket dropped",
                    extra={
                        "session_id": session_id,
                        "event": event,
                        "error_type": type(exc).__name__,
                        "error": str(exc),
                    },
                )
        return RealtimeEmitResult(attempted=attempted, delivered=delivered, dropped=dropped)

    async def emit_with_world_context(
        self,
        session_id: str,
        event: str,
        data: Mapping[str, Any],
        world_context: Mapping[str, Any],
    ) -> "RealtimeEmitResult":
        return await self.emit(session_id, event, with_world_context(data, world_context))

    def connection_count(self, session_id: str) -> int:
        return len(self._connections.get(session_id, []))


@dataclass(frozen=True)
class RealtimeEmitResult:
    attempted: int
    delivered: int
    dropped: int


def is_stale_websocket_error(exc: Exception) -> bool:
    if isinstance(exc, WebSocketDisconnect):
        return True
    if type(exc).__name__ == "ClientDisconnected":
        return True
    if not isinstance(exc, RuntimeError):
        return False
    message = str(exc)
    return "websocket.send" in message and (
        "websocket.close" in message or "response already completed" in message
    )


realtime_hub = RealtimeHub()
