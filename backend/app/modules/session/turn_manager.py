from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.exc import OperationalError
from starlette.concurrency import run_in_threadpool

from app.core.container import AppContainer
from app.core.realtime import realtime_hub
from app.models.entities import TurnResolutionJob
from app.modules.session.progress import bind_turn_progress
from app.modules.session.service import load_prepared_turn_context_for_job, resolve_turn_for_session


@dataclass
class ManagedTurnResolution:
    result: Any | None
    emitted_phases: set[str] = field(default_factory=set)
    error: dict[str, object] | None = None


class TurnResolutionManager:
    """Coordinates turn resolution work and player-facing progress delivery."""

    heartbeat_interval_seconds = 5.0
    provisional_after_seconds = 30.0
    retryable_sqlstates = {"40001", "40P01"}
    max_resolution_attempts = 3

    def __init__(
        self,
        *,
        container: AppContainer,
        turn_id: str,
        session_id: str,
        world_id: str,
        user_sub: str,
        action_type: str | None,
        input_mode: str,
        choice_id: str | None,
        input_text: str | None,
        item_id: str | None,
        quest_assignment_id: str | None,
        world_context: dict[str, object],
    ) -> None:
        self.container = container
        self.turn_id = turn_id
        self.session_id = session_id
        self.world_id = world_id
        self.user_sub = user_sub
        self.action_type = action_type
        self.input_mode = input_mode
        self.choice_id = choice_id
        self.input_text = input_text
        self.item_id = item_id
        self.quest_assignment_id = quest_assignment_id
        self.world_context = world_context

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
                payload = {
                    "phase": latest_phase,
                    "status": "heartbeat",
                }
            payload = self._normalize_progress_payload(payload, started_at, loop.time())
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
                        "turn_id": self.turn_id,
                        "message": "解決を継続しています。世界状態の確認と応答生成を進めています。",
                        "canonical": False,
                        "elapsed_ms": int(elapsed_seconds * 1000),
                    },
                    self.world_context,
                )

        try:
            result = await work_task
        except Exception as exc:
            error = {
                "detail": "Turn resolution background job failed",
                "error_type": type(exc).__name__,
                "error": str(exc),
            }
            return ManagedTurnResolution(result=None, emitted_phases=emitted_phases, error=error)
        return ManagedTurnResolution(result=result, emitted_phases=emitted_phases)

    def _resolve_work(self, progress_callback) -> Any:
        for attempt in range(1, self.max_resolution_attempts + 1):
            db = self.container.session_factory()
            try:
                return self._resolve_work_once(db, progress_callback)
            except Exception as exc:
                db.rollback()
                if self._is_retryable_db_error(exc) and attempt < self.max_resolution_attempts:
                    self._mark_job_retrying(db, exc, attempt)
                    db.close()
                    time.sleep(0.25 * attempt)
                    continue
                self._mark_job_failed(db, exc)
                raise
            finally:
                if db.is_active:
                    db.close()
        raise RuntimeError(f"Turn resolution exhausted retry attempts: {self.turn_id}")

    def _resolve_work_once(self, db, progress_callback) -> Any:
        started_at = self.container.observability_service.timer()
        job = db.get(TurnResolutionJob, self.turn_id)
        if job is None:
            raise LookupError(f"Turn resolution job not found: {self.turn_id}")
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        db.commit()

        prepared = load_prepared_turn_context_for_job(
            db,
            self.container,
            session_id=self.session_id,
            user_sub=self.user_sub,
            turn_id=self.turn_id,
            input_mode=self.input_mode,
        )
        with bind_turn_progress(progress_callback):
            result = resolve_turn_for_session(
                db,
                self.container,
                prepared,
                action_type=self.action_type,  # type: ignore[arg-type]
                input_mode=self.input_mode,
                choice_id=self.choice_id,  # type: ignore[arg-type]
                input_text=self.input_text,
                item_id=self.item_id,
                quest_assignment_id=self.quest_assignment_id,
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
        job = db.get(TurnResolutionJob, self.turn_id)
        if job is not None:
            job.status = "resolved" if result.succeeded else "failed"
            job.result_payload = {
                "turn_id": result.turn.id,
                "event_id": result.event.id,
                "status_code": result.status_code,
                "succeeded": result.succeeded,
                "graph_context_status": result.graph_context_status,
            }
            if not result.succeeded:
                job.error_payload = {
                    "detail": result.error_detail,
                    "failure": result.failure or {},
                }
            job.completed_at = datetime.now(timezone.utc)
        db.commit()
        return result

    def _is_retryable_db_error(self, exc: Exception) -> bool:
        if not isinstance(exc, OperationalError):
            return False
        sqlstate = str(getattr(exc.orig, "sqlstate", "") or getattr(exc.orig, "pgcode", ""))
        return sqlstate in self.retryable_sqlstates

    def _mark_job_retrying(self, db, exc: Exception, attempt: int) -> None:
        job = db.get(TurnResolutionJob, self.turn_id)
        if job is None:
            return
        job.status = "retrying"
        job.error_payload = {
            "detail": "Turn resolution background job retrying",
            "attempt": attempt,
            "error_type": type(exc).__name__,
            "error": str(exc),
        }
        db.commit()

    def _mark_job_failed(self, db, exc: Exception) -> None:
        job = db.get(TurnResolutionJob, self.turn_id)
        if job is None:
            return
        job.status = "failed"
        job.error_payload = {
            "detail": "Turn resolution background job failed",
            "error_type": type(exc).__name__,
            "error": str(exc),
        }
        job.completed_at = datetime.now(timezone.utc)
        db.commit()

    def _normalize_progress_payload(
        self,
        payload: dict[str, object],
        started_at: float,
        now: float,
    ) -> dict[str, object]:
        normalized = dict(payload)
        role_elapsed = normalized.get("elapsed_ms")
        normalized["turn_id"] = self.turn_id
        normalized["elapsed_ms"] = int((now - started_at) * 1000)
        if role_elapsed is not None and normalized.get("status") != "heartbeat":
            try:
                normalized["role_elapsed_ms"] = int(role_elapsed)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                pass
        return normalized
