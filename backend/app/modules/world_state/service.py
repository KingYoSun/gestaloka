from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
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


FOLLOWUP_STANDING_DELTA = 0.10


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


def _world_scoped_seed_id(world_id: str, base_id: str) -> str:
    return f"{world_id}:{base_id}"


def _resolve_seeded_entity_id(world_id: str, base_id: str) -> tuple[str, list[str]]:
    scoped_id = _world_scoped_seed_id(world_id, base_id)
    return scoped_id, [scoped_id, base_id]


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
    faction_base_id = str(faction_seed.get("id") or "founders_watch")
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
    quest_seed = _seed_section(section_name)
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
    return _ensure_seeded_quest_template(
        db,
        world_id=world_id,
        section_name="quest",
        default_id="starter_watch_request",
        default_title="First Watch Request",
        default_description="Help a local traveler, report back what you learned, and earn the watch's trust.",
        default_completion_target=2,
        default_reward_template_key="lantern_sigils",
        default_reward_name="Lantern Sigil",
        default_reward_description="A stamped sigil from the watch that marks the bearer as a trusted helper.",
        default_stage_key="starter_watch",
        default_unlock_requirements={},
        default_state={
            "reward_enabled": True,
            "reward_effect_kind": "unlock_followup_watch_path",
            "reward_effect_payload": {"unlock_stage_key": "watch_path_followup"},
        },
    )


def ensure_followup_quest_template(db: Session, world_id: str) -> QuestTemplate:
    return _ensure_seeded_quest_template(
        db,
        world_id=world_id,
        section_name="followup_quest",
        default_id="followup_watch_path",
        default_title="Watch Path Unsealed",
        default_description="Carry the sigil's trust into the next watch path and steady the square.",
        default_completion_target=1,
        default_reward_template_key="none",
        default_reward_name="",
        default_reward_description="",
        default_stage_key="watch_path_followup",
        default_unlock_requirements={"starter_item_effect": "unlock_followup_watch_path"},
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
    return _ensure_quest_assignment(
        db,
        world_id=world_id,
        owner_actor_id=owner_actor_id,
        quest_template=quest_template,
        latest_summary="Help a local and return with what you learned.",
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

    return _ensure_quest_assignment(
        db,
        world_id=world_id,
        owner_actor_id=owner_actor_id,
        quest_template=followup_template,
        latest_summary="The Lantern Sigil opened a follow-up watch path.",
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
    followup_quest_template = ensure_followup_quest_template(db, world_id)
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


def important_inventory_affordances(inventory: list[dict[str, Any]]) -> list[dict[str, Any]]:
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
                    f"{item['name']} can unlock the next watch path."
                    if effect_kind == "unlock_followup_watch_path"
                    else f"{item['name']} carries a special affordance."
                ),
            }
        )
    return affordances


def default_next_choices(session_state: dict[str, Any]) -> list[dict[str, Any]]:
    quests = session_state.get("quests") or []
    inventory = session_state.get("inventory") or []
    active_quest = next((item for item in quests if item.get("status") == "active"), quests[0] if quests else {})
    stage_key = str(active_quest.get("stage_key") or "starter_watch")
    progress = int(active_quest.get("progress") or 0)
    usable_item = next((item for item in inventory if item.get("usable")), None)

    safe_choice = {
        "choice_id": "safe",
        "posture": "safe",
        "label": "一歩退いて広場の気配を落ち着いて見守る",
        "summary": "場の流れを乱さず、まず気配と視線を確かめる。",
        "canonical_input_text": "広場の流れを乱さず、周囲の気配と旅人の様子を見守る",
        "action_kind": "narrative",
    }
    progress_choice = {
        "choice_id": "progress",
        "posture": "progress",
        "label": "困っている相手に手を差し伸べ、次の進展を作る",
        "summary": "もっとも前進寄りの行動で、依頼や関係を進める。",
        "canonical_input_text": "広場で旅人を助け、灯をともす",
        "action_kind": "narrative",
    }
    explore_choice = {
        "choice_id": "explore",
        "posture": "explore",
        "label": "噂と視線をたどり、場の裏側を探る",
        "summary": "探索や関係変化に寄せた行動で、状況理解を広げる。",
        "canonical_input_text": "広場の空気や旅人の事情を探り、何が起きているか確かめる",
        "action_kind": "narrative",
    }

    if stage_key == "starter_watch" and progress >= 1:
        progress_choice = {
            **progress_choice,
            "label": "旅人に報告を促し、次の見回りを引き受ける",
            "summary": "依頼を締め、watch から次の信頼を引き出す。",
            "canonical_input_text": "旅人へ報告し、広場を見回して次の見回りを約束する",
        }
        safe_choice = {
            **safe_choice,
            "label": "急がず旅人の落ち着きを確かめ、広場の気配を保つ",
            "canonical_input_text": "急がず旅人の落ち着きを確かめ、広場の気配を保つ",
        }
        explore_choice = {
            **explore_choice,
            "label": "広場の視線や噂を探り、次の手掛かりを拾う",
            "canonical_input_text": "広場の視線や噂を探り、次の手掛かりを拾う",
        }

    if usable_item is not None and usable_item.get("effect_kind") == "unlock_followup_watch_path":
        progress_choice = {
            "choice_id": "progress",
            "posture": "progress",
            "label": "Lantern Sigilを掲げ、次の watch path を正式に開く",
            "summary": "重要アイテムを使って次の物語段階を解放する。",
            "canonical_input_text": "Lantern Sigilを掲げ、次の watch path を開く",
            "action_kind": "use_reward_item",
        }

    if stage_key == "watch_path_followup":
        progress_choice = {
            "choice_id": "progress",
            "posture": "progress",
            "label": "開いた watch path を辿り、そこで見つかる異変を確かめる",
            "summary": "follow-up quest を前へ進める選択。",
            "canonical_input_text": "Lantern Sigilで開いた watch path の様子を観察する",
            "action_kind": "narrative",
        }
        safe_choice = {
            "choice_id": "safe",
            "posture": "safe",
            "label": "巡回路の灯を整え、場を静かに安定させる",
            "summary": "危険を抑えつつ、場の安定を優先する。",
            "canonical_input_text": "開いた巡回路の灯を整え、場を静かに安定させる",
            "action_kind": "narrative",
        }
        explore_choice = {
            "choice_id": "explore",
            "posture": "explore",
            "label": "巡回路の痕跡や見張りの記憶を集め、関係の糸口を探る",
            "summary": "探索と関係変化に寄せた選択。",
            "canonical_input_text": "Lantern Sigilで開いた巡回路の痕跡や見張りの記憶を集める",
            "action_kind": "narrative",
        }

    return [safe_choice, progress_choice, explore_choice]


def build_session_state(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    location_id: str | None,
) -> dict[str, Any]:
    character = get_character_summary(db, world_id, actor_id)
    quests = list_quest_summaries(db, world_id, actor_id)
    factions = list_faction_summaries(db, world_id, actor_id)
    inventory = list_inventory_summaries(db, world_id, actor_id)
    state = {
        "world_id": world_id,
        "location": get_location_summary(db, world_id, location_id),
        "character": character,
        "quests": quests,
        "factions": factions,
        "inventory": inventory,
        "narrative_state_bands": narrative_state_bands(character, factions),
        "important_inventory_affordances": important_inventory_affordances(inventory),
    }
    state["next_choices"] = default_next_choices(state)
    return state


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
    item = db.execute(
        select(Item).where(Item.world_id == world_id, Item.id == item_id)
    ).scalar_one_or_none()
    if item is None or item.owner_actor_id != actor_id:
        raise LookupError("Reward item not found")
    if item.used_at is not None or item.status == "used":
        raise ValueError("Reward item has already been used")
    if item.effect_kind != "unlock_followup_watch_path":
        raise ValueError("Reward item is not usable in the current progression slice")
    if location_id != starter_location_id(world_id):
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

    quest_updates = [
        {
            **quest_summary_to_dict(followup_assignment, followup_template),
            "summary": "Lantern Sigil unlocked the next watch path.",
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
    event_narrative = (
        f"{actor_name}はLantern Sigilを掲げ、Founders Watchに新しい巡回路の解放を認められた。"
    )
    memory_drafts = [
        {
            "scope": "location",
            "text": "Founders ReachでLantern Sigilが使われ、新しい watch path が解放された。",
            "salience": 0.95,
            "location_id": location_id,
            "actor_id": None,
        },
        {
            "scope": "world",
            "text": f"{actor_name}はLantern Sigilを使い、Founders Watchの次の依頼段階を開いた。",
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
