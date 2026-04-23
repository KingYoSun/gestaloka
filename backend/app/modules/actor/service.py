from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models.entities import Actor, NPCProfile, PlayerProfile, Relationship


@dataclass(frozen=True)
class FoundersReachNPCSeed:
    display_name: str
    personality: str
    goals: dict[str, str]
    home_location_key: str
    routine_state: dict[str, object]


PLAZA_NPC_SEEDS: tuple[FoundersReachNPCSeed, ...] = (
    FoundersReachNPCSeed(
        display_name="Archivist Nera",
        personality="observant and steady",
        goals={"duty": "keep same-world memory coherent"},
        home_location_key="archive_steps",
        routine_state={
            "routine_role": "archivist",
            "beat_state": "observe",
            "attention_target_actor_id": None,
            "last_ambient_turn_id": None,
            "last_idle_tick_id": None,
            "rumor_focus": "newcomers and first impressions",
            "tension_band": "medium",
        },
    ),
    FoundersReachNPCSeed(
        display_name="Lamplighter Sera",
        personality="warmly practical and alert to the square's shifting light",
        goals={"duty": "keep the plaza calm by tending its lamps"},
        home_location_key="watch_path",
        routine_state={
            "routine_role": "lamplighter",
            "beat_state": "observe",
            "attention_target_actor_id": None,
            "last_ambient_turn_id": None,
            "last_idle_tick_id": None,
            "rumor_focus": "the plaza lamps and who lingers beneath them",
            "tension_band": "low",
        },
    ),
    FoundersReachNPCSeed(
        display_name="Courier Pell",
        personality="quick-eyed and curious about every message that crosses the square",
        goals={"duty": "carry notices and hear how the square answers them"},
        home_location_key="square",
        routine_state={
            "routine_role": "courier",
            "beat_state": "observe",
            "attention_target_actor_id": None,
            "last_ambient_turn_id": None,
            "last_idle_tick_id": None,
            "rumor_focus": "small promises and the gossip they leave behind",
            "tension_band": "medium",
        },
    ),
)


def get_player_actor_for_user(db: Session, world_id: str, user_sub: str) -> Actor | None:
    stmt: Select[tuple[Actor]] = select(Actor).where(
        Actor.world_id == world_id,
        Actor.user_sub == user_sub,
        Actor.actor_type == "player",
    )
    return db.execute(stmt).scalar_one_or_none()


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
    db.add(PlayerProfile(actor_id=actor.id, world_id=world_id, preferences={}))
    db.flush()
    return actor


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
    seed: FoundersReachNPCSeed,
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


def ensure_founders_reach_npcs(
    db: Session,
    world_id: str,
    *,
    location_ids_by_key: Mapping[str, str] | None = None,
) -> list[Actor]:
    return [_ensure_seeded_npc(db, world_id, seed, location_ids_by_key=location_ids_by_key) for seed in PLAZA_NPC_SEEDS]


def get_or_create_guide_npc(db: Session, world_id: str, *, location_id: str | None = None) -> Actor:
    guide = get_guide_npc_for_location(db, world_id, location_id=location_id)
    if guide is not None:
        return guide
    return _ensure_seeded_npc(db, world_id, PLAZA_NPC_SEEDS[2], location_ids_by_key=None)


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
    priority = {seed.display_name: index for index, seed in enumerate(PLAZA_NPC_SEEDS)}
    rows.sort(key=lambda actor: (priority.get(actor.display_name, 999), actor.display_name, actor.id))
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
