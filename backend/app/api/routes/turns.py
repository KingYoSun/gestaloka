from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.api.deps import ensure_primary_runtime, get_container, get_current_user, get_db
from app.core.container import AppContainer
from app.core.realtime import realtime_hub
from app.modules.identity.oidc import UserIdentity
from app.modules.session.service import prepare_turn_for_session, resolve_turn_for_session

router = APIRouter(tags=["turns"])


class ResolveTurnRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=36)
    action_type: Literal["narrative", "use_reward_item"] = "narrative"
    input_text: str | None = Field(default=None, min_length=1, max_length=2000)
    item_id: str | None = Field(default=None, min_length=1, max_length=36)

    @model_validator(mode="after")
    def validate_action_payload(self) -> "ResolveTurnRequest":
        if self.action_type == "narrative" and not self.input_text:
            raise ValueError("input_text is required for narrative turns")
        if self.action_type == "use_reward_item" and not self.item_id:
            raise ValueError("item_id is required for use_reward_item turns")
        return self


@router.post("/turns")
async def resolve_turn(
    payload: ResolveTurnRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict:
    ensure_primary_runtime(container)
    try:
        prepared = prepare_turn_for_session(db, container, user, payload.session_id)
    except HTTPException as exc:
        if exc.status_code == 409 and isinstance(exc.detail, dict):
            return JSONResponse(status_code=409, content=exc.detail)
        raise

    await realtime_hub.emit(payload.session_id, "turn.accepted", {"session_id": payload.session_id})
    phases = (
        (
            "memory_council",
            "npc_council",
            "world_progress",
            "rules_arbiter",
            "safety_guard",
            "narrative",
        )
        if payload.action_type == "narrative"
        else ("item_use",)
    )
    for phase in phases:
        await realtime_hub.emit(payload.session_id, "turn.progress", {"phase": phase})

    started_at = container.observability_service.timer()
    result = resolve_turn_for_session(
        db,
        container,
        prepared,
        action_type=payload.action_type,
        input_text=payload.input_text,
        item_id=payload.item_id,
    )
    container.observability_service.record_turn_resolution(
        duration_seconds=container.observability_service.elapsed(started_at),
        world_id=result.turn.world_id,
        session_id=result.turn.session_id,
        turn_id=result.turn.id,
        final_lane=result.turn.model_lane,
        graph_context_status=result.graph_context_status,
    )
    db.commit()

    if result.succeeded:
        await realtime_hub.emit(
            payload.session_id,
            "turn.narrative.delta",
            {"delta": result.turn.resolved_output.get("narrative", ""), "final": True},
        )

    await realtime_hub.emit(payload.session_id, "world.event.created", result.event_payload)
    if result.memories_payload:
        await realtime_hub.emit(payload.session_id, "memory.materialized", {"memories": result.memories_payload})
    if result.quest_updates:
        await realtime_hub.emit(payload.session_id, "quest.updated", {"items": result.quest_updates})
    if result.faction_updates:
        await realtime_hub.emit(payload.session_id, "faction.standing.updated", {"items": result.faction_updates})
    if result.inventory_updates:
        await realtime_hub.emit(payload.session_id, "inventory.changed", {"items": result.inventory_updates})

    processed = container.projection_service.process_pending(db)
    db.commit()

    projection_summary = container.projection_service.summarize_records(processed, world_id=result.event.world_id)
    await realtime_hub.emit(
        payload.session_id,
        "graph.projection.updated",
        {
            "records": processed,
            "world_id": projection_summary["world_id"],
            "vertex_count": projection_summary["vertex_count"],
            "edge_count": projection_summary["edge_count"],
        },
    )

    if not result.succeeded:
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
                "action_type": result.action_type,
            },
        )

    response = {
        "turn_id": result.turn.id,
        "action_type": result.action_type,
        "event_id": result.event.id,
        "memory_ids": result.memory_ids,
        "narrative": result.turn.resolved_output.get("narrative", ""),
        "npc_reaction": result.turn.resolved_output.get("npc_reaction", ""),
        "sp_delta": result.sp_delta,
        "sp_balance": result.sp_balance,
        "sp_ledger_id": result.sp_ledger_id,
        "quest_updates": result.quest_updates,
        "faction_updates": result.faction_updates,
        "inventory_updates": result.inventory_updates,
    }
    await realtime_hub.emit(payload.session_id, "turn.resolved", response)

    return response
