from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Location, World, starter_location_id


STARTER_LOCATION_NAME = "Founders Reach"
STARTER_LOCATION_DESCRIPTION = "The public square where new sessions begin and rumors first take shape."


def ensure_world(db: Session, world_id: str, world_name: str) -> World:
    world = db.execute(select(World).where(World.id == world_id)).scalar_one_or_none()
    if world is not None:
        ensure_starter_location(db, world_id)
        return world

    world = World(id=world_id, name=world_name, status="active")
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

    location = Location(
        id=starter_location_id(world_id),
        world_id=world_id,
        name=STARTER_LOCATION_NAME,
        description=STARTER_LOCATION_DESCRIPTION,
        state={"kind": "starter"},
    )
    db.add(location)
    db.flush()
    return location
