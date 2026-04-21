from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_container, get_current_user, get_db
from app.core.container import AppContainer
from app.modules.identity.oidc import UserIdentity
from app.modules.session.service import create_session_for_user

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
    result = create_session_for_user(db, user, payload.world_id, payload.world_name, payload.player_display_name)
    db.commit()
    return {
        "session_id": result.session.id,
        "world_id": result.world.id,
        "world_name": result.world.name,
        "player_actor_id": result.player_actor.id,
        "guide_npc_id": result.guide_npc.id,
        "player_display_name": result.player_actor.display_name,
        "graph_backend": container.settings.graph_projection_backend,
    }
