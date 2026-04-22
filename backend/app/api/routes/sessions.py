from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import ensure_primary_runtime, get_container, get_current_user, get_db
from app.core.container import AppContainer
from app.modules.identity.oidc import UserIdentity
from app.modules.session.service import create_session_for_user, get_session_state_for_user

router = APIRouter(tags=["sessions"])


class CreateSessionRequest(BaseModel):
    world_id: str = Field(min_length=1, max_length=64)
    world_name: str = Field(default="Founders Reach", min_length=1, max_length=120)
    player_display_name: str | None = Field(default=None, max_length=120)


@router.post("/sessions")
def create_session(
    payload: CreateSessionRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, str]:
    ensure_primary_runtime(container)
    result = create_session_for_user(db, container, user, payload.world_id, payload.world_name, payload.player_display_name)
    container.projection_service.process_pending(db)
    db.commit()
    return {
        "session_id": result.session.id,
        "world_id": result.world.id,
        "player_actor_id": result.player_actor.id,
        "npc_actor_id": result.guide_npc.id,
        "location_id": result.starter_location.id,
        "websocket_url": result.websocket_url,
    }


@router.get("/sessions/{session_id}/state")
def get_session_state(
    session_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
) -> dict:
    return get_session_state_for_user(db, user=user, session_id=session_id)
