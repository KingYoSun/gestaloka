from __future__ import annotations

import time
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Callable, Iterator


TurnProgressCallback = Callable[[dict[str, object]], None]

_turn_progress_callback: ContextVar[TurnProgressCallback | None] = ContextVar(
    "turn_progress_callback",
    default=None,
)


PROMPT_PHASES: dict[str, tuple[str, int]] = {
    "session.turn_resolution": ("ai_gm_turn", 1),
    "council.intent_interpreter": ("intent_interpretation", 1),
    "council.memory_manager": ("memory_council", 2),
    "council.npc_manager": ("npc_council", 3),
    "council.situation_mapper": ("situation_mapping", 4),
    "council.world_progress": ("world_progress", 5),
    "council.rules_arbiter": ("rules_arbiter", 6),
    "council.safety_guard": ("safety_guard", 7),
    "council.narrative": ("narrative", 8),
}


def phase_for_prompt(prompt_id: str) -> tuple[str, int | None]:
    phase, stage_index = PROMPT_PHASES.get(prompt_id, (prompt_id.replace(".", "_"), None))
    return phase, stage_index


@contextmanager
def bind_turn_progress(callback: TurnProgressCallback | None) -> Iterator[None]:
    token = _turn_progress_callback.set(callback)
    try:
        yield
    finally:
        _turn_progress_callback.reset(token)


def emit_turn_progress(
    *,
    phase: str,
    status: str,
    stage_index: int | None = None,
    elapsed_ms: int | None = None,
    detail: str | None = None,
) -> None:
    callback = _turn_progress_callback.get()
    if callback is None:
        return
    payload: dict[str, object] = {
        "phase": phase,
        "status": status,
        "elapsed_ms": int(elapsed_ms if elapsed_ms is not None else 0),
    }
    if stage_index is not None:
        payload["stage_index"] = stage_index
    if detail:
        payload["detail"] = detail
    callback(payload)


def emit_turn_event(event: str, data: dict[str, object]) -> None:
    callback = _turn_progress_callback.get()
    if callback is None:
        return
    callback({"event": event, "data": data})


def elapsed_ms_since(started_at: float) -> int:
    return max(int((time.perf_counter() - started_at) * 1000), 0)
