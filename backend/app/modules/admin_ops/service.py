from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.entities import Actor, OutboxEvent, ProjectionRecord, Session as GameSession
from app.modules.graph_projection.service import ProjectionService


def runtime_snapshot(db: Session, settings: Settings, projection_service: ProjectionService) -> dict[str, object]:
    active_sessions = db.execute(select(func.count(GameSession.id)).where(GameSession.status == "active")).scalar_one()
    pending_outbox = db.execute(select(func.count(OutboxEvent.id)).where(OutboxEvent.status == "pending")).scalar_one()
    failed_outbox = db.execute(select(func.count(OutboxEvent.id)).where(OutboxEvent.status == "failed")).scalar_one()
    projected_outbox = db.execute(
        select(func.count(OutboxEvent.id)).where(OutboxEvent.status == "projected")
    ).scalar_one()
    projection_records = db.execute(select(func.count(ProjectionRecord.id))).scalar_one()
    last_error = db.execute(
        select(OutboxEvent.last_error)
        .where(OutboxEvent.last_error.is_not(None))
        .order_by(OutboxEvent.updated_at.desc(), OutboxEvent.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    return {
        "active_sessions": int(active_sessions),
        "pending_outbox": int(pending_outbox),
        "failed_outbox": int(failed_outbox),
        "projected_outbox": int(projected_outbox),
        "projection_records": int(projection_records),
        "last_error": last_error,
        "backend": settings.graph_projection_backend,
        "space": settings.nebula_space,
        "graph_read_mode": projection_service.graph_read_mode,
    }


def projection_status(db: Session, settings: Settings, projection_service: ProjectionService) -> dict[str, object]:
    snapshot = runtime_snapshot(db, settings, projection_service)
    return {
        "backend": snapshot["backend"],
        "space": snapshot["space"],
        "pending": snapshot["pending_outbox"],
        "failed": snapshot["failed_outbox"],
        "projected": snapshot["projected_outbox"],
        "last_error": snapshot["last_error"],
        "graph_read_mode": snapshot["graph_read_mode"],
    }


def rebuild_projection(db: Session, projection_service: ProjectionService, world_id: str) -> dict[str, object]:
    created = projection_service.rebuild(db, world_id)
    return {
        "world_id": world_id,
        "records": len(created),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        **ProjectionService.summarize_records(created, world_id=world_id),
    }


def world_graph_summary(db: Session, projection_service: ProjectionService, world_id: str) -> dict[str, object]:
    records = list(
        db.execute(
            select(ProjectionRecord)
            .where(ProjectionRecord.world_id == world_id)
            .order_by(ProjectionRecord.created_at.desc(), ProjectionRecord.id.desc())
        ).scalars()
    )
    vertex_keys = {record.entity_key for record in records if record.payload.get("kind") == "vertex"}
    edge_keys = {record.entity_key for record in records if record.payload.get("kind") == "edge"}
    recent_records = [
        {
            "entity_key": record.entity_key,
            "projection_type": record.projection_type,
            "kind": record.payload.get("kind"),
            "label": record.payload.get("label"),
        }
        for record in records[:12]
    ]

    primary_actor = db.execute(
        select(Actor).where(Actor.world_id == world_id, Actor.actor_type == "npc").order_by(Actor.created_at.asc())
    ).scalar_one_or_none()
    counterpart = db.execute(
        select(Actor).where(Actor.world_id == world_id, Actor.actor_type == "player").order_by(Actor.created_at.asc())
    ).scalar_one_or_none()
    neighborhood_summary: list[str] = []
    if primary_actor is not None:
        context = projection_service.recording_repository.read_relation_context(
            db,
            world_id=world_id,
            primary_actor_id=primary_actor.id,
            counterpart_actor_id=counterpart.id if counterpart is not None else None,
            location_id=primary_actor.current_location_id,
        )
        neighborhood_summary = context.prompt_lines()

    return {
        "world_id": world_id,
        "vertex_count": len(vertex_keys),
        "edge_count": len(edge_keys),
        "recent_records": recent_records,
        "neighborhood_summary": neighborhood_summary,
    }
