from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.entities import Event, Memory, OutboxEvent


class NebulaProjectionSink:
    def record(self, db: Session, outbox_event: OutboxEvent, event: Event, memories: list[Memory]) -> list[dict]:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="NebulaGraph adapter boundary exists but the live adapter is not enabled in this development slice.",
        )
