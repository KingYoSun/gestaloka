from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import ensure_primary_runtime, get_container, get_current_user, get_db
from app.core.container import AppContainer
from app.core.realtime import realtime_hub, with_world_context
from app.models.entities import Session as GameSession
from app.modules.identity.oidc import UserIdentity
from app.modules.session.service import prepare_turn_for_session, resolve_turn_for_session
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
    session_id: str = Field(min_length=1, max_length=36)
    input_mode: Literal["choice", "free_text"] = "choice"
    choice_id: Literal["safe", "progress", "explore"] | None = None
    input_text: str | None = Field(default=None, min_length=1, max_length=2000)
    action_type: Literal["narrative", "use_reward_item"] | None = None
    item_id: str | None = Field(default=None, min_length=1, max_length=36)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_payload(cls, payload: object) -> object:
        if not isinstance(payload, dict):
            return payload
        normalized = dict(payload)
        action_type = normalized.get("action_type")
        if normalized.get("input_text") and not normalized.get("choice_id") and "input_mode" not in normalized:
            normalized["input_mode"] = "free_text"
        if action_type == "narrative" and normalized.get("input_text") and not normalized.get("choice_id"):
            normalized["input_mode"] = "free_text"
        elif action_type == "use_reward_item":
            normalized["input_mode"] = "choice"
        return normalized

    @model_validator(mode="after")
    def validate_action_payload(self) -> "ResolveTurnRequest":
        if self.action_type == "use_reward_item" and not self.item_id:
            raise ValueError("item_id is required for use_reward_item turns")
        if self.action_type == "narrative" and self.input_mode != "free_text":
            self.input_mode = "free_text"
        if self.action_type != "use_reward_item" and self.input_mode == "choice" and not self.choice_id:
            raise ValueError("choice_id is required for choice turns")
        if self.action_type != "use_reward_item" and self.input_mode == "free_text" and not self.input_text:
            raise ValueError("input_text is required for free_text turns")
        if self.action_type == "use_reward_item" and self.choice_id is not None:
            self.choice_id = None
        if self.action_type == "use_reward_item" and self.input_text is None:
            self.input_text = f"[use_reward_item:{self.item_id}]"
        return self


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


@router.post("/turns")
async def resolve_turn(
    payload: ResolveTurnRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict:
    ensure_primary_runtime(container)
    prepared_input_mode = "choice" if payload.action_type == "use_reward_item" else payload.input_mode
    game_session = db.execute(select(GameSession).where(GameSession.id == payload.session_id)).scalar_one_or_none()
    if game_session is not None:
        try:
            world_health(db, container.pack_registry, game_session.world_id)
        except WorldAvailabilityError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.diagnostic()) from exc
    try:
        prepared = prepare_turn_for_session(db, container, user, payload.session_id, input_mode=prepared_input_mode)
    except HTTPException as exc:
        if exc.status_code == 409 and isinstance(exc.detail, dict):
            world_context = _world_context_for_session_id(db, payload.session_id)
            detail = exc.detail if world_context is None else with_world_context(exc.detail, world_context)
            return JSONResponse(status_code=409, content=detail)
        raise
    world_context = world_context_for_world(db, prepared.session.world_id)

    await realtime_hub.emit_with_world_context(
        payload.session_id,
        "turn.accepted",
        {"session_id": payload.session_id},
        world_context,
    )

    started_at = container.observability_service.timer()
    result = resolve_turn_for_session(
        db,
        container,
        prepared,
        action_type=payload.action_type,
        input_mode=prepared_input_mode,
        choice_id=payload.choice_id,
        input_text=payload.input_text,
        item_id=payload.item_id,
    )
    for phase in result.progress_phases:
        await realtime_hub.emit_with_world_context(payload.session_id, "turn.progress", {"phase": phase}, world_context)
    container.observability_service.record_turn_resolution(
        duration_seconds=container.observability_service.elapsed(started_at),
        world_id=result.turn.world_id,
        pack_id=str(world_context["pack_id"]),
        world_template_id=str(world_context["world_template_id"]),
        session_id=result.turn.session_id,
        turn_id=result.turn.id,
        final_lane=result.turn.model_lane,
        graph_context_status=result.graph_context_status,
    )
    db.commit()

    if result.succeeded:
        await realtime_hub.emit_with_world_context(
            payload.session_id,
            "turn.narrative.delta",
            {"delta": result.turn.resolved_output.get("narrative", ""), "final": True},
            world_context,
        )

    await realtime_hub.emit_with_world_context(payload.session_id, "world.event.created", result.event_payload, world_context)
    if result.memories_payload:
        await realtime_hub.emit_with_world_context(
            payload.session_id,
            "memory.materialized",
            {"memories": result.memories_payload},
            world_context,
        )
    if result.quest_updates:
        await realtime_hub.emit_with_world_context(payload.session_id, "quest.updated", {"items": result.quest_updates}, world_context)
    if result.faction_updates:
        await realtime_hub.emit_with_world_context(
            payload.session_id,
            "faction.standing.updated",
            {"items": result.faction_updates},
            world_context,
        )
    if result.inventory_updates:
        await realtime_hub.emit_with_world_context(
            payload.session_id,
            "inventory.changed",
            {"items": result.inventory_updates},
            world_context,
        )
    if result.location_updates:
        await realtime_hub.emit_with_world_context(
            payload.session_id,
            "location.updated",
            {"items": result.location_updates},
            world_context,
        )
    if result.relationship_updates:
        await realtime_hub.emit_with_world_context(
            payload.session_id,
            "relationship.updated",
            {"items": result.relationship_updates},
            world_context,
        )
    if result.consequence_updates:
        await realtime_hub.emit_with_world_context(
            payload.session_id,
            "consequence.updated",
            {"items": result.consequence_updates},
            world_context,
        )
    if result.scene_updates:
        await realtime_hub.emit_with_world_context(payload.session_id, "scene.updated", {"items": result.scene_updates}, world_context)
    if result.chapter_updates:
        await realtime_hub.emit_with_world_context(
            payload.session_id,
            "chapter.updated",
            {"items": result.chapter_updates},
            world_context,
        )
    if result.branch_updates:
        await realtime_hub.emit_with_world_context(
            payload.session_id,
            "branch.updated",
            {"items": result.branch_updates},
            world_context,
        )
    if result.ambient_updates:
        await realtime_hub.emit_with_world_context(
            payload.session_id,
            "ambient.updated",
            {"items": result.ambient_updates, "recent_world_beats": result.recent_world_beats},
            world_context,
        )

    processed = container.projection_service.process_pending(db)
    db.commit()

    projection_summary = container.projection_service.summarize_records(processed, world_id=result.event.world_id)
    await realtime_hub.emit_with_world_context(
        payload.session_id,
        "graph.projection.updated",
        {
            "records": processed,
            "world_id": projection_summary["world_id"],
            "vertex_count": projection_summary["vertex_count"],
            "edge_count": projection_summary["edge_count"],
        },
        world_context,
    )

    if not result.succeeded:
        shared_response = _shared_consequence_response(result.turn.resolved_output or {})
        return JSONResponse(
            status_code=result.status_code,
            content={
                "detail": result.error_detail,
                "turn_id": result.turn.id,
                "event_id": result.event.id,
                "memory_ids": [],
                "sp_delta": result.sp_delta,
                "sp_balance": result.sp_balance,
                "sp_ledger_id": result.sp_ledger_id,
                "quest_updates": [],
                "faction_updates": [],
                "inventory_updates": [],
                "location_updates": [],
                "relationship_updates": [],
                "consequence_updates": [],
                "scene_updates": [],
                "chapter_updates": [],
                "branch_updates": [],
                "ambient_updates": [],
                "action_type": result.action_type,
                "input_mode": result.input_mode,
                "interpreted_intent": result.interpreted_intent,
                "next_choices": result.next_choices,
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
            },
        )

    shared_response = _shared_consequence_response(result.turn.resolved_output or {})
    response = {
        "turn_id": result.turn.id,
        "action_type": result.action_type,
        "input_mode": result.input_mode,
        "event_id": result.event.id,
        "memory_ids": result.memory_ids,
        "narrative": result.turn.resolved_output.get("narrative", ""),
        "npc_reaction": result.turn.resolved_output.get("npc_reaction", ""),
        "sp_delta": result.sp_delta,
        "sp_balance": result.sp_balance,
        "sp_ledger_id": result.sp_ledger_id,
        "interpreted_intent": result.interpreted_intent,
        "next_choices": result.next_choices,
        "consequence_summary": result.consequence_summary,
        "scene_tone": result.scene_tone,
        "quest_updates": result.quest_updates,
        "faction_updates": result.faction_updates,
        "inventory_updates": result.inventory_updates,
        "location_updates": result.location_updates,
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
    await realtime_hub.emit_with_world_context(payload.session_id, "turn.resolved", response, world_context)

    return response
