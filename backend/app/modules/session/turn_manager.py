from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.container import AppContainer
from app.core.realtime import realtime_hub
from app.modules.session.progress import bind_turn_progress
from app.modules.session.service import PreparedTurnContext, resolve_turn_for_session


@dataclass
class ManagedTurnResolution:
    result: Any
    emitted_phases: set[str] = field(default_factory=set)


class TurnResolutionManager:
    """Coordinates turn resolution work and player-facing progress delivery."""

    heartbeat_interval_seconds = 5.0
    provisional_after_seconds = 30.0

    def __init__(
        self,
        *,
        db: Session,
        container: AppContainer,
        prepared: PreparedTurnContext,
        action_type: str | None,
        input_mode: str,
        choice_id: str | None,
        input_text: str | None,
        item_id: str | None,
        world_context: dict[str, object],
    ) -> None:
        self.db = db
        self.container = container
        self.prepared = prepared
        self.action_type = action_type
        self.input_mode = input_mode
        self.choice_id = choice_id
        self.input_text = input_text
        self.item_id = item_id
        self.world_context = world_context
        self.session_id = prepared.session.id

    async def resolve(self) -> ManagedTurnResolution:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        emitted_phases: set[str] = set()
        started_at = loop.time()
        provisional_sent = False
        latest_phase = "resolving"

        def enqueue_progress(payload: dict[str, object]) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, payload)

        work_task = asyncio.create_task(run_in_threadpool(self._resolve_work, enqueue_progress))

        while True:
            if work_task.done() and queue.empty():
                break
            timeout = self.heartbeat_interval_seconds
            try:
                payload = await asyncio.wait_for(queue.get(), timeout=timeout)
            except asyncio.TimeoutError:
                elapsed_ms = int((loop.time() - started_at) * 1000)
                payload = {
                    "phase": latest_phase,
                    "status": "heartbeat",
                    "elapsed_ms": elapsed_ms,
                }
            phase = str(payload.get("phase") or latest_phase)
            latest_phase = phase
            if payload.get("status") != "heartbeat":
                emitted_phases.add(phase)
            await realtime_hub.emit_with_world_context(
                self.session_id,
                "turn.progress",
                payload,
                self.world_context,
            )
            elapsed_seconds = loop.time() - started_at
            if not provisional_sent and elapsed_seconds >= self.provisional_after_seconds:
                provisional_sent = True
                await realtime_hub.emit_with_world_context(
                    self.session_id,
                    "turn.provisional",
                    {
                        "message": "解決を継続しています。世界状態の確認と応答生成を進めています。",
                        "canonical": False,
                        "elapsed_ms": int(elapsed_seconds * 1000),
                    },
                    self.world_context,
                )

        result = await work_task
        return ManagedTurnResolution(result=result, emitted_phases=emitted_phases)

    def _resolve_work(self, progress_callback) -> Any:
        started_at = self.container.observability_service.timer()
        with bind_turn_progress(progress_callback):
            result = resolve_turn_for_session(
                self.db,
                self.container,
                self.prepared,
                action_type=self.action_type,  # type: ignore[arg-type]
                input_mode=self.input_mode,
                choice_id=self.choice_id,  # type: ignore[arg-type]
                input_text=self.input_text,
                item_id=self.item_id,
            )
        self.container.observability_service.record_turn_resolution(
            duration_seconds=self.container.observability_service.elapsed(started_at),
            world_id=result.turn.world_id,
            pack_id=str(self.world_context["pack_id"]),
            world_template_id=str(self.world_context["world_template_id"]),
            session_id=result.turn.session_id,
            turn_id=result.turn.id,
            final_lane=result.turn.model_lane,
            graph_context_status=result.graph_context_status,
        )
        self.db.commit()
        return result
