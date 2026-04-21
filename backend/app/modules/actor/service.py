from __future__ import annotations

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models.entities import Actor, NPCProfile, PlayerProfile


def get_player_actor_for_user(db: Session, world_id: str, user_sub: str) -> Actor | None:
    stmt: Select[tuple[Actor]] = select(Actor).where(
        Actor.world_id == world_id,
        Actor.user_sub == user_sub,
        Actor.actor_type == "player",
    )
    return db.execute(stmt).scalar_one_or_none()


def ensure_player_actor(db: Session, world_id: str, user_sub: str, display_name: str) -> Actor:
    actor = get_player_actor_for_user(db, world_id, user_sub)
    if actor is not None:
        return actor

    actor = Actor(world_id=world_id, actor_type="player", user_sub=user_sub, display_name=display_name)
    db.add(actor)
    db.flush()
    db.add(PlayerProfile(actor_id=actor.id, world_id=world_id, preferences={}))
    db.flush()
    return actor


def get_or_create_guide_npc(db: Session, world_id: str) -> Actor:
    stmt = select(Actor).where(Actor.world_id == world_id, Actor.actor_type == "npc").order_by(Actor.created_at.asc())
    npc = db.execute(stmt).scalar_one_or_none()
    if npc is not None:
        return npc

    npc = Actor(world_id=world_id, actor_type="npc", display_name="Archivist Nera", status="active")
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
