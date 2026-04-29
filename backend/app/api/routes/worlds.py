from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import Literal

from app.api.deps import get_container, get_current_user, get_db
from app.core.container import AppContainer
from app.modules.actor.service import (
    create_player_profile_for_user,
    get_player_profile_for_user,
    list_player_profiles_for_user,
    player_profile_to_dict,
    update_player_profile_for_user,
    user_has_world_membership,
)
from app.modules.event_log.service import list_world_events
from app.modules.identity.oidc import UserIdentity
from app.modules.world_pack.service import (
    WorldAvailabilityError,
    WorldPackError,
    ensure_requested_world_is_playable,
    playable_world_catalog,
    world_health,
)
from app.modules.world_memory.service import list_world_memories
from app.modules.world_state.service import ensure_world

router = APIRouter(prefix="/worlds", tags=["worlds"])


class NarrativePreferencesPayload(BaseModel):
    perspective: Literal["first_person", "third_person"] = "third_person"
    tone: Literal["lyrical", "logical"] = "lyrical"
    density: Literal["concise", "ornate"] = "concise"
    dialogue_style: Literal["dialogue_forward", "literary"] = "literary"


class PlayLanguagePayload(BaseModel):
    mode: Literal["preset", "custom"] = "preset"
    preset: Literal[
        "ja",
        "en",
        "zh-Hans",
        "zh-Hant",
        "ko",
        "es",
        "fr",
        "de",
        "pt-BR",
        "it",
        "id",
        "th",
        "vi",
        "ar",
        "hi",
    ] | None = "ja"
    custom: str = Field(default="", max_length=80)


class CreatePlayerProfileRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=40)
    gender: Literal["male", "female", "unspecified", "other"] = "unspecified"
    background: str = Field(default="", max_length=1200)
    free_text: str = Field(default="", max_length=2000)
    narrative_preferences: NarrativePreferencesPayload = Field(default_factory=NarrativePreferencesPayload)
    play_language: PlayLanguagePayload | None = None


class UpdatePlayerProfileRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=40)
    gender: Literal["male", "female", "unspecified", "other"] | None = None
    background: str | None = Field(default=None, max_length=1200)
    free_text: str | None = Field(default=None, max_length=2000)
    narrative_preferences: NarrativePreferencesPayload | None = None
    play_language: PlayLanguagePayload | None = None


def _ensure_membership(db: Session, world_id: str, user: UserIdentity) -> None:
    if not user_has_world_membership(db, world_id, user.sub):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World not found for current user")


def _ensure_world_is_playable(db: Session, container: AppContainer, world_id: str) -> tuple[object, object]:
    try:
        pack, template, _ = ensure_requested_world_is_playable(db, container.pack_registry, world_id)
        return pack, template
    except WorldAvailabilityError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.diagnostic()) from exc
    except WorldPackError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=exc.diagnostic()) from exc


def _ensure_playable_world_row(db: Session, container: AppContainer, world_id: str) -> None:
    try:
        pack, template = _ensure_world_is_playable(db, container, world_id)
        ensure_world(
            db,
            world_id,
            pack_id=pack.manifest.pack_id,
            world_template_id=template.template_id,
            world_name=None,
        )
    except WorldAvailabilityError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.diagnostic()) from exc
    except WorldPackError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=exc.diagnostic()) from exc


@router.get("/{world_id}/events")
def get_world_events(
    world_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, list[dict]]:
    _ensure_membership(db, world_id, user)
    return {"items": [event_to_dict(item) for item in list_world_events(db, world_id)]}


@router.get("/{world_id}/memories")
def get_world_memories(
    world_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, list[dict]]:
    _ensure_membership(db, world_id, user)
    return {"items": [memory_to_dict(item) for item in list_world_memories(db, world_id)]}


@router.get("/{world_id}/player-profiles")
def list_player_profiles(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, list[dict[str, object]]]:
    _ensure_world_is_playable(db, container, world_id)
    rows = list_player_profiles_for_user(db, world_id, user.sub)
    return {"items": [player_profile_to_dict(actor, profile) for actor, profile in rows]}


@router.post("/{world_id}/player-profiles")
def create_player_profile(
    world_id: str,
    payload: CreatePlayerProfileRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, object]:
    _ensure_playable_world_row(db, container, world_id)
    actor, profile = create_player_profile_for_user(
        db,
        world_id=world_id,
        user_sub=user.sub,
        display_name=payload.display_name,
        gender=payload.gender,
        background=payload.background,
        free_text=payload.free_text,
        narrative_preferences=payload.narrative_preferences.model_dump(),
        play_language=payload.play_language.model_dump() if payload.play_language else None,
    )
    db.commit()
    return player_profile_to_dict(actor, profile)


@router.patch("/{world_id}/player-profiles/{actor_id}")
def update_player_profile(
    world_id: str,
    actor_id: str,
    payload: UpdatePlayerProfileRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, object]:
    _ensure_playable_world_row(db, container, world_id)
    row = get_player_profile_for_user(db, world_id, user.sub, actor_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player profile not found")
    actor, profile = row
    locked_fields = {"display_name", "gender", "background", "free_text"}
    if profile.locked_at is not None and locked_fields.intersection(payload.model_fields_set):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Player profile identity is locked")
    updated = update_player_profile_for_user(
        db,
        world_id=world_id,
        user_sub=user.sub,
        actor_id=actor_id,
        display_name=payload.display_name,
        gender=payload.gender,
        background=payload.background,
        free_text=payload.free_text,
        narrative_preferences=payload.narrative_preferences.model_dump() if payload.narrative_preferences else None,
        play_language=payload.play_language.model_dump() if payload.play_language else None,
    )
    assert updated is not None
    db.commit()
    return player_profile_to_dict(*updated)


@router.get("/packs")
def list_world_packs(
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, object]:
    del user
    try:
        return container.pack_registry.public_catalog()
    except WorldPackError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=exc.diagnostic()) from exc


@router.get("/playable")
def list_playable_worlds(
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, object]:
    del user
    return playable_world_catalog(container.pack_registry)


@router.get("/{world_id}/health")
def get_world_health(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, object]:
    del user
    try:
        return world_health(db, container.pack_registry, world_id)
    except WorldAvailabilityError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.diagnostic()) from exc
    except WorldPackError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=exc.diagnostic()) from exc


def event_to_dict(item) -> dict:
    return {
        "id": item.id,
        "world_id": item.world_id,
        "event_type": item.event_type,
        "canonical_sequence": item.canonical_sequence,
        "canonical_status": item.canonical_status,
        "timeline_entry_id": item.timeline_entry_id,
        "narrative": item.narrative,
        "occurred_at": item.occurred_at.isoformat(),
        "location_id": item.location_id,
        "payload": item.payload,
    }


def memory_to_dict(item) -> dict:
    return {
        "id": item.id,
        "world_id": item.world_id,
        "scope": item.scope,
        "text": item.text,
        "salience": item.salience,
        "actor_id": item.actor_id,
        "location_id": item.location_id,
    }
