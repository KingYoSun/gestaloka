from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    CharacterSheet,
    Faction,
    FactionStanding,
    Item,
    Location,
    QuestAssignment,
    QuestTemplate,
    Relationship,
    World,
    new_id,
    starter_location_id,
)
from app.modules.world_state.rules import QuestRuleEngine, QuestRuleInput, WorldTag, standing_band


@dataclass(frozen=True)
class WorldSliceSeed:
    faction: Faction
    standing: FactionStanding
    quest_template: QuestTemplate
    quest_assignment: QuestAssignment
    character_sheet: CharacterSheet


def _seed_path() -> Path:
    return Path(__file__).with_name("founders_reach.yaml")


@lru_cache(maxsize=1)
def _load_seed() -> dict[str, Any]:
    return yaml.safe_load(_seed_path().read_text(encoding="utf-8")) or {}


def _seed_section(name: str) -> dict[str, Any]:
    value = _load_seed().get(name) or {}
    if not isinstance(value, dict):
        raise ValueError(f"Invalid world seed section: {name}")
    return value


def ensure_world(db: Session, world_id: str, world_name: str) -> World:
    world = db.execute(select(World).where(World.id == world_id)).scalar_one_or_none()
    if world is not None:
        ensure_starter_location(db, world_id)
        return world

    fallback_name = str(_seed_section("world").get("default_name") or "Founders Reach")
    world = World(id=world_id, name=world_name or fallback_name, status="active")
    db.add(world)
    db.flush()
    ensure_starter_location(db, world_id)
    return world


def ensure_starter_location(db: Session, world_id: str) -> Location:
    location = db.execute(
        select(Location).where(Location.id == starter_location_id(world_id), Location.world_id == world_id)
    ).scalar_one_or_none()
    if location is not None:
        return location

    location_seed = _seed_section("location")
    location = Location(
        id=starter_location_id(world_id),
        world_id=world_id,
        name=str(location_seed.get("name") or "Founders Reach"),
        description=str(location_seed.get("description") or ""),
        state={"kind": "starter"},
    )
    db.add(location)
    db.flush()
    return location


def ensure_character_sheet(db: Session, world_id: str, actor_id: str) -> CharacterSheet:
    sheet = db.execute(
        select(CharacterSheet).where(CharacterSheet.world_id == world_id, CharacterSheet.actor_id == actor_id)
    ).scalar_one_or_none()
    if sheet is not None:
        return sheet

    character_seed = _seed_section("character")
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
    faction_seed = _seed_section("faction")
    faction_id = str(faction_seed.get("id") or "founders_watch")
    faction = db.execute(
        select(Faction).where(Faction.world_id == world_id, Faction.id == faction_id)
    ).scalar_one_or_none()
    if faction is not None:
        return faction

    faction = Faction(
        id=faction_id,
        world_id=world_id,
        name=str(faction_seed.get("name") or "Founders Watch"),
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


def ensure_starter_quest_template(db: Session, world_id: str) -> QuestTemplate:
    quest_seed = _seed_section("quest")
    quest_id = str(quest_seed.get("id") or "starter_watch_request")
    quest_template = db.execute(
        select(QuestTemplate).where(QuestTemplate.world_id == world_id, QuestTemplate.id == quest_id)
    ).scalar_one_or_none()
    if quest_template is not None:
        return quest_template

    quest_template = QuestTemplate(
        id=quest_id,
        world_id=world_id,
        title=str(quest_seed.get("title") or "First Watch Request"),
        description=str(quest_seed.get("description") or ""),
        completion_target=int(quest_seed.get("completion_target") or 2),
        reward_template_key=str(quest_seed.get("reward_template_key") or "lantern_sigils"),
        reward_name=str(quest_seed.get("reward_name") or "Lantern Sigil"),
        reward_description=str(quest_seed.get("reward_description") or ""),
        state={},
    )
    db.add(quest_template)
    db.flush()
    return quest_template


def ensure_starter_quest_assignment(
    db: Session,
    *,
    world_id: str,
    owner_actor_id: str,
    quest_template_id: str,
) -> QuestAssignment:
    existing = db.execute(
        select(QuestAssignment).where(
            QuestAssignment.world_id == world_id,
            QuestAssignment.owner_actor_id == owner_actor_id,
            QuestAssignment.quest_template_id == quest_template_id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    active = db.execute(
        select(QuestAssignment)
        .where(
            QuestAssignment.world_id == world_id,
            QuestAssignment.owner_actor_id == owner_actor_id,
            QuestAssignment.status == "active",
        )
        .order_by(QuestAssignment.created_at.asc(), QuestAssignment.id.asc())
    ).scalar_one_or_none()
    if active is not None:
        return active

    quest_template = db.execute(
        select(QuestTemplate).where(QuestTemplate.world_id == world_id, QuestTemplate.id == quest_template_id)
    ).scalar_one()
    assignment = QuestAssignment(
        world_id=world_id,
        owner_actor_id=owner_actor_id,
        quest_template_id=quest_template_id,
        status="active",
        progress=0,
        progress_target=quest_template.completion_target,
        latest_summary="Help a local and return with what you learned.",
        state_json={"lore_progress": 0, "last_world_tags": []},
    )
    db.add(assignment)
    db.flush()
    return assignment


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
    guide_actor_id: str,
) -> WorldSliceSeed:
    ensure_starter_location(db, world_id)
    faction = ensure_starter_faction(db, world_id)
    ensure_membership_relationship(db, world_id=world_id, from_actor_id=guide_actor_id, faction_id=faction.id)
    standing = ensure_faction_standing(db, world_id=world_id, actor_id=player_actor_id, faction_id=faction.id)
    character_sheet = ensure_character_sheet(db, world_id, player_actor_id)
    quest_template = ensure_starter_quest_template(db, world_id)
    quest_assignment = ensure_starter_quest_assignment(
        db,
        world_id=world_id,
        owner_actor_id=player_actor_id,
        quest_template_id=quest_template.id,
    )
    return WorldSliceSeed(
        faction=faction,
        standing=standing,
        quest_template=quest_template,
        quest_assignment=quest_assignment,
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
    }


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
            .order_by(QuestAssignment.created_at.asc(), QuestAssignment.id.asc())
        ).all()
    )
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


def build_session_state(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    location_id: str | None,
) -> dict[str, Any]:
    return {
        "world_id": world_id,
        "location": get_location_summary(db, world_id, location_id),
        "character": get_character_summary(db, world_id, actor_id),
        "quests": list_quest_summaries(db, world_id, actor_id),
        "factions": list_faction_summaries(db, world_id, actor_id),
        "inventory": list_inventory_summaries(db, world_id, actor_id),
    }


def apply_world_tag_updates(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    world_tags: list[WorldTag],
) -> dict[str, list[dict[str, Any]]]:
    faction = ensure_starter_faction(db, world_id)
    standing = ensure_faction_standing(db, world_id=world_id, actor_id=actor_id, faction_id=faction.id)
    quest_template = ensure_starter_quest_template(db, world_id)
    assignment = ensure_starter_quest_assignment(
        db,
        world_id=world_id,
        owner_actor_id=actor_id,
        quest_template_id=quest_template.id,
    )

    rule = QuestRuleEngine.evaluate(
        QuestRuleInput(
            world_tags=world_tags,
            current_progress=assignment.progress,
            progress_target=max(assignment.progress_target, quest_template.completion_target),
            current_standing=standing.standing,
            reward_already_issued=assignment.reward_item_id is not None,
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
                source_quest_assignment_id=assignment.id,
            )
            db.add(reward_item)
            db.flush()
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
    }
