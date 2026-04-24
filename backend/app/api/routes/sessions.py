from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import ensure_primary_runtime, get_container, get_current_user, get_db
from app.core.container import AppContainer
from app.modules.identity.oidc import UserIdentity
from app.modules.session.service import create_session_for_user, get_session_state_for_user
from app.modules.world_pack.service import world_context_for_world

router = APIRouter(tags=["sessions"])


class CreateSessionRequest(BaseModel):
    world_id: str = Field(min_length=1, max_length=64)
    pack_id: str = Field(min_length=1, max_length=120)
    world_template_id: str = Field(min_length=1, max_length=120)
    world_name: str | None = Field(default=None, min_length=1, max_length=120)
    player_display_name: str | None = Field(default=None, max_length=120)
    world_overrides: dict[str, Any] = Field(default_factory=dict)


@router.post("/sessions")
def create_session(
    payload: CreateSessionRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, object]:
    ensure_primary_runtime(container)
    requested_world_name = str(payload.world_overrides.get("world_name") or payload.world_name or "").strip() or None
    try:
        result = create_session_for_user(
            db,
            container,
            user,
            payload.world_id,
            pack_id=payload.pack_id,
            world_template_id=payload.world_template_id,
            world_name=requested_world_name,
            player_display_name=payload.player_display_name,
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    container.projection_service.process_pending(db)
    world_context = world_context_for_world(db, result.world.id)
    db.commit()
    world_state = dict(result.world.state or {})
    return {
        "session_id": result.session.id,
        "world_id": result.world.id,
        "world_name": result.world.name,
        "pack_id": str(world_state.get("pack_id") or payload.pack_id),
        "world_template_id": str(world_state.get("world_template_id") or payload.world_template_id),
        "player_actor_id": result.player_actor.id,
        "npc_actor_id": result.guide_npc.id,
        "location_id": result.starter_location.id,
        "websocket_url": result.websocket_url,
        "world_context": world_context,
    }


@router.get("/sessions/{session_id}/state")
def get_session_state(
    session_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
) -> dict:
    return get_session_state_for_user(db, user=user, session_id=session_id)
