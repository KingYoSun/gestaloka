from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.entities import Event, Memory, OutboxEvent, ProjectionRecord, new_id
from app.modules.graph_projection.nebula import NebulaProjectionSink


class RecordingProjectionSink:
    def record(self, db: Session, outbox_event: OutboxEvent, event: Event, memories: list[Memory]) -> list[dict]:
        records = [
            ProjectionRecord(
                world_id=event.world_id,
                outbox_event_id=outbox_event.id,
                event_id=event.id,
                projection_type=outbox_event.projection_type,
                entity_key=f"{event.world_id}:event:{event.id}",
                payload={"kind": "event", "payload": event.payload},
            )
        ]
        for memory in memories:
            records.append(
                ProjectionRecord(
                    world_id=memory.world_id,
                    outbox_event_id=outbox_event.id,
                    event_id=event.id,
                    projection_type=outbox_event.projection_type,
                    entity_key=f"{memory.world_id}:memory:{memory.id}",
                    payload={"kind": "memory", "text": memory.text, "scope": memory.scope},
                )
            )
        db.add_all(records)
        db.flush()
        return [
            {"entity_key": record.entity_key, "projection_type": record.projection_type}
            for record in records
        ]


class ProjectionService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.nebula_sink = NebulaProjectionSink()

    def _sink(self):
        if self.settings.graph_projection_backend == "nebula":
            return self.nebula_sink
        return RecordingProjectionSink()

    def process_pending(self, db: Session) -> list[dict]:
        stmt = select(OutboxEvent).where(OutboxEvent.status == "pending").order_by(OutboxEvent.created_at.asc())
        pending = list(db.execute(stmt).scalars())
        processed: list[dict] = []
        sink = self._sink()
        for outbox_event in pending:
            event = db.execute(
                select(Event).where(Event.id == outbox_event.event_id, Event.world_id == outbox_event.world_id)
            ).scalar_one()
            memories = list(
                db.execute(
                    select(Memory).where(Memory.source_event_id == event.id, Memory.world_id == event.world_id)
                ).scalars()
            )
            try:
                processed.extend(sink.record(db, outbox_event, event, memories))
                outbox_event.status = "processed"
                outbox_event.attempts += 1
                outbox_event.last_error = None
            except Exception as exc:
                outbox_event.status = "error"
                outbox_event.attempts += 1
                outbox_event.last_error = str(exc)
        db.flush()
        return processed

    def rebuild(self, db: Session, world_id: str) -> list[dict]:
        db.execute(delete(ProjectionRecord).where(ProjectionRecord.world_id == world_id))
        db.flush()

        sink = self._sink()
        created: list[dict] = []
        events = list(db.execute(select(Event).where(Event.world_id == world_id)).scalars())
        for event in events:
            synthetic_outbox = OutboxEvent(
                id=new_id(),
                world_id=world_id,
                event_id=event.id,
                projection_type="world_graph.rebuild",
            )
            memories = list(
                db.execute(select(Memory).where(Memory.world_id == world_id, Memory.source_event_id == event.id)).scalars()
            )
            created.extend(sink.record(db, synthetic_outbox, event, memories))
        db.flush()
        return created
