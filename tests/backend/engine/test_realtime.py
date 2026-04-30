from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.core.realtime import RealtimeHub


class FakeWebSocket:
    def __init__(self, *, send_error: Exception | None = None) -> None:
        self.accepted = False
        self.send_error = send_error
        self.sent_payloads: list[dict[str, Any]] = []

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, payload: dict[str, Any]) -> None:
        if self.send_error is not None:
            raise self.send_error
        self.sent_payloads.append(payload)


def test_realtime_emit_drops_stale_websocket_and_continues_delivery():
    async def scenario() -> None:
        hub = RealtimeHub()
        stale = FakeWebSocket(
            send_error=RuntimeError(
                "Unexpected ASGI message 'websocket.send', "
                "after sending 'websocket.close' or response already completed."
            )
        )
        healthy = FakeWebSocket()

        await hub.connect("session-1", stale)  # type: ignore[arg-type]
        await hub.connect("session-1", healthy)  # type: ignore[arg-type]

        result = await hub.emit("session-1", "turn.resolved", {"turn_id": "turn-1"})

        assert result.attempted == 2
        assert result.delivered == 1
        assert result.dropped == 1
        assert hub.connection_count("session-1") == 1
        assert healthy.sent_payloads == [
            {"event": "turn.resolved", "data": {"turn_id": "turn-1"}},
        ]

    asyncio.run(scenario())


def test_realtime_emit_reraises_non_stale_send_errors():
    async def scenario() -> None:
        hub = RealtimeHub()
        broken = FakeWebSocket(send_error=RuntimeError("serialization broke"))
        await hub.connect("session-1", broken)  # type: ignore[arg-type]

        with pytest.raises(RuntimeError, match="serialization broke"):
            await hub.emit("session-1", "turn.resolved", {"turn_id": "turn-1"})

        assert hub.connection_count("session-1") == 1

    asyncio.run(scenario())
