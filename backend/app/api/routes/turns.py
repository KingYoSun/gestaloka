from __future__ import annotations

import asyncio
import time
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import ensure_primary_runtime, get_container, get_current_user, get_db
from app.core.container import AppContainer
from app.core.realtime import realtime_hub, with_world_context
from app.models.entities import Event, Session as GameSession, Turn, TurnResolutionJob
from app.modules.actor.service import get_player_profile, normalize_play_language
from app.modules.identity.oidc import UserIdentity
from app.modules.localization.service import localize_turn_payload
from app.modules.session.service import prepare_turn_for_session
from app.modules.session.turn_manager import TurnResolutionManager
from app.modules.world_pack.service import WorldAvailabilityError, world_context_for_world, world_health

router = APIRouter(tags=["turns"])


EMPTY_SHARED_CONSEQUENCE_UPDATES = {
    "shared_action_tag": "none",
    "applied_rule_ids": [],
    "axis_updates": [],
    "faction_updates": [],
    "location_updates": [],
    "relationship_updates": [],
    "history_records": [],
    "title_progress": [],
    "memory_ids": [],
}


class ResolveTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(min_length=1, max_length=36)
    player_action_text: str = Field(min_length=1, max_length=2000)


def _world_context_for_session_id(db: Session, session_id: str) -> dict[str, object] | None:
    game_session = db.execute(select(GameSession).where(GameSession.id == session_id)).scalar_one_or_none()
    if game_session is None:
        return None
    return world_context_for_world(db, game_session.world_id)


def _shared_consequence_response(resolved_output: dict) -> dict[str, object]:
    shared_action_tag = str(resolved_output.get("shared_action_tag") or "none")
    raw_updates = resolved_output.get("shared_consequence_updates")
    updates = dict(raw_updates) if isinstance(raw_updates, dict) else dict(EMPTY_SHARED_CONSEQUENCE_UPDATES)
    updates["shared_action_tag"] = shared_action_tag
    return {
        "shared_action_tag": shared_action_tag,
        "shared_consequence_updates": updates,
    }


async def _emit_broadcast_available(result, world_context: dict[str, object]) -> None:
    event_payload = result.event_payload.get("payload") if isinstance(result.event_payload, dict) else {}
    if not isinstance(event_payload, dict):
        return
    broadcast = event_payload.get("world_broadcast_event")
    if not isinstance(broadcast, dict):
        return
    delivery_session_ids = [str(item) for item in broadcast.get("delivery_session_ids") or [] if str(item)]
    if not delivery_session_ids:
        return
    notification = {
        "semantic_key": broadcast.get("semantic_key"),
        "status": broadcast.get("status"),
        "affected_location_ids": broadcast.get("affected_location_ids") or [],
    }
    for session_id in delivery_session_ids:
        await realtime_hub.emit_with_world_context(session_id, "world.broadcast.available", notification, world_context)


def _failure_response_content(result, world_context: dict[str, object]) -> dict[str, object]:
    shared_response = _shared_consequence_response(result.turn.resolved_output or {})
    resolved_output = result.turn.resolved_output or {}
    failure = result.failure if isinstance(result.failure, dict) else resolved_output.get("failure")
    if not isinstance(failure, dict):
        failure = {
            "reason": result.error_detail,
            "rejection_role": resolved_output.get("rejection_role"),
            "final_lane": result.turn.model_lane,
            "used_fallback": bool(resolved_output.get("used_fallback", False)),
            "council_trace": resolved_output.get("council_trace", []),
        }
    return {
        "detail": result.error_detail,
        "system_message": resolved_output.get("system_message") or "アクションに失敗しました。SPは返却されました。",
        "failure": failure,
        "rejected_claims": resolved_output.get("rejected_claims", []),
        "normalization_warnings": resolved_output.get("normalization_warnings", []),
        "turn_id": result.turn.id,
        "event_id": result.event.id,
        "memory_ids": [],
        "sp_delta": result.sp_delta,
        "sp_balance": result.sp_balance,
        "paid_sp": result.paid_sp,
        "bonus_sp": result.bonus_sp,
        "sp_ledger_id": result.sp_ledger_id,
        "refund_ledger_id": resolved_output.get("refund_ledger_id") or failure.get("refund_ledger_id"),
        "quest_updates": [],
        "faction_updates": [],
        "inventory_updates": [],
        "knowledge_updates": [],
        "skill_updates": [],
        "trade_updates": [],
        "blocked_state_drafts": [],
        "location_updates": [],
        "relationship_updates": [],
        "consequence_updates": [],
        "scene_updates": [],
        "chapter_updates": [],
        "branch_updates": [],
        "ambient_updates": [],
        "player_action_text": result.turn.input_text,
        "interpreted_intent": result.interpreted_intent,
        "suggested_actions": result.next_choices,
        "consequence_summary": result.consequence_summary,
        "scene_tone": result.scene_tone,
        "scene_summary": result.scene_summary,
        "crossroads_summary": result.crossroads_summary,
        "current_location": result.current_location,
        "travel_summary": result.travel_summary,
        "recent_world_beats": result.recent_world_beats,
        "recent_offstage_beats": result.recent_offstage_beats,
        "idle_updates": result.idle_updates,
        "world_context": world_context,
        **shared_response,
    }


def _success_response_content(result, world_context: dict[str, object]) -> dict[str, object]:
    shared_response = _shared_consequence_response(result.turn.resolved_output or {})
    return {
        "turn_id": result.turn.id,
        "player_action_text": result.turn.input_text,
        "event_id": result.event.id,
        "memory_ids": result.memory_ids,
        "narrative": result.turn.resolved_output.get("narrative", ""),
        "npc_reaction": result.turn.resolved_output.get("npc_reaction", ""),
        "sp_delta": result.sp_delta,
        "sp_balance": result.sp_balance,
        "paid_sp": result.paid_sp,
        "bonus_sp": result.bonus_sp,
        "sp_ledger_id": result.sp_ledger_id,
        "interpreted_intent": result.interpreted_intent,
        "suggested_actions": result.next_choices,
        "consequence_summary": result.consequence_summary,
        "scene_tone": result.scene_tone,
        "quest_updates": result.quest_updates,
        "faction_updates": result.faction_updates,
        "inventory_updates": result.inventory_updates,
        "knowledge_updates": result.knowledge_updates,
        "skill_updates": result.skill_updates,
        "trade_updates": result.trade_updates,
        "blocked_state_drafts": result.blocked_state_drafts,
        "location_updates": result.location_updates,
        "entity_updates": result.turn.resolved_output.get("entity_updates", []),
        "relationship_updates": result.relationship_updates,
        "consequence_updates": result.consequence_updates,
        "scene_updates": result.scene_updates,
        "chapter_updates": result.chapter_updates,
        "branch_updates": result.branch_updates,
        "ambient_updates": result.ambient_updates,
        "scene_summary": result.scene_summary,
        "crossroads_summary": result.crossroads_summary,
        "current_location": result.current_location,
        "travel_summary": result.travel_summary,
        "recent_world_beats": result.recent_world_beats,
        "recent_offstage_beats": result.recent_offstage_beats,
        "idle_updates": result.idle_updates,
        "world_context": world_context,
        **shared_response,
    }


def _localize_turn_content(
    container: AppContainer,
    result,
    content: dict[str, object],
    *,
    generate_missing: bool = True,
) -> dict[str, object]:
    world_id = str(result.turn.world_id)
    actor_id = str(result.turn.actor_id or "")
    if not world_id or not actor_id:
        return content
    db = container.session_factory()
    try:
        profile_row = get_player_profile(db, world_id, actor_id)
        if profile_row is None:
            return content
        _, profile = profile_row
        play_language = normalize_play_language((profile.preferences or {}).get("play_language"))  # type: ignore[arg-type]
        localized = localize_turn_payload(
            db,
            container.model_router,
            dict(content),
            world_id=world_id,
            actor_id=actor_id,
            play_language=dict(play_language),
            generate_missing=generate_missing,
        )
        return localized
    finally:
        db.close()


def _persist_player_facing_turn_text(container: AppContainer, result, content: dict[str, object]) -> None:
    updates = {
        "narrative": str(content.get("narrative") or ""),
        "npc_reaction": str(content.get("npc_reaction") or ""),
        "consequence_summary": str(content.get("consequence_summary") or ""),
        "scene_summary": str(content.get("scene_summary") or ""),
    }
    if not any(updates.values()):
        return
    db = container.session_factory()
    try:
        turn = db.get(Turn, result.turn.id)
        if turn is not None and isinstance(turn.resolved_output, dict):
            turn.resolved_output = {**turn.resolved_output, **updates}
        event = db.get(Event, result.event.id)
        if event is not None and updates["narrative"]:
            event.narrative = updates["narrative"]
        db.commit()
        if isinstance(result.turn.resolved_output, dict):
            result.turn.resolved_output = {**result.turn.resolved_output, **updates}
        if updates["narrative"]:
            result.event.narrative = updates["narrative"]
    finally:
        db.close()


async def _emit_response_localization_progress(
    *,
    session_id: str,
    turn_id: str,
    world_context: dict[str, object],
    status: str,
    started_at: float | None = None,
) -> None:
    payload: dict[str, object] = {
        "turn_id": turn_id,
        "phase": "response_localization",
        "status": status,
        "elapsed_ms": 0,
    }
    if started_at is not None:
        elapsed_ms = max(int((time.perf_counter() - started_at) * 1000), 0)
        payload["elapsed_ms"] = elapsed_ms
        payload["role_elapsed_ms"] = elapsed_ms
    await realtime_hub.emit_with_world_context(session_id, "turn.progress", payload, world_context)


async def _emit_turn_result_events(result, world_context: dict[str, object], response_content: dict[str, object]) -> None:
    if result.succeeded:
        await realtime_hub.emit_with_world_context(
            result.turn.session_id,
            "turn.narrative.delta",
            {"turn_id": result.turn.id, "delta": response_content.get("narrative", ""), "final": True},
            world_context,
        )

        await realtime_hub.emit_with_world_context(result.turn.session_id, "world.event.created", result.event_payload, world_context)
        await _emit_broadcast_available(result, world_context)
    if result.memories_payload:
        await realtime_hub.emit_with_world_context(
            result.turn.session_id,
            "memory.materialized",
            {"turn_id": result.turn.id, "memories": result.memories_payload},
            world_context,
        )
    if result.quest_updates:
        await realtime_hub.emit_with_world_context(result.turn.session_id, "quest.updated", {"items": response_content.get("quest_updates", result.quest_updates)}, world_context)
    if result.faction_updates:
        await realtime_hub.emit_with_world_context(
            result.turn.session_id,
            "faction.standing.updated",
            {"items": response_content.get("faction_updates", result.faction_updates)},
            world_context,
        )
    if result.inventory_updates:
        await realtime_hub.emit_with_world_context(
            result.turn.session_id,
            "inventory.changed",
            {"items": response_content.get("inventory_updates", result.inventory_updates)},
            world_context,
        )
    if result.knowledge_updates:
        await realtime_hub.emit_with_world_context(
            result.turn.session_id,
            "knowledge.updated",
            {"items": response_content.get("knowledge_updates", result.knowledge_updates)},
            world_context,
        )
    if result.skill_updates:
        await realtime_hub.emit_with_world_context(
            result.turn.session_id,
            "skills.updated",
            {"items": response_content.get("skill_updates", result.skill_updates)},
            world_context,
        )
    if result.location_updates:
        await realtime_hub.emit_with_world_context(
            result.turn.session_id,
            "location.updated",
            {"items": response_content.get("location_updates", result.location_updates)},
            world_context,
        )
    if result.relationship_updates:
        await realtime_hub.emit_with_world_context(
            result.turn.session_id,
            "relationship.updated",
            {"items": response_content.get("relationship_updates", result.relationship_updates)},
            world_context,
        )
    if result.consequence_updates:
        await realtime_hub.emit_with_world_context(
            result.turn.session_id,
            "consequence.updated",
            {"items": response_content.get("consequence_updates", result.consequence_updates)},
            world_context,
        )
    if result.scene_updates:
        await realtime_hub.emit_with_world_context(result.turn.session_id, "scene.updated", {"items": response_content.get("scene_updates", result.scene_updates)}, world_context)
    if result.chapter_updates:
        await realtime_hub.emit_with_world_context(
            result.turn.session_id,
            "chapter.updated",
            {"items": response_content.get("chapter_updates", result.chapter_updates)},
            world_context,
        )
    if result.branch_updates:
        await realtime_hub.emit_with_world_context(
            result.turn.session_id,
            "branch.updated",
            {"items": response_content.get("branch_updates", result.branch_updates)},
            world_context,
        )
    if result.ambient_updates:
        await realtime_hub.emit_with_world_context(
            result.turn.session_id,
            "ambient.updated",
            {
                "items": response_content.get("ambient_updates", result.ambient_updates),
                "recent_world_beats": response_content.get("recent_world_beats", result.recent_world_beats),
            },
            world_context,
        )


async def _resolve_turn_background(
    *,
    container: AppContainer,
    turn_id: str,
    session_id: str,
    world_id: str,
    user_sub: str,
    player_action_text: str,
    world_context: dict[str, object],
) -> None:
    managed = await TurnResolutionManager(
        container=container,
        turn_id=turn_id,
        session_id=session_id,
        world_id=world_id,
        user_sub=user_sub,
        player_action_text=player_action_text,
        world_context=world_context,
    ).resolve()
    if managed.error is not None:
        await realtime_hub.emit_with_world_context(
            session_id,
            "turn.failed",
            {"turn_id": turn_id, "detail": managed.error.get("detail"), "failure": managed.error, "retryable": True},
            world_context,
        )
        return
    result = managed.result
    if result is None:
        await realtime_hub.emit_with_world_context(
            session_id,
            "turn.failed",
            {"turn_id": turn_id, "detail": "Turn resolution did not return a result", "failure": {}, "retryable": True},
            world_context,
        )
        return

    for phase in result.progress_phases:
        if phase in managed.emitted_phases:
            continue
        await realtime_hub.emit_with_world_context(
            session_id,
            "turn.progress",
            {"turn_id": turn_id, "phase": phase, "status": "completed", "elapsed_ms": 0},
            world_context,
        )

    if not result.succeeded:
        localization_started_at = time.perf_counter()
        await _emit_response_localization_progress(
            session_id=session_id,
            turn_id=turn_id,
            world_context=world_context,
            status="started",
        )
        failure_payload = _localize_turn_content(
            container,
            result,
            _failure_response_content(result, world_context),
            generate_missing=True,
        )
        await _emit_response_localization_progress(
            session_id=session_id,
            turn_id=turn_id,
            world_context=world_context,
            status="completed",
            started_at=localization_started_at,
        )
        _persist_player_facing_turn_text(container, result, failure_payload)
        await _emit_turn_result_events(result, world_context, failure_payload)
        await realtime_hub.emit_with_world_context(
            session_id,
            "turn.failed",
            {**failure_payload, "retryable": True},
            world_context,
        )
        return

    localization_started_at = time.perf_counter()
    await _emit_response_localization_progress(
        session_id=session_id,
        turn_id=turn_id,
        world_context=world_context,
        status="started",
    )
    success_payload = _localize_turn_content(
        container,
        result,
        _success_response_content(result, world_context),
        generate_missing=True,
    )
    await _emit_response_localization_progress(
        session_id=session_id,
        turn_id=turn_id,
        world_context=world_context,
        status="completed",
        started_at=localization_started_at,
    )
    _persist_player_facing_turn_text(container, result, success_payload)
    await _emit_turn_result_events(result, world_context, success_payload)
    await realtime_hub.emit_with_world_context(
        session_id,
        "turn.resolved",
        success_payload,
        world_context,
    )


@router.post("/turns")
async def resolve_turn(
    payload: ResolveTurnRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict:
    ensure_primary_runtime(container)
    game_session = db.execute(select(GameSession).where(GameSession.id == payload.session_id)).scalar_one_or_none()
    if game_session is not None:
        try:
            world_health(db, container.pack_registry, game_session.world_id)
        except WorldAvailabilityError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.diagnostic()) from exc
    try:
        prepared = prepare_turn_for_session(db, container, user, payload.session_id, input_mode="free_text")
    except HTTPException as exc:
        if exc.status_code == 409 and isinstance(exc.detail, dict):
            world_context = _world_context_for_session_id(db, payload.session_id)
            detail = exc.detail if world_context is None else with_world_context(exc.detail, world_context)
            return JSONResponse(status_code=409, content=detail)
        raise
    world_context = world_context_for_world(db, prepared.session.world_id)

    db.add(
        TurnResolutionJob(
            id=prepared.turn_id,
            turn_id=prepared.turn_id,
            session_id=prepared.session.id,
            world_id=prepared.session.world_id,
            user_sub=user.sub,
            request_payload={
                "player_action_text": payload.player_action_text,
            },
            status="accepted",
            result_payload={},
            error_payload={},
        )
    )
    db.commit()

    await realtime_hub.emit_with_world_context(
        payload.session_id,
        "turn.accepted",
        {"turn_id": prepared.turn_id, "session_id": payload.session_id},
        world_context,
    )

    asyncio.create_task(
        _resolve_turn_background(
            container=container,
            turn_id=prepared.turn_id,
            session_id=prepared.session.id,
            world_id=prepared.session.world_id,
            user_sub=user.sub,
            player_action_text=payload.player_action_text,
            world_context=world_context,
        )
    )

    return JSONResponse(
        status_code=202,
        content={
            "status": "accepted",
            "turn_id": prepared.turn_id,
            "session_id": prepared.session.id,
            "world_context": world_context,
        },
    )
