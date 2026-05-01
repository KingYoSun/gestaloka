from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import ensure_primary_runtime, get_container, get_current_user, get_db
from app.core.container import AppContainer
from app.models.entities import Event, Session as GameSession, Turn
from app.modules.actor.service import create_player_profile_for_user, get_player_profile_for_user, player_profile_to_dict
from app.modules.identity.oidc import UserIdentity
from app.modules.localization.service import localize_session_state, localize_turn_payload
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


def _session_for_user(db: Session, *, user: UserIdentity, session_id: str) -> tuple[GameSession, dict[str, Any]]:
    game_session = db.execute(select(GameSession).where(GameSession.id == session_id)).scalar_one_or_none()
    if game_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    player_row = get_player_profile_for_user(db, game_session.world_id, user.sub, game_session.player_actor_id)
    if player_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found for current user")
    actor, profile = player_row
    return game_session, player_profile_to_dict(actor, profile)


def _story_item(event: Event, turn: Turn | None) -> dict[str, object]:
    resolved_output = turn.resolved_output if turn is not None and isinstance(turn.resolved_output, dict) else {}
    payload = event.payload if isinstance(event.payload, dict) else {}
    return {
        "event_id": event.id,
        "turn_id": event.turn_id,
        "canonical_sequence": event.canonical_sequence,
        "occurred_at": event.occurred_at.isoformat(),
        "input_mode": str(resolved_output.get("input_mode") or payload.get("input_mode") or ""),
        "narrative": str(resolved_output.get("narrative") or event.narrative or ""),
        "reaction": str(resolved_output.get("npc_reaction") or ""),
        "consequence": str(resolved_output.get("consequence_summary") or payload.get("consequence_summary") or ""),
        "scene_summary": str(resolved_output.get("scene_summary") or payload.get("scene_summary") or ""),
    }


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


@router.get("/sessions/{session_id}/story")
def get_session_story(
    session_id: str,
    limit: int = Query(default=20, ge=1, le=50),
    before_sequence: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, object]:
    game_session, player_profile = _session_for_user(db, user=user, session_id=session_id)
    conditions = [
        Event.world_id == game_session.world_id,
        Event.session_id == game_session.id,
        Event.event_type == "player.turn.resolved",
        Event.canonical_sequence.is_not(None),
    ]
    if before_sequence is not None:
        conditions.append(Event.canonical_sequence < before_sequence)
    stmt = (
        select(Event, Turn)
        .join(Turn, (Turn.id == Event.turn_id) & (Turn.world_id == Event.world_id), isouter=True)
        .where(*conditions)
        .order_by(Event.canonical_sequence.desc(), Event.occurred_at.desc(), Event.id.desc())
        .limit(limit + 1)
    )
    rows = list(db.execute(stmt).all())
    page_rows = rows[:limit]
    ordered = list(reversed(page_rows))
    items = [_story_item(event, turn) for event, turn in ordered]
    cache_db = container.session_factory()
    try:
        for item in items:
            localized = localize_turn_payload(
                cache_db,
                container.model_router,
                {
                    "consequence_summary": item["consequence"],
                    "scene_summary": item["scene_summary"],
                },
                world_id=game_session.world_id,
                actor_id=str(player_profile.get("actor_id") or ""),
                play_language=dict(player_profile.get("play_language") or {}),
            )
            item["consequence"] = str(localized.get("consequence_summary") or item["consequence"])
            item["scene_summary"] = str(localized.get("scene_summary") or item["scene_summary"])
    finally:
        cache_db.close()
    next_before_sequence = min(
        (item["canonical_sequence"] for item in items if isinstance(item["canonical_sequence"], int)),
        default=None,
    )
    if len(rows) <= limit:
        next_before_sequence = None
    return {"items": items, "next_before_sequence": next_before_sequence}
