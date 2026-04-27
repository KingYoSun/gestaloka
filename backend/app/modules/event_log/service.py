from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Event


def list_world_events(db: Session, world_id: str) -> list[Event]:
    stmt = (
        select(Event)
        .where(Event.world_id == world_id)
        .order_by(Event.occurred_at.desc(), Event.created_at.desc(), Event.id.desc())
    )
    return list(db.execute(stmt).scalars())
