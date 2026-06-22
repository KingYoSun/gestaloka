from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.models.entities import (
    Actor,
    ActorKnowledgeEntry,
    ActorTitleProgress,
    CharacterSheet,
    ConsequenceThread,
    Event,
    Faction,
    FactionStanding,
    Item,
    Location,
    LocationRoute,
    Memory,
    ChapterTrack,
    QuestAssignment,
    QuestTemplate,
    Relationship,
    SharedHistoryRecord,
    Turn,
    World,
    WorldAxisState,
    new_id,
    route_id,
)
from app.modules.world_state.history import title_progress_to_dict
from app.modules.actor.service import (
    adjust_relationship_strength,
    ensure_pack_npcs,
    get_player_profile,
    get_guide_npc_for_location,
    get_relationship,
    player_profile_to_dict,
)
from app.modules.world_pack.service import (
    WorldPackError,
    branch_labels_from_followup_branches,
    get_pack_registry,
    normalize_language_tag,
    resolve_world_pack,
    serialize_followup_branches,
)
from app.modules.world_state.ambient import (
    list_ambient_murmurs,
    list_local_figures,
    list_npc_locations,
    list_offstage_murmurs,
    list_recent_offstage_beats,
    list_recent_world_beats,
)
from app.modules.world_state.branch import (
    branch_key_for_slot,
    branch_label,
    branch_slot_for_key,
    crossroads_summary_text,
    dominant_branch_key,
    list_recent_branch_echoes,
    list_route_pressures,
    player_visible_branch_hint,
)
from app.modules.world_state.consequence import (
    ConsequenceRuleEngine,
    ConsequenceRuleInput,
    ConsequenceTag,
    ConsequenceThreadSnapshot,
    OutcomeBand,
    PressureBand,
    ThreadStatus,
    ThreadType,
    fallback_consequence_tags,
    normalize_consequence_tags,
    relationship_band,
    relationship_summary,
    scene_tone_for_band,
    thread_summary,
    thread_title,
)
from app.modules.world_state.entity_generation import pack_seed_entity_key
from app.modules.world_state.scene import (
    SceneFrameEngine,
    ensure_narrative_frame_seed,
    get_current_chapter_summary,
    get_current_scene_summary,
    list_chapter_tracks_debug,
    list_recent_scene_history,
    list_scene_frames_debug,
)
from app.modules.world_state.shared_consequence import ensure_shared_world_seed, pack_scoped_entity_id
from app.modules.world_state.rules import WorldTag, standing_band


FOLLOWUP_STANDING_DELTA = 0.10
ROUTE_STATUS_OPEN = "open"
ROUTE_STATUS_LOCKED = "locked"
MAX_OFFERED_QUESTS = 3
QUEST_SIMILARITY_THRESHOLD = 0.30
PACK_GENERATION_CONTEXT_KEYS = (
    "situation_grammar",
    "rumor_grammar",
    "quest_generation_constraints",
    "dynamic_narrative_policy",
    "quest_emergence_policy",
    "quest_offer_policy",
    "scene_generation_policy",
)
QUEST_EMERGENCE_DEFAULT_POLICY = {
    "require_player_attention_basis": True,
    "require_uncertainty": True,
    "require_first_step": True,
    "reject_single_action_quests": True,
    "suppress_primary_offer_when_live_quest_exists": True,
}


def _safe_language_tag(value: Any, *, fallback: str = "en") -> str:
    try:
        return normalize_language_tag(str(value or fallback))
    except ValueError:
        return fallback


def _play_language_code(play_language: dict[str, Any] | None, *, fallback: str = "ja") -> str:
    payload = play_language if isinstance(play_language, dict) else {}
    preset = str(payload.get("preset") or "").strip()
    if preset:
        return _safe_language_tag(preset, fallback=fallback)
    custom = str(payload.get("custom") or payload.get("prompt_name") or "").strip()
    return _safe_language_tag(custom, fallback=fallback)


def _pack_generation_context_from_world(world: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(world, dict):
        return {}
    context: dict[str, Any] = {}
    for key in PACK_GENERATION_CONTEXT_KEYS:
        value = world.get(key)
        if value in (None, "", [], {}):
            continue
        context[key] = value
    return context


def _normalize_aliases_by_language(value: Any) -> dict[str, list[str]]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, list[str]] = {}
    for language, aliases in value.items():
        language_tag = _safe_language_tag(language, fallback="")
        if not language_tag:
            continue
        items = aliases if isinstance(aliases, list) else [aliases]
        deduped: list[str] = []
        seen: set[str] = set()
        for item in items:
            text = str(item or "").strip()
            if not text or text in seen:
                continue
            deduped.append(text)
            seen.add(text)
        if deduped:
            normalized[language_tag] = deduped
    return normalized


def _bootstrap_for_language(bootstrap: dict[str, Any], *, language: str, source_language: str) -> dict[str, Any]:
    if language != source_language:
        localized = (bootstrap.get("localized_bootstrap") or {}).get(language)
        if isinstance(localized, dict):
            return localized
    return bootstrap


@dataclass(frozen=True)
class WorldSliceSeed:
    faction: Faction
    standing: FactionStanding
    quest_template: QuestTemplate | None
    quest_assignment: QuestAssignment | None
    followup_quest_template: QuestTemplate | None
    character_sheet: CharacterSheet


@dataclass(frozen=True)
class RewardItemUseOutcome:
    item: Item
    quest_updates: list[dict[str, Any]]
    faction_updates: list[dict[str, Any]]
    inventory_updates: list[dict[str, Any]]
    event_type: str
    event_narrative: str
    event_payload: dict[str, Any]
    memory_drafts: list[dict[str, Any]]


@dataclass(frozen=True)
class TravelOutcome:
    destination: Location
    location_updates: list[dict[str, Any]]
    event_type: str
    event_narrative: str
    event_payload: dict[str, Any]
    memory_drafts: list[dict[str, Any]]
    travel_summary: str


@dataclass(frozen=True)
class StateDraftMaterializationOutcome:
    inventory_updates: list[dict[str, Any]]
    knowledge_updates: list[dict[str, Any]]
    skill_updates: list[dict[str, Any]]
    trade_updates: list[dict[str, Any]]
    blocked_state_drafts: list[dict[str, Any]]


@dataclass(frozen=True)
class ConsequenceApplicationOutcome:
    relationship_updates: list[dict[str, Any]]
    consequence_updates: list[dict[str, Any]]
    faction_updates: list[dict[str, Any]]
    additional_memory_drafts: list[dict[str, Any]]
    outcome_band: OutcomeBand
    scene_tone: str
    consequence_summary: str


def _world_row(db: Session, world_id: str) -> World | None:
    return db.execute(select(World).where(World.id == world_id)).scalar_one_or_none()


def _lock_world_seed(db: Session, world_id: str) -> None:
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        return
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:namespace), hashtext(:world_id))"),
        {"namespace": "world-seed", "world_id": world_id},
    )


def _seed_section(db: Session, world_id: str, name: str) -> dict[str, Any]:
    _, template = resolve_world_pack(db, world_id)
    if name == "world":
        return dict(template.world)
    if name == "roles":
        return template.roles.model_dump()
    if name == "bootstrap":
        return template.bootstrap.model_dump()
    if name == "faction":
        return template.faction.model_dump()
    if name == "quest":
        return template.quest.model_dump() if template.quest is not None else {}
    if name == "followup_quest":
        return template.followup_quest.model_dump() if template.followup_quest is not None else {}
    if name == "character":
        return template.character.model_dump()
    raise KeyError(f"Unknown pack section: {name}")


def _world_scoped_seed_id(world_id: str, base_id: str) -> str:
    return f"{world_id}:{base_id}"


def _resolve_seeded_entity_id(world_id: str, base_id: str) -> tuple[str, list[str]]:
    scoped_id = _world_scoped_seed_id(world_id, base_id)
    return scoped_id, [scoped_id, base_id]


def _seed_locations(db: Session, world_id: str) -> dict[str, dict[str, Any]]:
    _, template = resolve_world_pack(db, world_id)
    locations = {key: value.model_dump() for key, value in template.locations.items()}
    if not locations:
        raise ValueError("World pack is missing locations")
    return locations


def _seed_routes(db: Session, world_id: str) -> list[dict[str, Any]]:
    _, template = resolve_world_pack(db, world_id)
    return [item.model_dump(by_alias=True) for item in template.routes]


def _route_unlock_requirements_from_seed(payload: dict[str, Any]) -> dict[str, Any]:
    requirements = dict(payload.get("unlock_requirements") or {})
    locked_summary = str(payload.get("locked_travel_summary") or "").strip()
    unlocked_summary = str(payload.get("unlocked_travel_summary") or "").strip()
    if locked_summary:
        requirements["locked_travel_summary"] = locked_summary
    if unlocked_summary:
        requirements["unlocked_travel_summary"] = unlocked_summary
    return requirements


def _route_seed_display_summary(payload: dict[str, Any], *, status_value: str) -> str:
    summary = str(payload.get("travel_summary") or "").strip()
    locked_summary = str(payload.get("locked_travel_summary") or "").strip()
    unlocked_summary = str(payload.get("unlocked_travel_summary") or "").strip()
    if status_value == ROUTE_STATUS_OPEN:
        return summary or unlocked_summary or locked_summary
    return locked_summary or summary or unlocked_summary


def _route_display_summary(route: LocationRoute) -> str:
    metadata = dict(route.unlock_requirements_json or {})
    if route.status == ROUTE_STATUS_OPEN:
        summary = str(metadata.get("unlocked_travel_summary") or "").strip()
        if summary:
            return summary
    else:
        summary = str(metadata.get("locked_travel_summary") or "").strip()
        if summary:
            return summary
    return route.travel_summary.strip()


def _starter_location_key(db: Session, world_id: str) -> str:
    return str(_seed_section(db, world_id, "roles").get("starter_location_key") or "starter")


def _lore_location_key(db: Session, world_id: str) -> str:
    return str(_seed_section(db, world_id, "roles").get("lore_location_key") or "lore")


def _followup_location_key(db: Session, world_id: str) -> str:
    return str(_seed_section(db, world_id, "roles").get("followup_location_key") or "followup")


def _starter_stage_key(db: Session, world_id: str) -> str:
    return str(_seed_section(db, world_id, "roles").get("starter_stage_key") or "starter_stage")


def _followup_stage_key(db: Session, world_id: str) -> str:
    return str(_seed_section(db, world_id, "roles").get("followup_stage_key") or "followup_stage")


def _opening_chapter_key(db: Session, world_id: str) -> str:
    return str(_seed_section(db, world_id, "roles").get("opening_chapter_key") or "")


def _followup_chapter_key(db: Session, world_id: str) -> str:
    return str(_seed_section(db, world_id, "roles").get("followup_chapter_key") or "")


def _reward_effect_kind(db: Session, world_id: str) -> str:
    return str(_seed_section(db, world_id, "roles").get("reward_effect_kind") or "unlock_followup_route")


def _followup_branches(db: Session, world_id: str) -> dict[str, dict[str, Any]]:
    _, template = resolve_world_pack(db, world_id)
    return serialize_followup_branches(template.roles.followup_branches)


def _branch_labels(db: Session, world_id: str) -> dict[str, str]:
    _, template = resolve_world_pack(db, world_id)
    return branch_labels_from_followup_branches(template.roles.followup_branches)


def _bootstrap_copy(db: Session, world_id: str) -> dict[str, Any]:
    return _seed_section(db, world_id, "bootstrap")


def _location_id_for_key(world_id: str, location_key: str, base_id: str | None = None) -> str:
    return _world_scoped_seed_id(world_id, base_id or location_key)


def location_key_for_id(db: Session, world_id: str, location_id: str | None) -> str | None:
    if location_id is None:
        return None
    for location_key, payload in _seed_locations(db, world_id).items():
        seeded_location_id = _location_id_for_key(world_id, location_key, str(payload.get("id") or location_key))
        if location_id == seeded_location_id:
            return location_key
    return None


def ensure_seeded_locations(db: Session, world_id: str) -> dict[str, Location]:
    seeded: dict[str, Location] = {}
    for location_key, payload in _seed_locations(db, world_id).items():
        location_id = _location_id_for_key(world_id, location_key, str(payload.get("id") or location_key))
        location = db.execute(
            select(Location).where(Location.world_id == world_id, Location.id == location_id)
        ).scalar_one_or_none()
        state = dict(location.state or {}) if location is not None else {}
        state.update(
            {
                "kind": "starter" if bool(payload.get("starter")) else "district",
                "key": location_key,
                "source_name": str(payload.get("name") or location_key.replace("_", " ").title()),
                "public_aliases": _normalize_aliases_by_language(payload.get("public_aliases")),
            }
        )
        if location is None:
            location = Location(
                id=location_id,
                world_id=world_id,
                name=str(payload.get("name") or location_key.replace("_", " ").title()),
                description=str(payload.get("description") or ""),
                state=state,
                entity_key=pack_seed_entity_key("location", str(payload.get("id") or location_key)),
                origin_kind="pack_seed",
                origin_ref=str(payload.get("id") or location_key),
                visibility_scope="world",
            )
            db.add(location)
            db.flush()
        else:
            location.name = str(payload.get("name") or location.name)
            location.description = str(payload.get("description") or location.description)
            location.state = state
            location.entity_key = location.entity_key or pack_seed_entity_key("location", str(payload.get("id") or location_key))
            location.origin_kind = location.origin_kind or "pack_seed"
            location.origin_ref = location.origin_ref or str(payload.get("id") or location_key)
            location.visibility_scope = location.visibility_scope or "world"
            db.flush()
        seeded[location_key] = location
    return seeded


def ensure_location_routes(db: Session, world_id: str, *, locations_by_key: dict[str, Location] | None = None) -> dict[str, LocationRoute]:
    resolved_locations = locations_by_key or ensure_seeded_locations(db, world_id)
    routes: dict[str, LocationRoute] = {}
    for payload in _seed_routes(db, world_id):
        route_key_name = str(payload.get("route_key") or "").strip()
        from_key = str(payload.get("from") or "").strip()
        to_key = str(payload.get("to") or "").strip()
        if not route_key_name or from_key not in resolved_locations or to_key not in resolved_locations:
            continue
        route = db.execute(
            select(LocationRoute).where(LocationRoute.world_id == world_id, LocationRoute.route_key == route_key_name)
        ).scalar_one_or_none()
        default_status = str(payload.get("status") or ROUTE_STATUS_OPEN)
        unlock_requirements = _route_unlock_requirements_from_seed(payload)
        if route is None:
            route = LocationRoute(
                id=route_id(world_id, route_key_name),
                world_id=world_id,
                from_location_id=resolved_locations[from_key].id,
                to_location_id=resolved_locations[to_key].id,
                route_key=route_key_name,
                status=default_status,
                travel_summary=_route_seed_display_summary(payload, status_value=default_status),
                unlock_requirements_json=unlock_requirements,
            )
            db.add(route)
            db.flush()
        else:
            route.from_location_id = resolved_locations[from_key].id
            route.to_location_id = resolved_locations[to_key].id
            route.travel_summary = _route_seed_display_summary(payload, status_value=route.status) or route.travel_summary
            route.unlock_requirements_json = unlock_requirements or dict(route.unlock_requirements_json or {})
            if route.status not in {ROUTE_STATUS_OPEN, ROUTE_STATUS_LOCKED}:
                route.status = default_status
            db.flush()
        routes[route_key_name] = route
    return routes


def ensure_world(
    db: Session,
    world_id: str,
    *,
    pack_id: str,
    world_template_id: str,
    world_name: str | None = None,
) -> World:
    registry = get_pack_registry()
    template = registry.get_template(pack_id, world_template_id)
    world = db.execute(select(World).where(World.id == world_id)).scalar_one_or_none()
    if world is not None:
        return _ensure_world_seeded_structure(
            db,
            world,
            world_id=world_id,
            pack_id=pack_id,
            world_template_id=world_template_id,
        )

    _lock_world_seed(db, world_id)
    world = db.execute(select(World).where(World.id == world_id)).scalar_one_or_none()
    if world is not None:
        return _ensure_world_seeded_structure(
            db,
            world,
            world_id=world_id,
            pack_id=pack_id,
            world_template_id=world_template_id,
        )

    fallback_name = str((template.world or {}).get("default_name") or template.display_name)
    world = World(
        id=world_id,
        name=world_name or fallback_name,
        status="active",
        state={
            "pack_id": pack_id,
            "world_template_id": world_template_id,
        },
    )
    db.add(world)
    db.flush()
    locations = ensure_seeded_locations(db, world_id)
    ensure_location_routes(db, world_id, locations_by_key=locations)
    return world


def _ensure_world_seeded_structure(
    db: Session,
    world: World,
    *,
    world_id: str,
    pack_id: str,
    world_template_id: str,
) -> World:
    state = dict(world.state or {})
    existing_pack_id = str(state.get("pack_id") or "").strip()
    existing_template_id = str(state.get("world_template_id") or "").strip()
    if not existing_pack_id or not existing_template_id:
        raise WorldPackError(
            f"World {world_id!r} is missing immutable pack metadata",
            code="world_pack_metadata_missing",
            pack_id=pack_id,
        )
    if existing_pack_id != pack_id or existing_template_id != world_template_id:
        raise WorldPackError(
            f"World {world_id!r} is already bound to pack/template "
            f"{existing_pack_id!r}/{existing_template_id!r}",
            code="world_pack_immutable",
            pack_id=existing_pack_id,
        )
    locations = ensure_seeded_locations(db, world_id)
    ensure_location_routes(db, world_id, locations_by_key=locations)
    db.flush()
    return world


def ensure_starter_location(db: Session, world_id: str) -> Location:
    return ensure_seeded_locations(db, world_id)[_starter_location_key(db, world_id)]


def ensure_character_sheet(db: Session, world_id: str, actor_id: str) -> CharacterSheet:
    sheet = db.execute(
        select(CharacterSheet).where(CharacterSheet.world_id == world_id, CharacterSheet.actor_id == actor_id)
    ).scalar_one_or_none()
    if sheet is not None:
        return sheet

    character_seed = _seed_section(db, world_id, "character")
    sheet = CharacterSheet(
        actor_id=actor_id,
        world_id=world_id,
        rank=str(character_seed.get("rank") or "Wayfarer"),
        hp=int(character_seed.get("hp") or 10),
        focus=int(character_seed.get("focus") or 5),
        status_json=dict(character_seed.get("status_json") or {}),
    )
    db.add(sheet)
    db.flush()
    return sheet


def ensure_starter_faction(db: Session, world_id: str) -> Faction:
    _, template = resolve_world_pack(db, world_id)
    faction_seed = _seed_section(db, world_id, "faction")
    faction_base_id = str(faction_seed.get("id") or "starter_faction")
    shared_seed = next((item for item in template.factions if item.id == faction_base_id), None)
    faction_id = pack_scoped_entity_id(world_id, faction_base_id)
    candidates = [faction_id, _world_scoped_seed_id(world_id, faction_base_id), faction_base_id]
    stmt = (
        select(Faction).where(
            Faction.world_id == world_id,
            Faction.id.in_(candidates),
        )
    )
    faction = db.execute(stmt).scalars().first()
    if faction is not None:
        faction.entity_key = faction.entity_key or pack_seed_entity_key("community", faction_base_id)
        faction.origin_kind = faction.origin_kind or "pack_seed"
        faction.origin_ref = faction.origin_ref or faction_base_id
        faction.visibility_scope = faction.visibility_scope or "world"
        db.flush()
        return faction

    faction = Faction(
        id=faction_id,
        world_id=world_id,
        name=str((shared_seed.name if shared_seed is not None else None) or faction_seed.get("name") or "Starter Faction"),
        description=str((shared_seed.description if shared_seed is not None else None) or faction_seed.get("description") or ""),
        entity_key=pack_seed_entity_key("community", faction_base_id),
        origin_kind="pack_seed",
        origin_ref=faction_base_id,
        visibility_scope="world",
        state={
            **dict(faction_seed.get("state") or {}),
            "pack_faction_id": faction_base_id,
            "policy": str(shared_seed.policy if shared_seed is not None else (faction_seed.get("state") or {}).get("doctrine") or ""),
        },
    )
    try:
        with db.begin_nested():
            db.add(faction)
            db.flush()
        return faction
    except IntegrityError:
        existing = db.execute(stmt).scalars().first()
        if existing is None:
            raise
        return existing


def ensure_faction_standing(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    faction_id: str,
    initial_standing: float = 0.25,
) -> FactionStanding:
    standing = db.execute(
        select(FactionStanding).where(
            FactionStanding.world_id == world_id,
            FactionStanding.actor_id == actor_id,
            FactionStanding.faction_id == faction_id,
        )
    ).scalar_one_or_none()
    if standing is not None:
        return standing

    standing = FactionStanding(
        world_id=world_id,
        actor_id=actor_id,
        faction_id=faction_id,
        standing=round(initial_standing, 3),
        band=standing_band(initial_standing),
    )
    db.add(standing)
    db.flush()
    return standing


def _ensure_seeded_quest_template(
    db: Session,
    *,
    world_id: str,
    section_name: str,
    default_id: str,
    default_title: str,
    default_description: str,
    default_reward_template_key: str,
    default_reward_name: str,
    default_reward_description: str,
    default_stage_key: str,
    default_unlock_requirements: dict[str, Any] | None = None,
    default_state: dict[str, Any] | None = None,
) -> QuestTemplate:
    quest_seed = _seed_section(db, world_id, section_name)
    quest_base_id = str(quest_seed.get("id") or default_id)
    quest_id, candidates = _resolve_seeded_entity_id(world_id, quest_base_id)
    quest_template = db.execute(
        select(QuestTemplate).where(
            QuestTemplate.world_id == world_id,
            QuestTemplate.id.in_(candidates),
        )
    ).scalars().first()
    if quest_template is not None:
        quest_template.title = str(quest_seed.get("title") or quest_template.title or default_title)
        quest_template.description = str(quest_seed.get("description") or quest_template.description or default_description)
        quest_template.stage_key = str(quest_seed.get("stage_key") or quest_template.stage_key or default_stage_key)
        quest_template.unlock_requirements = dict(
            quest_seed.get("unlock_requirements") or quest_template.unlock_requirements or default_unlock_requirements or {}
        )
        quest_template.reward_template_key = str(
            quest_seed.get("reward_template_key") or quest_template.reward_template_key or default_reward_template_key
        )
        quest_template.reward_name = str(quest_seed.get("reward_name") or quest_template.reward_name or default_reward_name)
        quest_template.reward_description = str(
            quest_seed.get("reward_description") or quest_template.reward_description or default_reward_description
        )
        quest_template.state = dict(quest_seed.get("state") or quest_template.state or default_state or {})
        db.flush()
        return quest_template

    quest_template = QuestTemplate(
        id=quest_id,
        world_id=world_id,
        title=str(quest_seed.get("title") or default_title),
        description=str(quest_seed.get("description") or default_description),
        status=str(quest_seed.get("status") or "active"),
        stage_key=str(quest_seed.get("stage_key") or default_stage_key),
        unlock_requirements=dict(quest_seed.get("unlock_requirements") or default_unlock_requirements or {}),
        reward_template_key=str(quest_seed.get("reward_template_key") or default_reward_template_key),
        reward_name=str(quest_seed.get("reward_name") or default_reward_name),
        reward_description=str(quest_seed.get("reward_description") or default_reward_description),
        state=dict(quest_seed.get("state") or default_state or {}),
    )
    db.add(quest_template)
    db.flush()
    return quest_template


def ensure_starter_quest_template(db: Session, world_id: str) -> QuestTemplate:
    template = resolve_world_pack(db, world_id)[1]
    return _ensure_seeded_quest_template(
        db,
        world_id=world_id,
        section_name="quest",
        default_id="starter_quest_request",
        default_title="Starter Request",
        default_description="Help a local, report back what you learned, and earn enough trust to unlock the next route.",
        default_reward_template_key="starter_reward",
        default_reward_name=str((template.quest.reward_name if template.quest is not None else "") or "World Seal"),
        default_reward_description=str(
            (template.quest.reward_description if template.quest is not None else "")
            or "A trusted item for the next route."
        ),
        default_stage_key=_starter_stage_key(db, world_id),
        default_unlock_requirements={},
        default_state={
            "reward_enabled": True,
            "reward_effect_kind": _reward_effect_kind(db, world_id),
            "reward_effect_payload": {"unlock_stage_key": _followup_stage_key(db, world_id)},
        },
    )


def ensure_followup_quest_template(db: Session, world_id: str) -> QuestTemplate:
    template = resolve_world_pack(db, world_id)[1]
    return _ensure_seeded_quest_template(
        db,
        world_id=world_id,
        section_name="followup_quest",
        default_id="followup_route",
        default_title=str((template.followup_quest.title if template.followup_quest is not None else "") or "Follow-up Route Unsealed"),
        default_description=str(
            (template.followup_quest.description if template.followup_quest is not None else "")
            or "Carry earned trust into the next route."
        ),
        default_reward_template_key="none",
        default_reward_name="",
        default_reward_description="",
        default_stage_key=_followup_stage_key(db, world_id),
        default_unlock_requirements={"requires_resolved_stage": _starter_stage_key(db, world_id)},
        default_state={"reward_enabled": False},
    )


def _ensure_quest_assignment(
    db: Session,
    *,
    world_id: str,
    owner_actor_id: str,
    quest_template: QuestTemplate,
    status: str = "active",
    latest_summary: str,
    state_json: dict[str, Any] | None = None,
) -> QuestAssignment:
    existing = db.execute(
        select(QuestAssignment).where(
            QuestAssignment.world_id == world_id,
            QuestAssignment.owner_actor_id == owner_actor_id,
            QuestAssignment.quest_template_id == quest_template.id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    assignment = QuestAssignment(
        world_id=world_id,
        owner_actor_id=owner_actor_id,
        quest_template_id=quest_template.id,
        status=status,
        latest_summary=latest_summary,
        state_json=state_json or {},
    )
    db.add(assignment)
    db.flush()
    return assignment


def ensure_starter_quest_assignment(
    db: Session,
    *,
    world_id: str,
    owner_actor_id: str,
    quest_template_id: str,
) -> QuestAssignment:
    quest_template = db.execute(
        select(QuestTemplate).where(QuestTemplate.world_id == world_id, QuestTemplate.id == quest_template_id)
    ).scalar_one()
    lore_location_name = ensure_seeded_locations(db, world_id)[_lore_location_key(db, world_id)].name
    return _ensure_quest_assignment(
        db,
        world_id=world_id,
        owner_actor_id=owner_actor_id,
        quest_template=quest_template,
        latest_summary=f"{lore_location_name}周辺で得たことを持ち帰り、来訪者ログを読み解く。",
        state_json={"lore_progress": 0, "last_world_tags": [], "unlocked_by_item_id": None},
    )


def ensure_membership_relationship(
    db: Session,
    *,
    world_id: str,
    from_actor_id: str,
    faction_id: str,
) -> Relationship:
    relationship = db.execute(
        select(Relationship).where(
            Relationship.world_id == world_id,
            Relationship.from_actor_id == from_actor_id,
            Relationship.to_entity_id == faction_id,
            Relationship.relationship_type == "MEMBER_OF",
        )
    ).scalar_one_or_none()
    if relationship is not None:
        if relationship.strength != 1.0:
            relationship.strength = 1.0
            db.flush()
        return relationship

    relationship = Relationship(
        world_id=world_id,
        from_actor_id=from_actor_id,
        to_entity_id=faction_id,
        to_actor_id=None,
        relationship_type="MEMBER_OF",
        strength=1.0,
    )
    db.add(relationship)
    db.flush()
    return relationship


def _existing_world_slice_seed(db: Session, *, world_id: str, player_actor_id: str) -> WorldSliceSeed | None:
    faction_seed = _seed_section(db, world_id, "faction")
    faction_base_id = str(faction_seed.get("id") or "starter_faction")
    faction_id = pack_scoped_entity_id(world_id, faction_base_id)
    faction_candidates = [faction_id, _world_scoped_seed_id(world_id, faction_base_id), faction_base_id]
    faction = db.execute(
        select(Faction).where(
            Faction.world_id == world_id,
            Faction.id.in_(faction_candidates),
        )
    ).scalars().first()
    if faction is None:
        return None

    quest_template: QuestTemplate | None = None
    quest_seed = _seed_section(db, world_id, "quest")
    if quest_seed:
        quest_base_id = str(quest_seed.get("id") or "starter_quest_request")
        _, quest_candidates = _resolve_seeded_entity_id(world_id, quest_base_id)
        quest_template = db.execute(
            select(QuestTemplate).where(
                QuestTemplate.world_id == world_id,
                QuestTemplate.id.in_(quest_candidates),
            )
        ).scalars().first()

    followup_quest_template: QuestTemplate | None = None
    followup_seed = _seed_section(db, world_id, "followup_quest")
    if followup_seed:
        followup_base_id = str(followup_seed.get("id") or "followup_route")
        _, followup_candidates = _resolve_seeded_entity_id(world_id, followup_base_id)
        followup_quest_template = db.execute(
            select(QuestTemplate).where(
                QuestTemplate.world_id == world_id,
                QuestTemplate.id.in_(followup_candidates),
            )
        ).scalars().first()

    character_sheet = db.execute(
        select(CharacterSheet).where(
            CharacterSheet.world_id == world_id,
            CharacterSheet.actor_id == player_actor_id,
        )
    ).scalar_one_or_none()
    standing = db.execute(
        select(FactionStanding).where(
            FactionStanding.world_id == world_id,
            FactionStanding.actor_id == player_actor_id,
            FactionStanding.faction_id == faction.id,
        )
    ).scalar_one_or_none()
    quest_assignment = (
        db.execute(
            select(QuestAssignment).where(
                QuestAssignment.world_id == world_id,
                QuestAssignment.owner_actor_id == player_actor_id,
                QuestAssignment.quest_template_id == quest_template.id,
            )
        ).scalar_one_or_none()
        if quest_template is not None
        else None
    )
    if character_sheet is None or standing is None:
        return None

    return WorldSliceSeed(
        faction=faction,
        standing=standing,
        quest_template=quest_template,
        quest_assignment=quest_assignment,
        followup_quest_template=followup_quest_template,
        character_sheet=character_sheet,
    )


def ensure_world_slice_seed(
    db: Session,
    *,
    world_id: str,
    player_actor_id: str,
) -> WorldSliceSeed:
    existing_seed = _existing_world_slice_seed(db, world_id=world_id, player_actor_id=player_actor_id)
    if existing_seed is not None:
        return existing_seed

    _lock_world_seed(db, world_id)
    existing_seed = _existing_world_slice_seed(db, world_id=world_id, player_actor_id=player_actor_id)
    if existing_seed is not None:
        return existing_seed

    locations_by_key = ensure_seeded_locations(db, world_id)
    ensure_location_routes(db, world_id, locations_by_key=locations_by_key)
    ensure_pack_npcs(
        db,
        world_id,
        location_ids_by_key={key: location.id for key, location in locations_by_key.items()},
    )
    ensure_shared_world_seed(db, world_id=world_id, actor_id=player_actor_id)
    starter_key = _starter_location_key(db, world_id)
    guide_actor = get_guide_npc_for_location(db, world_id, location_id=locations_by_key[starter_key].id)
    faction = ensure_starter_faction(db, world_id)
    if guide_actor is not None:
        ensure_membership_relationship(db, world_id=world_id, from_actor_id=guide_actor.id, faction_id=faction.id)
    standing = ensure_faction_standing(db, world_id=world_id, actor_id=player_actor_id, faction_id=faction.id)
    character_sheet = ensure_character_sheet(db, world_id, player_actor_id)
    quest_template = None
    quest_assignment = None
    followup_quest_template = None
    if _seed_section(db, world_id, "quest").get("seed_on_session_start", False):
        quest_template = ensure_starter_quest_template(db, world_id)
        quest_assignment = ensure_starter_quest_assignment(
            db,
            world_id=world_id,
            owner_actor_id=player_actor_id,
            quest_template_id=quest_template.id,
        )
    if _seed_section(db, world_id, "followup_quest").get("seed_on_session_start", False):
        followup_quest_template = ensure_followup_quest_template(db, world_id)
    ensure_narrative_frame_seed(
        db,
        world_id=world_id,
        actor_id=player_actor_id,
        location_id=locations_by_key[starter_key].id,
        focus_actor_id=guide_actor.id if guide_actor is not None else None,
    )
    return WorldSliceSeed(
        faction=faction,
        standing=standing,
        quest_template=quest_template,
        quest_assignment=quest_assignment,
        followup_quest_template=followup_quest_template,
        character_sheet=character_sheet,
    )


def get_location_summary(db: Session, world_id: str, location_id: str | None) -> dict[str, Any] | None:
    if location_id is None:
        return None
    location = db.execute(
        select(Location).where(Location.world_id == world_id, Location.id == location_id)
    ).scalar_one_or_none()
    if location is None:
        return None
    return {
        "id": location.id,
        "name": location.name,
        "description": location.description,
        "source_name": str((location.state or {}).get("source_name") or location.name),
        "public_aliases": _normalize_aliases_by_language((location.state or {}).get("public_aliases")),
        "key": str((location.state or {}).get("key") or location_key_for_id(db, world_id, location.id) or ""),
    }


def get_location_by_key(db: Session, world_id: str, location_key: str) -> Location | None:
    locations = ensure_seeded_locations(db, world_id)
    return locations.get(location_key)


def get_location_route(
    db: Session,
    *,
    world_id: str,
    from_location_id: str,
    to_location_id: str,
) -> LocationRoute | None:
    return db.execute(
        select(LocationRoute).where(
            LocationRoute.world_id == world_id,
            LocationRoute.from_location_id == from_location_id,
            LocationRoute.to_location_id == to_location_id,
        )
    ).scalar_one_or_none()


def _route_requirements_met(
    db: Session,
    *,
    world_id: str,
    actor_id: str | None,
    requirements: dict[str, Any] | None,
) -> bool:
    """Evaluate emergent route-unlock conditions against current world state (ADR-003).

    A locked route opens when the world has moved, not when a fixed key item is used.
    Conditions are OR-ed paths so several playstyles can reach the same area:
    - ``world_axis_min``: a mapping of axis_id -> minimum value (all must be met).
    - ``requires_resolved_stage``: the player has resolved a quest with this stage_key.
    """
    if not isinstance(requirements, dict) or not requirements:
        return False

    axis_min = requirements.get("world_axis_min")
    if isinstance(axis_min, dict) and axis_min:
        axis_values = {
            str(state.axis_id): float(state.current_value)
            for state in db.execute(
                select(WorldAxisState).where(WorldAxisState.world_id == world_id)
            ).scalars()
        }
        if all(axis_values.get(str(axis_id), float("-inf")) >= float(threshold) for axis_id, threshold in axis_min.items()):
            return True

    resolved_stage = str(requirements.get("requires_resolved_stage") or "").strip()
    if resolved_stage and actor_id is not None:
        resolved = db.execute(
            select(QuestAssignment.id)
            .join(
                QuestTemplate,
                (QuestTemplate.id == QuestAssignment.quest_template_id) & (QuestTemplate.world_id == QuestAssignment.world_id),
            )
            .where(
                QuestAssignment.world_id == world_id,
                QuestAssignment.owner_actor_id == actor_id,
                QuestAssignment.status == "completed",
                QuestTemplate.stage_key == resolved_stage,
            )
        ).first()
        if resolved is not None:
            return True

    return False


def _route_accessible(
    db: Session,
    *,
    world_id: str,
    route: LocationRoute,
    actor_id: str | None = None,
) -> bool:
    if route.status == ROUTE_STATUS_OPEN:
        return True
    return _route_requirements_met(
        db,
        world_id=world_id,
        actor_id=actor_id,
        requirements=route.unlock_requirements_json,
    )


def _route_summary(route: LocationRoute, to_location: Location, *, unlocked: bool) -> dict[str, Any]:
    available = unlocked
    summary = _route_display_summary(route)
    destination_key = str((to_location.state or {}).get("key") or "")
    destination_aliases = _normalize_aliases_by_language((to_location.state or {}).get("public_aliases"))
    destination_source_name = str((to_location.state or {}).get("source_name") or to_location.name)
    if not summary:
        summary = (
            f"{to_location.name}へ抜ける道が開いている。"
            if available
            else f"{to_location.name}へ続く道は、まだためらうように閉じている。"
        )
    return {
        "route_id": route.id,
        "route_key": route.route_key,
        "summary": summary,
        "available": available,
        "destination_id": to_location.id,
        "destination_name": to_location.name,
        "destination_source_name": destination_source_name,
        "destination_aliases": destination_aliases,
        "destination_key": destination_key,
        "to_location": {
            "id": to_location.id,
            "name": to_location.name,
            "description": to_location.description,
            "source_name": destination_source_name,
            "public_aliases": destination_aliases,
            "key": destination_key,
        },
    }


def list_nearby_routes(
    db: Session, world_id: str, location_id: str | None, *, actor_id: str | None = None
) -> list[dict[str, Any]]:
    if location_id is None:
        return []
    routes = list(
        db.execute(
            select(LocationRoute, Location)
            .join(
                Location,
                (Location.id == LocationRoute.to_location_id) & (Location.world_id == LocationRoute.world_id),
            )
            .where(LocationRoute.world_id == world_id, LocationRoute.from_location_id == location_id)
            .order_by(Location.name.asc(), LocationRoute.route_key.asc())
        ).all()
    )
    return [
        _route_summary(
            route,
            location,
            unlocked=_route_accessible(db, world_id=world_id, route=route, actor_id=actor_id),
        )
        for route, location in routes
    ]


def list_location_summaries(db: Session, world_id: str) -> list[dict[str, Any]]:
    locations = list(
        db.execute(
            select(Location).where(Location.world_id == world_id).order_by(Location.created_at.asc(), Location.id.asc())
        ).scalars()
    )
    return [
        {
            "id": location.id,
            "name": location.name,
            "description": location.description,
            "key": str((location.state or {}).get("key") or ""),
            "kind": str((location.state or {}).get("kind") or ""),
        }
        for location in locations
    ]


def list_recent_travel_history(db: Session, world_id: str, actor_id: str, *, limit: int = 3) -> list[str]:
    rows = list(
        db.execute(
            select(Event)
            .where(
                Event.world_id == world_id,
                Event.source_actor_id == actor_id,
                Event.event_type.in_(("travel.arrived", "travel.hesitated")),
            )
            .order_by(Event.created_at.desc(), Event.id.desc())
            .limit(limit)
        ).scalars()
    )
    history: list[str] = []
    for event in rows:
        summary = str((event.payload or {}).get("travel_summary") or event.narrative or "").strip()
        if summary:
            history.append(summary)
    return history


def travel_to_location(
    db: Session,
    *,
    world_id: str,
    actor: Actor,
    destination_location_id: str,
) -> TravelOutcome:
    origin_location = db.execute(
        select(Location).where(Location.world_id == world_id, Location.id == actor.current_location_id)
    ).scalar_one()
    destination = db.execute(
        select(Location).where(Location.world_id == world_id, Location.id == destination_location_id)
    ).scalar_one_or_none()
    if destination is None:
        raise LookupError("Destination location not found")
    route = get_location_route(
        db,
        world_id=world_id,
        from_location_id=origin_location.id,
        to_location_id=destination.id,
    )
    if route is None:
        raise LookupError("Travel route not found")
    if not _route_accessible(db, world_id=world_id, route=route, actor_id=actor.id):
        raise ValueError("Travel route is not open")

    actor.current_location_id = destination.id
    route_summary = _route_display_summary(route)
    location_updates = [
        {
            "from_location": get_location_summary(db, world_id, origin_location.id),
            "to_location": get_location_summary(db, world_id, destination.id),
            "summary": route_summary or f"{origin_location.name}から{destination.name}へ移動した。",
            "action": "arrived",
        }
    ]
    travel_summary = str(route_summary or f"{destination.name}へ移動した。").strip()
    event_payload = {
        "world_id": world_id,
        "route_id": route.id,
        "route_key": route.route_key,
        "travel_summary": travel_summary,
        "from_location_id": origin_location.id,
        "to_location_id": destination.id,
        "from_location_name": origin_location.name,
        "to_location_name": destination.name,
    }
    event_narrative = f"{actor.display_name}は{origin_location.name}を離れ、{destination.name}へ歩みを進めた。"
    memory_drafts = [
        {
            "scope": "location",
            "text": f"{actor.display_name}は{destination.name}へ辿り着き、その場の空気を新しく読み始めた。",
            "salience": 0.88,
            "location_id": destination.id,
            "actor_id": None,
        },
        {
            "scope": "world",
            "text": f"{actor.display_name}は{origin_location.name}から{destination.name}へ移動した。",
            "salience": 0.82,
            "location_id": destination.id,
            "actor_id": None,
        },
    ]
    db.flush()
    return TravelOutcome(
        destination=destination,
        location_updates=location_updates,
        event_type="travel.arrived",
        event_narrative=event_narrative,
        event_payload=event_payload,
        memory_drafts=memory_drafts,
        travel_summary=travel_summary,
    )


def get_character_summary(db: Session, world_id: str, actor_id: str) -> dict[str, Any]:
    sheet = ensure_character_sheet(db, world_id, actor_id)
    return {
        "actor_id": actor_id,
        "rank": sheet.rank,
        "hp": sheet.hp,
        "focus": sheet.focus,
        "status_json": sheet.status_json,
    }


def list_faction_summaries(db: Session, world_id: str, actor_id: str) -> list[dict[str, Any]]:
    rows = list(
        db.execute(
            select(FactionStanding, Faction)
            .join(Faction, (Faction.id == FactionStanding.faction_id) & (Faction.world_id == FactionStanding.world_id))
            .where(FactionStanding.world_id == world_id, FactionStanding.actor_id == actor_id)
            .order_by(FactionStanding.updated_at.desc(), Faction.id.asc())
        ).all()
    )
    return [faction_summary_to_dict(standing, faction) for standing, faction in rows]


def list_recognized_titles(db: Session, world_id: str, actor_id: str) -> list[dict[str, Any]]:
    rows = list(
        db.execute(
            select(ActorTitleProgress)
            .where(
                ActorTitleProgress.world_id == world_id,
                ActorTitleProgress.actor_id == actor_id,
                ActorTitleProgress.status == "recognized",
            )
            .order_by(ActorTitleProgress.updated_at.desc(), ActorTitleProgress.title_rule_id.asc())
        ).scalars()
    )
    return [title_progress_to_dict(row) for row in rows]


def build_shared_world_context(
    db: Session,
    *,
    world_id: str,
    actor_id: str | None = None,
    location_id: str | None = None,
    include_all_axes: bool = False,
    limit: int = 5,
) -> dict[str, Any]:
    axis_stmt = select(WorldAxisState).where(WorldAxisState.world_id == world_id)
    if not include_all_axes:
        axis_stmt = axis_stmt.where(WorldAxisState.expose_to_session_context.is_(True))
    axes = list(db.execute(axis_stmt.order_by(WorldAxisState.axis_id.asc())).scalars())
    world_axes = [_world_axis_context(axis) for axis in axes]

    factions = list(
        db.execute(select(Faction).where(Faction.world_id == world_id).order_by(Faction.updated_at.desc(), Faction.id.asc())).scalars()
    )
    standings: dict[str, FactionStanding] = {}
    if actor_id is not None:
        standings = {
            standing.faction_id: standing
            for standing in db.execute(
                select(FactionStanding).where(FactionStanding.world_id == world_id, FactionStanding.actor_id == actor_id)
            ).scalars()
        }
    faction_pressure = [
        _faction_pressure_context(faction, standings.get(faction.id))
        for faction in factions
    ]

    location_context = _location_public_context(db, world_id=world_id, location_id=location_id)
    recent_history = _recent_shared_history_context(db, world_id=world_id, location_id=location_id, limit=limit)
    memory_rumors = _rumor_memory_context(db, world_id=world_id, location_id=location_id, limit=limit)
    pack_rumors = [
        str(item).strip()
        for item in (location_context.get("rumor_surface") or [])
        if str(item).strip()
    ]
    rumor_surface = [
        *[
            {
                "source": "pack_location",
                "summary": rumor,
                "location_id": location_id,
                "memory_id": None,
                "source_event_id": None,
            }
            for rumor in pack_rumors[:limit]
        ],
        *memory_rumors,
    ][:limit]

    source_event_ids = _dedupe(
        [
            *[str(axis.get("last_event_id") or "") for axis in world_axes],
            str(location_context.get("last_public_state_event_id") or ""),
            *[str(item.get("source_event_id") or "") for item in recent_history],
            *[str(item.get("source_event_id") or "") for item in rumor_surface],
        ]
    )
    memory_ids = _dedupe([str(item.get("memory_id") or "") for item in rumor_surface])
    axis_event_ids = _dedupe([str(axis.get("last_event_id") or "") for axis in world_axes])

    return {
        "world_axes": world_axes,
        "faction_pressure": faction_pressure,
        "location_public_state": location_context,
        "recent_history": recent_history,
        "rumor_surface": rumor_surface,
        "trace": {
            "world_id": world_id,
            "actor_id": actor_id,
            "location_id": location_id,
            "source_event_ids": source_event_ids,
            "memory_ids": memory_ids,
            "axis_event_ids": axis_event_ids,
        },
    }


def list_quest_summaries(db: Session, world_id: str, actor_id: str) -> list[dict[str, Any]]:
    rows = list(
        db.execute(
            select(QuestAssignment, QuestTemplate)
            .join(
                QuestTemplate,
                (QuestTemplate.id == QuestAssignment.quest_template_id) & (QuestTemplate.world_id == QuestAssignment.world_id),
            )
            .where(QuestAssignment.world_id == world_id, QuestAssignment.owner_actor_id == actor_id)
        ).all()
    )
    rows.sort(key=lambda item: (item[0].status != "active", item[0].created_at, item[0].id))
    return [quest_summary_to_dict(assignment, template) for assignment, template in rows]


def list_quest_journal(db: Session, world_id: str, actor_id: str) -> list[dict[str, Any]]:
    rows = list(
        db.execute(
            select(QuestAssignment, QuestTemplate)
            .join(
                QuestTemplate,
                (QuestTemplate.id == QuestAssignment.quest_template_id) & (QuestTemplate.world_id == QuestAssignment.world_id),
            )
            .where(QuestAssignment.world_id == world_id, QuestAssignment.owner_actor_id == actor_id)
        ).all()
    )
    rows.sort(key=lambda item: (item[0].status not in {"active", "offered", "paused"}, item[0].created_at, item[0].id))
    chapters_by_quest: dict[str, list[dict[str, Any]]] = {}
    chapter_rows = list(
        db.execute(
            select(ChapterTrack)
            .where(ChapterTrack.world_id == world_id, ChapterTrack.owner_actor_id == actor_id)
            .order_by(ChapterTrack.sequence_index.asc(), ChapterTrack.created_at.asc(), ChapterTrack.id.asc())
        ).scalars()
    )
    for chapter in chapter_rows:
        if not chapter.quest_assignment_id:
            continue
        chapters_by_quest.setdefault(chapter.quest_assignment_id, []).append(
            {
                "id": chapter.id,
                "key": chapter.chapter_key,
                "status": chapter.status,
                "chapter_kind": chapter.chapter_kind,
                "sequence_index": chapter.sequence_index,
                "summary": chapter.summary,
            }
        )
    return [
        {
            **quest_summary_to_dict(assignment, template),
            "chapters": chapters_by_quest.get(assignment.id, []),
            "available_actions": _quest_available_actions(db, world_id=world_id, actor_id=actor_id, assignment=assignment),
        }
        for assignment, template in rows
    ]


def _quest_available_actions(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    assignment: QuestAssignment,
) -> list[str]:
    if assignment.status == "offered":
        state_json = dict(assignment.state_json or {})
        actions = ["accept_quest", "decline_quest"]
        if not bool(state_json.get("inline_prompt_ignored")):
            actions.append("ignore_quest")
        return actions
    if assignment.status == "paused":
        return ["resume_quest"]
    if assignment.status != "active":
        return []
    chapter = get_current_chapter_summary(db, world_id, actor_id, include_internal=True)
    chapter_kind = str((chapter or {}).get("chapter_kind") or "")
    locked_reason = str(((chapter or {}).get("state_json") or {}).get("departure_locked_reason") or "")
    if chapter_kind in {"prologue", "epilogue"} or locked_reason:
        return []
    return ["leave_quest"]


def _quest_update_dict(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    assignment: QuestAssignment,
    template: QuestTemplate,
    action: str | None = None,
) -> dict[str, Any]:
    payload = {
        **quest_summary_to_dict(assignment, template),
        "available_actions": _quest_available_actions(db, world_id=world_id, actor_id=actor_id, assignment=assignment),
    }
    if action:
        payload["action"] = action
    return payload


def _chapter_update_dict(chapter: ChapterTrack) -> dict[str, Any]:
    return {
        "id": chapter.id,
        "key": chapter.chapter_key,
        "status": chapter.status,
        "quest_assignment_id": chapter.quest_assignment_id,
        "chapter_kind": chapter.chapter_kind,
        "sequence_index": chapter.sequence_index,
        "summary": chapter.summary,
    }


def quest_display_state(*, player_profile: dict[str, Any] | None, quest_journal: list[dict[str, Any]]) -> dict[str, Any]:
    visible = [item for item in quest_journal if str(item.get("status") or "") in {"offered", "active", "paused"}]
    if visible:
        return {
            "mode": "quest",
            "label": str(visible[0].get("title") or ""),
        }
    play_language = (player_profile or {}).get("play_language") if isinstance(player_profile, dict) else {}
    preset = str((play_language or {}).get("preset") or "").lower() if isinstance(play_language, dict) else ""
    prompt_name = str((play_language or {}).get("prompt_name") or "").lower() if isinstance(play_language, dict) else ""
    label = "探索中..." if preset == "ja" or "japanese" in prompt_name else "Exploring..."
    return {
        "mode": "exploration",
        "label": label,
    }


def _quest_similarity_text(*values: Any) -> str:
    text = " ".join(str(value or "") for value in values)
    return re.sub(r"[\W_]+", "", text.lower(), flags=re.UNICODE)


def _quest_ngrams(text: str, *, size: int = 3) -> set[str]:
    if not text:
        return set()
    if len(text) <= size:
        return {text}
    return {text[index : index + size] for index in range(0, len(text) - size + 1)}


def _quest_text_similarity(left: str, right: str) -> float:
    scores: list[float] = []
    for size in (2, 3):
        left_grams = _quest_ngrams(left, size=size)
        right_grams = _quest_ngrams(right, size=size)
        if left_grams and right_grams:
            scores.append(len(left_grams & right_grams) / len(left_grams | right_grams))
    return max(scores, default=0.0)


def _quest_offer_is_similar(template: QuestTemplate, *, title: str, description: str) -> bool:
    existing_title = _quest_similarity_text(template.title)
    incoming_title = _quest_similarity_text(title)
    if existing_title and incoming_title and existing_title == incoming_title:
        return True
    existing = _quest_similarity_text(template.title, template.description)
    incoming = _quest_similarity_text(title, description)
    return _quest_text_similarity(existing, incoming) >= QUEST_SIMILARITY_THRESHOLD


def quest_offer_repeats_resolution(*, offer: dict[str, Any] | None, resolution_summary: str | None) -> bool:
    if not isinstance(offer, dict) or not offer:
        return False
    resolution = _quest_similarity_text(resolution_summary)
    if not resolution:
        return False
    fields = [
        offer.get("title"),
        offer.get("description"),
        offer.get("summary"),
        offer.get("offered_summary"),
    ]
    for value in fields:
        candidate = _quest_similarity_text(value)
        if candidate and (candidate == resolution or _quest_text_similarity(candidate, resolution) >= 0.75):
            return True
    combined = _quest_similarity_text(*fields)
    return bool(combined and _quest_text_similarity(combined, resolution) >= 0.75)


def _quest_gate_result(
    *,
    allowed: bool,
    reason_code: str,
    reason: str,
    basis: dict[str, Any] | None = None,
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "allowed": allowed,
        "reason_code": reason_code,
        "reason": reason,
        "basis": basis or {},
        "warnings": warnings or [],
    }


def _text_from_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return " ".join(value.split())
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, dict):
        return " ".join(_text_from_value(item) for item in value.values() if _text_from_value(item))
    if isinstance(value, list):
        return " ".join(_text_from_value(item) for item in value if _text_from_value(item))
    return " ".join(str(value).split())


def _quest_offer_text(offer: dict[str, Any]) -> str:
    return _text_from_value(
        [
            offer.get("title"),
            offer.get("description"),
            offer.get("summary"),
            offer.get("offered_summary"),
            offer.get("constraints"),
            offer.get("outcome_basis"),
            offer.get("first_step"),
            offer.get("uncertainty"),
            offer.get("why_now"),
        ]
    )


def _quest_gate_policy(pack_generation_context: dict[str, Any] | None) -> dict[str, Any]:
    policy = dict(QUEST_EMERGENCE_DEFAULT_POLICY)
    context = pack_generation_context if isinstance(pack_generation_context, dict) else {}
    for key in ("quest_generation_constraints", "quest_emergence_policy", "quest_offer_policy"):
        value = context.get(key)
        if isinstance(value, dict):
            for policy_key in QUEST_EMERGENCE_DEFAULT_POLICY:
                if policy_key in value and isinstance(value[policy_key], bool):
                    policy[policy_key] = value[policy_key]
    return policy


def _has_basis_key(offer: dict[str, Any], key: str) -> bool:
    value = offer.get(key)
    if value not in (None, "", [], {}):
        return True
    outcome_basis = offer.get("outcome_basis")
    if isinstance(outcome_basis, dict):
        return outcome_basis.get(key) not in (None, "", [], {})
    if isinstance(outcome_basis, list):
        return any(key in str(item) for item in outcome_basis)
    if isinstance(outcome_basis, str):
        return key in outcome_basis
    return False


def _text_has_any(text: str, fragments: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(fragment.lower() in lowered for fragment in fragments)


def _word_overlap(left: str, right: str) -> float:
    left_normalized = _quest_similarity_text(left)
    right_normalized = _quest_similarity_text(right)
    if not left_normalized or not right_normalized:
        return 0.0
    return _quest_text_similarity(left_normalized, right_normalized)


def _offer_has_player_attention_basis(
    offer: dict[str, Any],
    *,
    player_action_text: str,
    session_state: dict[str, Any],
) -> bool:
    if any(_has_basis_key(offer, key) for key in ("player_attention", "player_action", "why_now")):
        return True
    selected_choice = session_state.get("selected_choice") if isinstance(session_state, dict) else None
    selected_text = _text_from_value(selected_choice if isinstance(selected_choice, dict) else {})
    action_text = _text_from_value([player_action_text, selected_text])
    offer_text = _quest_offer_text(offer)
    if action_text and _word_overlap(action_text, offer_text) >= 0.18:
        return True
    intent_text = _text_from_value((session_state.get("interpreted_intent") or {}) if isinstance(session_state, dict) else {})
    return bool(intent_text and _word_overlap(intent_text, offer_text) >= 0.22)


def _offer_has_context_basis(
    offer: dict[str, Any],
    *,
    current_location: dict[str, Any] | None,
    shared_world_context: dict[str, Any] | None,
) -> bool:
    if any(_has_basis_key(offer, key) for key in ("current_location", "scene_pressure", "world_axis_basis", "faction_basis")):
        return True
    offer_text = _quest_offer_text(offer)
    location_text = _text_from_value(current_location or {})
    if location_text and _word_overlap(location_text, offer_text) >= 0.12:
        return True
    context_text = _text_from_value(shared_world_context or {})
    return bool(context_text and _word_overlap(context_text, offer_text) >= 0.16)


def _offer_has_uncertainty(offer: dict[str, Any]) -> bool:
    if _has_basis_key(offer, "uncertainty"):
        return True
    text = _quest_offer_text(offer)
    return _text_has_any(
        text,
        (
            "uncertain",
            "unknown",
            "unresolved",
            "investigate",
            "trace",
            "clue",
            "未解決",
            "不明",
            "曖昧",
            "疑い",
            "手がかり",
            "調査",
            "探る",
            "確かめる",
        ),
    )


def _offer_has_first_step(offer: dict[str, Any]) -> bool:
    if any(_has_basis_key(offer, key) for key in ("first_step", "actionable_first_step")):
        return True
    text = _quest_offer_text(offer)
    return _text_has_any(
        text,
        (
            "first step",
            "begin by",
            "start by",
            "meet",
            "ask",
            "inspect",
            "follow",
            "まず",
            "最初",
            "会う",
            "聞く",
            "調べる",
            "確認する",
            "向かう",
            "追う",
        ),
    )


def _offer_is_single_next_action(offer: dict[str, Any]) -> bool:
    title = str(offer.get("title") or "").strip()
    description = str(offer.get("description") or offer.get("summary") or "").strip()
    text = _quest_offer_text(offer)
    single_action_phrases = (
        "話を聞く",
        "掲示板を見る",
        "向かう",
        "周囲を観察",
        "もう一度確認",
        "受付で相談",
        "地図を見る",
        "wait",
        "look around",
        "check the board",
        "ask someone",
        "go to",
        "talk to",
    )
    if not _text_has_any(text, single_action_phrases):
        return False
    has_thread_basis = _offer_has_uncertainty(offer) and (
        _has_basis_key(offer, "objective") or _has_basis_key(offer, "why_now") or len(description) >= 40
    )
    return not has_thread_basis or len(_quest_similarity_text(title, description)) < 28


def _offer_is_too_abstract(offer: dict[str, Any]) -> bool:
    text = _quest_offer_text(offer)
    compact = _quest_similarity_text(text)
    if len(compact) < 18:
        return True
    broad_phrases = (
        "世界を探索",
        "冒険を始め",
        "情報を集め",
        "問題を探",
        "町を見て回",
        "explore the world",
        "start an adventure",
        "gather information",
        "find something to do",
    )
    return _text_has_any(text, broad_phrases) and not (_offer_has_uncertainty(offer) and _offer_has_first_step(offer))


def _offer_is_too_conclusive(offer: dict[str, Any]) -> bool:
    text = _quest_offer_text(offer)
    conclusive_phrases = (
        "true culprit",
        "final culprit",
        "final cause",
        "final solution",
        "defeat the final",
        "真犯人",
        "原因が確定",
        "真の原因",
        "解決方法が確定",
        "最終敵",
        "黒幕",
        "すべて解決",
    )
    return _text_has_any(text, conclusive_phrases)


def _offer_similar_to_existing_live_quest(offer: dict[str, Any], session_state: dict[str, Any]) -> bool:
    title = str(offer.get("title") or "").strip()
    description = str(offer.get("description") or offer.get("summary") or "").strip()
    if not title or not description:
        return False
    for quest in [*(session_state.get("quests") or []), *(session_state.get("quest_journal") or [])]:
        if not isinstance(quest, dict):
            continue
        if str(quest.get("status") or "") not in {"offered", "active", "paused"}:
            continue
        existing_title = str(quest.get("title") or "").strip()
        existing_description = str(
            quest.get("description")
            or quest.get("summary")
            or quest.get("latest_summary")
            or quest.get("offered_summary")
            or ""
        ).strip()
        existing_text = _quest_similarity_text(existing_title, existing_description)
        incoming_text = _quest_similarity_text(title, description)
        if existing_title and title and _quest_similarity_text(existing_title) == _quest_similarity_text(title):
            return True
        if existing_text and incoming_text and _quest_text_similarity(existing_text, incoming_text) >= 0.60:
            return True
    return False


def evaluate_quest_emergence_gate(
    *,
    session_state: dict[str, Any],
    offer: dict[str, Any] | None,
    player_action_text: str,
    resolution_summary: str | None,
    is_followup: bool = False,
    has_live_primary_quest: bool = False,
    followup_of_assignment_id: str | None = None,
    pack_generation_context: dict[str, Any] | None = None,
    current_location: dict[str, Any] | None = None,
    shared_world_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(offer, dict) or not offer:
        return _quest_gate_result(
            allowed=False,
            reason_code="no_offer",
            reason="No quest offer was emitted.",
        )

    title = str(offer.get("title") or "").strip()
    description = str(offer.get("description") or offer.get("summary") or "").strip()
    if not title or not description:
        return _quest_gate_result(
            allowed=False,
            reason_code="missing_title_or_description",
            reason="Quest offer requires title and description or summary.",
            basis={"title_present": bool(title), "description_present": bool(description)},
        )

    context = pack_generation_context if isinstance(pack_generation_context, dict) else {}
    if not context and isinstance(session_state, dict):
        context = session_state.get("pack_generation_context") if isinstance(session_state.get("pack_generation_context"), dict) else {}
    policy = _quest_gate_policy(context)
    current_location = current_location or (session_state.get("current_location") if isinstance(session_state, dict) else None)
    shared_world_context = shared_world_context or (
        session_state.get("shared_world_context") if isinstance(session_state, dict) else None
    )
    basis = {
        "policy": policy,
        "player_attention": _offer_has_player_attention_basis(
            offer,
            player_action_text=player_action_text,
            session_state=session_state,
        ),
        "current_context": _offer_has_context_basis(
            offer,
            current_location=current_location if isinstance(current_location, dict) else None,
            shared_world_context=shared_world_context if isinstance(shared_world_context, dict) else None,
        ),
        "uncertainty": _offer_has_uncertainty(offer),
        "first_step": _offer_has_first_step(offer),
        "similar_to_existing_live_quest": _offer_similar_to_existing_live_quest(offer, session_state),
        "repeats_resolution": quest_offer_repeats_resolution(offer=offer, resolution_summary=resolution_summary),
        "is_followup": is_followup,
        "followup_of_assignment_id": followup_of_assignment_id,
    }
    warnings: list[str] = []

    if is_followup and not followup_of_assignment_id:
        return _quest_gate_result(
            allowed=False,
            reason_code="followup_source_missing",
            reason="Follow-up quest offer requires a source assignment.",
            basis=basis,
            warnings=warnings,
        )
    if (
        not is_followup
        and bool(policy.get("suppress_primary_offer_when_live_quest_exists"))
        and has_live_primary_quest
    ):
        return _quest_gate_result(
            allowed=False,
            reason_code="live_primary_quest_exists",
            reason="A live primary quest already occupies the current quest focus.",
            basis=basis,
            warnings=warnings,
        )
    if basis["repeats_resolution"]:
        return _quest_gate_result(
            allowed=False,
            reason_code="repeats_resolution",
            reason="Quest offer repeats the latest resolution summary.",
            basis=basis,
            warnings=warnings,
        )
    if basis["similar_to_existing_live_quest"]:
        return _quest_gate_result(
            allowed=False,
            reason_code="similar_to_existing_live_quest",
            reason="Quest offer is too similar to an existing offered, active, or paused quest.",
            basis=basis,
            warnings=warnings,
        )
    if bool(policy.get("reject_single_action_quests")) and _offer_is_single_next_action(offer):
        return _quest_gate_result(
            allowed=False,
            reason_code="too_early_broad_observation",
            reason="Offer describes a single scene action rather than a playable quest thread.",
            basis=basis,
            warnings=warnings,
        )
    if _offer_is_too_abstract(offer):
        return _quest_gate_result(
            allowed=False,
            reason_code="too_abstract",
            reason="Offer is too broad or abstract to become a quest.",
            basis=basis,
            warnings=warnings,
        )
    if _offer_is_too_conclusive(offer):
        return _quest_gate_result(
            allowed=False,
            reason_code="too_conclusive",
            reason="Offer reveals or settles too much of the final cause, culprit, or solution.",
            basis=basis,
            warnings=warnings,
        )
    if bool(policy.get("require_player_attention_basis")) and not basis["player_attention"]:
        return _quest_gate_result(
            allowed=False,
            reason_code="lacks_player_attention_basis",
            reason="Offer lacks a clear basis in the player's action or attention.",
            basis=basis,
            warnings=warnings,
        )
    if not basis["current_context"]:
        warnings.append("Offer has weak current location or shared world context basis.")
    if bool(policy.get("require_uncertainty")) and not basis["uncertainty"]:
        return _quest_gate_result(
            allowed=False,
            reason_code="not_enough_context",
            reason="Offer lacks unresolved uncertainty.",
            basis=basis,
            warnings=warnings,
        )
    if bool(policy.get("require_first_step")) and not basis["first_step"]:
        return _quest_gate_result(
            allowed=False,
            reason_code="lacks_actionable_first_step",
            reason="Offer lacks a first actionable step.",
            basis=basis,
            warnings=warnings,
        )

    return _quest_gate_result(
        allowed=True,
        reason_code="allowed_followup" if is_followup else "allowed",
        reason="Quest offer has enough player attention, context, uncertainty, and first-step basis.",
        basis=basis,
        warnings=warnings,
    )


def _merge_dynamic_quest_offer(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    assignment: QuestAssignment,
    template: QuestTemplate,
    offer: dict[str, Any],
    source_event_id: str,
) -> dict[str, Any]:
    summary = str(offer.get("offered_summary") or offer.get("description") or offer.get("summary") or "").strip()
    if summary:
        assignment.latest_summary = summary
    state_json = dict(assignment.state_json or {})
    merged_offers = [item for item in state_json.get("merged_offers") or [] if isinstance(item, dict)]
    merged_offers.append(
        {
            "source_event_id": source_event_id,
            "title": str(offer.get("title") or "").strip(),
            "summary": summary,
            "constraints": list(offer.get("constraints") or []),
        }
    )
    state_json["merged_offers"] = merged_offers[-5:]
    state_json["last_merged_offer_event_id"] = source_event_id
    assignment.state_json = state_json
    db.flush()
    return _quest_update_dict(
        db,
        world_id=world_id,
        actor_id=actor_id,
        assignment=assignment,
        template=template,
        action="merged_existing",
    )


def create_dynamic_quest_offer(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    source_event_id: str,
    offer: dict[str, Any] | None,
    followup_of_assignment_id: str | None = None,
) -> list[dict[str, Any]]:
    if not isinstance(offer, dict) or not offer:
        return []
    title = str(offer.get("title") or "").strip()
    description = str(offer.get("description") or offer.get("summary") or "").strip()
    if not title or not description:
        return []
    live_rows = list(
        db.execute(
            select(QuestAssignment, QuestTemplate)
            .join(
                QuestTemplate,
                (QuestTemplate.id == QuestAssignment.quest_template_id) & (QuestTemplate.world_id == QuestAssignment.world_id),
            )
            .where(
                QuestAssignment.world_id == world_id,
                QuestAssignment.owner_actor_id == actor_id,
                QuestAssignment.status.in_(("offered", "active", "paused")),
            )
            .order_by(
                (QuestAssignment.status == "active").desc(),
                (QuestAssignment.status == "offered").desc(),
                QuestAssignment.updated_at.desc(),
                QuestAssignment.id.desc(),
            )
        ).all()
    )
    for assignment, template in live_rows:
        if _quest_offer_is_similar(template, title=title, description=description):
            if assignment.status != "offered":
                return []
            return [
                _merge_dynamic_quest_offer(
                    db,
                    world_id=world_id,
                    actor_id=actor_id,
                    assignment=assignment,
                    template=template,
                    offer=offer,
                    source_event_id=source_event_id,
                )
            ]

    if live_rows:
        return []

    if followup_of_assignment_id:
        source_assignment = db.execute(
            select(QuestAssignment).where(
                QuestAssignment.world_id == world_id,
                QuestAssignment.owner_actor_id == actor_id,
                QuestAssignment.id == followup_of_assignment_id,
                QuestAssignment.status == "completed",
            )
        ).scalar_one_or_none()
        if source_assignment is None:
            return []

    superseded_updates: list[dict[str, Any]] = []
    offered_rows = [
        (assignment, template)
        for assignment, template in sorted(live_rows, key=lambda item: (item[0].created_at, item[0].id))
        if assignment.status == "offered"
    ]
    while len(offered_rows) >= MAX_OFFERED_QUESTS:
        stale_assignment, stale_template = offered_rows.pop(0)
        stale_assignment.status = "superseded"
        stale_assignment.latest_summary = f"{stale_template.title} was superseded by a newer quest offer."
        db.flush()
        superseded_updates.append(
            _quest_update_dict(
                db,
                world_id=world_id,
                actor_id=actor_id,
                assignment=stale_assignment,
                template=stale_template,
                action="superseded",
            )
        )

    existing_active = db.execute(
        select(QuestAssignment, QuestTemplate)
        .join(
            QuestTemplate,
            (QuestTemplate.id == QuestAssignment.quest_template_id) & (QuestTemplate.world_id == QuestAssignment.world_id),
        )
        .where(
            QuestAssignment.world_id == world_id,
            QuestAssignment.owner_actor_id == actor_id,
            QuestAssignment.status.in_(("offered", "active", "paused")),
            QuestTemplate.title == title,
        )
    ).first()
    if existing_active is not None:
        assignment, template = existing_active
        return [
            {
                **quest_summary_to_dict(assignment, template),
                "action": "offered_existing",
                "available_actions": _quest_available_actions(db, world_id=world_id, actor_id=actor_id, assignment=assignment),
            }
        ]

    template_id = f"dynamic_quest_{source_event_id.replace('-', '')[:20]}"
    if followup_of_assignment_id:
        template_id = f"followup_quest_{source_event_id.replace('-', '')[:19]}"
    template = QuestTemplate(
        id=template_id,
        world_id=world_id,
        title=title[:160],
        description=description,
        status="active",
        stage_key=str(offer.get("stage_key") or template_id)[:96],
        unlock_requirements=dict(offer.get("unlock_requirements") or {}),
        reward_template_key=str(offer.get("reward_template_key") or "none")[:96],
        reward_name=str(offer.get("reward_name") or "")[:120],
        reward_description=str(offer.get("reward_description") or ""),
        state={
            "dynamic": True,
            "source_event_id": source_event_id,
            "followup_of_assignment_id": followup_of_assignment_id,
            "seed": dict(offer),
            "reward_enabled": bool(offer.get("reward_name") or offer.get("reward_template_key")),
        },
    )
    db.add(template)
    db.flush()
    assignment = QuestAssignment(
        world_id=world_id,
        owner_actor_id=actor_id,
        quest_template_id=template.id,
        status="offered",
        latest_summary=str(offer.get("offered_summary") or description),
        state_json={
            "dynamic": True,
            "source_event_id": source_event_id,
            "followup_of_assignment_id": followup_of_assignment_id,
            "constraints": list(offer.get("constraints") or []),
            "outcome_basis": offer.get("outcome_basis"),
        },
    )
    db.add(assignment)
    db.flush()
    return [
        *superseded_updates,
        {
            **quest_summary_to_dict(assignment, template),
            "action": "offered",
            "available_actions": _quest_available_actions(db, world_id=world_id, actor_id=actor_id, assignment=assignment),
            "chapters": [],
        }
    ]


def _pause_other_active_quests(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    keep_assignment_id: str,
) -> list[dict[str, Any]]:
    rows = list(
        db.execute(
            select(QuestAssignment, QuestTemplate)
            .join(
                QuestTemplate,
                (QuestTemplate.id == QuestAssignment.quest_template_id) & (QuestTemplate.world_id == QuestAssignment.world_id),
            )
            .where(
                QuestAssignment.world_id == world_id,
                QuestAssignment.owner_actor_id == actor_id,
                QuestAssignment.status == "active",
                QuestAssignment.id != keep_assignment_id,
            )
            .order_by(QuestAssignment.updated_at.desc(), QuestAssignment.id.desc())
        ).all()
    )
    updates: list[dict[str, Any]] = []
    for assignment, template in rows:
        assignment.status = "paused"
        assignment.latest_summary = f"{template.title} is paused while another quest is in focus."
        updates.append(
            _quest_update_dict(
                db,
                world_id=world_id,
                actor_id=actor_id,
                assignment=assignment,
                template=template,
                action="paused_by_focus_change",
            )
        )
    if updates:
        db.flush()
    return updates


def _open_epilogue_chapter_for_assignment(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    source_event_id: str,
    assignment: QuestAssignment,
    template: QuestTemplate,
    summary: str,
) -> list[dict[str, Any]]:
    current = db.execute(
        select(ChapterTrack)
        .where(
            ChapterTrack.world_id == world_id,
            ChapterTrack.owner_actor_id == actor_id,
            ChapterTrack.quest_assignment_id == assignment.id,
            ChapterTrack.status.in_(("active", "cooling")),
        )
        .order_by(ChapterTrack.sequence_index.desc(), ChapterTrack.created_at.desc(), ChapterTrack.id.desc())
    ).scalars().first()
    if current is not None and current.chapter_kind == "epilogue":
        current.summary = summary or current.summary
        current.updated_at = datetime.now(timezone.utc)
        db.flush()
        return [_chapter_update_dict(current)]

    now = datetime.now(timezone.utc)
    next_index = 0
    if current is not None:
        current.status = "resolved"
        current.closing_event_id = source_event_id
        current.resolved_at = now
        current.updated_at = now
        next_index = current.sequence_index + 1
    chapter = ChapterTrack(
        world_id=world_id,
        owner_actor_id=actor_id,
        quest_assignment_id=assignment.id,
        chapter_key=f"{template.stage_key}:epilogue:{next_index}",
        chapter_kind="epilogue",
        sequence_index=next_index,
        status="active",
        summary=summary or f"{template.title} reaches its aftermath. {assignment.latest_summary}",
        state_json={"departure_locked_reason": "The epilogue must settle before leaving this quest."},
        opening_event_id=source_event_id,
        opened_at=now,
    )
    db.add(chapter)
    db.flush()
    return [_chapter_update_dict(chapter)]


def record_quest_resolution_hint(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    source_event_id: str,
    hint: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if not isinstance(hint, dict) or not hint:
        return []
    title = str(hint.get("title") or hint.get("quest_title") or "").strip()
    summary = str(hint.get("summary") or hint.get("resolution_summary") or hint.get("outcome_summary") or "").strip()
    if not title and not summary:
        return []
    rows = list(
        db.execute(
            select(QuestAssignment, QuestTemplate)
            .join(
                QuestTemplate,
                (QuestTemplate.id == QuestAssignment.quest_template_id) & (QuestTemplate.world_id == QuestAssignment.world_id),
            )
            .where(
                QuestAssignment.world_id == world_id,
                QuestAssignment.owner_actor_id == actor_id,
                QuestAssignment.status.in_(("active", "paused", "offered")),
            )
            .order_by(
                (QuestAssignment.status == "active").desc(),
                (QuestAssignment.status == "paused").desc(),
                QuestAssignment.updated_at.desc(),
                QuestAssignment.id.desc(),
            )
        ).all()
    )
    active_rows = [(assignment, template) for assignment, template in rows if assignment.status == "active"]
    for assignment, template in rows:
        title_matches = bool(title and _quest_offer_is_similar(template, title=title, description=summary))
        single_active_summary_hint = assignment.status == "active" and not title and bool(summary) and len(active_rows) == 1
        if not title_matches and not single_active_summary_hint:
            continue
        if assignment.status == "active":
            state_json = dict(assignment.state_json or {})
            state_json["resolved_from_resolution_hint_event_id"] = source_event_id
            state_json["resolution_hint"] = dict(hint)
            assignment.state_json = state_json
            assignment.status = "completed"
            assignment.latest_summary = summary or f"{template.title} is complete."
            _open_epilogue_chapter_for_assignment(
                db,
                world_id=world_id,
                actor_id=actor_id,
                source_event_id=source_event_id,
                assignment=assignment,
                template=template,
                summary=assignment.latest_summary,
            )
            db.flush()
            return [
                _quest_update_dict(
                    db,
                    world_id=world_id,
                    actor_id=actor_id,
                    assignment=assignment,
                    template=template,
                    action="completed_from_resolution_hint",
                )
            ]
        state_json = dict(assignment.state_json or {})
        state_json["pending_resolution"] = {
            "source_event_id": source_event_id,
            "title": title or template.title,
            "summary": summary or f"{template.title} is ready to resolve when resumed.",
            "hint": dict(hint),
        }
        assignment.state_json = state_json
        assignment.latest_summary = summary or assignment.latest_summary
        db.flush()
        return [
            _quest_update_dict(
                db,
                world_id=world_id,
                actor_id=actor_id,
                assignment=assignment,
                template=template,
                action="deferred_resolution_recorded",
            )
        ]
    return []


def apply_quest_lifecycle_action(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    quest_assignment_id: str,
    action_type: str,
    source_event_id: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str]:
    row = db.execute(
        select(QuestAssignment, QuestTemplate)
        .join(
            QuestTemplate,
            (QuestTemplate.id == QuestAssignment.quest_template_id) & (QuestTemplate.world_id == QuestAssignment.world_id),
        )
        .where(
            QuestAssignment.world_id == world_id,
            QuestAssignment.owner_actor_id == actor_id,
            QuestAssignment.id == quest_assignment_id,
        )
    ).one_or_none()
    if row is None:
        raise LookupError("Quest assignment not found")
    assignment, template = row
    now = datetime.now(timezone.utc)
    chapter_updates: list[dict[str, Any]] = []

    if action_type == "accept_quest":
        if assignment.status != "offered":
            raise ValueError("Only offered quests can be accepted")
        assignment.status = "active"
        assignment.latest_summary = f"{template.title} has begun."
        focus_updates = _pause_other_active_quests(
            db,
            world_id=world_id,
            actor_id=actor_id,
            keep_assignment_id=assignment.id,
        )
        chapter = ChapterTrack(
            world_id=world_id,
            owner_actor_id=actor_id,
            quest_assignment_id=assignment.id,
            chapter_key=f"{template.stage_key}:prologue",
            chapter_kind="prologue",
            sequence_index=0,
            status="active",
            summary=f"{template.title} begins. {template.description}",
            state_json={"departure_locked_reason": "The prologue must settle before leaving this quest."},
            opening_event_id=source_event_id,
            opened_at=now,
        )
        db.add(chapter)
        db.flush()
        chapter_updates.append(_chapter_update_dict(chapter))
        return [
            _quest_update_dict(
                db,
                world_id=world_id,
                actor_id=actor_id,
                assignment=assignment,
                template=template,
                action="accepted",
            ),
            *focus_updates,
        ], chapter_updates, f"{template.title} begins."

    if action_type == "decline_quest":
        if assignment.status != "offered":
            raise ValueError("Only offered quests can be declined")
        assignment.status = "declined"
        assignment.latest_summary = f"{template.title} was declined for now."
        db.flush()
        return [{**quest_summary_to_dict(assignment, template), "action": "declined"}], chapter_updates, f"{template.title} is left aside."

    if action_type == "ignore_quest":
        if assignment.status != "offered":
            raise ValueError("Only offered quests can be ignored")
        state_json = dict(assignment.state_json or {})
        state_json["inline_prompt_ignored"] = True
        state_json["inline_prompt_ignored_at_event_id"] = source_event_id
        assignment.state_json = state_json
        assignment.latest_summary = f"{template.title} remains available, but it is no longer interrupting the current scene."
        db.flush()
        return [
            _quest_update_dict(
                db,
                world_id=world_id,
                actor_id=actor_id,
                assignment=assignment,
                template=template,
                action="ignored",
            )
        ], chapter_updates, f"{template.title} is left available for later."

    if action_type == "leave_quest":
        if assignment.status != "active":
            raise ValueError("Only active quests can be left")
        current_chapter = get_current_chapter_summary(db, world_id, actor_id, include_internal=True)
        chapter_kind = str((current_chapter or {}).get("chapter_kind") or "")
        locked_reason = str(((current_chapter or {}).get("state_json") or {}).get("departure_locked_reason") or "")
        if chapter_kind in {"prologue", "epilogue"}:
            raise ValueError("This quest cannot be left during its prologue or epilogue")
        if locked_reason:
            raise ValueError(locked_reason)
        assignment.status = "paused"
        assignment.latest_summary = f"{template.title} is paused and can be resumed later."
        db.flush()
        return [{**quest_summary_to_dict(assignment, template), "action": "left"}], chapter_updates, f"{template.title} is paused."

    if action_type == "resume_quest":
        if assignment.status != "paused":
            raise ValueError("Only paused quests can be resumed")
        state_json = dict(assignment.state_json or {})
        pending_resolution = state_json.get("pending_resolution") if isinstance(state_json.get("pending_resolution"), dict) else None
        assignment.status = "active"
        focus_updates = _pause_other_active_quests(
            db,
            world_id=world_id,
            actor_id=actor_id,
            keep_assignment_id=assignment.id,
        )
        if pending_resolution:
            summary = str(pending_resolution.get("summary") or f"{template.title} resolves from earlier actions.").strip()
            state_json.pop("pending_resolution", None)
            state_json["resolved_from_pending_event_id"] = pending_resolution.get("source_event_id")
            assignment.state_json = state_json
            assignment.status = "completed"
            assignment.latest_summary = summary
            chapter_updates.extend(
                _open_epilogue_chapter_for_assignment(
                    db,
                    world_id=world_id,
                    actor_id=actor_id,
                    source_event_id=source_event_id,
                    assignment=assignment,
                    template=template,
                    summary=summary,
                )
            )
            db.flush()
            return [
                _quest_update_dict(
                    db,
                    world_id=world_id,
                    actor_id=actor_id,
                    assignment=assignment,
                    template=template,
                    action="resumed",
                ),
                *focus_updates,
            ], chapter_updates, summary
        assignment.latest_summary = f"{template.title} has resumed."
        db.flush()
        return [
            _quest_update_dict(
                db,
                world_id=world_id,
                actor_id=actor_id,
                assignment=assignment,
                template=template,
                action="resumed",
            ),
            *focus_updates,
        ], chapter_updates, f"{template.title} resumes."

    raise ValueError(f"Unsupported quest action: {action_type}")


def apply_quest_lifecycle_directive(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    source_event_id: str,
    directive: dict[str, Any] | None,
) -> dict[str, list[dict[str, Any]]]:
    """Apply the AI GM's judgment that the player set aside (paused) or returned to (resumed)
    a quest.

    Like quest completion, leaving and resuming a quest are the AI GM's narrative judgment,
    expressed in its canonical ``quest_lifecycle_directive`` output (see ADR-003). The player
    conveys the intent through ``player_action_text`` only; deterministic code never decides
    the action from that text. It just verifies a single eligible quest exists and applies the
    canonical transition, so the narrative and the journal change come from the same turn and
    cannot diverge:

    - ``disposition == "paused"`` pauses the single active quest (unless its prologue/epilogue
      locks departure).
    - ``disposition == "resumed"`` reactivates the most recently paused quest.
    """
    empty: dict[str, list[dict[str, Any]]] = {"quest_updates": [], "inventory_updates": [], "chapter_updates": []}
    directive = directive if isinstance(directive, dict) else {}
    disposition = str(directive.get("disposition") or "").strip().lower()
    if disposition == "paused":
        active = _active_progression_quest(db, world_id=world_id, actor_id=actor_id)
        if active is None:
            return empty
        assignment, _template = active
        action_type = "leave_quest"
    elif disposition == "resumed":
        paused_row = db.execute(
            select(QuestAssignment, QuestTemplate)
            .join(
                QuestTemplate,
                (QuestTemplate.id == QuestAssignment.quest_template_id) & (QuestTemplate.world_id == QuestAssignment.world_id),
            )
            .where(
                QuestAssignment.world_id == world_id,
                QuestAssignment.owner_actor_id == actor_id,
                QuestAssignment.status == "paused",
            )
            .order_by(QuestAssignment.updated_at.desc(), QuestAssignment.id.desc())
        ).first()
        if paused_row is None:
            return empty
        assignment, _template = paused_row
        action_type = "resume_quest"
    else:
        return empty
    try:
        quest_updates, chapter_updates, _summary = apply_quest_lifecycle_action(
            db,
            world_id=world_id,
            actor_id=actor_id,
            quest_assignment_id=assignment.id,
            action_type=action_type,
            source_event_id=source_event_id,
        )
    except (LookupError, ValueError):
        # Leaving is locked during prologue/epilogue, or the quest changed underfoot. The
        # narrative already accounts for the moment; the journal simply does not transition.
        return empty
    return {"quest_updates": quest_updates, "inventory_updates": [], "chapter_updates": chapter_updates}


def apply_dynamic_chapter_progression(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    source_event_id: str,
    chapter_directive: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    active_row = db.execute(
        select(QuestAssignment, QuestTemplate)
        .join(
            QuestTemplate,
            (QuestTemplate.id == QuestAssignment.quest_template_id) & (QuestTemplate.world_id == QuestAssignment.world_id),
        )
        .where(
            QuestAssignment.world_id == world_id,
            QuestAssignment.owner_actor_id == actor_id,
            QuestAssignment.status.in_(("active", "completed")),
        )
        .order_by((QuestAssignment.status == "active").desc(), QuestAssignment.updated_at.desc(), QuestAssignment.id.desc())
    ).first()
    if active_row is None:
        return []
    assignment, template = active_row
    current = db.execute(
        select(ChapterTrack)
        .where(
            ChapterTrack.world_id == world_id,
            ChapterTrack.owner_actor_id == actor_id,
            ChapterTrack.quest_assignment_id == assignment.id,
            ChapterTrack.status.in_(("active", "cooling")),
        )
        .order_by(ChapterTrack.sequence_index.desc(), ChapterTrack.created_at.desc(), ChapterTrack.id.desc())
    ).scalars().first()
    if current is None:
        return []

    now = datetime.now(timezone.utc)
    updates: list[dict[str, Any]] = []
    directive = chapter_directive if isinstance(chapter_directive, dict) else {}
    directive_action = str(directive.get("action") or "").strip().lower()
    directive_kind = str(directive.get("chapter_kind") or "").strip().lower()
    directive_summary = str(directive.get("summary") or directive.get("chapter_summary") or "").strip()
    directive_constraints = [str(item) for item in directive.get("constraints") or [] if str(item).strip()]
    directive_locked_reason = str(directive.get("departure_locked_reason") or "").strip()

    if directive:
        state_json = dict(current.state_json or {})
        if directive_constraints:
            existing_constraints = [str(item) for item in state_json.get("constraints") or [] if str(item).strip()]
            state_json["constraints"] = [*existing_constraints, *directive_constraints]
        if "departure_locked_reason" in directive:
            state_json["departure_locked_reason"] = directive_locked_reason
        if directive.get("event_source"):
            state_json["event_source"] = directive.get("event_source")
        current.state_json = state_json
        if directive_summary:
            current.summary = directive_summary
        current.updated_at = now

    if (
        assignment.status == "active"
        and current.chapter_kind == "body"
        and directive_action == "close"
        and directive_kind == "epilogue"
    ):
        assignment.status = "completed"
        assignment.latest_summary = directive_summary or f"{template.title} reaches its aftermath."

    if (
        assignment.status == "active"
        and current.chapter_kind == "body"
        and directive_action == "open"
        and directive_kind in {"", "body"}
    ):
        current.status = "resolved"
        current.closing_event_id = source_event_id
        current.resolved_at = now
        current.updated_at = now
        chapter = ChapterTrack(
            world_id=world_id,
            owner_actor_id=actor_id,
            quest_assignment_id=assignment.id,
            chapter_key=f"{template.stage_key}:body:{current.sequence_index + 1}",
            chapter_kind="body",
            sequence_index=current.sequence_index + 1,
            status="active",
            summary=directive_summary or f"{template.title} turns into a new chapter.",
            state_json={
                "departure_locked_reason": directive_locked_reason,
                "constraints": directive_constraints,
                "event_source": directive.get("event_source"),
            },
            opening_event_id=source_event_id,
            opened_at=now,
        )
        db.add(chapter)
        db.flush()
        updates.append(
            {
                "id": chapter.id,
                "key": chapter.chapter_key,
                "status": chapter.status,
                "quest_assignment_id": chapter.quest_assignment_id,
                "chapter_kind": chapter.chapter_kind,
                "sequence_index": chapter.sequence_index,
                "summary": chapter.summary,
            }
        )
    if assignment.status == "active" and current.chapter_kind == "prologue":
        current.status = "resolved"
        current.closing_event_id = source_event_id
        current.resolved_at = now
        current.updated_at = now
        chapter = ChapterTrack(
            world_id=world_id,
            owner_actor_id=actor_id,
            quest_assignment_id=assignment.id,
            chapter_key=f"{template.stage_key}:body:{current.sequence_index + 1}",
            chapter_kind="body",
            sequence_index=current.sequence_index + 1,
            status="active",
            summary=f"{template.title} continues through the player's choices.",
            state_json={"departure_locked_reason": ""},
            opening_event_id=source_event_id,
            opened_at=now,
        )
        db.add(chapter)
        db.flush()
        updates.append(
            {
                "id": chapter.id,
                "key": chapter.chapter_key,
                "status": chapter.status,
                "quest_assignment_id": chapter.quest_assignment_id,
                "chapter_kind": chapter.chapter_kind,
                "sequence_index": chapter.sequence_index,
                "summary": chapter.summary,
            }
        )
    elif assignment.status == "completed" and current.chapter_kind != "epilogue":
        current.status = "resolved"
        current.closing_event_id = source_event_id
        current.resolved_at = now
        current.updated_at = now
        chapter = ChapterTrack(
            world_id=world_id,
            owner_actor_id=actor_id,
            quest_assignment_id=assignment.id,
            chapter_key=f"{template.stage_key}:epilogue:{current.sequence_index + 1}",
            chapter_kind="epilogue",
            sequence_index=current.sequence_index + 1,
            status="active",
            summary=f"{template.title} reaches its aftermath. {assignment.latest_summary}",
            state_json={"departure_locked_reason": "The epilogue must settle before leaving this quest."},
            opening_event_id=source_event_id,
            opened_at=now,
        )
        db.add(chapter)
        db.flush()
        updates.append(
            {
                "id": chapter.id,
                "key": chapter.chapter_key,
                "status": chapter.status,
                "quest_assignment_id": chapter.quest_assignment_id,
                "chapter_kind": chapter.chapter_kind,
                "sequence_index": chapter.sequence_index,
                "summary": chapter.summary,
            }
        )
    if updates:
        db.flush()
    return updates


def _world_axis_context(axis: WorldAxisState) -> dict[str, Any]:
    threshold = _active_axis_threshold(float(axis.current_value), axis.thresholds or [])
    return {
        "axis_id": axis.axis_id,
        "display_name": axis.display_name,
        "description": axis.description,
        "current_value": axis.current_value,
        "min_value": axis.min_value,
        "max_value": axis.max_value,
        "threshold": threshold,
        "last_event_id": axis.last_event_id,
    }


def _active_axis_threshold(current_value: float, thresholds: list[dict[str, Any]]) -> dict[str, Any] | None:
    candidates = [
        threshold
        for threshold in thresholds
        if isinstance(threshold, dict) and float(threshold.get("value") or 0.0) <= current_value
    ]
    if not candidates:
        return None
    selected = max(candidates, key=lambda item: float(item.get("value") or 0.0))
    return {
        "key": str(selected.get("key") or ""),
        "label": str(selected.get("label") or ""),
        "value": float(selected.get("value") or 0.0),
        "description": str(selected.get("description") or ""),
    }


def _faction_pressure_context(faction: Faction, standing: FactionStanding | None) -> dict[str, Any]:
    state = dict(faction.state or {})
    influence = float(state.get("influence") or 0.0)
    return {
        "faction_id": faction.id,
        "pack_faction_id": str(state.get("pack_faction_id") or faction.id),
        "name": faction.name,
        "description": faction.description,
        "policy": str(state.get("policy") or ""),
        "influence": influence,
        "standing": None if standing is None else standing.standing,
        "standing_band": None if standing is None else standing.band,
        "world_axis_interests": dict(state.get("world_axis_interests") or {}),
        "location_keys": list(state.get("location_keys") or []),
        "last_influence_event_id": state.get("last_influence_event_id"),
    }


def _location_public_context(db: Session, *, world_id: str, location_id: str | None) -> dict[str, Any]:
    if location_id is None:
        return {
            "location_id": None,
            "location_key": None,
            "name": None,
            "public_state": {},
            "rumor_surface": [],
            "related_factions": [],
            "related_world_axes": [],
            "last_public_state_event_id": None,
        }
    location = db.execute(
        select(Location).where(Location.world_id == world_id, Location.id == location_id)
    ).scalar_one_or_none()
    if location is None:
        return {
            "location_id": location_id,
            "location_key": None,
            "name": None,
            "public_state": {},
            "rumor_surface": [],
            "related_factions": [],
            "related_world_axes": [],
            "last_public_state_event_id": None,
        }
    state = dict(location.state or {})
    return {
        "location_id": location.id,
        "location_key": str(state.get("key") or ""),
        "name": location.name,
        "public_state": dict(state.get("public_state") or {}),
        "rumor_surface": list(state.get("rumor_surface") or []),
        "related_factions": list(state.get("related_factions") or []),
        "related_world_axes": list(state.get("related_world_axes") or []),
        "last_public_state_event_id": state.get("last_public_state_event_id"),
    }


def _recent_shared_history_context(
    db: Session,
    *,
    world_id: str,
    location_id: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    rows = list(
        db.execute(
            select(SharedHistoryRecord)
            .where(SharedHistoryRecord.world_id == world_id)
            .order_by(
                (SharedHistoryRecord.location_id == location_id).desc(),
                SharedHistoryRecord.salience.desc(),
                SharedHistoryRecord.created_at.desc(),
                SharedHistoryRecord.id.desc(),
            )
            .limit(limit)
        ).scalars()
    )
    rows.sort(key=lambda item: (item.location_id != location_id, -float(item.salience), -item.created_at.timestamp(), item.id))
    return [
        {
            "id": record.id,
            "source_event_id": record.source_event_id,
            "actor_id": record.actor_id,
            "location_id": record.location_id,
            "history_rule_id": record.history_rule_id,
            "level": record.level,
            "status": record.status,
            "summary": record.summary,
            "salience": record.salience,
            "tags": list(record.tags or []),
        }
        for record in rows
    ]


def _rumor_memory_context(
    db: Session,
    *,
    world_id: str,
    location_id: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    rows = list(
        db.execute(
            select(Memory)
            .where(
                Memory.world_id == world_id,
                Memory.actor_id.is_(None),
                Memory.scope.in_(("location", "world")),
            )
            .order_by(
                (Memory.location_id == location_id).desc(),
                Memory.salience.desc(),
                Memory.created_at.desc(),
                Memory.id.desc(),
            )
            .limit(limit * 2)
        ).scalars()
    )
    rows = [
        memory
        for memory in rows
        if memory.location_id in {location_id, None}
    ][:limit]
    return [
        {
            "source": memory.scope,
            "summary": memory.text,
            "location_id": memory.location_id,
            "memory_id": memory.id,
            "source_event_id": memory.source_event_id,
            "salience": memory.salience,
        }
        for memory in rows
    ]


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def list_inventory_summaries(db: Session, world_id: str, actor_id: str) -> list[dict[str, Any]]:
    items = list(
        db.execute(
            select(Item)
            .where(Item.world_id == world_id, Item.owner_actor_id == actor_id)
            .order_by(Item.created_at.asc(), Item.id.asc())
        ).scalars()
    )
    return [item_summary_to_dict(item) for item in items]


def list_knowledge_summaries(db: Session, world_id: str, actor_id: str, entry_kind: str) -> list[dict[str, Any]]:
    rows = list(
        db.execute(
            select(ActorKnowledgeEntry)
            .where(
                ActorKnowledgeEntry.world_id == world_id,
                ActorKnowledgeEntry.actor_id == actor_id,
                ActorKnowledgeEntry.entry_kind == entry_kind,
                ActorKnowledgeEntry.status == "active",
            )
            .order_by(ActorKnowledgeEntry.created_at.asc(), ActorKnowledgeEntry.id.asc())
        ).scalars()
    )
    return [knowledge_entry_to_dict(item) for item in rows]


def _state_draft_items(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]
    return []


def _state_draft_text(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float, bool)):
            return str(value)
    return ""


def _state_draft_key(value: str, *, fallback: str) -> str:
    normalized = re.sub(r"[^a-z0-9_]+", "_", value.strip().lower().replace("-", "_"))
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    if not normalized:
        normalized = fallback
    return normalized[:96]


def _trade_context_requires_consideration(
    *,
    input_text: str,
    shared_action_tag: str,
    trade_terms: list[dict[str, Any]],
) -> bool:
    if shared_action_tag in {"trade", "negotiate"} or trade_terms:
        return True
    lowered = input_text.lower()
    return any(
        token in input_text or token in lowered
        for token in ("市場", "取引", "情報屋", "露店", "market", "trade", "deal", "broker", "informant", "stall")
    )


def _valid_trade_terms(trade_terms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    valid: list[dict[str, Any]] = []
    for term in trade_terms:
        consideration_kind = _state_draft_text(term.get("consideration_kind"), term.get("cost_kind")).lower()
        consideration_summary = _state_draft_text(term.get("consideration_summary"), term.get("cost_summary"), term.get("summary"))
        if consideration_kind in {"", "none", "free", "no_cost", "no_consideration"} or not consideration_summary:
            continue
        valid.append(
            {
                "trade_id": _state_draft_text(term.get("trade_id"), term.get("id")) or new_id(),
                "counterparty": _state_draft_text(term.get("counterparty"), term.get("counterparty_name")),
                "received_summary": _state_draft_text(term.get("received_summary"), term.get("received"), term.get("asset_summary")),
                "consideration_kind": consideration_kind,
                "consideration_summary": consideration_summary,
                "status": _state_draft_text(term.get("status")) or "settled",
            }
        )
    return valid


def materialize_state_drafts(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    source_event_id: str,
    input_text: str,
    state_drafts: dict[str, Any] | None,
    shared_action_tag: str = "none",
) -> StateDraftMaterializationOutcome:
    drafts = state_drafts if isinstance(state_drafts, dict) else {}
    acquired_items = _state_draft_items(drafts.get("acquired_items"))
    known_facts = _state_draft_items(drafts.get("known_facts"))
    skills = _state_draft_items(drafts.get("skills"))
    trade_terms = _state_draft_items(drafts.get("trade_terms"))
    valid_trade_updates = _valid_trade_terms(trade_terms)
    blocked: list[dict[str, Any]] = []
    trade_requires_consideration = _trade_context_requires_consideration(
        input_text=input_text,
        shared_action_tag=shared_action_tag,
        trade_terms=trade_terms,
    )
    item_materialization_allowed = not (acquired_items and trade_requires_consideration and not valid_trade_updates)
    if acquired_items and not item_materialization_allowed:
        blocked.append(
            {
                "draft_kind": "acquired_items",
                "reason": "market_trade_missing_consideration",
                "summary": "Market acquisition was blocked because no non-currency consideration was recorded.",
            }
        )

    inventory_updates: list[dict[str, Any]] = []
    if item_materialization_allowed:
        for index, draft in enumerate(acquired_items):
            name = _state_draft_text(draft.get("name"), draft.get("title"))
            if not name:
                continue
            name = name[:120]
            template_key = _state_draft_text(draft.get("template_key"))
            if not template_key:
                template_key = _state_draft_key(name, fallback=f"state_item_{index + 1}")
            description = _state_draft_text(draft.get("description"), draft.get("summary"))
            existing = db.execute(
                select(Item).where(
                    Item.world_id == world_id,
                    Item.owner_actor_id == actor_id,
                    Item.template_key == template_key,
                    Item.source_quest_assignment_id.is_(None),
                )
            ).scalars().first()
            if existing is None:
                item = Item(
                    id=new_id(),
                    world_id=world_id,
                    owner_actor_id=actor_id,
                    template_key=template_key,
                    name=name,
                    description=description,
                    status=_state_draft_text(draft.get("status")) or "active",
                    effect_kind=_state_draft_text(draft.get("effect_kind")) or None,
                    effect_payload={
                        "source_event_id": source_event_id,
                        "item_kind": _state_draft_text(draft.get("item_kind"), draft.get("asset_kind")) or "asset",
                        "acquisition_summary": _state_draft_text(draft.get("acquisition_summary"), draft.get("summary")),
                    },
                )
                db.add(item)
                action = "added"
            else:
                item = existing
                item.name = name
                item.description = description or item.description
                item.status = item.status or "active"
                item.effect_payload = {
                    **dict(item.effect_payload or {}),
                    "source_event_id": source_event_id,
                    "acquisition_summary": _state_draft_text(draft.get("acquisition_summary"), draft.get("summary")),
                }
                action = "updated"
            db.flush()
            inventory_updates.append({**item_summary_to_dict(item), "action": action})

    knowledge_updates = _materialize_knowledge_entries(
        db,
        world_id=world_id,
        actor_id=actor_id,
        source_event_id=source_event_id,
        entry_kind="known_fact",
        drafts=known_facts,
    )
    skill_updates = _materialize_knowledge_entries(
        db,
        world_id=world_id,
        actor_id=actor_id,
        source_event_id=source_event_id,
        entry_kind="skill",
        drafts=skills,
    )
    db.flush()
    return StateDraftMaterializationOutcome(
        inventory_updates=inventory_updates,
        knowledge_updates=knowledge_updates,
        skill_updates=skill_updates,
        trade_updates=valid_trade_updates,
        blocked_state_drafts=blocked,
    )


def _materialize_knowledge_entries(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    source_event_id: str,
    entry_kind: str,
    drafts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    updates: list[dict[str, Any]] = []
    for index, draft in enumerate(drafts):
        title = _state_draft_text(draft.get("title"), draft.get("name"))
        summary = _state_draft_text(draft.get("summary"), draft.get("description"), draft.get("text"))
        if not title and summary:
            title = summary[:80]
        if not title:
            continue
        title = title[:160]
        existing = db.execute(
            select(ActorKnowledgeEntry).where(
                ActorKnowledgeEntry.world_id == world_id,
                ActorKnowledgeEntry.actor_id == actor_id,
                ActorKnowledgeEntry.entry_kind == entry_kind,
                ActorKnowledgeEntry.title == title,
            )
        ).scalar_one_or_none()
        if existing is None:
            try:
                salience = float(draft.get("salience") or 0.6)
            except (TypeError, ValueError):
                salience = 0.6
            entry = ActorKnowledgeEntry(
                id=new_id(),
                world_id=world_id,
                actor_id=actor_id,
                entry_kind=entry_kind,
                title=title,
                summary=summary or title,
                status=_state_draft_text(draft.get("status")) or "active",
                salience=salience,
                source_event_id=source_event_id,
                evidence_payload={
                    "source_event_id": source_event_id,
                    "draft_index": index,
                    "source": _state_draft_text(draft.get("source")) or "turn_state_draft",
                },
            )
            db.add(entry)
            action = "added"
        else:
            entry = existing
            entry.summary = summary or entry.summary
            entry.status = "active"
            entry.source_event_id = source_event_id
            entry.evidence_payload = {**dict(entry.evidence_payload or {}), "source_event_id": source_event_id}
            action = "updated"
        db.flush()
        updates.append({**knowledge_entry_to_dict(entry), "action": action})
    return updates


def _relationship_rows(db: Session, world_id: str, actor_id: str) -> list[tuple[Relationship, Actor]]:
    rows = list(
        db.execute(
            select(Relationship, Actor)
            .join(Actor, (Actor.id == Relationship.to_actor_id) & (Actor.world_id == Relationship.world_id))
            .where(
                Relationship.world_id == world_id,
                Relationship.from_actor_id == actor_id,
                Relationship.to_actor_id.is_not(None),
                Relationship.relationship_type == "KNOWS",
            )
            .order_by(Relationship.updated_at.desc(), Actor.display_name.asc())
        ).all()
    )
    return rows


def list_relationship_summaries(db: Session, world_id: str, actor_id: str) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    active_threads = list_active_consequence_threads(db, world_id, actor_id)
    thread_by_counterpart_id = {
        item.get("counterpart_actor_id"): item
        for item in active_threads
        if item.get("counterpart_actor_id") is not None
    }
    for relationship, counterpart in _relationship_rows(db, world_id, actor_id):
        band = relationship_band(float(relationship.strength))
        active_thread = thread_by_counterpart_id.get(counterpart.id)
        summaries.append(
            {
                "actor_id": counterpart.id,
                "display_name": counterpart.display_name,
                "band": band,
                "summary": relationship_summary(
                    counterpart.display_name,
                    band,
                    thread_summary_text=str(active_thread.get("summary")) if active_thread is not None else None,
                ),
            }
        )
    return summaries


def list_active_consequence_threads(db: Session, world_id: str, actor_id: str) -> list[dict[str, Any]]:
    rows = list(
        db.execute(
            select(ConsequenceThread, Actor)
            .join(
                Actor,
                (Actor.id == ConsequenceThread.counterpart_actor_id) & (Actor.world_id == ConsequenceThread.world_id),
                isouter=True,
            )
            .where(
                ConsequenceThread.world_id == world_id,
                ConsequenceThread.owner_actor_id == actor_id,
                ConsequenceThread.status.in_(("active", "cooling")),
            )
            .order_by(ConsequenceThread.updated_at.desc(), ConsequenceThread.id.desc())
        ).all()
    )
    return [
        {
            "id": thread.id,
            "counterpart_actor_id": thread.counterpart_actor_id,
            "counterpart_name": counterpart.display_name if counterpart is not None else None,
            "thread_type": thread.thread_type,
            "status": thread.status,
            "pressure_band": thread.pressure_band,
            "title": thread.title,
            "summary": thread.summary,
        }
        for thread, counterpart in rows
    ]


def list_recent_consequence_history(db: Session, world_id: str, actor_id: str) -> list[str]:
    turns = list(
        db.execute(
            select(Turn)
            .where(Turn.world_id == world_id, Turn.actor_id == actor_id)
            .order_by(Turn.created_at.desc(), Turn.id.desc())
            .limit(12)
        ).scalars()
    )
    summaries: list[str] = []
    for turn in turns:
        summary = str((turn.resolved_output or {}).get("consequence_summary") or "").strip()
        if not summary:
            continue
        summaries.append(summary)
        if len(summaries) >= 3:
            break
    return summaries


def list_relationship_debug(db: Session, world_id: str) -> list[dict[str, Any]]:
    from_actor = aliased(Actor)
    to_actor = aliased(Actor)
    rows = list(
        db.execute(
            select(Relationship, from_actor, to_actor)
            .join(
                from_actor,
                (from_actor.id == Relationship.from_actor_id) & (from_actor.world_id == Relationship.world_id),
            )
            .join(
                to_actor,
                (to_actor.id == Relationship.to_actor_id) & (to_actor.world_id == Relationship.world_id),
            )
            .where(
                Relationship.world_id == world_id,
                Relationship.relationship_type == "KNOWS",
                Relationship.to_actor_id.is_not(None),
            )
            .order_by(Relationship.updated_at.desc(), Relationship.id.desc())
        ).all()
    )
    payload: list[dict[str, Any]] = []
    for relationship, from_actor_row, to_actor_row in rows:
        payload.append(
            {
                "world_id": world_id,
                "relationship_id": relationship.id,
                "from_actor_id": from_actor_row.id,
                "from_actor_name": from_actor_row.display_name,
                "to_actor_id": to_actor_row.id,
                "to_actor_name": to_actor_row.display_name,
                "relationship_type": relationship.relationship_type,
                "strength": round(float(relationship.strength), 3),
                "band": relationship_band(float(relationship.strength)),
            }
        )
    return payload


def list_consequence_threads_debug(db: Session, world_id: str) -> list[dict[str, Any]]:
    owner_alias = Actor.__table__.alias("owner_actor")
    counterpart_alias = Actor.__table__.alias("counterpart_actor")
    rows = list(
        db.execute(
            select(
                ConsequenceThread,
                owner_alias.c.id,
                owner_alias.c.display_name,
                counterpart_alias.c.id,
                counterpart_alias.c.display_name,
            )
            .select_from(ConsequenceThread)
            .join(
                owner_alias,
                (owner_alias.c.id == ConsequenceThread.owner_actor_id) & (owner_alias.c.world_id == ConsequenceThread.world_id),
            )
            .join(
                counterpart_alias,
                (counterpart_alias.c.id == ConsequenceThread.counterpart_actor_id)
                & (counterpart_alias.c.world_id == ConsequenceThread.world_id),
                isouter=True,
            )
            .where(ConsequenceThread.world_id == world_id)
            .order_by(ConsequenceThread.updated_at.desc(), ConsequenceThread.id.desc())
        ).all()
    )
    payload: list[dict[str, Any]] = []
    for thread, owner_id, owner_name, counterpart_id, counterpart_name in rows:
        payload.append(
            {
                "id": thread.id,
                "world_id": world_id,
                "owner_actor_id": owner_id,
                "owner_actor_name": owner_name,
                "counterpart_actor_id": counterpart_id,
                "counterpart_actor_name": counterpart_name,
                "thread_type": thread.thread_type,
                "status": thread.status,
                "pressure_band": thread.pressure_band,
                "title": thread.title,
                "summary": thread.summary,
                "updated_at": thread.updated_at.isoformat(),
                "resolved_at": thread.resolved_at.isoformat() if thread.resolved_at is not None else None,
            }
        )
    return payload


def list_locations_debug(db: Session, world_id: str) -> list[dict[str, Any]]:
    routes_by_from: dict[str, list[dict[str, Any]]] = {}
    route_rows = list(
        db.execute(
            select(LocationRoute, Location)
            .join(
                Location,
                (Location.id == LocationRoute.to_location_id) & (Location.world_id == LocationRoute.world_id),
            )
            .where(LocationRoute.world_id == world_id)
            .order_by(LocationRoute.route_key.asc())
        ).all()
    )
    for route, to_location in route_rows:
        routes_by_from.setdefault(route.from_location_id, []).append(
            {
                "route_id": route.id,
                "route_key": route.route_key,
                "status": route.status,
                "travel_summary": _route_display_summary(route),
                "to_location_id": to_location.id,
                "to_location_name": to_location.name,
            }
        )

    payload: list[dict[str, Any]] = []
    for location in db.execute(
        select(Location).where(Location.world_id == world_id).order_by(Location.created_at.asc(), Location.id.asc())
    ).scalars():
        payload.append(
            {
                "id": location.id,
                "name": location.name,
                "description": location.description,
                "key": str((location.state or {}).get("key") or ""),
                "kind": str((location.state or {}).get("kind") or ""),
                "routes": routes_by_from.get(location.id, []),
            }
        )
    return payload


def list_travel_log_debug(db: Session, world_id: str) -> list[dict[str, Any]]:
    rows = list(
        db.execute(
            select(Event)
            .where(Event.world_id == world_id, Event.event_type.in_(("travel.arrived", "travel.hesitated")))
            .order_by(Event.created_at.desc(), Event.id.desc())
            .limit(40)
        ).scalars()
    )
    return [
        {
            "event_id": event.id,
            "turn_id": event.turn_id,
            "session_id": event.session_id,
            "event_type": event.event_type,
            "location_id": event.location_id,
            "travel_summary": str((event.payload or {}).get("travel_summary") or event.narrative or ""),
            "from_location_id": (event.payload or {}).get("from_location_id"),
            "to_location_id": (event.payload or {}).get("to_location_id"),
            "created_at": event.created_at.isoformat(),
        }
        for event in rows
    ]


def _world_pack_state(db: Session, world_id: str) -> dict[str, Any]:
    world = _world_row(db, world_id)
    pack, template = resolve_world_pack(db, world_id)
    pack_generation_context = _pack_generation_context_from_world(dict(template.world or {}))
    locations = ensure_seeded_locations(db, world_id)
    starter_key = _starter_location_key(db, world_id)
    lore_key = _lore_location_key(db, world_id)
    followup_key = _followup_location_key(db, world_id)
    followup_branches = _followup_branches(db, world_id)
    bootstrap = template.bootstrap
    return {
        "pack_id": pack.manifest.pack_id,
        "pack_display_name": pack.manifest.display_name,
        "source_language": pack.manifest.source_language,
        "world_template_id": template.template_id,
        "world_template_display_name": template.display_name,
        "world_name": world.name if world is not None else str((template.world or {}).get("default_name") or template.display_name),
        "semantic_tags": list(pack.manifest.semantic_tags),
        "starter_location_key": starter_key,
        "starter_location_name": locations[starter_key].name,
        "lore_location_key": lore_key,
        "lore_location_name": locations[lore_key].name,
        "followup_location_key": followup_key,
        "followup_location_name": locations[followup_key].name,
        "starter_stage_key": _starter_stage_key(db, world_id),
        "followup_stage_key": _followup_stage_key(db, world_id),
        "opening_chapter_key": _opening_chapter_key(db, world_id),
        "followup_chapter_key": _followup_chapter_key(db, world_id),
        "reward_effect_kind": _reward_effect_kind(db, world_id),
        "reward_name": str((template.quest.reward_name if template.quest is not None else "") or ""),
        "faction_name": str(template.faction.name or ""),
        "followup_branches": followup_branches,
        "branch_labels": branch_labels_from_followup_branches(followup_branches),
        "bootstrap": {
            "opening_title": str(bootstrap.opening_title or ""),
            "opening_narrative": str(bootstrap.opening_narrative or ""),
            "opening_situation": str(bootstrap.opening_situation or ""),
            "opening_pressure": str(bootstrap.opening_pressure or ""),
            "opening_choices": list(bootstrap.opening_choices or []),
            "localized_bootstrap": {
                language: payload.model_dump()
                for language, payload in bootstrap.localized_bootstrap.items()
            },
        },
        "pack_generation_context": pack_generation_context,
    }


def narrative_state_bands(character: dict[str, Any], factions: list[dict[str, Any]]) -> dict[str, str]:
    hp = int(character.get("hp") or 0)
    focus = int(character.get("focus") or 0)
    if hp <= 2:
        vitality = "strained"
    elif hp <= 5:
        vitality = "steady"
    else:
        vitality = "grounded"

    if focus <= 1:
        clarity = "frayed"
    elif focus <= 3:
        clarity = "steady"
    else:
        clarity = "sharp"

    primary_faction = factions[0]["band"] if factions else "unknown"
    return {
        "vitality": vitality,
        "clarity": clarity,
        "standing": str(primary_faction),
    }


def important_inventory_affordances(inventory: list[dict[str, Any]], *, followup_location_name: str = "the next route") -> list[dict[str, Any]]:
    affordances: list[dict[str, Any]] = []
    for item in inventory:
        effect_kind = item.get("effect_kind")
        if not effect_kind:
            continue
        affordances.append(
            {
                "item_id": item["id"],
                "name": item["name"],
                "usable": bool(item.get("usable")),
                "effect_kind": effect_kind,
                "summary": (
                    f"{item['name']} can open the road toward {followup_location_name}."
                    if effect_kind
                    else f"{item['name']} carries a special affordance."
                ),
            }
        )
    return affordances


def default_next_choices(session_state: dict[str, Any]) -> list[dict[str, Any]]:
    world_pack = session_state.get("world_pack") or {}
    player_profile = session_state.get("player_profile") or {}
    play_language = player_profile.get("play_language") if isinstance(player_profile, dict) else {}
    play_language = play_language if isinstance(play_language, dict) else {}
    play_language_code = _play_language_code(play_language)
    source_language = _safe_language_tag(world_pack.get("source_language"), fallback="en")
    english_play_language = (
        play_language_code == "en"
        or str(play_language.get("prompt_name") or "").strip().lower() == "english"
    )
    starter_location_key = str(world_pack.get("starter_location_key") or "starter")
    lore_location_key = str(world_pack.get("lore_location_key") or "lore")
    followup_location_key = str(world_pack.get("followup_location_key") or "followup")
    starter_location_name = str(world_pack.get("starter_location_name") or "the starting place")
    lore_location_name = str(world_pack.get("lore_location_name") or "the loreward district")
    followup_location_name = str(world_pack.get("followup_location_name") or "the next route")
    starter_stage_key = str(world_pack.get("starter_stage_key") or "starter_stage")
    followup_stage_key = str(world_pack.get("followup_stage_key") or "followup_stage")
    reward_effect_kind = str(world_pack.get("reward_effect_kind") or "unlock_followup_route")
    reward_name = str(
        world_pack.get("reward_name") or (session_state.get("inventory") or [{}])[0].get("name") or "the reward item"
    )
    faction_name = str(world_pack.get("faction_name") or "the local faction")
    formal_branch_key = branch_key_for_slot(world_pack, "formal_path")
    undercurrent_branch_key = branch_key_for_slot(world_pack, "undercurrent_path")
    formal_branch_label = branch_label(formal_branch_key, world_pack=world_pack)
    undercurrent_branch_label = branch_label(undercurrent_branch_key, world_pack=world_pack)
    quests = session_state.get("quests") or []
    inventory = session_state.get("inventory") or []
    relationships = session_state.get("relationships") or []
    active_threads = session_state.get("active_consequence_threads") or []
    recent_consequence_history = session_state.get("recent_consequence_history") or []
    current_location = session_state.get("current_location") or session_state.get("location") or {}
    current_location_name = str(current_location.get("name") or "the scene")
    current_location_key = str(current_location.get("key") or starter_location_key)
    nearby_routes = session_state.get("nearby_routes") or []
    local_figures = session_state.get("local_figures") or session_state.get("plaza_figures") or []
    recent_travel_history = session_state.get("recent_travel_history") or []
    active_quest = next((item for item in quests if item.get("status") == "active"), quests[0] if quests else {})
    stage_key = str(active_quest.get("stage_key") or starter_stage_key)
    usable_item = next((item for item in inventory if item.get("usable")), None)
    primary_relationship = relationships[0] if relationships else {}
    relationship_band_name = str(primary_relationship.get("band") or "neutral")
    thread_types = {str(item.get("thread_type") or "") for item in active_threads}
    current_scene = session_state.get("current_scene") or {}
    scene_summary = str(current_scene.get("summary") or "").strip()
    pressure_summary = str(current_scene.get("pressure_summary") or "").strip()
    chapter_summary = str((session_state.get("chapter") or {}).get("summary") or "").strip()
    crossroads_summary = str((session_state.get("chapter") or {}).get("crossroads_summary") or "").strip()
    branch_hint = str((session_state.get("chapter") or {}).get("branch_hint") or "").strip()
    route_pressures = (session_state.get("chapter") or {}).get("route_pressures") or []
    current_branch = str((session_state.get("chapter") or {}).get("current_branch") or "")
    current_branch_slot = branch_slot_for_key(world_pack, current_branch)
    recent_branch_echoes = session_state.get("recent_branch_echoes") or []
    recent_world_beats = session_state.get("recent_world_beats") or []
    ambient_murmurs = session_state.get("ambient_murmurs") or []
    shared_world_context = session_state.get("shared_world_context") or {}
    shared_rumors = [
        str(item.get("summary") or "").strip()
        for item in (shared_world_context.get("rumor_surface") or [])
        if isinstance(item, dict) and str(item.get("summary") or "").strip()
    ]
    shared_history = [
        str(item.get("summary") or "").strip()
        for item in (shared_world_context.get("recent_history") or [])
        if isinstance(item, dict) and str(item.get("summary") or "").strip()
    ]
    location_public_state = shared_world_context.get("location_public_state") or {}
    public_state = (
        location_public_state.get("public_state")
        if isinstance(location_public_state, dict)
        else {}
    ) or {}
    public_state_hint = ", ".join(
        f"{key}={value}"
        for key, value in list(public_state.items())[:3]
    )
    recent_offstage_beats = session_state.get("recent_offstage_beats") or []
    offstage_murmurs = session_state.get("offstage_murmurs") or []
    npc_locations = session_state.get("npc_locations") or []
    leading_world_beat = str(recent_world_beats[0]) if recent_world_beats else ""
    leading_murmur = str(ambient_murmurs[0]) if ambient_murmurs else ""
    leading_shared_rumor = shared_rumors[0] if shared_rumors else ""
    leading_shared_history = shared_history[0] if shared_history else ""
    leading_offstage = str(recent_offstage_beats[0]) if recent_offstage_beats else ""
    leading_offstage_murmur = str(offstage_murmurs[0]) if offstage_murmurs else ""
    leading_npc_location = str((npc_locations[0] or {}).get("summary") or "") if npc_locations else ""
    leading_local_figure = str((local_figures[0] or {}).get("summary") or "") if local_figures else ""
    leading_route = str((nearby_routes[0] or {}).get("summary") or "") if nearby_routes else ""
    leading_travel = str(recent_travel_history[0] or "") if recent_travel_history else ""
    leading_branch_echo = str(recent_branch_echoes[0] or "") if recent_branch_echoes else ""
    leading_consequence = str(recent_consequence_history[0] or "") if recent_consequence_history else ""
    dominant_branch = dominant_branch_key(route_pressures, world_pack=world_pack)
    dominant_branch_slot = branch_slot_for_key(world_pack, dominant_branch)
    opening_bootstrap = world_pack.get("bootstrap") if isinstance(world_pack.get("bootstrap"), dict) else {}
    is_opening_bootstrap_state = (
        current_location_key == starter_location_key
        and stage_key == starter_stage_key
        and not inventory
        and not recent_travel_history
    )

    def route_to(location_key: str) -> dict[str, Any] | None:
        return next(
            (
                route
                for route in nearby_routes
                if str(((route or {}).get("to_location") or {}).get("key") or "") == location_key
            ),
            None,
        )

    first_choice = {
        "choice_id": "choice_1",
        "label": f"{current_location_name}の気配を乱さず、まず息を整えて見守る",
        "summary": "場の流れを乱さず、まず気配と視線を確かめる。",
        "canonical_input_text": f"{current_location_name}の流れを乱さず、周囲の気配と視線を見守る",
        "action_kind": "narrative",
    }
    second_choice = {
        "choice_id": "choice_2",
        "label": "困っている相手に手を差し伸べ、次の進展を作る",
        "summary": "もっとも前進寄りの行動で、依頼や関係を進める。",
        "canonical_input_text": f"{starter_location_name}で旅人を助け、次の進展を作る",
        "action_kind": "narrative",
    }
    third_choice = {
        "choice_id": "choice_3",
        "label": "噂と視線をたどり、場の裏側を探る",
        "summary": "探索や関係変化に寄せた行動で、状況理解を広げる。",
        "canonical_input_text": f"{current_location_name}の空気や人の事情を探り、何が起きているか確かめる",
        "action_kind": "narrative",
    }

    if "promise" in thread_types:
        first_choice = {
            **first_choice,
            "label": "急がず場を保ちつつ、宙に浮いた約束の手触りを確かめる",
            "summary": "約束を悪化させず、まず場を落ち着かせる。",
            "canonical_input_text": "場を保ちつつ、宙に浮いた約束をどう受け止めるか静かに確かめる",
        }
        second_choice = {
            **second_choice,
            "label": "まだ宙に浮く約束へきちんと応え、次の進展を作る",
            "summary": "約束の圧力へ正面から応え、関係と依頼を前に進める。",
            "canonical_input_text": "宙に浮いた約束へ応え、見回りの次の段取りをきちんと進める",
        }
        third_choice = {
            **third_choice,
            "label": "約束がどう噂や視線に残っているかを探る",
            "summary": "物語のしこりの広がり方を探る。",
            "canonical_input_text": f"約束が{current_location_name}の噂や視線にどう残っているかを探る",
        }
    elif "scrutiny" in thread_types:
        first_choice = {
            **first_choice,
            "label": "見張りの視線を刺激しないよう、慎重に場の空気を読む",
            "summary": "警戒をこれ以上高めずに場を保つ。",
            "canonical_input_text": "見張りの視線を刺激しないよう慎重に場の空気を読む",
        }
        second_choice = {
            **second_choice,
            "label": "見られていることを受け止めたまま、着実に前へ進む",
            "summary": "警戒下でも進展を作る。",
            "canonical_input_text": "見られていることを受け止めたまま着実に前へ進む",
        }
        third_choice = {
            **third_choice,
            "label": "誰がどこまで見ているのか、視線の流れを探る",
            "summary": "警戒の源を見極める。",
            "canonical_input_text": "誰がどこまで見ているのか、広場の視線の流れを探る",
        }
    elif relationship_band_name in {"warm", "trusted"}:
        second_choice = {
            **second_choice,
            "label": "差し出された信頼を受け止め、そのまま次の進展へ踏み込む",
            "summary": "関係の追い風を受けて進める。",
            "canonical_input_text": "差し出された信頼を受け止め、そのまま次の進展へ踏み込む",
        }

    if stage_key == starter_stage_key and not is_opening_bootstrap_state:
        second_choice = {
            **second_choice,
            "label": "見聞きをまとめて報告し、次の見回りへ繋げる",
            "summary": f"依頼を締め、{faction_name}から次の信頼を引き出す。",
            "canonical_input_text": f"見聞きを報告し、{current_location_name}で次の段取りを引き受ける",
        }
        first_choice = {
            **first_choice,
            "label": "急がず相手の落ち着きを確かめ、場の気配を保つ",
            "canonical_input_text": f"急がず相手の落ち着きを確かめ、{current_location_name}の気配を保つ",
        }
        third_choice = {
            **third_choice,
            "label": "周囲の視線や噂を探り、次の手掛かりを拾う",
            "canonical_input_text": f"{current_location_name}に残る視線や噂を探り、次の手掛かりを拾う",
        }

    if usable_item is not None and usable_item.get("effect_kind") == reward_effect_kind:
        if current_location_key == starter_location_key:
            second_choice = {
                "choice_id": "choice_2",
                "label": f"{reward_name}を掲げ、次の道を正式に開く",
                "summary": "重要アイテムを使って次の物語段階を解放する。",
                "canonical_input_text": f"{reward_name}を掲げ、次の道を開く",
                "action_kind": "use_reward_item",
            }
        else:
            return_route = route_to(starter_location_key)
            if return_route is not None and bool(return_route.get("available")):
                second_choice = {
                    "choice_id": "choice_2",
                    "label": f"{reward_name}を使える場所へ戻る",
                    "summary": "重要アイテムを使うため、まず起点の場所へ戻る。",
                    "canonical_input_text": f"{reward_name}を使える場所へ戻る",
                    "action_kind": "travel",
                    "travel_target_key": starter_location_key,
                }

    if stage_key == followup_stage_key:
        followup_route = route_to(followup_location_key)
        if current_location_key != followup_location_key and followup_route is not None and bool(followup_route.get("available")):
            second_choice = {
                "choice_id": "choice_2",
                "label": f"開いた{followup_location_name}へ足を向ける",
                "summary": "follow-up quest の舞台へ実際に移る。",
                "canonical_input_text": f"{reward_name}で開いた{followup_location_name}へ向かう",
                "action_kind": "travel",
                "travel_target_key": followup_location_key,
            }
        else:
            second_choice = {
                "choice_id": "choice_2",
                "label": f"開いた{followup_location_name}を辿り、そこで見つかる異変を確かめる",
                "summary": "follow-up quest を前へ進める選択。",
                "canonical_input_text": f"{reward_name}で開いた{followup_location_name}の様子を観察する",
                "action_kind": "narrative",
            }
        if current_location_key == followup_location_key:
            first_choice = {
                "choice_id": "choice_1",
                "label": f"{followup_location_name}の気配を整え、場を静かに安定させる",
                "summary": "危険を抑えつつ、場の安定を優先する。",
                "canonical_input_text": f"開いた{followup_location_name}の気配を整え、場を静かに安定させる",
                "action_kind": "narrative",
            }
            third_choice = {
                "choice_id": "choice_3",
                "label": f"{followup_location_name}の痕跡や現地の記憶を集め、関係の糸口を探る",
                "summary": "探索と関係変化に寄せた選択。",
                "canonical_input_text": f"{reward_name}で開いた{followup_location_name}の痕跡や現地の記憶を集める",
                "action_kind": "narrative",
            }
        if current_branch_slot == "formal_path":
            first_choice = {
                **first_choice,
                "label": "表に出た秩序を崩さず、今の線を丁寧に保つ",
                "canonical_input_text": "表に出た秩序を崩さず、今の線を丁寧に保つ",
            }
            second_choice = {
                **second_choice,
                "label": f"{formal_branch_label}に沿って前へ進み、正式な信頼を固める",
                "canonical_input_text": f"{formal_branch_label}に沿って前へ進み、正式な信頼を固める",
            }
            third_choice = {
                **third_choice,
                "label": "表の流れの裏でまだ揺れている気配を探る",
                "canonical_input_text": "表の流れの裏でまだ揺れている気配を探る",
            }
        elif current_branch_slot == "undercurrent_path":
            first_choice = {
                **first_choice,
                "label": "広がりすぎた噂を刺激せず、静かな流れを読む",
                "canonical_input_text": "広がりすぎた噂を刺激せず、静かな流れを読む",
            }
            second_choice = {
                **second_choice,
                "label": f"{undercurrent_branch_label}に沿って前へ進み、裏の流れを確かめる",
                "canonical_input_text": f"{undercurrent_branch_label}に沿って前へ進み、裏の流れを確かめる",
            }
            third_choice = {
                **third_choice,
                "label": "静かな流れの外縁に残る別の糸を探る",
                "canonical_input_text": "静かな流れの外縁に残る別の糸を探る",
            }
        elif crossroads_summary:
            first_choice = {
                **first_choice,
                "label": "どちらの道にも決め切らず、場の圧だけを静かに読む",
                "canonical_input_text": "どちらの道にも決め切らず、場の圧だけを静かに読む",
            }
            if dominant_branch_slot == "formal_path":
                second_choice = {
                    **second_choice,
                    "label": f"{formal_branch_label}の側へ少し踏み込み、表の流れを前へ押す",
                    "canonical_input_text": f"{formal_branch_label}の側へ少し踏み込み、表の流れを前へ押す",
                }
                third_choice = {
                    **third_choice,
                    "label": f"{undercurrent_branch_label}の側にまだ残る別の糸を拾う",
                    "canonical_input_text": f"{undercurrent_branch_label}の側にまだ残る別の糸を拾う",
                }
            elif dominant_branch_slot == "undercurrent_path":
                second_choice = {
                    **second_choice,
                    "label": f"{undercurrent_branch_label}の側へ少し踏み込み、その流れを前へ押す",
                    "canonical_input_text": f"{undercurrent_branch_label}の側へ少し踏み込み、その流れを前へ押す",
                }
                third_choice = {
                    **third_choice,
                    "label": f"{formal_branch_label}の側にまだ残る別の糸を拾う",
                    "canonical_input_text": f"{formal_branch_label}の側にまだ残る別の糸を拾う",
                }

    archive_route = route_to(lore_location_key)
    square_route = route_to(starter_location_key)
    if current_location_key == starter_location_key and archive_route is not None and bool(archive_route.get("available")):
        third_choice = {
            "choice_id": "choice_3",
            "label": f"{lore_location_name}へ向かい、古い記録と視線の重なりを確かめる",
            "summary": "場を変えながら探索を進める。",
            "canonical_input_text": f"{lore_location_name}へ向かう",
            "action_kind": "travel",
            "travel_target_key": lore_location_key,
        }
    if current_location_key == lore_location_key:
        second_choice = {
            "choice_id": "choice_2",
            "label": f"{lore_location_name}で手掛かりを辿り、次の糸口を掴む",
            "summary": f"{lore_location_name}側で状況を前へ進める。",
            "canonical_input_text": f"{lore_location_name}で古い記録と現地の話を辿る",
            "action_kind": "narrative",
        }
        if square_route is not None and bool(square_route.get("available")):
            first_choice = {
                "choice_id": "choice_1",
                "label": f"いったん{starter_location_name}へ戻り、場の流れを確かめ直す",
                "summary": "起点へ戻って場の圧力を測り直す。",
                "canonical_input_text": f"{starter_location_name}へ戻る",
                "action_kind": "travel",
                "travel_target_key": starter_location_key,
            }
    if current_location_key == followup_location_key and square_route is not None and bool(square_route.get("available")):
        first_choice = {
            "choice_id": "choice_1",
            "label": f"{followup_location_name}の緊張を抱えたまま、いったん起点へ戻る",
            "summary": "新しい場所の余韻を持ち帰る。",
            "canonical_input_text": f"{starter_location_name}へ戻る",
            "action_kind": "travel",
            "travel_target_key": starter_location_key,
        }

    if english_play_language:
        for choice_index, choice in enumerate((first_choice, second_choice, third_choice)):
            action_kind = str(choice.get("action_kind") or "narrative")
            travel_target_key = str(choice.get("travel_target_key") or "")
            if action_kind == "use_reward_item":
                choice["label"] = f"Raise {reward_name} and formally open the next road"
                choice["summary"] = "Use the key item to unlock the next story stage."
                choice["canonical_input_text"] = f"Raise {reward_name} and open the road toward {followup_location_name}"
            elif action_kind == "travel" and travel_target_key == followup_location_key:
                choice["label"] = f"Head toward the opened {followup_location_name}"
                choice["summary"] = "Move to the follow-up quest location."
                choice["canonical_input_text"] = f"Travel to {followup_location_name} opened by {reward_name}"
            elif action_kind == "travel" and travel_target_key == starter_location_key:
                choice["label"] = f"Return to {starter_location_name}"
                choice["summary"] = "Return to the starting place and reassess the scene."
                choice["canonical_input_text"] = f"Return to {starter_location_name}"
            elif action_kind == "travel" and travel_target_key == lore_location_key:
                choice["label"] = f"Go to {lore_location_name} and check the old records"
                choice["summary"] = "Change places and widen the investigation."
                choice["canonical_input_text"] = f"Travel to {lore_location_name}"
            elif stage_key == followup_stage_key and current_location_key == followup_location_key:
                if choice_index == 0:
                    choice["label"] = f"Steady the air around {followup_location_name}"
                    choice["summary"] = "Keep danger contained and stabilize the scene."
                    choice["canonical_input_text"] = f"Steady the air around {followup_location_name}"
                elif choice_index == 1:
                    choice["label"] = f"Read the disturbance inside {followup_location_name}"
                    choice["summary"] = "Advance the follow-up quest inside the breach site."
                    choice["canonical_input_text"] = f"Observe what changed inside {followup_location_name}"
                else:
                    choice["label"] = f"Gather traces and local memories in {followup_location_name}"
                    choice["summary"] = "Explore the site and look for relationship leads."
                    choice["canonical_input_text"] = f"Gather traces and local memories in {followup_location_name}"
            elif stage_key == followup_stage_key:
                if choice_index == 0:
                    choice["label"] = "Hold the newly opened route steady"
                    choice["summary"] = "Keep the scene stable before moving on."
                    choice["canonical_input_text"] = f"Hold the route toward {followup_location_name} steady"
                elif choice_index == 1:
                    choice["label"] = f"Follow the opened path toward {followup_location_name}"
                    choice["summary"] = "Move the follow-up quest forward."
                    choice["canonical_input_text"] = f"Follow the path opened by {reward_name}"
                else:
                    choice["label"] = "Look for traces around the opened route"
                    choice["summary"] = "Explore what the opened route has changed."
                    choice["canonical_input_text"] = f"Look for traces around the route to {followup_location_name}"
            elif stage_key == starter_stage_key and not is_opening_bootstrap_state:
                if choice_index == 0:
                    choice["label"] = "Keep the scene calm and check that everyone is steady"
                    choice["summary"] = "Avoid rushing and preserve the scene's balance."
                    choice["canonical_input_text"] = f"Keep {current_location_name} calm and check that everyone is steady"
                elif choice_index == 1:
                    choice["label"] = "Report what you learned and take the next patrol step"
                    choice["summary"] = f"Close the request and earn further trust from {faction_name}."
                    choice["canonical_input_text"] = f"Report what you learned in {current_location_name} and accept the next step"
                else:
                    choice["label"] = "Trace the nearby rumors and pick up the next lead"
                    choice["summary"] = "Explore the looks and rumors left in the scene."
                    choice["canonical_input_text"] = f"Trace the rumors and looks left in {current_location_name}"
            else:
                if choice_index == 0:
                    choice["label"] = f"Watch {current_location_name} without disturbing the flow"
                    choice["summary"] = "Read the room and avoid disrupting the scene."
                    choice["canonical_input_text"] = f"Watch the mood and sightlines around {current_location_name}"
                elif choice_index == 1:
                    choice["label"] = "Help the person in need and create the next opening"
                    choice["summary"] = "Take the clearest forward action for the current request."
                    choice["canonical_input_text"] = f"Help at {starter_location_name} and create the next opening"
                else:
                    choice["label"] = "Follow the rumors and sightlines beneath the scene"
                    choice["summary"] = "Explore the situation and widen your understanding."
                    choice["canonical_input_text"] = f"Explore the mood and local concerns around {current_location_name}"

    if is_opening_bootstrap_state:
        opening_payload = _bootstrap_for_language(
            opening_bootstrap,
            language=play_language_code,
            source_language=source_language,
        )
        opening_choices = opening_payload.get("opening_choices")
        if isinstance(opening_choices, list):
            for choice, opening_choice in zip((first_choice, second_choice, third_choice), opening_choices):
                if not isinstance(opening_choice, dict):
                    continue
                for field in ("label", "summary", "canonical_input_text", "action_kind", "travel_target_key"):
                    value = opening_choice.get(field)
                    if isinstance(value, str) and value.strip():
                        choice[field] = value.strip()

    if (leading_consequence or leading_world_beat or leading_murmur) and not is_opening_bootstrap_state:
        signal = leading_consequence or leading_world_beat or leading_murmur
        for choice_index, choice in enumerate((first_choice, second_choice, third_choice)):
            if str(choice.get("action_kind") or "narrative") != "narrative":
                continue
            if english_play_language:
                if choice_index == 0:
                    choice["label"] = "Read the change that just settled in the scene"
                    choice["summary"] = f"Pause and judge the latest result: {signal}"
                    choice["canonical_input_text"] = f"Read the latest change around {current_location_name}: {signal}"
                elif choice_index == 1:
                    choice["label"] = "Act on the opening created by the last result"
                    choice["summary"] = f"Use the latest result to move forward: {signal}"
                    choice["canonical_input_text"] = f"Act on the opening created by the latest result: {signal}"
                else:
                    choice["label"] = "Trace who noticed the latest change"
                    choice["summary"] = f"Explore how the result is spreading: {signal}"
                    choice["canonical_input_text"] = f"Trace who noticed the latest change around {current_location_name}: {signal}"
            elif choice_index == 0:
                choice["label"] = "直前の変化を受け止め、場の揺れを静かに読む"
                choice["summary"] = f"直前の結果を急がず確かめる: {signal}"
                choice["canonical_input_text"] = f"{current_location_name}で直前の変化を受け止め、場の揺れを静かに読む"
            elif choice_index == 1:
                choice["label"] = "直前に生まれた糸口を使い、次の進展へ踏み込む"
                choice["summary"] = f"直前の結果を足場に前へ進める: {signal}"
                choice["canonical_input_text"] = "直前に生まれた糸口を使い、次の進展へ踏み込む"
            else:
                choice["label"] = "直前の変化が誰に届いたか、噂と視線をたどる"
                choice["summary"] = f"結果の広がり方を探索する: {signal}"
                choice["canonical_input_text"] = f"{current_location_name}で直前の変化が誰に届いたかを探る"

    for choice in (first_choice, second_choice, third_choice):
        summary = " ".join(str(choice.get("summary") or "").split()).strip()
        choice["summary"] = summary or "次の行動を選ぶ。"

    return [first_choice, second_choice, third_choice]


def build_session_state(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    location_id: str | None,
    include_internal: bool = False,
) -> dict[str, Any]:
    world_info = _world_pack_state(db, world_id)
    player_profile_row = get_player_profile(db, world_id, actor_id)
    player_profile = (
        player_profile_to_dict(player_profile_row[0], player_profile_row[1])
        if player_profile_row is not None
        else None
    )
    character = get_character_summary(db, world_id, actor_id)
    quests = list_quest_summaries(db, world_id, actor_id)
    quest_journal = list_quest_journal(db, world_id, actor_id)
    factions = list_faction_summaries(db, world_id, actor_id)
    inventory = list_inventory_summaries(db, world_id, actor_id)
    known_facts = list_knowledge_summaries(db, world_id, actor_id, "known_fact")
    skills = list_knowledge_summaries(db, world_id, actor_id, "skill")
    relationships = list_relationship_summaries(db, world_id, actor_id)
    recognized_titles = list_recognized_titles(db, world_id, actor_id)
    active_consequence_threads = list_active_consequence_threads(db, world_id, actor_id)
    recent_consequence_history = list_recent_consequence_history(db, world_id, actor_id)
    chapter_full = get_current_chapter_summary(db, world_id, actor_id, include_internal=True)
    chapter = None if chapter_full is None else dict(chapter_full)
    current_scene = get_current_scene_summary(db, world_id, actor_id)
    recent_scene_history = list_recent_scene_history(db, world_id, actor_id)
    current_location = get_location_summary(db, world_id, location_id)
    local_figures = list_local_figures(db, world_id, actor_id, location_id)
    recent_world_beats = list_recent_world_beats(db, world_id, location_id)
    ambient_murmurs = list_ambient_murmurs(db, world_id, location_id)
    npc_locations = list_npc_locations(db, world_id)
    recent_offstage_beats = list_recent_offstage_beats(db, world_id, location_id)
    offstage_murmurs = list_offstage_murmurs(db, world_id, location_id)
    nearby_routes = list_nearby_routes(db, world_id, location_id, actor_id=actor_id)
    recent_travel_history = list_recent_travel_history(db, world_id, actor_id)
    shared_world_context = build_shared_world_context(
        db,
        world_id=world_id,
        actor_id=actor_id,
        location_id=location_id,
    )
    chapter_key = str((chapter or {}).get("key") or "")
    followup_chapter_key = str(world_info.get("followup_chapter_key") or "")
    route_pressures = (
        list_route_pressures(db, world_id=world_id, actor_id=actor_id, chapter_key=chapter_key)
        if followup_chapter_key and chapter_key == followup_chapter_key
        else []
    )
    route_pressure_map = {
        str(item.get("route_key") or ""): float(item.get("pressure") or 0.0)
        for item in route_pressures
    }
    branch_hint = player_visible_branch_hint(
        world_pack=world_info,
        current_branch=((chapter or {}).get("current_branch") if include_internal else None),
        pressures=route_pressure_map,
        crossroads_status=str(
            (chapter or {}).get("branch_status")
            or ("open" if route_pressures and followup_chapter_key and chapter_key == followup_chapter_key else "none")
        ),
    )
    if chapter is not None:
        if (
            not str(chapter.get("crossroads_summary") or "").strip()
            and route_pressures
            and followup_chapter_key
            and chapter_key == followup_chapter_key
        ):
            chapter["crossroads_summary"] = crossroads_summary_text(
                world_pack=world_info,
                current_branch=chapter.get("current_branch"),
                crossroads_status=str(chapter.get("branch_status") or "open"),
                pressures=route_pressure_map,
            )
        chapter["crossroads_summary"] = str(chapter.get("crossroads_summary") or "")
        chapter["branch_hint"] = branch_hint or str(chapter.get("branch_hint") or "")
        chapter["route_pressures"] = route_pressures
    recent_branch_echoes = list_recent_branch_echoes(
        db,
        world_id=world_id,
        actor_id=actor_id,
        current_chapter=chapter,
    )
    state = {
        "world_id": world_id,
        "world_pack": world_info,
        "pack_generation_context": world_info.get("pack_generation_context") or {},
        "location": current_location,
        "current_location": current_location,
        "character": character,
        "player_profile": player_profile,
        "quests": quests,
        "quest_journal": quest_journal,
        "quest_display_state": quest_display_state(player_profile=player_profile, quest_journal=quest_journal),
        "factions": factions,
        "inventory": inventory,
        "known_facts": known_facts,
        "skills": skills,
        "chapter": chapter,
        "current_scene": current_scene,
        "recent_scene_history": recent_scene_history,
        "local_figures": local_figures,
        "plaza_figures": local_figures,
        "nearby_routes": nearby_routes,
        "recent_travel_history": recent_travel_history,
        "shared_world_context": shared_world_context,
        "recent_world_beats": recent_world_beats,
        "ambient_murmurs": ambient_murmurs,
        "npc_locations": npc_locations,
        "recent_offstage_beats": recent_offstage_beats,
        "offstage_murmurs": offstage_murmurs,
        "recent_branch_echoes": recent_branch_echoes,
        "relationships": relationships,
        "recognized_titles": recognized_titles,
        "active_consequence_threads": active_consequence_threads,
        "recent_consequence_history": recent_consequence_history,
        "narrative_state_bands": narrative_state_bands(character, factions),
        "important_inventory_affordances": important_inventory_affordances(
            inventory,
            followup_location_name=str(world_info.get("followup_location_name") or "the next route"),
        ),
    }
    state["next_choices"] = default_next_choices(state)
    if not include_internal and chapter is not None:
        chapter.pop("current_branch", None)
        chapter.pop("branch_status", None)
        chapter.pop("route_pressures", None)
    return state


def apply_scene_updates(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    location_id: str | None,
    focus_actor_id: str | None,
    source_event_id: str,
    action_kind: str,
    session_state: dict[str, Any],
    outcome_band: str,
    scene_move: str | None,
    scene_pressure: str | None,
) -> dict[str, Any]:
    result = SceneFrameEngine.apply(
        db,
        world_id=world_id,
        actor_id=actor_id,
        location_id=location_id,
        focus_actor_id=focus_actor_id,
        source_event_id=source_event_id,
        action_kind=action_kind,
        session_state=session_state,
        outcome_band=outcome_band,
        requested_scene_move=scene_move if scene_move in {"hold", "deepen", "pivot", "close"} else None,
        requested_scene_pressure=scene_pressure if scene_pressure in {"low", "medium", "high"} else None,
    )
    return {
        "chapter_updates": result.chapter_updates,
        "scene_updates": result.scene_updates,
        "scene_summary": result.scene_summary,
    }


def _pressure_rank(pressure_band: PressureBand) -> int:
    return {"low": 1, "medium": 2, "high": 3}[pressure_band]


def _thread_snapshots(db: Session, world_id: str, actor_id: str) -> list[ConsequenceThreadSnapshot]:
    rows = list(
        db.execute(
            select(ConsequenceThread)
            .where(
                ConsequenceThread.world_id == world_id,
                ConsequenceThread.owner_actor_id == actor_id,
                ConsequenceThread.status.in_(("active", "cooling")),
            )
            .order_by(ConsequenceThread.updated_at.desc(), ConsequenceThread.id.desc())
        ).scalars()
    )
    return [
        ConsequenceThreadSnapshot(
            thread_type=str(thread.thread_type),  # type: ignore[arg-type]
            status=str(thread.status),  # type: ignore[arg-type]
            pressure_band=str(thread.pressure_band),  # type: ignore[arg-type]
        )
        for thread in rows
    ]


def _matching_thread(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    thread_type: ThreadType,
    counterpart_actor_id: str | None,
    location_id: str | None,
) -> ConsequenceThread | None:
    rows = list(
        db.execute(
            select(ConsequenceThread)
            .where(
                ConsequenceThread.world_id == world_id,
                ConsequenceThread.owner_actor_id == actor_id,
                ConsequenceThread.thread_type == thread_type,
            )
            .order_by(ConsequenceThread.updated_at.desc(), ConsequenceThread.id.desc())
        ).scalars()
    )
    for thread in rows:
        if thread.counterpart_actor_id == counterpart_actor_id and thread.location_id == location_id:
            return thread
    return rows[0] if rows else None


def _enforce_active_thread_cap(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    keep_thread_id: str | None,
) -> None:
    active_rows = list(
        db.execute(
            select(ConsequenceThread)
            .where(
                ConsequenceThread.world_id == world_id,
                ConsequenceThread.owner_actor_id == actor_id,
                ConsequenceThread.status == "active",
            )
            .order_by(ConsequenceThread.updated_at.asc(), ConsequenceThread.id.asc())
        ).scalars()
    )
    while len(active_rows) > 3:
        oldest = next((row for row in active_rows if row.id != keep_thread_id), active_rows[0])
        oldest.status = "cooling"
        oldest.pressure_band = "low"
        oldest.summary = thread_summary(
            oldest.thread_type,  # type: ignore[arg-type]
            "low",
            counterpart_name=None,
        )
        oldest.updated_at = datetime.now(timezone.utc)
        active_rows.remove(oldest)
    db.flush()


def apply_consequence_updates(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    counterpart_actor_id: str | None,
    counterpart_name: str | None,
    location_id: str | None,
    source_event_id: str,
    world_tags: list[WorldTag],
    consequence_tags: list[str] | None,
    action_kind: str,
    fail_forward: bool = False,
) -> ConsequenceApplicationOutcome:
    relationship_updates: list[dict[str, Any]] = []
    consequence_updates: list[dict[str, Any]] = []
    faction_updates: list[dict[str, Any]] = []
    additional_memory_drafts: list[dict[str, Any]] = []

    normalized_consequence_tags = normalize_consequence_tags(consequence_tags) or fallback_consequence_tags(
        world_tags=world_tags,
        action_kind=action_kind,
        fail_forward=fail_forward,
    )
    relationship = None
    if counterpart_actor_id is not None:
        relationship = get_relationship(
            db,
            world_id=world_id,
            from_actor_id=actor_id,
            to_actor_id=counterpart_actor_id,
            relationship_type="KNOWS",
        )
    current_strength = float(relationship.strength) if relationship is not None else 0.55
    outcome = ConsequenceRuleEngine.evaluate(
        ConsequenceRuleInput(
            world_tags=world_tags,
            consequence_tags=normalized_consequence_tags,
            relationship_strength=current_strength,
            active_threads=_thread_snapshots(db, world_id, actor_id),
        )
    )

    if counterpart_actor_id is not None and outcome.relationship_delta != 0.0:
        updated_relationship = adjust_relationship_strength(
            db,
            world_id=world_id,
            from_actor_id=actor_id,
            to_actor_id=counterpart_actor_id,
            relationship_type="KNOWS",
            delta=outcome.relationship_delta,
            default_strength=0.55,
        )
        band = relationship_band(float(updated_relationship.strength))
        relationship_updates.append(
            {
                "actor_id": counterpart_actor_id,
                "display_name": counterpart_name or "Unknown counterpart",
                "band": band,
                "summary": relationship_summary(counterpart_name or "The district", band),
                "delta": round(outcome.relationship_delta, 3),
            }
        )

    if outcome.faction_delta != 0.0:
        faction = ensure_starter_faction(db, world_id)
        standing = ensure_faction_standing(db, world_id=world_id, actor_id=actor_id, faction_id=faction.id)
        next_standing = max(-1.0, min(1.0, round(standing.standing + outcome.faction_delta, 3)))
        standing.standing = next_standing
        standing.band = standing_band(next_standing)
        faction_updates.append(
            {
                **faction_summary_to_dict(standing, faction),
                "delta": round(outcome.faction_delta, 3),
            }
        )
        db.flush()

    consequence_summary_text = outcome.summary
    if outcome.thread_action != "none" and outcome.thread_type is not None:
        thread = _matching_thread(
            db,
            world_id=world_id,
            actor_id=actor_id,
            thread_type=outcome.thread_type,
            counterpart_actor_id=counterpart_actor_id,
            location_id=location_id,
        )
        now = datetime.now(timezone.utc)
        if thread is None and outcome.thread_action in {"opened", "raised"}:
            thread = ConsequenceThread(
                world_id=world_id,
                owner_actor_id=actor_id,
                counterpart_actor_id=counterpart_actor_id,
                location_id=location_id,
                thread_type=outcome.thread_type,
                status=outcome.thread_status or "active",
                pressure_band=outcome.pressure_band or "low",
                title=thread_title(outcome.thread_type),
                summary=thread_summary(
                    outcome.thread_type,
                    outcome.pressure_band or "low",
                    counterpart_name=counterpart_name,
                ),
                source_event_id=source_event_id,
                last_event_id=source_event_id,
                opened_at=now,
                updated_at=now,
                resolved_at=now if outcome.thread_status == "resolved" else None,
            )
            db.add(thread)
            db.flush()
        elif thread is not None:
            pressure_band = outcome.pressure_band or thread.pressure_band  # type: ignore[assignment]
            if outcome.thread_action == "raised":
                current_rank = _pressure_rank(str(thread.pressure_band))  # type: ignore[arg-type]
                next_rank = max(current_rank, _pressure_rank(pressure_band))
                pressure_band = {1: "low", 2: "medium", 3: "high"}[next_rank]  # type: ignore[assignment]
            thread.status = outcome.thread_status or thread.status
            thread.pressure_band = pressure_band
            thread.title = thread_title(outcome.thread_type)
            thread.summary = thread_summary(outcome.thread_type, pressure_band, counterpart_name=counterpart_name)
            thread.last_event_id = source_event_id
            thread.updated_at = now
            if outcome.thread_action == "resolved":
                thread.resolved_at = now
            db.flush()
        if thread is not None:
            if thread.status == "active":
                _enforce_active_thread_cap(db, world_id=world_id, actor_id=actor_id, keep_thread_id=thread.id)
            consequence_summary_text = thread.summary
            consequence_updates.append(
                {
                    "id": thread.id,
                    "title": thread.title,
                    "summary": thread.summary,
                    "pressure_band": thread.pressure_band,
                    "status": thread.status,
                    "action": outcome.thread_action,
                }
            )
            additional_memory_drafts.append(
                {
                    "scope": "world",
                    "text": thread.summary,
                    "salience": 0.84 if outcome.outcome_band == "steady" else 0.9,
                    "location_id": location_id,
                    "actor_id": None,
                }
            )

    if relationship_updates:
        additional_memory_drafts.append(
            {
                "scope": "actor",
                "text": f"{counterpart_name or 'Someone'} now reads the scene with a {relationship_updates[0]['band']} edge toward the player.",
                "salience": 0.79,
                "location_id": location_id,
                "actor_id": counterpart_actor_id,
            }
        )

    db.flush()
    return ConsequenceApplicationOutcome(
        relationship_updates=relationship_updates,
        consequence_updates=consequence_updates,
        faction_updates=faction_updates,
        additional_memory_drafts=additional_memory_drafts,
        outcome_band=outcome.outcome_band,
        scene_tone=outcome.scene_tone,
        consequence_summary=consequence_summary_text,
    )


def _active_progression_quest(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
) -> tuple[QuestAssignment, QuestTemplate] | None:
    rows = list(
        db.execute(
            select(QuestAssignment, QuestTemplate)
            .join(
                QuestTemplate,
                (QuestTemplate.id == QuestAssignment.quest_template_id) & (QuestTemplate.world_id == QuestAssignment.world_id),
            )
            .where(QuestAssignment.world_id == world_id, QuestAssignment.owner_actor_id == actor_id)
        ).all()
    )
    rows.sort(key=lambda item: (item[0].status != "active", item[0].created_at, item[0].id))
    for assignment, template in rows:
        if assignment.status == "active":
            return assignment, template
    return None


def _issue_quest_reward_if_needed(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    assignment: QuestAssignment,
    quest_template: QuestTemplate,
) -> list[dict[str, Any]]:
    if assignment.reward_item_id is not None:
        return []
    if not bool((quest_template.state or {}).get("reward_enabled", True)):
        return []

    reward_item = db.execute(
        select(Item).where(
            Item.world_id == world_id,
            Item.source_quest_assignment_id == assignment.id,
        )
    ).scalar_one_or_none()
    if reward_item is None:
        reward_item = Item(
            id=new_id(),
            world_id=world_id,
            owner_actor_id=actor_id,
            template_key=quest_template.reward_template_key,
            name=quest_template.reward_name,
            description=quest_template.reward_description,
            status="active",
            effect_kind=(quest_template.state or {}).get("reward_effect_kind"),
            effect_payload=dict((quest_template.state or {}).get("reward_effect_payload") or {}),
            source_quest_assignment_id=assignment.id,
        )
        db.add(reward_item)
        db.flush()
    else:
        reward_item.status = reward_item.status or "active"
        reward_item.effect_kind = reward_item.effect_kind or (quest_template.state or {}).get("reward_effect_kind")
        reward_item.effect_payload = dict(
            reward_item.effect_payload or (quest_template.state or {}).get("reward_effect_payload") or {}
        )
    assignment.reward_item_id = reward_item.id
    return [{**item_summary_to_dict(reward_item), "action": "added"}]


def apply_active_quest_resolution(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    source_event_id: str,
    resolution: dict[str, Any] | None,
    summary: str,
) -> dict[str, list[dict[str, Any]]]:
    """Apply the AI GM's judgment that the active quest's situation is resolved.

    Quest progression is the AI GM's narrative judgment, not a deterministic counter
    (see ADR-003). Deterministic code only validates that a single active quest exists
    and applies the canonical effect (completion, reward, epilogue). It never decides
    whether a quest advanced or resolved.
    """
    empty: dict[str, list[dict[str, Any]]] = {"quest_updates": [], "inventory_updates": [], "chapter_updates": []}
    if not isinstance(resolution, dict) or not bool(resolution.get("resolved")):
        return empty

    active = _active_progression_quest(db, world_id=world_id, actor_id=actor_id)
    if active is None:
        return empty

    assignment, quest_template = active
    resolution_summary = (
        str(resolution.get("summary") or "").strip()
        or (summary or "").strip()
        or f"{quest_template.title} is resolved."
    )
    assignment.status = "completed"
    assignment.latest_summary = resolution_summary
    state_json = dict(assignment.state_json or {})
    state_json["resolved_from_ai_gm_event_id"] = source_event_id
    outcome_basis = [str(item) for item in (resolution.get("outcome_basis") or []) if str(item).strip()]
    if outcome_basis:
        state_json["resolution_outcome_basis"] = outcome_basis
    assignment.state_json = state_json

    inventory_updates = _issue_quest_reward_if_needed(
        db,
        world_id=world_id,
        actor_id=actor_id,
        assignment=assignment,
        quest_template=quest_template,
    )
    chapter_updates = _open_epilogue_chapter_for_assignment(
        db,
        world_id=world_id,
        actor_id=actor_id,
        source_event_id=source_event_id,
        assignment=assignment,
        template=quest_template,
        summary=assignment.latest_summary,
    )
    db.flush()
    return {
        "quest_updates": [
            _quest_update_dict(
                db,
                world_id=world_id,
                actor_id=actor_id,
                assignment=assignment,
                template=quest_template,
                action="resolved_by_ai_gm",
            )
        ],
        "inventory_updates": inventory_updates,
        "chapter_updates": chapter_updates,
    }


def use_reward_item(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    actor_name: str,
    location_id: str,
    item_id: str,
) -> RewardItemUseOutcome:
    # ADR-003: the reward item is a recognition artifact, not an unlock key. Area access
    # emerges from world state (see _route_accessible) and follow-up threads emerge through
    # the quest-offer system. Using the item only records the recognition and a small local
    # standing bump; it never unlocks routes or seeds a fixed follow-up quest.
    world_info = _world_pack_state(db, world_id)
    starter_location = ensure_starter_location(db, world_id)
    item = db.execute(
        select(Item).where(Item.world_id == world_id, Item.id == item_id)
    ).scalar_one_or_none()
    if item is None or item.owner_actor_id != actor_id:
        raise LookupError("Reward item not found")
    if item.used_at is not None or item.status == "used":
        raise ValueError("Reward item has already been used")
    if item.effect_kind != str(world_info.get("reward_effect_kind") or ""):
        raise ValueError("Reward item is not usable in the current progression slice")

    faction = ensure_starter_faction(db, world_id)
    standing = ensure_faction_standing(db, world_id=world_id, actor_id=actor_id, faction_id=faction.id)
    next_standing = max(-1.0, min(1.0, round(standing.standing + FOLLOWUP_STANDING_DELTA, 3)))
    standing.standing = next_standing
    standing.band = standing_band(next_standing)

    item.status = "used"
    item.used_at = datetime.now(timezone.utc)
    item.effect_payload = dict(item.effect_payload or {})

    faction_updates = [
        {
            **faction_summary_to_dict(standing, faction),
            "delta": FOLLOWUP_STANDING_DELTA,
        }
    ]
    inventory_updates = [
        {
            **item_summary_to_dict(item),
            "action": "used",
        }
    ]

    event_payload = {
        "world_id": world_id,
        "item_id": item.id,
        "template_key": item.template_key,
        "effect_kind": item.effect_kind,
        "effect_payload": item.effect_payload,
        "location_id": location_id,
        "faction_id": faction.id,
        "standing_delta": FOLLOWUP_STANDING_DELTA,
    }
    bootstrap_copy = _bootstrap_copy(db, world_id)
    followup_location_name = str(world_info.get("followup_location_name") or "")
    format_kwargs = {
        "player_name": actor_name,
        "reward_name": item.name,
        "faction_name": faction.name,
        "starter_location_name": starter_location.name,
        "followup_location_name": followup_location_name,
    }
    event_narrative = str(
        bootstrap_copy.get(
            "reward_use_narrative",
            "{player_name} presented {reward_name}, and {faction_name} acknowledged the thread they had resolved.",
        )
    ).format(**format_kwargs)
    memory_drafts = [
        {
            "scope": "location",
            "text": str(
                bootstrap_copy.get(
                    "reward_location_memory",
                    "{starter_location_name} remembers {player_name} presenting {reward_name}.",
                )
            ).format(**format_kwargs),
            "salience": 0.85,
            "location_id": location_id,
            "actor_id": None,
        },
        {
            "scope": "world",
            "text": str(
                bootstrap_copy.get(
                    "reward_world_memory",
                    "{player_name} is recognized by {faction_name} for the thread they resolved.",
                )
            ).format(**format_kwargs),
            "salience": 0.85,
            "location_id": location_id,
            "actor_id": None,
        },
    ]

    db.flush()
    return RewardItemUseOutcome(
        item=item,
        quest_updates=[],
        faction_updates=faction_updates,
        inventory_updates=inventory_updates,
        event_type="item.used",
        event_narrative=event_narrative,
        event_payload=event_payload,
        memory_drafts=memory_drafts,
    )


def faction_summary_to_dict(standing: FactionStanding, faction: Faction) -> dict[str, Any]:
    return {
        "faction_id": faction.id,
        "name": faction.name,
        "description": faction.description,
        "standing": round(standing.standing, 3),
        "band": standing.band,
    }


def quest_summary_to_dict(assignment: QuestAssignment, template: QuestTemplate) -> dict[str, Any]:
    return {
        "assignment_id": assignment.id,
        "quest_template_id": template.id,
        "title": template.title,
        "description": template.description,
        "status": assignment.status,
        "stage_key": template.stage_key,
        "unlock_requirements": template.unlock_requirements,
        "latest_summary": assignment.latest_summary,
        "reward_item_id": assignment.reward_item_id,
        "state_json": assignment.state_json,
    }


def item_summary_to_dict(item: Item) -> dict[str, Any]:
    return {
        "id": item.id,
        "template_key": item.template_key,
        "name": item.name,
        "description": item.description,
        "status": item.status,
        "usable": bool(item.effect_kind and item.used_at is None and item.status == "active"),
        "effect_kind": item.effect_kind,
    }


def knowledge_entry_to_dict(entry: ActorKnowledgeEntry) -> dict[str, Any]:
    return {
        "id": entry.id,
        "entry_kind": entry.entry_kind,
        "title": entry.title,
        "summary": entry.summary,
        "status": entry.status,
        "salience": round(float(entry.salience or 0.0), 3),
        "source_event_id": entry.source_event_id,
    }
