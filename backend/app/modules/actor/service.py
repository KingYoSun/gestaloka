from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models.entities import Actor, NPCProfile, PlayerProfile, Relationship


@dataclass(frozen=True)
class PlazaNPCSeed:
    display_name: str
    personality: str
    goals: dict[str, str]
    routine_state: dict[str, object]


PLAZA_NPC_SEEDS: tuple[PlazaNPCSeed, ...] = (
    PlazaNPCSeed(
        display_name="Archivist Nera",
        personality="observant and steady",
        goals={"duty": "keep same-world memory coherent"},
        routine_state={
            "routine_role": "archivist",
            "beat_state": "observe",
            "attention_target_actor_id": None,
            "last_ambient_turn_id": None,
            "rumor_focus": "newcomers and first impressions",
            "tension_band": "medium",
            "location": "Founders Reach",
        },
    ),
    PlazaNPCSeed(
        display_name="Lamplighter Sera",
        personality="warmly practical and alert to the square's shifting light",
        goals={"duty": "keep the plaza calm by tending its lamps"},
        routine_state={
            "routine_role": "lamplighter",
            "beat_state": "observe",
            "attention_target_actor_id": None,
            "last_ambient_turn_id": None,
            "rumor_focus": "the plaza lamps and who lingers beneath them",
            "tension_band": "low",
            "location": "Founders Reach",
        },
    ),
    PlazaNPCSeed(
        display_name="Courier Pell",
        personality="quick-eyed and curious about every message that crosses the square",
        goals={"duty": "carry notices and hear how the square answers them"},
        routine_state={
            "routine_role": "courier",
            "beat_state": "observe",
            "attention_target_actor_id": None,
            "last_ambient_turn_id": None,
            "rumor_focus": "small promises and the gossip they leave behind",
            "tension_band": "medium",
            "location": "Founders Reach",
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


def _merge_routine_state(existing: dict[str, object] | None, defaults: dict[str, object]) -> dict[str, object]:
    merged = dict(defaults)
    for key, value in (existing or {}).items():
        merged[key] = value
    for required_key in (
        "routine_role",
        "beat_state",
        "attention_target_actor_id",
        "last_ambient_turn_id",
        "rumor_focus",
        "tension_band",
        "location",
    ):
        merged.setdefault(required_key, defaults.get(required_key))
    return merged


def _ensure_seeded_npc(
    db: Session,
    world_id: str,
    seed: PlazaNPCSeed,
    *,
    location_id: str | None = None,
) -> Actor:
    npc = db.execute(
        select(Actor).where(
            Actor.world_id == world_id,
            Actor.actor_type == "npc",
            Actor.display_name == seed.display_name,
        )
    ).scalar_one_or_none()
    if npc is not None:
        if location_id and npc.current_location_id != location_id:
            npc.current_location_id = location_id
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
                    routine_state=_merge_routine_state({}, seed.routine_state),
                )
            )
        else:
            profile.personality = profile.personality or seed.personality
            profile.goals = dict(profile.goals or seed.goals)
            profile.routine_state = _merge_routine_state(profile.routine_state, seed.routine_state)
        db.flush()
        return npc

    npc = Actor(
        world_id=world_id,
        current_location_id=location_id,
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
            routine_state=_merge_routine_state({}, seed.routine_state),
        )
    )
    db.flush()
    return npc


def ensure_founders_reach_npcs(db: Session, world_id: str, *, location_id: str | None = None) -> list[Actor]:
    return [_ensure_seeded_npc(db, world_id, seed, location_id=location_id) for seed in PLAZA_NPC_SEEDS]


def get_or_create_guide_npc(db: Session, world_id: str, *, location_id: str | None = None) -> Actor:
    return _ensure_seeded_npc(db, world_id, PLAZA_NPC_SEEDS[0], location_id=location_id)


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
