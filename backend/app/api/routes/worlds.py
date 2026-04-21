from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.modules.actor.service import user_has_world_membership
from app.modules.event_log.service import list_world_events
from app.modules.identity.oidc import UserIdentity
from app.modules.world_memory.service import list_world_memories

router = APIRouter(prefix="/worlds", tags=["worlds"])


def _ensure_membership(db: Session, world_id: str, user: UserIdentity) -> None:
    if not user_has_world_membership(db, world_id, user.sub):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World not found for current user")


@router.get("/{world_id}/events")
def get_world_events(
    world_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, list[dict]]:
    _ensure_membership(db, world_id, user)
    return {"items": [event_to_dict(item) for item in list_world_events(db, world_id)]}


@router.get("/{world_id}/memories")
def get_world_memories(
    world_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, list[dict]]:
    _ensure_membership(db, world_id, user)
    return {"items": [memory_to_dict(item) for item in list_world_memories(db, world_id)]}


def event_to_dict(item) -> dict:
    return {
        "id": item.id,
        "world_id": item.world_id,
        "event_type": item.event_type,
        "narrative": item.narrative,
        "occurred_at": item.occurred_at.isoformat(),
        "payload": item.payload,
    }


def memory_to_dict(item) -> dict:
    return {
        "id": item.id,
        "world_id": item.world_id,
        "scope": item.scope,
        "text": item.text,
        "salience": item.salience,
        "actor_id": item.actor_id,
    }
