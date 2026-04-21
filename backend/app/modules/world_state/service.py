from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import World


def ensure_world(db: Session, world_id: str, world_name: str) -> World:
    world = db.execute(select(World).where(World.id == world_id)).scalar_one_or_none()
    if world is not None:
        return world

    world = World(id=world_id, name=world_name, status="active")
    db.add(world)
    db.flush()
    return world
