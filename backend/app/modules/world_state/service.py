from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from app.models.entities import (
    Actor,
    CharacterSheet,
    ConsequenceThread,
    Event,
    Faction,
    FactionStanding,
    Item,
    Location,
    LocationRoute,
    QuestAssignment,
    QuestTemplate,
    Relationship,
    Turn,
    World,
    new_id,
    route_id,
)
from app.modules.actor.service import (
    adjust_relationship_strength,
    ensure_pack_npcs,
    get_guide_npc_for_location,
    get_relationship,
)
from app.modules.world_pack.service import (
    DEFAULT_PACK_ID,
    DEFAULT_WORLD_TEMPLATE_ID,
    get_pack_registry,
    resolve_world_pack,
)
from app.modules.world_state.ambient import (
    list_ambient_murmurs,
    list_local_figures,
    list_npc_locations,
    list_offstage_murmurs,
    list_plaza_figures,
    list_recent_offstage_beats,
    list_recent_world_beats,
)
from app.modules.world_state.branch import (
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
from app.modules.world_state.scene import (
    SceneFrameEngine,
    ensure_narrative_frame_seed,
    get_current_chapter_summary,
    get_current_scene_summary,
    list_chapter_tracks_debug,
    list_recent_scene_history,
    list_scene_frames_debug,
)
from app.modules.world_state.rules import QuestRuleEngine, QuestRuleInput, WorldTag, standing_band


FOLLOWUP_STANDING_DELTA = 0.10
ROUTE_STATUS_OPEN = "open"
ROUTE_STATUS_LOCKED = "locked"


@dataclass(frozen=True)
class WorldSliceSeed:
    faction: Faction
    standing: FactionStanding
    quest_template: QuestTemplate
    quest_assignment: QuestAssignment
    followup_quest_template: QuestTemplate
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
        return template.quest.model_dump()
    if name == "followup_quest":
        return template.followup_quest.model_dump()
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
    return str(_seed_section(db, world_id, "roles").get("opening_chapter_key") or "opening_chapter")


def _followup_chapter_key(db: Session, world_id: str) -> str:
    return str(_seed_section(db, world_id, "roles").get("followup_chapter_key") or _followup_stage_key(db, world_id))


def _reward_effect_kind(db: Session, world_id: str) -> str:
    return str(_seed_section(db, world_id, "roles").get("reward_effect_kind") or "unlock_followup_route")


def _branch_labels(db: Session, world_id: str) -> dict[str, str]:
    labels = _seed_section(db, world_id, "roles").get("branch_labels") or {}
    if not isinstance(labels, dict):
        return {}
    return {str(key): str(value) for key, value in labels.items()}


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
            }
        )
        if location is None:
            location = Location(
                id=location_id,
                world_id=world_id,
                name=str(payload.get("name") or location_key.replace("_", " ").title()),
                description=str(payload.get("description") or ""),
                state=state,
            )
            db.add(location)
            db.flush()
        else:
            location.name = str(payload.get("name") or location.name)
            location.description = str(payload.get("description") or location.description)
            location.state = state
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
        if route is None:
            route = LocationRoute(
                id=route_id(world_id, route_key_name),
                world_id=world_id,
                from_location_id=resolved_locations[from_key].id,
                to_location_id=resolved_locations[to_key].id,
                route_key=route_key_name,
                status=default_status,
                travel_summary=str(payload.get("travel_summary") or ""),
                unlock_requirements_json=dict(payload.get("unlock_requirements") or {}),
            )
            db.add(route)
            db.flush()
        else:
            route.from_location_id = resolved_locations[from_key].id
            route.to_location_id = resolved_locations[to_key].id
            route.travel_summary = str(payload.get("travel_summary") or route.travel_summary or "")
            route.unlock_requirements_json = dict(payload.get("unlock_requirements") or route.unlock_requirements_json or {})
            if route.status not in {ROUTE_STATUS_OPEN, ROUTE_STATUS_LOCKED}:
                route.status = default_status
            db.flush()
        routes[route_key_name] = route
    return routes


def ensure_world(
    db: Session,
    world_id: str,
    *,
    pack_id: str = DEFAULT_PACK_ID,
    world_template_id: str = DEFAULT_WORLD_TEMPLATE_ID,
    world_name: str | None = None,
) -> World:
    registry = get_pack_registry()
    template = registry.get_template(pack_id, world_template_id)
    world = db.execute(select(World).where(World.id == world_id)).scalar_one_or_none()
    if world is not None:
        world.state = {
            **dict(world.state or {}),
            "pack_id": pack_id,
            "world_template_id": world_template_id,
        }
        locations = ensure_seeded_locations(db, world_id)
        ensure_location_routes(db, world_id, locations_by_key=locations)
        db.flush()
        return world

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
    faction_seed = _seed_section(db, world_id, "faction")
    faction_base_id = str(faction_seed.get("id") or "starter_faction")
    faction_id, candidates = _resolve_seeded_entity_id(world_id, faction_base_id)
    faction = db.execute(
        select(Faction).where(
            Faction.world_id == world_id,
            Faction.id.in_(candidates),
        )
    ).scalars().first()
    if faction is not None:
        return faction

    faction = Faction(
        id=faction_id,
        world_id=world_id,
        name=str(faction_seed.get("name") or "Starter Faction"),
        description=str(faction_seed.get("description") or ""),
        state=dict(faction_seed.get("state") or {}),
    )
    db.add(faction)
    db.flush()
    return faction


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
    default_completion_target: int,
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
        quest_template.completion_target = int(
            quest_seed.get("completion_target") or quest_template.completion_target or default_completion_target
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
        completion_target=int(quest_seed.get("completion_target") or default_completion_target),
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
        default_completion_target=2,
        default_reward_template_key="starter_reward",
        default_reward_name=str(template.quest.reward_name or "World Seal"),
        default_reward_description=str(template.quest.reward_description or "A trusted item for the next route."),
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
        default_id="followup_watch_path",
        default_title=str(template.followup_quest.title or "Follow-up Route Unsealed"),
        default_description=str(template.followup_quest.description or "Carry earned trust into the next route."),
        default_completion_target=1,
        default_reward_template_key="none",
        default_reward_name="",
        default_reward_description="",
        default_stage_key=_followup_stage_key(db, world_id),
        default_unlock_requirements={"starter_item_effect": _reward_effect_kind(db, world_id)},
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
        progress=0,
        progress_target=quest_template.completion_target,
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
        latest_summary=f"Help a local and return with what you learned around {lore_location_name}.",
        state_json={"lore_progress": 0, "last_world_tags": [], "unlocked_by_item_id": None},
    )


def ensure_followup_quest_assignment(
    db: Session,
    *,
    world_id: str,
    owner_actor_id: str,
    followup_template: QuestTemplate,
    unlocked_by_item_id: str,
) -> QuestAssignment:
    existing = db.execute(
        select(QuestAssignment).where(
            QuestAssignment.world_id == world_id,
            QuestAssignment.owner_actor_id == owner_actor_id,
            QuestAssignment.quest_template_id == followup_template.id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    template = resolve_world_pack(db, world_id)[1]
    return _ensure_quest_assignment(
        db,
        world_id=world_id,
        owner_actor_id=owner_actor_id,
        quest_template=followup_template,
        latest_summary=_bootstrap_copy(db, world_id).get(
            "reward_unlock_summary",
            f"{template.quest.reward_name} opened a follow-up route.",
        ),
        state_json={
            "lore_progress": 0,
            "last_world_tags": [],
            "unlocked_by_item_id": unlocked_by_item_id,
            "unlock_source": "reward_item",
        },
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


def ensure_world_slice_seed(
    db: Session,
    *,
    world_id: str,
    player_actor_id: str,
) -> WorldSliceSeed:
    locations_by_key = ensure_seeded_locations(db, world_id)
    ensure_location_routes(db, world_id, locations_by_key=locations_by_key)
    ensure_pack_npcs(
        db,
        world_id,
        location_ids_by_key={key: location.id for key, location in locations_by_key.items()},
    )
    starter_key = _starter_location_key(db, world_id)
    guide_actor = get_guide_npc_for_location(db, world_id, location_id=locations_by_key[starter_key].id)
    faction = ensure_starter_faction(db, world_id)
    if guide_actor is not None:
        ensure_membership_relationship(db, world_id=world_id, from_actor_id=guide_actor.id, faction_id=faction.id)
    standing = ensure_faction_standing(db, world_id=world_id, actor_id=player_actor_id, faction_id=faction.id)
    character_sheet = ensure_character_sheet(db, world_id, player_actor_id)
    quest_template = ensure_starter_quest_template(db, world_id)
    quest_assignment = ensure_starter_quest_assignment(
        db,
        world_id=world_id,
        owner_actor_id=player_actor_id,
        quest_template_id=quest_template.id,
    )
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


def _route_summary(route: LocationRoute, to_location: Location) -> dict[str, Any]:
    available = route.status == ROUTE_STATUS_OPEN
    summary = route.travel_summary.strip()
    destination_key = str((to_location.state or {}).get("key") or "")
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
        "destination_key": destination_key,
        "to_location": {
            "id": to_location.id,
            "name": to_location.name,
            "description": to_location.description,
            "key": destination_key,
        },
    }


def list_nearby_routes(db: Session, world_id: str, location_id: str | None) -> list[dict[str, Any]]:
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
    return [_route_summary(route, location) for route, location in routes]


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


def unlock_watch_path_routes(db: Session, world_id: str) -> list[LocationRoute]:
    locations = ensure_seeded_locations(db, world_id)
    starter = locations[_starter_location_key(db, world_id)]
    followup = locations[_followup_location_key(db, world_id)]
    routes = [
        route
        for route in (
            get_location_route(db, world_id=world_id, from_location_id=starter.id, to_location_id=followup.id),
            get_location_route(db, world_id=world_id, from_location_id=followup.id, to_location_id=starter.id),
        )
        if route is not None
    ]
    updated: list[LocationRoute] = []
    for route in routes:
        if route.status != ROUTE_STATUS_OPEN:
            route.status = ROUTE_STATUS_OPEN
            updated.append(route)
    db.flush()
    return routes


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
    if route.status != ROUTE_STATUS_OPEN:
        raise ValueError("Travel route is not open")

    actor.current_location_id = destination.id
    location_updates = [
        {
            "from_location": get_location_summary(db, world_id, origin_location.id),
            "to_location": get_location_summary(db, world_id, destination.id),
            "summary": route.travel_summary or f"{origin_location.name}から{destination.name}へ移動した。",
            "action": "arrived",
        }
    ]
    travel_summary = str(route.travel_summary or f"{destination.name}へ移動した。").strip()
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


def list_inventory_summaries(db: Session, world_id: str, actor_id: str) -> list[dict[str, Any]]:
    items = list(
        db.execute(
            select(Item)
            .where(Item.world_id == world_id, Item.owner_actor_id == actor_id)
            .order_by(Item.created_at.asc(), Item.id.asc())
        ).scalars()
    )
    return [item_summary_to_dict(item) for item in items]


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
                "travel_summary": route.travel_summary,
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
    locations = ensure_seeded_locations(db, world_id)
    starter_key = _starter_location_key(db, world_id)
    lore_key = _lore_location_key(db, world_id)
    followup_key = _followup_location_key(db, world_id)
    return {
        "pack_id": pack.manifest.pack_id,
        "pack_display_name": pack.manifest.display_name,
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
        "reward_name": str(template.quest.reward_name or ""),
        "faction_name": str(template.faction.name or ""),
        "branch_labels": _branch_labels(db, world_id),
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
    starter_location_key = str(world_pack.get("starter_location_key") or "starter")
    lore_location_key = str(world_pack.get("lore_location_key") or "lore")
    followup_location_key = str(world_pack.get("followup_location_key") or "followup")
    starter_location_name = str(world_pack.get("starter_location_name") or "the starting place")
    lore_location_name = str(world_pack.get("lore_location_name") or "the loreward district")
    followup_location_name = str(world_pack.get("followup_location_name") or "the next route")
    starter_stage_key = str(world_pack.get("starter_stage_key") or "starter_stage")
    followup_stage_key = str(world_pack.get("followup_stage_key") or "followup_stage")
    reward_effect_kind = str(world_pack.get("reward_effect_kind") or "unlock_followup_route")
    reward_name = str(world_pack.get("reward_name") or (session_state.get("inventory") or [{}])[0].get("name") or "the seal")
    faction_name = str(world_pack.get("faction_name") or "the local faction")
    branch_labels = dict(world_pack.get("branch_labels") or {})
    watch_branch_label = str(branch_labels.get("watch_oath") or "Watch Oath")
    whisper_branch_label = str(branch_labels.get("lantern_whispers") or "Lantern Whispers")
    quests = session_state.get("quests") or []
    inventory = session_state.get("inventory") or []
    relationships = session_state.get("relationships") or []
    active_threads = session_state.get("active_consequence_threads") or []
    current_location = session_state.get("current_location") or session_state.get("location") or {}
    current_location_name = str(current_location.get("name") or "the scene")
    current_location_key = str(current_location.get("key") or starter_location_key)
    nearby_routes = session_state.get("nearby_routes") or []
    local_figures = session_state.get("local_figures") or session_state.get("plaza_figures") or []
    recent_travel_history = session_state.get("recent_travel_history") or []
    active_quest = next((item for item in quests if item.get("status") == "active"), quests[0] if quests else {})
    stage_key = str(active_quest.get("stage_key") or starter_stage_key)
    progress = int(active_quest.get("progress") or 0)
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
    recent_branch_echoes = session_state.get("recent_branch_echoes") or []
    recent_world_beats = session_state.get("recent_world_beats") or []
    ambient_murmurs = session_state.get("ambient_murmurs") or []
    recent_offstage_beats = session_state.get("recent_offstage_beats") or []
    offstage_murmurs = session_state.get("offstage_murmurs") or []
    npc_locations = session_state.get("npc_locations") or []
    leading_world_beat = str(recent_world_beats[0]) if recent_world_beats else ""
    leading_murmur = str(ambient_murmurs[0]) if ambient_murmurs else ""
    leading_offstage = str(recent_offstage_beats[0]) if recent_offstage_beats else ""
    leading_offstage_murmur = str(offstage_murmurs[0]) if offstage_murmurs else ""
    leading_npc_location = str((npc_locations[0] or {}).get("summary") or "") if npc_locations else ""
    leading_local_figure = str((local_figures[0] or {}).get("summary") or "") if local_figures else ""
    leading_route = str((nearby_routes[0] or {}).get("summary") or "") if nearby_routes else ""
    leading_travel = str(recent_travel_history[0] or "") if recent_travel_history else ""
    leading_branch_echo = str(recent_branch_echoes[0] or "") if recent_branch_echoes else ""
    dominant_branch = dominant_branch_key(route_pressures)

    def route_to(location_key: str) -> dict[str, Any] | None:
        return next(
            (
                route
                for route in nearby_routes
                if str(((route or {}).get("to_location") or {}).get("key") or "") == location_key
            ),
            None,
        )

    safe_choice = {
        "choice_id": "safe",
        "posture": "safe",
        "label": f"{current_location_name}の気配を乱さず、まず息を整えて見守る",
        "summary": "場の流れを乱さず、まず気配と視線を確かめる。",
        "canonical_input_text": f"{current_location_name}の流れを乱さず、周囲の気配と視線を見守る",
        "action_kind": "narrative",
    }
    progress_choice = {
        "choice_id": "progress",
        "posture": "progress",
        "label": "困っている相手に手を差し伸べ、次の進展を作る",
        "summary": "もっとも前進寄りの行動で、依頼や関係を進める。",
        "canonical_input_text": f"{starter_location_name}で旅人を助け、次の進展を作る",
        "action_kind": "narrative",
    }
    explore_choice = {
        "choice_id": "explore",
        "posture": "explore",
        "label": "噂と視線をたどり、場の裏側を探る",
        "summary": "探索や関係変化に寄せた行動で、状況理解を広げる。",
        "canonical_input_text": f"{current_location_name}の空気や人の事情を探り、何が起きているか確かめる",
        "action_kind": "narrative",
    }

    if "promise" in thread_types:
        safe_choice = {
            **safe_choice,
            "label": "急がず場を保ちつつ、宙に浮いた約束の手触りを確かめる",
            "summary": "約束を悪化させず、まず場を落ち着かせる。",
            "canonical_input_text": "場を保ちつつ、宙に浮いた約束をどう受け止めるか静かに確かめる",
        }
        progress_choice = {
            **progress_choice,
            "label": "まだ宙に浮く約束へきちんと応え、次の進展を作る",
            "summary": "約束の圧力へ正面から応え、関係と依頼を前に進める。",
            "canonical_input_text": "宙に浮いた約束へ応え、見回りの次の段取りをきちんと進める",
        }
        explore_choice = {
            **explore_choice,
            "label": "約束がどう噂や視線に残っているかを探る",
            "summary": "物語のしこりの広がり方を探る。",
            "canonical_input_text": f"約束が{current_location_name}の噂や視線にどう残っているかを探る",
        }
    elif "scrutiny" in thread_types:
        safe_choice = {
            **safe_choice,
            "label": "見張りの視線を刺激しないよう、慎重に場の空気を読む",
            "summary": "警戒をこれ以上高めずに場を保つ。",
            "canonical_input_text": "見張りの視線を刺激しないよう慎重に場の空気を読む",
        }
        progress_choice = {
            **progress_choice,
            "label": "見られていることを受け止めたまま、着実に前へ進む",
            "summary": "警戒下でも進展を作る。",
            "canonical_input_text": "見られていることを受け止めたまま着実に前へ進む",
        }
        explore_choice = {
            **explore_choice,
            "label": "誰がどこまで見ているのか、視線の流れを探る",
            "summary": "警戒の源を見極める。",
            "canonical_input_text": "誰がどこまで見ているのか、広場の視線の流れを探る",
        }
    elif relationship_band_name in {"warm", "trusted"}:
        progress_choice = {
            **progress_choice,
            "label": "差し出された信頼を受け止め、そのまま次の進展へ踏み込む",
            "summary": "関係の追い風を受けて進める。",
            "canonical_input_text": "差し出された信頼を受け止め、そのまま次の進展へ踏み込む",
        }

    if stage_key == starter_stage_key and progress >= 1:
        progress_choice = {
            **progress_choice,
            "label": "見聞きをまとめて報告し、次の見回りへ繋げる",
            "summary": f"依頼を締め、{faction_name}から次の信頼を引き出す。",
            "canonical_input_text": f"見聞きを報告し、{current_location_name}で次の段取りを引き受ける",
        }
        safe_choice = {
            **safe_choice,
            "label": "急がず相手の落ち着きを確かめ、場の気配を保つ",
            "canonical_input_text": f"急がず相手の落ち着きを確かめ、{current_location_name}の気配を保つ",
        }
        explore_choice = {
            **explore_choice,
            "label": "周囲の視線や噂を探り、次の手掛かりを拾う",
            "canonical_input_text": f"{current_location_name}に残る視線や噂を探り、次の手掛かりを拾う",
        }

    if usable_item is not None and usable_item.get("effect_kind") == reward_effect_kind:
        if current_location_key == starter_location_key:
            progress_choice = {
                "choice_id": "progress",
                "posture": "progress",
                "label": f"{reward_name}を掲げ、次の道を正式に開く",
                "summary": "重要アイテムを使って次の物語段階を解放する。",
                "canonical_input_text": f"{reward_name}を掲げ、次の道を開く",
                "action_kind": "use_reward_item",
            }
        else:
            return_route = route_to(starter_location_key)
            if return_route is not None and bool(return_route.get("available")):
                progress_choice = {
                    "choice_id": "progress",
                    "posture": "progress",
                    "label": f"{reward_name}を使える場所へ戻る",
                    "summary": "重要アイテムを使うため、まず起点の場所へ戻る。",
                    "canonical_input_text": f"{reward_name}を使える場所へ戻る",
                    "action_kind": "travel",
                    "travel_target_key": starter_location_key,
                }

    if stage_key == followup_stage_key:
        watch_route = route_to(followup_location_key)
        if current_location_key != followup_location_key and watch_route is not None and bool(watch_route.get("available")):
            progress_choice = {
                "choice_id": "progress",
                "posture": "progress",
                "label": f"開いた{followup_location_name}へ足を向ける",
                "summary": "follow-up quest の舞台へ実際に移る。",
                "canonical_input_text": f"{reward_name}で開いた{followup_location_name}へ向かう",
                "action_kind": "travel",
                "travel_target_key": followup_location_key,
            }
        else:
            progress_choice = {
                "choice_id": "progress",
                "posture": "progress",
                "label": f"開いた{followup_location_name}を辿り、そこで見つかる異変を確かめる",
                "summary": "follow-up quest を前へ進める選択。",
                "canonical_input_text": f"{reward_name}で開いた{followup_location_name}の様子を観察する",
                "action_kind": "narrative",
            }
        if current_location_key == followup_location_key:
            safe_choice = {
                "choice_id": "safe",
                "posture": "safe",
                "label": f"{followup_location_name}の気配を整え、場を静かに安定させる",
                "summary": "危険を抑えつつ、場の安定を優先する。",
                "canonical_input_text": f"開いた{followup_location_name}の気配を整え、場を静かに安定させる",
                "action_kind": "narrative",
            }
            explore_choice = {
                "choice_id": "explore",
                "posture": "explore",
                "label": f"{followup_location_name}の痕跡や現地の記憶を集め、関係の糸口を探る",
                "summary": "探索と関係変化に寄せた選択。",
                "canonical_input_text": f"{reward_name}で開いた{followup_location_name}の痕跡や現地の記憶を集める",
                "action_kind": "narrative",
            }
        if current_branch == "watch_oath":
            safe_choice = {
                **safe_choice,
                "label": "表に出た秩序を崩さず、今の線を丁寧に保つ",
                "canonical_input_text": "表に出た秩序を崩さず、今の線を丁寧に保つ",
            }
            progress_choice = {
                **progress_choice,
                "label": f"{watch_branch_label}に沿って前へ進み、正式な信頼を固める",
                "canonical_input_text": f"{watch_branch_label}に沿って前へ進み、正式な信頼を固める",
            }
            explore_choice = {
                **explore_choice,
                "label": "表の流れの裏でまだ揺れている気配を探る",
                "canonical_input_text": "表の流れの裏でまだ揺れている気配を探る",
            }
        elif current_branch == "lantern_whispers":
            safe_choice = {
                **safe_choice,
                "label": "広がりすぎた噂を刺激せず、静かな流れを読む",
                "canonical_input_text": "広がりすぎた噂を刺激せず、静かな流れを読む",
            }
            progress_choice = {
                **progress_choice,
                "label": f"{whisper_branch_label}に沿って前へ進み、裏の流れを確かめる",
                "canonical_input_text": f"{whisper_branch_label}に沿って前へ進み、裏の流れを確かめる",
            }
            explore_choice = {
                **explore_choice,
                "label": "静かな流れの外縁に残る別の糸を探る",
                "canonical_input_text": "静かな流れの外縁に残る別の糸を探る",
            }
        elif crossroads_summary:
            safe_choice = {
                **safe_choice,
                "label": "どちらの道にも決め切らず、場の圧だけを静かに読む",
                "canonical_input_text": "どちらの道にも決め切らず、場の圧だけを静かに読む",
            }
            if dominant_branch == "watch_oath":
                progress_choice = {
                    **progress_choice,
                    "label": f"{watch_branch_label}の側へ少し踏み込み、表の流れを前へ押す",
                    "canonical_input_text": f"{watch_branch_label}の側へ少し踏み込み、表の流れを前へ押す",
                }
                explore_choice = {
                    **explore_choice,
                    "label": f"{whisper_branch_label}の側にまだ残る別の糸を拾う",
                    "canonical_input_text": f"{whisper_branch_label}の側にまだ残る別の糸を拾う",
                }
            elif dominant_branch == "lantern_whispers":
                progress_choice = {
                    **progress_choice,
                    "label": f"{whisper_branch_label}の側へ少し踏み込み、その流れを前へ押す",
                    "canonical_input_text": f"{whisper_branch_label}の側へ少し踏み込み、その流れを前へ押す",
                }
                explore_choice = {
                    **explore_choice,
                    "label": f"{watch_branch_label}の側にまだ残る別の糸を拾う",
                    "canonical_input_text": f"{watch_branch_label}の側にまだ残る別の糸を拾う",
                }

    archive_route = route_to(lore_location_key)
    square_route = route_to(starter_location_key)
    if current_location_key == starter_location_key and archive_route is not None and bool(archive_route.get("available")):
        explore_choice = {
            "choice_id": "explore",
            "posture": "explore",
            "label": f"{lore_location_name}へ向かい、古い記録と視線の重なりを確かめる",
            "summary": "場を変えながら探索を進める。",
            "canonical_input_text": f"{lore_location_name}へ向かう",
            "action_kind": "travel",
            "travel_target_key": lore_location_key,
        }
    if current_location_key == lore_location_key:
        progress_choice = {
            "choice_id": "progress",
            "posture": "progress",
            "label": f"{lore_location_name}で手掛かりを辿り、次の糸口を掴む",
            "summary": f"{lore_location_name}側で状況を前へ進める。",
            "canonical_input_text": f"{lore_location_name}で古い記録と現地の話を辿る",
            "action_kind": "narrative",
        }
        if square_route is not None and bool(square_route.get("available")):
            safe_choice = {
                "choice_id": "safe",
                "posture": "safe",
                "label": f"いったん{starter_location_name}へ戻り、場の流れを確かめ直す",
                "summary": "起点へ戻って場の圧力を測り直す。",
                "canonical_input_text": f"{starter_location_name}へ戻る",
                "action_kind": "travel",
                "travel_target_key": starter_location_key,
            }
    if current_location_key == followup_location_key and square_route is not None and bool(square_route.get("available")):
        safe_choice = {
            "choice_id": "safe",
            "posture": "safe",
            "label": f"{followup_location_name}の緊張を抱えたまま、いったん起点へ戻る",
            "summary": "新しい場所の余韻を持ち帰る。",
            "canonical_input_text": f"{starter_location_name}へ戻る",
            "action_kind": "travel",
            "travel_target_key": starter_location_key,
        }

    for choice in (safe_choice, progress_choice, explore_choice):
        ambient_parts = [
            scene_summary,
            pressure_summary,
            chapter_summary,
            crossroads_summary,
            branch_hint,
            leading_branch_echo,
            leading_travel if str(choice.get("action_kind") or "") == "travel" else "",
            leading_route if str(choice.get("action_kind") or "") == "travel" else "",
            leading_world_beat if choice["choice_id"] != "safe" else leading_murmur,
            leading_offstage if choice["choice_id"] == "progress" else leading_offstage_murmur,
            leading_npc_location if choice["choice_id"] == "explore" else "",
            leading_local_figure if choice["choice_id"] == "explore" else "",
            str(choice.get("summary") or "").strip(),
        ]
        choice["summary"] = " ".join(part for part in ambient_parts if part).strip()

    return [safe_choice, progress_choice, explore_choice]


def build_session_state(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    location_id: str | None,
    include_internal: bool = False,
) -> dict[str, Any]:
    world_info = _world_pack_state(db, world_id)
    character = get_character_summary(db, world_id, actor_id)
    quests = list_quest_summaries(db, world_id, actor_id)
    factions = list_faction_summaries(db, world_id, actor_id)
    inventory = list_inventory_summaries(db, world_id, actor_id)
    relationships = list_relationship_summaries(db, world_id, actor_id)
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
    nearby_routes = list_nearby_routes(db, world_id, location_id)
    recent_travel_history = list_recent_travel_history(db, world_id, actor_id)
    chapter_key = str((chapter or {}).get("key") or "")
    followup_chapter_key = str(world_info.get("followup_chapter_key") or "")
    route_pressures = (
        list_route_pressures(db, world_id=world_id, actor_id=actor_id, chapter_key=chapter_key)
        if followup_chapter_key and chapter_key == followup_chapter_key
        else []
    )
    branch_hint = player_visible_branch_hint(
        current_branch=((chapter or {}).get("current_branch") if include_internal else None),
        pressures={
            "watch_oath": float(next((item["pressure"] for item in route_pressures if item["route_key"] == "watch_oath"), 0.0)),
            "lantern_whispers": float(
                next((item["pressure"] for item in route_pressures if item["route_key"] == "lantern_whispers"), 0.0)
            ),
        },
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
                current_branch=chapter.get("current_branch"),
                crossroads_status=str(chapter.get("branch_status") or "open"),
                pressures={
                    "watch_oath": float(
                        next((item["pressure"] for item in route_pressures if item["route_key"] == "watch_oath"), 0.0)
                    ),
                    "lantern_whispers": float(
                        next((item["pressure"] for item in route_pressures if item["route_key"] == "lantern_whispers"), 0.0)
                    ),
                },
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
        "location": current_location,
        "current_location": current_location,
        "character": character,
        "quests": quests,
        "factions": factions,
        "inventory": inventory,
        "chapter": chapter,
        "current_scene": current_scene,
        "recent_scene_history": recent_scene_history,
        "local_figures": local_figures,
        "plaza_figures": local_figures,
        "nearby_routes": nearby_routes,
        "recent_travel_history": recent_travel_history,
        "recent_world_beats": recent_world_beats,
        "ambient_murmurs": ambient_murmurs,
        "npc_locations": npc_locations,
        "recent_offstage_beats": recent_offstage_beats,
        "offstage_murmurs": offstage_murmurs,
        "recent_branch_echoes": recent_branch_echoes,
        "relationships": relationships,
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
    for assignment, template in rows:
        if assignment.progress < assignment.progress_target:
            return assignment, template
    return None


def apply_world_tag_updates(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    world_tags: list[WorldTag],
) -> dict[str, list[dict[str, Any]]]:
    active = _active_progression_quest(db, world_id=world_id, actor_id=actor_id)
    if active is None:
        return {
            "quest_updates": [],
            "faction_updates": [],
            "inventory_updates": [],
        }

    assignment, quest_template = active
    faction = ensure_starter_faction(db, world_id)
    standing = ensure_faction_standing(db, world_id=world_id, actor_id=actor_id, faction_id=faction.id)

    rule = QuestRuleEngine.evaluate(
        QuestRuleInput(
            world_tags=world_tags,
            current_progress=assignment.progress,
            progress_target=max(assignment.progress_target, quest_template.completion_target),
            current_standing=standing.standing,
            reward_already_issued=assignment.reward_item_id is not None,
            reward_enabled=bool((quest_template.state or {}).get("reward_enabled", True)),
        )
    )

    state_json = dict(assignment.state_json or {})
    state_json["lore_progress"] = int(state_json.get("lore_progress", 0)) + rule.lore_progress_delta
    state_json["last_world_tags"] = rule.world_tags

    assignment.progress_target = max(assignment.progress_target, quest_template.completion_target)
    assignment.progress = rule.next_progress
    assignment.state_json = state_json
    assignment.status = "completed" if rule.completed else "active"
    assignment.latest_summary = (
        f"{quest_template.title}: {assignment.progress}/{assignment.progress_target} "
        f"({assignment.status}) [{', '.join(rule.world_tags)}]"
    )

    standing_changed = rule.standing_delta != 0.0
    if standing_changed:
        standing.standing = rule.next_standing
        standing.band = rule.next_band

    inventory_updates: list[dict[str, Any]] = []
    reward_item: Item | None = None
    if rule.should_issue_reward:
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
        inventory_updates.append(
            {
                **item_summary_to_dict(reward_item),
                "action": "added",
            }
        )

    db.flush()

    quest_updates = []
    if rule.world_tags != ["none"] or rule.quest_progress_delta or rule.lore_progress_delta or rule.should_issue_reward:
        quest_updates.append(
            {
                **quest_summary_to_dict(assignment, quest_template),
                "world_tags": rule.world_tags,
                "summary": rule.summary,
            }
        )

    faction_updates = []
    if standing_changed:
        faction_updates.append(
            {
                **faction_summary_to_dict(standing, faction),
                "delta": rule.standing_delta,
            }
        )

    return {
        "quest_updates": quest_updates,
        "faction_updates": faction_updates,
        "inventory_updates": inventory_updates,
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
    if location_id != starter_location.id:
        raise ValueError("Reward item can only be used at the starter location")

    starter_template = ensure_starter_quest_template(db, world_id)
    starter_assignment = ensure_starter_quest_assignment(
        db,
        world_id=world_id,
        owner_actor_id=actor_id,
        quest_template_id=starter_template.id,
    )
    if starter_assignment.status != "completed":
        raise ValueError("Starter quest must be completed before using this reward item")

    followup_template = ensure_followup_quest_template(db, world_id)
    existing_followup = db.execute(
        select(QuestAssignment).where(
            QuestAssignment.world_id == world_id,
            QuestAssignment.owner_actor_id == actor_id,
            QuestAssignment.quest_template_id == followup_template.id,
        )
    ).scalar_one_or_none()
    if existing_followup is not None:
        raise ValueError("Follow-up quest is already unlocked")

    followup_assignment = ensure_followup_quest_assignment(
        db,
        world_id=world_id,
        owner_actor_id=actor_id,
        followup_template=followup_template,
        unlocked_by_item_id=item.id,
    )

    faction = ensure_starter_faction(db, world_id)
    standing = ensure_faction_standing(db, world_id=world_id, actor_id=actor_id, faction_id=faction.id)
    next_standing = max(-1.0, min(1.0, round(standing.standing + FOLLOWUP_STANDING_DELTA, 3)))
    standing.standing = next_standing
    standing.band = standing_band(next_standing)

    item.status = "used"
    item.used_at = datetime.now(timezone.utc)
    item.effect_payload = dict(item.effect_payload or {})
    item.effect_payload["followup_quest_assignment_id"] = followup_assignment.id
    unlock_watch_path_routes(db, world_id)

    quest_updates = [
        {
            **quest_summary_to_dict(followup_assignment, followup_template),
            "summary": _bootstrap_copy(db, world_id).get(
                "reward_unlock_summary",
                f"{item.name} unlocked the next route.",
            ),
            "world_tags": ["collect_reward"],
        }
    ]
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
        "followup_assignment_id": followup_assignment.id,
        "followup_stage_key": followup_template.stage_key,
        "faction_id": faction.id,
        "standing_delta": FOLLOWUP_STANDING_DELTA,
    }
    bootstrap_copy = _bootstrap_copy(db, world_id)
    event_narrative = str(
        bootstrap_copy.get(
            "reward_use_narrative",
            "{player_name} used {reward_name} to open the next route.",
        )
    ).format(
        player_name=actor_name,
        reward_name=item.name,
        faction_name=faction.name,
        starter_location_name=starter_location.name,
        followup_location_name=str(world_info.get("followup_location_name") or ""),
    )
    memory_drafts = [
        {
            "scope": "location",
            "text": str(
                bootstrap_copy.get(
                    "reward_location_memory",
                    "{starter_location_name} remembers {reward_name} opening the next route.",
                )
            ).format(
                starter_location_name=starter_location.name,
                reward_name=item.name,
                followup_location_name=str(world_info.get("followup_location_name") or ""),
            ),
            "salience": 0.95,
            "location_id": location_id,
            "actor_id": None,
        },
        {
            "scope": "location",
            "text": f"{item.name}で開いた{world_info.get('followup_location_name') or '次の道'}の気配が、{starter_location.name}にはっきり残っている。",
            "salience": 0.98,
            "location_id": location_id,
            "actor_id": None,
        },
        {
            "scope": "world",
            "text": str(
                bootstrap_copy.get(
                    "reward_world_memory",
                    "{player_name} used {reward_name} to open the next route for {faction_name}.",
                )
            ).format(
                player_name=actor_name,
                reward_name=item.name,
                faction_name=faction.name,
                followup_location_name=str(world_info.get("followup_location_name") or ""),
            ),
            "salience": 0.9,
            "location_id": location_id,
            "actor_id": None,
        },
    ]

    db.flush()
    return RewardItemUseOutcome(
        item=item,
        quest_updates=quest_updates,
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
        "progress": assignment.progress,
        "progress_target": assignment.progress_target,
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
