from __future__ import annotations

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models.entities import Actor, NPCProfile, PlayerProfile, Relationship


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


def get_or_create_guide_npc(db: Session, world_id: str, *, location_id: str | None = None) -> Actor:
    stmt = select(Actor).where(Actor.world_id == world_id, Actor.actor_type == "npc").order_by(Actor.created_at.asc())
    npc = db.execute(stmt).scalar_one_or_none()
    if npc is not None:
        if location_id and npc.current_location_id != location_id:
            npc.current_location_id = location_id
            db.flush()
        return npc

    npc = Actor(
        world_id=world_id,
        current_location_id=location_id,
        actor_type="npc",
        display_name="Archivist Nera",
        status="active",
    )
    db.add(npc)
    db.flush()
    db.add(
        NPCProfile(
            actor_id=npc.id,
            world_id=world_id,
            personality="observant and steady",
            goals={"duty": "keep same-world memory coherent"},
            routine_state={"location": "Founders Reach"},
        )
    )
    db.flush()
    return npc


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
