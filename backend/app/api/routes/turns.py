from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_container, get_current_user, get_db
from app.core.container import AppContainer
from app.core.realtime import realtime_hub
from app.modules.identity.oidc import UserIdentity
from app.modules.session.service import resolve_turn_for_session

router = APIRouter(tags=["turns"])


class ResolveTurnRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=36)
    input_text: str = Field(min_length=1, max_length=2000)


@router.post("/turns")
async def resolve_turn(
    payload: ResolveTurnRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict:
    await realtime_hub.emit(payload.session_id, "turn.accepted", {"session_id": payload.session_id})
    await realtime_hub.emit(payload.session_id, "turn.progress", {"phase": "routing"})

    result = resolve_turn_for_session(db, container, user, payload.session_id, payload.input_text)
    db.commit()

    processed = container.projection_service.process_pending(db)
    db.commit()

    await realtime_hub.emit(payload.session_id, "world.event.created", result.event_payload)
    await realtime_hub.emit(payload.session_id, "memory.materialized", {"memories": result.memories_payload})
    if processed:
        await realtime_hub.emit(payload.session_id, "graph.projection.updated", {"records": processed})
    await realtime_hub.emit(
        payload.session_id,
        "turn.resolved",
        {
            "turn_id": result.turn.id,
            "narrative": result.turn.resolved_output["narrative"],
            "npc_reaction": result.turn.resolved_output["npc_reaction"],
        },
    )

    return {
        "turn_id": result.turn.id,
        "world_id": result.turn.world_id,
        "narrative": result.turn.resolved_output["narrative"],
        "npc_reaction": result.turn.resolved_output["npc_reaction"],
        "event": result.event_payload,
        "memories": result.memories_payload,
        "projection_records": processed,
    }
