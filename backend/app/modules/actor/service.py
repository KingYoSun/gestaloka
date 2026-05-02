from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Mapping

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models.entities import Actor, NPCProfile, PlayerProfile, Relationship
from app.modules.world_pack.service import PackNPCSeed, resolve_world_pack

GENDER_VALUES = {"male", "female", "unspecified", "other"}
NARRATIVE_PREFERENCE_OPTIONS = {
    "perspective": {"first_person", "third_person"},
    "tone": {"lyrical", "logical"},
    "density": {"concise", "ornate"},
    "dialogue_style": {"dialogue_forward", "literary"},
}
DEFAULT_NARRATIVE_PREFERENCES = {
    "perspective": "third_person",
    "tone": "lyrical",
    "density": "concise",
    "dialogue_style": "literary",
}
PLAY_LANGUAGE_PRESETS = {
    "ja": "Japanese",
    "en": "English",
    "zh-Hans": "Simplified Chinese",
    "zh-Hant": "Traditional Chinese",
    "ko": "Korean",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "pt-BR": "Brazilian Portuguese",
    "it": "Italian",
    "id": "Indonesian",
    "th": "Thai",
    "vi": "Vietnamese",
    "ar": "Arabic",
    "hi": "Hindi",
}
DEFAULT_PLAY_LANGUAGE = {
    "mode": "preset",
    "preset": "ja",
    "custom": "",
    "prompt_name": PLAY_LANGUAGE_PRESETS["ja"],
}
ICON_IMAGE_DATA_URL_PATTERN = re.compile(r"^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$")
ICON_IMAGE_DATA_URL_MAX_LENGTH = 800_000


def _clean_play_language_custom(value: object) -> str:
    text = "".join(" " if ord(character) < 32 or ord(character) == 127 else character for character in str(value or ""))
    return re.sub(r"\s+", " ", text).strip()[:80]


def normalize_narrative_preferences(value: Mapping[str, object] | None) -> dict[str, str]:
    preferences = dict(DEFAULT_NARRATIVE_PREFERENCES)
    for key, allowed_values in NARRATIVE_PREFERENCE_OPTIONS.items():
        candidate = str((value or {}).get(key) or "").strip()
        if candidate in allowed_values:
            preferences[key] = candidate
    return preferences


def normalize_play_language(value: Mapping[str, object] | str | None) -> dict[str, str | None]:
    if isinstance(value, str):
        value = {"mode": "custom", "custom": value}
    raw = dict(value or {})
    mode = str(raw.get("mode") or "preset").strip()
    preset = str(raw.get("preset") or "").strip()
    custom = _clean_play_language_custom(raw.get("custom"))

    if mode == "custom" and custom:
        return {
            "mode": "custom",
            "preset": None,
            "custom": custom,
            "prompt_name": custom,
        }
    if preset in PLAY_LANGUAGE_PRESETS:
        return {
            "mode": "preset",
            "preset": preset,
            "custom": "",
            "prompt_name": PLAY_LANGUAGE_PRESETS[preset],
        }
    return dict(DEFAULT_PLAY_LANGUAGE)


def normalize_gender(value: str | None) -> str:
    candidate = str(value or "unspecified").strip()
    return candidate if candidate in GENDER_VALUES else "unspecified"


def normalize_icon_image_data_url(value: object) -> str:
    candidate = str(value or "").strip()
    if not candidate:
        return ""
    if len(candidate) > ICON_IMAGE_DATA_URL_MAX_LENGTH:
        raise ValueError("icon image data URL is too large")
    if not ICON_IMAGE_DATA_URL_PATTERN.fullmatch(candidate):
        raise ValueError("icon image data URL must be png, jpeg, or webp base64 data")
    return candidate


def get_player_actor_for_user(db: Session, world_id: str, user_sub: str) -> Actor | None:
    stmt: Select[tuple[Actor]] = select(Actor).where(
        Actor.world_id == world_id,
        Actor.user_sub == user_sub,
        Actor.actor_type == "player",
    )
    return db.execute(stmt.order_by(Actor.created_at.asc(), Actor.id.asc()).limit(1)).scalar_one_or_none()


def list_player_profiles_for_user(db: Session, world_id: str, user_sub: str) -> list[tuple[Actor, PlayerProfile]]:
    stmt = (
        select(Actor, PlayerProfile)
        .join(PlayerProfile, (PlayerProfile.actor_id == Actor.id) & (PlayerProfile.world_id == Actor.world_id))
        .where(Actor.world_id == world_id, Actor.user_sub == user_sub, Actor.actor_type == "player")
        .order_by(Actor.created_at.asc(), Actor.id.asc())
    )
    return list(db.execute(stmt).all())


def get_player_profile_for_user(db: Session, world_id: str, user_sub: str, actor_id: str) -> tuple[Actor, PlayerProfile] | None:
    stmt = (
        select(Actor, PlayerProfile)
        .join(PlayerProfile, (PlayerProfile.actor_id == Actor.id) & (PlayerProfile.world_id == Actor.world_id))
        .where(
            Actor.id == actor_id,
            Actor.world_id == world_id,
            Actor.user_sub == user_sub,
            Actor.actor_type == "player",
        )
    )
    return db.execute(stmt).one_or_none()


def get_player_profile(db: Session, world_id: str, actor_id: str) -> tuple[Actor, PlayerProfile] | None:
    stmt = (
        select(Actor, PlayerProfile)
        .join(PlayerProfile, (PlayerProfile.actor_id == Actor.id) & (PlayerProfile.world_id == Actor.world_id))
        .where(Actor.id == actor_id, Actor.world_id == world_id, Actor.actor_type == "player")
    )
    return db.execute(stmt).one_or_none()


def create_player_profile_for_user(
    db: Session,
    *,
    world_id: str,
    user_sub: str,
    display_name: str,
    gender: str = "unspecified",
    background: str = "",
    free_text: str = "",
    narrative_preferences: Mapping[str, object] | None = None,
    play_language: Mapping[str, object] | str | None = None,
    icon_image_data_url: str | None = None,
) -> tuple[Actor, PlayerProfile]:
    actor = Actor(
        world_id=world_id,
        current_location_id=None,
        actor_type="player",
        user_sub=user_sub,
        display_name=display_name.strip(),
    )
    db.add(actor)
    db.flush()
    profile = PlayerProfile(
        actor_id=actor.id,
        world_id=world_id,
        gender=normalize_gender(gender),
        background=background.strip(),
        free_text=free_text.strip(),
        narrative_preferences=normalize_narrative_preferences(narrative_preferences),
        preferences={
            "play_language": normalize_play_language(play_language),
            "icon_image_data_url": normalize_icon_image_data_url(icon_image_data_url),
        },
    )
    db.add(profile)
    db.flush()
    return actor, profile


def update_player_profile_for_user(
    db: Session,
    *,
    world_id: str,
    user_sub: str,
    actor_id: str,
    display_name: str | None = None,
    gender: str | None = None,
    background: str | None = None,
    free_text: str | None = None,
    narrative_preferences: Mapping[str, object] | None = None,
    play_language: Mapping[str, object] | str | None = None,
    icon_image_data_url: str | None = None,
    update_icon_image_data_url: bool = False,
) -> tuple[Actor, PlayerProfile] | None:
    row = get_player_profile_for_user(db, world_id, user_sub, actor_id)
    if row is None:
        return None
    actor, profile = row
    profile.narrative_preferences = normalize_narrative_preferences(narrative_preferences or profile.narrative_preferences)
    preferences = dict(profile.preferences or {})
    if play_language is not None:
        preferences["play_language"] = normalize_play_language(play_language)
    elif "play_language" in preferences:
        preferences["play_language"] = normalize_play_language(preferences.get("play_language"))  # type: ignore[arg-type]
    else:
        preferences["play_language"] = normalize_play_language(None)
    if update_icon_image_data_url:
        preferences["icon_image_data_url"] = normalize_icon_image_data_url(icon_image_data_url)
    else:
        preferences["icon_image_data_url"] = normalize_icon_image_data_url(preferences.get("icon_image_data_url"))
    profile.preferences = preferences
    if profile.locked_at is None:
        if display_name is not None:
            actor.display_name = display_name.strip()
        if gender is not None:
            profile.gender = normalize_gender(gender)
        if background is not None:
            profile.background = background.strip()
        if free_text is not None:
            profile.free_text = free_text.strip()
    db.flush()
    return actor, profile


def ensure_player_actor(
    db: Session,
    world_id: str,
    user_sub: str,
    display_name: str,
    *,
    location_id: str | None = None,
) -> Actor:
    actor = get_player_actor_for_user(db, world_id, user_sub)
    if actor is not None:
        if location_id and actor.current_location_id != location_id:
            actor.current_location_id = location_id
            db.flush()
        return actor

    actor = Actor(
        world_id=world_id,
        current_location_id=location_id,
        actor_type="player",
        user_sub=user_sub,
        display_name=display_name,
    )
    db.add(actor)
    db.flush()
    db.add(
        PlayerProfile(
            actor_id=actor.id,
            world_id=world_id,
            gender="unspecified",
            background="",
            free_text="",
            narrative_preferences=dict(DEFAULT_NARRATIVE_PREFERENCES),
            preferences={"play_language": normalize_play_language(None)},
        )
    )
    db.flush()
    return actor


def lock_player_profile(profile: PlayerProfile) -> None:
    if profile.locked_at is None:
        profile.locked_at = datetime.now(timezone.utc)


def player_profile_to_dict(actor: Actor, profile: PlayerProfile) -> dict[str, object]:
    preferences = dict(profile.preferences or {})
    play_language = normalize_play_language(preferences.get("play_language"))  # type: ignore[arg-type]
    icon_image_data_url = normalize_icon_image_data_url(preferences.get("icon_image_data_url"))
    return {
        "actor_id": actor.id,
        "world_id": actor.world_id,
        "display_name": actor.display_name,
        "gender": profile.gender,
        "background": profile.background,
        "free_text": profile.free_text,
        "narrative_preferences": normalize_narrative_preferences(profile.narrative_preferences),
        "play_language": play_language,
        "icon_image_data_url": icon_image_data_url or None,
        "locked": profile.locked_at is not None,
        "locked_at": profile.locked_at.isoformat() if profile.locked_at is not None else None,
        "profile_setup_event_id": profile.profile_setup_event_id,
        "created_at": actor.created_at.isoformat(),
        "updated_at": profile.updated_at.isoformat(),
    }


def _merge_routine_state(
    existing: dict[str, object] | None,
    defaults: dict[str, object],
    *,
    home_location_id: str | None,
    active_location_id: str | None,
) -> dict[str, object]:
    merged = dict(defaults)
    for key, value in (existing or {}).items():
        merged[key] = value
    for required_key in (
        "routine_role",
        "beat_state",
        "attention_target_actor_id",
        "last_ambient_turn_id",
        "last_idle_tick_id",
        "rumor_focus",
        "tension_band",
        "home_location_id",
        "active_location_id",
    ):
        if required_key == "home_location_id":
            merged.setdefault(required_key, home_location_id)
            continue
        if required_key == "active_location_id":
            merged.setdefault(required_key, active_location_id)
            continue
        merged.setdefault(required_key, defaults.get(required_key))
    return merged


def _ensure_seeded_npc(
    db: Session,
    world_id: str,
    seed: PackNPCSeed,
    *,
    location_ids_by_key: Mapping[str, str] | None = None,
) -> Actor:
    home_location_id = (location_ids_by_key or {}).get(seed.home_location_key)
    npc = db.execute(
        select(Actor).where(
            Actor.world_id == world_id,
            Actor.actor_type == "npc",
            Actor.display_name == seed.display_name,
        )
    ).scalar_one_or_none()
    if npc is not None:
        if home_location_id and npc.current_location_id != home_location_id:
            npc.current_location_id = home_location_id
        profile = db.execute(
            select(NPCProfile).where(NPCProfile.world_id == world_id, NPCProfile.actor_id == npc.id)
        ).scalar_one_or_none()
        if profile is None:
            db.add(
                NPCProfile(
                    actor_id=npc.id,
                    world_id=world_id,
                    personality=seed.personality,
                    goals=seed.goals,
                    routine_state=_merge_routine_state(
                        {},
                        seed.routine_state,
                        home_location_id=home_location_id,
                        active_location_id=home_location_id,
                    ),
                )
            )
        else:
            profile.personality = profile.personality or seed.personality
            profile.goals = dict(profile.goals or seed.goals)
            profile.routine_state = _merge_routine_state(
                profile.routine_state,
                seed.routine_state,
                home_location_id=home_location_id,
                active_location_id=home_location_id,
            )
            if home_location_id is not None:
                profile.routine_state["home_location_id"] = home_location_id
                profile.routine_state["active_location_id"] = home_location_id
        db.flush()
        return npc

    npc = Actor(
        world_id=world_id,
        current_location_id=home_location_id,
        actor_type="npc",
        display_name=seed.display_name,
        status="active",
    )
    db.add(npc)
    db.flush()
    db.add(
        NPCProfile(
            actor_id=npc.id,
            world_id=world_id,
            personality=seed.personality,
            goals=seed.goals,
            routine_state=_merge_routine_state(
                {},
                seed.routine_state,
                home_location_id=home_location_id,
                active_location_id=home_location_id,
            ),
        )
    )
    db.flush()
    return npc


def ensure_pack_npcs(
    db: Session,
    world_id: str,
    *,
    location_ids_by_key: Mapping[str, str] | None = None,
) -> list[Actor]:
    pack, _ = resolve_world_pack(db, world_id)
    return [_ensure_seeded_npc(db, world_id, seed, location_ids_by_key=location_ids_by_key) for seed in pack.npcs]


def get_or_create_guide_npc(db: Session, world_id: str, *, location_id: str | None = None) -> Actor:
    guide = get_guide_npc_for_location(db, world_id, location_id=location_id)
    if guide is not None:
        return guide
    pack, template = resolve_world_pack(db, world_id)
    guide_name = template.roles.guide_npc_name
    guide_seed = next((seed for seed in pack.npcs if seed.display_name == guide_name or seed.is_guide), None)
    if guide_seed is not None:
        return _ensure_seeded_npc(db, world_id, guide_seed, location_ids_by_key=None)
    if pack.npcs:
        return _ensure_seeded_npc(db, world_id, pack.npcs[0], location_ids_by_key=None)
    raise LookupError(f"Pack for world {world_id} does not define any NPC seeds")


def get_guide_npc_for_location(db: Session, world_id: str, *, location_id: str | None = None) -> Actor | None:
    stmt: Select[tuple[Actor]] = select(Actor).where(
        Actor.world_id == world_id,
        Actor.actor_type == "npc",
    )
    if location_id is not None:
        stmt = stmt.where(Actor.current_location_id == location_id)
    rows = list(db.execute(stmt.order_by(Actor.created_at.asc(), Actor.id.asc())).scalars())
    if not rows:
        return None
    _, template = resolve_world_pack(db, world_id)
    guide_name = template.roles.guide_npc_name
    rows.sort(key=lambda actor: (actor.display_name != guide_name, actor.display_name, actor.id))
    return rows[0]


def user_has_world_membership(db: Session, world_id: str, user_sub: str) -> bool:
    return get_player_actor_for_user(db, world_id, user_sub) is not None


def ensure_relationship(
    db: Session,
    *,
    world_id: str,
    from_actor_id: str,
    to_actor_id: str,
    relationship_type: str,
    strength: float,
) -> Relationship:
    relationship = db.execute(
        select(Relationship).where(
            Relationship.world_id == world_id,
            Relationship.from_actor_id == from_actor_id,
            Relationship.to_entity_id == to_actor_id,
            Relationship.relationship_type == relationship_type,
        )
    ).scalar_one_or_none()
    if relationship is not None:
        relationship.to_actor_id = to_actor_id
        relationship.strength = strength
        db.flush()
        return relationship

    relationship = Relationship(
        world_id=world_id,
        from_actor_id=from_actor_id,
        to_entity_id=to_actor_id,
        to_actor_id=to_actor_id,
        relationship_type=relationship_type,
        strength=strength,
    )
    db.add(relationship)
    db.flush()
    return relationship


def get_relationship(
    db: Session,
    *,
    world_id: str,
    from_actor_id: str,
    to_actor_id: str,
    relationship_type: str,
) -> Relationship | None:
    return db.execute(
        select(Relationship).where(
            Relationship.world_id == world_id,
            Relationship.from_actor_id == from_actor_id,
            Relationship.to_entity_id == to_actor_id,
            Relationship.relationship_type == relationship_type,
        )
    ).scalar_one_or_none()


def adjust_relationship_strength(
    db: Session,
    *,
    world_id: str,
    from_actor_id: str,
    to_actor_id: str,
    relationship_type: str = "KNOWS",
    delta: float = 0.0,
    default_strength: float = 0.55,
) -> Relationship:
    relationship = get_relationship(
        db,
        world_id=world_id,
        from_actor_id=from_actor_id,
        to_actor_id=to_actor_id,
        relationship_type=relationship_type,
    )
    if relationship is None:
        relationship = Relationship(
            world_id=world_id,
            from_actor_id=from_actor_id,
            to_entity_id=to_actor_id,
            to_actor_id=to_actor_id,
            relationship_type=relationship_type,
            strength=default_strength,
        )
        db.add(relationship)
        db.flush()

    relationship.to_actor_id = to_actor_id
    relationship.strength = max(0.0, min(1.0, round(float(relationship.strength) + delta, 3)))
    db.flush()
    return relationship


def increment_relationship_strength(
    db: Session,
    *,
    world_id: str,
    from_actor_id: str,
    to_actor_id: str,
    relationship_type: str = "KNOWS",
    increment: float = 0.08,
) -> Relationship:
    relationship = adjust_relationship_strength(
        db,
        world_id=world_id,
        from_actor_id=from_actor_id,
        to_actor_id=to_actor_id,
        relationship_type=relationship_type,
        delta=increment,
        default_strength=0.55,
    )
    return relationship
