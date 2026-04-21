from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import OutboxEvent, ProjectionRecord, Session as GameSession


def runtime_snapshot(db: Session) -> dict[str, int]:
    active_sessions = db.execute(select(func.count(GameSession.id)).where(GameSession.status == "active")).scalar_one()
    pending_outbox = db.execute(select(func.count(OutboxEvent.id)).where(OutboxEvent.status == "pending")).scalar_one()
    projection_records = db.execute(select(func.count(ProjectionRecord.id))).scalar_one()
    return {
        "active_sessions": int(active_sessions),
        "pending_outbox": int(pending_outbox),
        "projection_records": int(projection_records),
    }
