from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.entities import (
    Actor,
    ActorTitleProgress,
    Event,
    Faction,
    FactionStanding,
    Item,
    Location,
    Memory,
    OutboxEvent,
    ProjectionRecord,
    QuestAssignment,
    QuestTemplate,
    Relationship,
    SharedHistoryRecord,
    WorldAxisState,
    new_id,
)
from app.modules.graph_projection.nebula import NebulaWorldGraphRepository
from app.modules.graph_projection.repository import (
    GraphProjectionBundle,
    GraphProjectionResult,
    GraphRelationContext,
    ProjectedArtifact,
    RecordingWorldGraphRepository,
    nebula_vid,
)
from app.modules.observability.service import ObservabilityService


@dataclass(frozen=True)
class GraphContextResolution:
    status: str
    context: GraphRelationContext


class ProjectionService:
    def __init__(self, settings: Settings, observability_service: ObservabilityService | None = None) -> None:
        self.settings = settings
        self.observability_service = observability_service
        self.recording_repository = RecordingWorldGraphRepository()
        self.repository = (
            NebulaWorldGraphRepository(settings)
            if settings.graph_projection_backend == "nebula"
            else self.recording_repository
        )
        self._graph_runtime_status = "ready" if settings.graph_projection_backend != "nebula" else "pending"
        self._last_runtime_error: str | None = None
        self.probe_runtime()

    @property
    def backend(self) -> str:
        return self.settings.graph_projection_backend

    @property
    def graph_read_mode(self) -> str:
        return "nebula" if self.settings.graph_projection_backend == "nebula" else "recording"

    @property
    def graph_runtime_status(self) -> str:
        return self._graph_runtime_status

    @property
    def last_runtime_error(self) -> str | None:
        return self._last_runtime_error

    def probe_runtime(self) -> dict[str, str | None]:
        if self.settings.graph_projection_backend != "nebula":
            self._graph_runtime_status = "recording"
            self._last_runtime_error = None
            return {
                "graph_runtime_status": self._graph_runtime_status,
                "last_runtime_error": self._last_runtime_error,
            }

        try:
            self.repository.bootstrap()
            self._graph_runtime_status = "ready"
            self._last_runtime_error = None
        except Exception as exc:
            self._graph_runtime_status = "degraded"
            self._last_runtime_error = str(exc)
        return {
            "graph_runtime_status": self._graph_runtime_status,
            "last_runtime_error": self._last_runtime_error,
        }

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
            self.probe_runtime()
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
        started_at = self.observability_service.timer() if self.observability_service is not None else None
        stmt = select(OutboxEvent).where(OutboxEvent.status == "pending").order_by(OutboxEvent.created_at.asc())
        pending = list(db.execute(stmt).scalars())
        return self._process_outbox_events(db, pending, started_at=started_at)

    def retry_failed(self, db: Session, *, world_id: str | None = None, limit: int = 100) -> dict[str, object]:
        started_at = self.observability_service.timer() if self.observability_service is not None else None
        stmt = select(OutboxEvent).where(OutboxEvent.status == "failed")
        if world_id is not None:
            stmt = stmt.where(OutboxEvent.world_id == world_id)
        failed = list(db.execute(stmt.order_by(OutboxEvent.updated_at.asc(), OutboxEvent.id.asc()).limit(limit)).scalars())
        processed = self._process_outbox_events(db, failed, started_at=started_at)
        remaining_stmt = select(func.count(OutboxEvent.id)).where(OutboxEvent.status == "failed")
        if world_id is not None:
            remaining_stmt = remaining_stmt.where(OutboxEvent.world_id == world_id)
        return {
            "world_id": world_id,
            "target_count": len(failed),
            "processed_count": len(processed),
            "remaining_failed": int(db.execute(remaining_stmt).scalar_one()),
            "records": processed,
            **self.summarize_records(processed, world_id=world_id),
        }

    def _process_outbox_events(
        self,
        db: Session,
        outbox_events: list[OutboxEvent],
        *,
        started_at: object | None,
    ) -> list[dict]:
        processed: list[dict] = []
        for outbox_event in outbox_events:
            outbox_event.status = "processing"
            db.flush()
            try:
                self.probe_runtime()
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
        if self.observability_service is not None and started_at is not None:
            self.observability_service.record_projection_processing(
                duration_seconds=self.observability_service.elapsed(started_at),
                pending_count=int(db.execute(select(func.count(OutboxEvent.id)).where(OutboxEvent.status == "pending")).scalar_one()),
                failed_count=int(db.execute(select(func.count(OutboxEvent.id)).where(OutboxEvent.status == "failed")).scalar_one()),
                lag_seconds=self._projection_lag_seconds(db),
                processed_count=len(processed),
            )
        return processed

    def rebuild(self, db: Session, world_id: str) -> list[dict]:
        started_at = self.observability_service.timer() if self.observability_service is not None else None
        db.execute(delete(ProjectionRecord).where(ProjectionRecord.world_id == world_id))
        db.flush()
        self.probe_runtime()
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
        if self.observability_service is not None and started_at is not None:
            self.observability_service.record_projection_processing(
                duration_seconds=self.observability_service.elapsed(started_at),
                pending_count=int(db.execute(select(func.count(OutboxEvent.id)).where(OutboxEvent.status == "pending")).scalar_one()),
                failed_count=int(db.execute(select(func.count(OutboxEvent.id)).where(OutboxEvent.status == "failed")).scalar_one()),
                lag_seconds=self._projection_lag_seconds(db),
                processed_count=len(created),
            )
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
        quest_assignments = list(
            db.execute(
                select(QuestAssignment)
                .where(QuestAssignment.world_id == resolved_event.world_id, QuestAssignment.owner_actor_id.in_(actor_ids))
                .order_by(QuestAssignment.created_at.asc(), QuestAssignment.id.asc())
            ).scalars()
        )
        quest_template_ids = {item.quest_template_id for item in quest_assignments}
        quest_templates = (
            list(
                db.execute(
                    select(QuestTemplate)
                    .where(QuestTemplate.world_id == resolved_event.world_id, QuestTemplate.id.in_(quest_template_ids))
                    .order_by(QuestTemplate.created_at.asc(), QuestTemplate.id.asc())
                ).scalars()
            )
            if quest_template_ids
            else []
        )
        faction_standings = list(
            db.execute(
                select(FactionStanding)
                .where(FactionStanding.world_id == resolved_event.world_id, FactionStanding.actor_id.in_(actor_ids))
                .order_by(FactionStanding.updated_at.desc(), FactionStanding.faction_id.asc())
            ).scalars()
        )
        faction_ids = {item.to_entity_id for item in relationships if item.relationship_type == "MEMBER_OF"}
        faction_ids.update(item.faction_id for item in faction_standings)
        factions = (
            list(
                db.execute(
                    select(Faction)
                    .where(Faction.world_id == resolved_event.world_id, Faction.id.in_(faction_ids))
                    .order_by(Faction.created_at.asc(), Faction.id.asc())
                ).scalars()
            )
            if faction_ids
            else []
        )
        items = list(
            db.execute(
                select(Item)
                .where(Item.world_id == resolved_event.world_id, Item.owner_actor_id.in_(actor_ids))
                .order_by(Item.created_at.asc(), Item.id.asc())
            ).scalars()
        )
        world_axis_states = list(
            db.execute(
                select(WorldAxisState)
                .where(WorldAxisState.world_id == resolved_event.world_id)
                .order_by(WorldAxisState.axis_id.asc())
            ).scalars()
        )
        shared_history_records = list(
            db.execute(
                select(SharedHistoryRecord)
                .where(SharedHistoryRecord.world_id == resolved_event.world_id, SharedHistoryRecord.source_event_id == resolved_event.id)
                .order_by(SharedHistoryRecord.created_at.asc(), SharedHistoryRecord.id.asc())
            ).scalars()
        )
        actor_title_progress = list(
            db.execute(
                select(ActorTitleProgress)
                .where(
                    ActorTitleProgress.world_id == resolved_event.world_id,
                    ActorTitleProgress.actor_id.in_(actor_ids),
                )
                .order_by(ActorTitleProgress.updated_at.desc(), ActorTitleProgress.title_rule_id.asc())
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
            factions=factions,
            faction_standings=faction_standings,
            quest_assignments=quest_assignments,
            quest_templates=quest_templates,
            items=items,
            world_axis_states=world_axis_states,
            shared_history_records=shared_history_records,
            actor_title_progress=actor_title_progress,
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
        vids.extend(
            nebula_vid(world_id, "faction", item.id)
            for item in db.execute(select(Faction).where(Faction.world_id == world_id)).scalars()
        )
        vids.extend(
            nebula_vid(world_id, "quest", item.id)
            for item in db.execute(select(QuestAssignment).where(QuestAssignment.world_id == world_id)).scalars()
        )
        vids.extend(
            nebula_vid(world_id, "item", item.id)
            for item in db.execute(select(Item).where(Item.world_id == world_id)).scalars()
        )
        vids.extend(
            nebula_vid(world_id, "world_axis", item.axis_id)
            for item in db.execute(select(WorldAxisState).where(WorldAxisState.world_id == world_id)).scalars()
        )
        vids.extend(
            nebula_vid(world_id, "shared_history", item.id)
            for item in db.execute(select(SharedHistoryRecord).where(SharedHistoryRecord.world_id == world_id)).scalars()
        )
        vids.extend(
            nebula_vid(world_id, "title_progress", f"{item.actor_id}:{item.title_rule_id}")
            for item in db.execute(select(ActorTitleProgress).where(ActorTitleProgress.world_id == world_id)).scalars()
        )
        return vids

    @staticmethod
    def _projection_lag_seconds(db: Session) -> float:
        oldest_pending = db.execute(
            select(OutboxEvent.created_at)
            .where(OutboxEvent.status == "pending")
            .order_by(OutboxEvent.created_at.asc(), OutboxEvent.id.asc())
            .limit(1)
        ).scalar_one_or_none()
        if oldest_pending is None:
            return 0.0
        return max((datetime.now(timezone.utc) - oldest_pending).total_seconds(), 0.0)
