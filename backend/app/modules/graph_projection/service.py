from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.entities import Actor, Event, Location, Memory, OutboxEvent, ProjectionRecord, Relationship, new_id
from app.modules.graph_projection.nebula import NebulaWorldGraphRepository
from app.modules.graph_projection.repository import (
    GraphProjectionBundle,
    GraphProjectionResult,
    GraphRelationContext,
    ProjectedArtifact,
    RecordingWorldGraphRepository,
    nebula_vid,
)


@dataclass(frozen=True)
class GraphContextResolution:
    status: str
    context: GraphRelationContext


class ProjectionService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.recording_repository = RecordingWorldGraphRepository()
        self.repository = (
            NebulaWorldGraphRepository(settings)
            if settings.graph_projection_backend == "nebula"
            else self.recording_repository
        )
        self.repository.bootstrap()

    @property
    def backend(self) -> str:
        return self.settings.graph_projection_backend

    @property
    def graph_read_mode(self) -> str:
        return "nebula" if self.settings.graph_projection_backend == "nebula" else "recording"

    def resolve_relation_context(
        self,
        db: Session,
        *,
        world_id: str,
        primary_actor_id: str,
        counterpart_actor_id: str | None,
        location_id: str | None,
        limit: int = 5,
    ) -> GraphContextResolution:
        if self.settings.graph_projection_backend != "nebula":
            return GraphContextResolution(
                status="ready",
                context=self.recording_repository.read_relation_context(
                    db,
                    world_id=world_id,
                    primary_actor_id=primary_actor_id,
                    counterpart_actor_id=counterpart_actor_id,
                    location_id=location_id,
                    limit=limit,
                ),
            )

        try:
            context = self.repository.read_relation_context(
                db,
                world_id=world_id,
                primary_actor_id=primary_actor_id,
                counterpart_actor_id=counterpart_actor_id,
                location_id=location_id,
                limit=limit,
            )
            return GraphContextResolution(status="ready", context=context)
        except Exception:
            fallback = self.recording_repository.read_relation_context(
                db,
                world_id=world_id,
                primary_actor_id=primary_actor_id,
                counterpart_actor_id=counterpart_actor_id,
                location_id=location_id,
                limit=limit,
            )
            return GraphContextResolution(status="degraded", context=fallback)

    def process_pending(self, db: Session) -> list[dict]:
        stmt = select(OutboxEvent).where(OutboxEvent.status == "pending").order_by(OutboxEvent.created_at.asc())
        pending = list(db.execute(stmt).scalars())
        processed: list[dict] = []
        for outbox_event in pending:
            outbox_event.status = "processing"
            db.flush()
            try:
                bundle = self._load_bundle(db, outbox_event)
                result = self.repository.project_bundle(bundle)
                self._persist_projection_records(db, outbox_event, bundle.event, result.records)
                outbox_event.status = "projected"
                outbox_event.attempts += 1
                outbox_event.last_error = None
                processed.extend(self._records_to_dicts(result, outbox_event.world_id))
            except Exception as exc:
                outbox_event.status = "failed"
                outbox_event.attempts += 1
                outbox_event.last_error = str(exc)
        db.flush()
        return processed

    def rebuild(self, db: Session, world_id: str) -> list[dict]:
        db.execute(delete(ProjectionRecord).where(ProjectionRecord.world_id == world_id))
        db.flush()
        self.repository.clear_world(world_id=world_id, entity_vids=self._world_vids(db, world_id))

        created: list[dict] = []
        events = list(
            db.execute(select(Event).where(Event.world_id == world_id).order_by(Event.occurred_at.asc(), Event.id.asc())).scalars()
        )
        for event in events:
            synthetic_outbox = OutboxEvent(
                id=new_id(),
                world_id=world_id,
                event_id=event.id,
                projection_type="world_graph.rebuild",
                payload={"world_id": world_id, "synthetic": True},
            )
            bundle = self._load_bundle(db, synthetic_outbox, event=event)
            result = self.repository.project_bundle(bundle)
            self._persist_projection_records(db, synthetic_outbox, event, result.records)
            created.extend(self._records_to_dicts(result, world_id))
        db.flush()
        return created

    def _load_bundle(
        self,
        db: Session,
        outbox_event: OutboxEvent,
        *,
        event: Event | None = None,
    ) -> GraphProjectionBundle:
        resolved_event = event or db.execute(
            select(Event).where(Event.id == outbox_event.event_id, Event.world_id == outbox_event.world_id)
        ).scalar_one()
        memories = list(
            db.execute(
                select(Memory)
                .where(Memory.source_event_id == resolved_event.id, Memory.world_id == resolved_event.world_id)
                .order_by(Memory.created_at.asc(), Memory.id.asc())
            ).scalars()
        )
        location = None
        if resolved_event.location_id is not None:
            location = db.execute(
                select(Location).where(Location.id == resolved_event.location_id, Location.world_id == resolved_event.world_id)
            ).scalar_one_or_none()

        actor_ids = {resolved_event.source_actor_id}
        actor_ids.update(memory.actor_id for memory in memories if memory.actor_id)
        if location is not None:
            actor_ids.update(
                actor.id
                for actor in db.execute(
                    select(Actor).where(Actor.world_id == resolved_event.world_id, Actor.current_location_id == location.id)
                ).scalars()
            )

        relationships = list(
            db.execute(
                select(Relationship)
                .where(
                    Relationship.world_id == resolved_event.world_id,
                    or_(
                        Relationship.from_actor_id.in_(actor_ids),
                        Relationship.to_actor_id.in_(actor_ids),
                    ),
                )
                .order_by(Relationship.relationship_type.asc(), Relationship.created_at.asc(), Relationship.id.asc())
            ).scalars()
        )
        actor_ids.update(item.from_actor_id for item in relationships)
        actor_ids.update(item.to_actor_id for item in relationships if item.to_actor_id)
        actors = list(
            db.execute(
                select(Actor)
                .where(Actor.world_id == resolved_event.world_id, Actor.id.in_(actor_ids))
                .order_by(Actor.created_at.asc(), Actor.id.asc())
            ).scalars()
        )

        return GraphProjectionBundle(
            world_id=resolved_event.world_id,
            projection_type=outbox_event.projection_type,
            event=resolved_event,
            memories=memories,
            actors=actors,
            location=location,
            relationships=relationships,
        )

    @staticmethod
    def summarize_records(records: list[dict], *, world_id: str | None = None) -> dict[str, int | str | None]:
        scoped = [item for item in records if world_id is None or item.get("world_id") == world_id]
        vertex_count = sum(1 for item in scoped if item.get("kind") == "vertex")
        edge_count = sum(1 for item in scoped if item.get("kind") == "edge")
        resolved_world_id = world_id or (scoped[-1]["world_id"] if scoped else None)
        return {
            "world_id": resolved_world_id,
            "vertex_count": vertex_count,
            "edge_count": edge_count,
        }

    def _persist_projection_records(
        self,
        db: Session,
        outbox_event: OutboxEvent,
        event: Event,
        records: list[ProjectedArtifact],
    ) -> None:
        db.add_all(
            [
                ProjectionRecord(
                    world_id=event.world_id,
                    outbox_event_id=outbox_event.id,
                    event_id=event.id,
                    projection_type=outbox_event.projection_type,
                    entity_key=record.entity_key,
                    payload=record.payload,
                )
                for record in records
            ]
        )
        db.flush()

    @staticmethod
    def _records_to_dicts(result: GraphProjectionResult, world_id: str) -> list[dict]:
        return [
            {
                "entity_key": record.entity_key,
                "projection_type": record.projection_type,
                "kind": record.payload["kind"],
                "label": record.payload["label"],
                "world_id": world_id,
            }
            for record in result.records
        ]

    @staticmethod
    def _world_vids(db: Session, world_id: str) -> list[str]:
        vids: list[str] = []
        vids.extend(nebula_vid(world_id, "actor", item.id) for item in db.execute(select(Actor).where(Actor.world_id == world_id)).scalars())
        vids.extend(
            nebula_vid(world_id, "location", item.id)
            for item in db.execute(select(Location).where(Location.world_id == world_id)).scalars()
        )
        vids.extend(nebula_vid(world_id, "event", item.id) for item in db.execute(select(Event).where(Event.world_id == world_id)).scalars())
        vids.extend(
            nebula_vid(world_id, "memory", item.id)
            for item in db.execute(select(Memory).where(Memory.world_id == world_id)).scalars()
        )
        return vids
