from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import ensure_primary_runtime, get_container, get_current_user, get_db
from app.core.container import AppContainer
from app.modules.actor.service import create_player_profile_for_user
from app.modules.identity.oidc import UserIdentity
from app.modules.localization.service import localize_session_state
from app.modules.session.service import create_session_for_user, get_session_state_for_user
from app.modules.world_pack.service import (
    WorldAvailabilityError,
    WorldPackError,
    ensure_requested_world_is_playable,
    world_context_for_world,
)
from app.modules.world_state.service import ensure_world

router = APIRouter(tags=["sessions"])


class CreateSessionRequest(BaseModel):
    world_id: str = Field(min_length=1, max_length=64)
    player_actor_id: str | None = Field(default=None, min_length=1, max_length=36)
    pack_id: str | None = Field(default=None, min_length=1, max_length=120)
    world_template_id: str | None = Field(default=None, min_length=1, max_length=120)
    world_name: str | None = Field(default=None, min_length=1, max_length=120)
    player_display_name: str | None = Field(default=None, min_length=1, max_length=40)
    world_overrides: dict[str, Any] = Field(default_factory=dict)


@router.post("/sessions")
def create_session(
    payload: CreateSessionRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, object]:
    ensure_primary_runtime(container)
    if container.pack_registry.status == "error":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "world_pack_catalog_unavailable",
                "message": "World pack catalog has no valid packs available",
                "failure_count": container.pack_registry.failure_count,
            },
        )
    requested_world_name = str(payload.world_overrides.get("world_name") or payload.world_name or "").strip() or None
    try:
        pack, template, _ = ensure_requested_world_is_playable(
            db,
            container.pack_registry,
            payload.world_id,
            requested_pack_id=payload.pack_id,
            requested_world_template_id=payload.world_template_id,
        )
        player_actor_id = payload.player_actor_id
        if player_actor_id is None:
            legacy_display_name = str(payload.player_display_name or "").strip()
            if not legacy_display_name:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="player_actor_id is required",
                )
            ensure_world(
                db,
                payload.world_id,
                pack_id=pack.manifest.pack_id,
                world_template_id=template.template_id,
                world_name=requested_world_name,
            )
            actor, _ = create_player_profile_for_user(
                db,
                world_id=payload.world_id,
                user_sub=user.sub,
                display_name=legacy_display_name,
            )
            player_actor_id = actor.id
        result = create_session_for_user(
            db,
            container,
            user,
            payload.world_id,
            pack_id=pack.manifest.pack_id,
            world_template_id=template.template_id,
            world_name=requested_world_name,
            player_actor_id=player_actor_id,
        )
        container.projection_service.process_pending(db, limit=8, world_id=result.world.id)
        world_context = world_context_for_world(db, result.world.id)
    except WorldAvailabilityError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.diagnostic()) from exc
    except WorldPackError as exc:
        db.rollback()
        status_code = status.HTTP_409_CONFLICT if exc.code == "world_pack_immutable" else status.HTTP_422_UNPROCESSABLE_CONTENT
        raise HTTPException(status_code=status_code, detail=exc.diagnostic()) from exc
    except KeyError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    db.commit()
    world_state = dict(result.world.state or {})
    return {
        "session_id": result.session.id,
        "world_id": result.world.id,
        "world_name": result.world.name,
        "pack_id": str(world_state.get("pack_id") or pack.manifest.pack_id),
        "world_template_id": str(world_state.get("world_template_id") or template.template_id),
        "player_actor_id": result.player_actor.id,
        "player_profile": result.player_profile,
        "npc_actor_id": result.guide_npc.id,
        "location_id": result.starter_location.id,
        "websocket_url": result.websocket_url,
        "world_context": world_context,
    }


@router.get("/sessions/{session_id}/state")
def get_session_state(
    session_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict:
    state = get_session_state_for_user(db, user=user, session_id=session_id)
    cache_db = container.session_factory()
    try:
        return localize_session_state(cache_db, container.model_router, state)
    finally:
        cache_db.close()
