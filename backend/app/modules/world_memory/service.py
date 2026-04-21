from __future__ import annotations

import math
from collections.abc import Iterable

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.entities import Memory


def embed_text(text: str) -> list[float]:
    basis = ["a", "e", "i", "o", "u", " ", "r", "n"]
    lowered = text.lower()
    total = max(len(lowered), 1)
    return [round(lowered.count(letter) / total, 6) for letter in basis]


def cosine_similarity(left: list[float] | None, right: list[float]) -> float:
    if not left:
        return 0.0
    numerator = sum(a * b for a, b in zip(left, right, strict=False))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return numerator / (left_norm * right_norm)


def materialize_memories(
    db: Session,
    *,
    world_id: str,
    source_event_id: str,
    drafts: Iterable[dict],
) -> list[Memory]:
    created: list[Memory] = []
    for draft in drafts:
        memory = Memory(
            world_id=world_id,
            source_event_id=source_event_id,
            actor_id=draft.get("actor_id"),
            scope=draft["scope"],
            text=draft["text"],
            salience=draft.get("salience", 0.7),
            embedding=embed_text(draft["text"]),
        )
        db.add(memory)
        created.append(memory)
    db.flush()
    return created


def search_memories(
    db: Session,
    *,
    world_id: str,
    query: str,
    actor_id: str | None = None,
    limit: int = 5,
) -> list[Memory]:
    del query
    stmt = select(Memory).where(Memory.world_id == world_id)
    if actor_id is not None:
        stmt = stmt.where(or_(Memory.actor_id.is_(None), Memory.actor_id == actor_id))
    stmt = stmt.order_by(Memory.salience.desc(), Memory.created_at.desc(), Memory.id.desc())
    return list(db.execute(stmt.limit(limit)).scalars())


def list_world_memories(db: Session, world_id: str) -> list[Memory]:
    stmt = select(Memory).where(Memory.world_id == world_id).order_by(Memory.created_at.desc())
    return list(db.execute(stmt).scalars())
