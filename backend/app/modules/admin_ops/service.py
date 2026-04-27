from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.entities import (
    Actor,
    ActorTitleProgress,
    LLMRun,
    ObservabilitySnapshot,
    OutboxEvent,
    ProjectionRecord,
    Session as GameSession,
    SharedHistoryRecord,
    Turn,
    World,
)
from app.modules.economy_sp.service import EconomyService
from app.modules.graph_projection.service import ProjectionService
from app.modules.observability.service import CanaryProbeResult, ObservabilityService
from app.modules.world_pack.service import get_pack_registry, nullable_world_context_for_world, world_context_for_world
from app.modules.world_memory.service import MemoryService
from app.modules.world_state.history import history_record_to_dict, title_progress_to_dict
from app.modules.world_state.ambient import (
    list_ambient_beats_debug,
    list_npc_locations,
    list_npc_routines_debug,
    list_offstage_beats_debug,
    list_world_ticks_debug,
)
from app.modules.world_state.branch import list_route_pressures_debug
from app.modules.world_state.scene import list_chapter_tracks_debug, list_scene_frames_debug
from app.modules.world_state.service import (
    build_shared_world_context,
    list_consequence_threads_debug,
    list_locations_debug,
    list_relationship_debug,
    list_travel_log_debug,
)


OBSERVABILITY_SNAPSHOT_RETENTION_DAYS = 30


def runtime_snapshot(db: Session, settings: Settings, projection_service: ProjectionService) -> dict[str, object]:
    projection_runtime = projection_service.probe_runtime()
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
    llm_rates = _llm_rates(db)
    return {
        "active_sessions": int(active_sessions),
        "pending_outbox": int(pending_outbox),
        "failed_outbox": int(failed_outbox),
        "projected_outbox": int(projected_outbox),
        "projection_records": int(projection_records),
        "projection_lag_seconds": ProjectionService._projection_lag_seconds(db),
        "last_error": last_error,
        "backend": settings.graph_projection_backend,
        "space": settings.nebula_space,
        "graph_read_mode": projection_service.graph_read_mode,
        "graph_runtime_status": projection_runtime["graph_runtime_status"],
        "graph_runtime_error": projection_runtime["last_runtime_error"],
        **llm_rates,
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
        "graph_runtime_status": snapshot["graph_runtime_status"],
        "projection_lag_seconds": snapshot["projection_lag_seconds"],
    }


def observability_summary(
    db: Session,
    settings: Settings,
    projection_service: ProjectionService,
    observability_service: ObservabilityService,
    *,
    pack_id: str | None = None,
    world_template_id: str | None = None,
) -> dict[str, object]:
    snapshot = runtime_snapshot(db, settings, projection_service)
    observability_service.sync_outbox_metrics(
        pending_count=int(snapshot["pending_outbox"]),
        failed_count=int(snapshot["failed_outbox"]),
        lag_seconds=float(snapshot["projection_lag_seconds"]),
    )
    observability_service.sync_llm_rates(
        schema_valid_rate=float(snapshot["llm_schema_valid_rate"]),
        fallback_rate=float(snapshot["llm_fallback_rate"]),
    )
    canary = observability_service.probe_canary_health()
    trace_limit = 200 if pack_id or world_template_id else 12
    recent_traces = [
        item
        for item in observability_service.recent_trace_attributes(limit=trace_limit)
        if _trace_matches_pack_scope(item.get("attributes", {}), pack_id, world_template_id)
    ]
    primary_slo = {
        "runtime_role": settings.app_runtime_role,
        "graph_runtime_status": snapshot["graph_runtime_status"],
        "graph_read_mode": snapshot["graph_read_mode"],
        "projection_lag_seconds": snapshot["projection_lag_seconds"],
        "outbox_pending_count": snapshot["pending_outbox"],
        "outbox_failed_count": snapshot["failed_outbox"],
        "llm_schema_valid_rate": snapshot["llm_schema_valid_rate"],
        "llm_fallback_rate": snapshot["llm_fallback_rate"],
    }
    canary_health = _canary_probe_dict(canary)
    langfuse_status = observability_service.langfuse_runtime()
    metrics = observability_service.metric_snapshot()
    stored_snapshot = create_observability_snapshot(
        db,
        settings,
        snapshot_kind="summary",
        runtime_role=settings.app_runtime_role,
        pack_id=pack_id,
        world_template_id=world_template_id,
        primary_slo=primary_slo,
        canary_health=canary_health,
        langfuse_status=langfuse_status,
        metrics=metrics,
        trace_count=len(recent_traces),
    )
    return {
        "snapshot_id": stored_snapshot.id if stored_snapshot is not None else None,
        "primary": primary_slo,
        "canary": canary_health,
        "langfuse": langfuse_status,
        "recent_traces": recent_traces,
        "metrics": metrics,
    }


def create_observability_snapshot(
    db: Session,
    settings: Settings,
    *,
    snapshot_kind: str,
    runtime_role: str,
    pack_id: str | None = None,
    world_template_id: str | None = None,
    release_gate_report_id: str | None = None,
    primary_slo: dict[str, object],
    canary_health: dict[str, object],
    langfuse_status: dict[str, object],
    metrics: dict[str, object],
    trace_count: int,
) -> ObservabilitySnapshot | None:
    _cleanup_observability_snapshots(db)
    scope = _snapshot_scope(settings, pack_id=pack_id, world_template_id=world_template_id)
    if not scope.pop("known"):
        return None
    snapshot = ObservabilitySnapshot(
        snapshot_kind=snapshot_kind,
        runtime_role=runtime_role,
        pack_id=scope["pack_id"],
        pack_display_name=scope["pack_display_name"],
        world_template_id=scope["world_template_id"],
        world_template_display_name=scope["world_template_display_name"],
        release_gate_report_id=release_gate_report_id,
        primary_slo=primary_slo,
        canary_health=canary_health,
        langfuse_status=langfuse_status,
        metrics=metrics,
        trace_count=trace_count,
    )
    db.add(snapshot)
    db.flush()
    return snapshot


def list_observability_snapshots(
    db: Session,
    *,
    pack_id: str | None = None,
    world_template_id: str | None = None,
    limit: int = 12,
) -> dict[str, object]:
    stmt = select(ObservabilitySnapshot).order_by(
        ObservabilitySnapshot.created_at.desc(),
        ObservabilitySnapshot.id.desc(),
    )
    if pack_id:
        stmt = stmt.where(ObservabilitySnapshot.pack_id == pack_id)
    if world_template_id:
        stmt = stmt.where(ObservabilitySnapshot.world_template_id == world_template_id)
    snapshots = list(db.execute(stmt.limit(limit)).scalars())
    return {
        "items": [_observability_snapshot_to_dict(snapshot) for snapshot in snapshots],
    }


def rebuild_projection(db: Session, projection_service: ProjectionService, world_id: str) -> dict[str, object]:
    created = projection_service.rebuild(db, world_id)
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "records": len(created),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        **ProjectionService.summarize_records(created, world_id=world_id),
    })


def retry_failed_projection(
    db: Session,
    projection_service: ProjectionService,
    *,
    world_id: str | None,
    limit: int,
) -> dict[str, object]:
    result = projection_service.retry_failed(db, world_id=world_id, limit=limit)
    payload = {
        "world_id": world_id,
        "target_count": result["target_count"],
        "processed_count": result["processed_count"],
        "remaining_failed": result["remaining_failed"],
        "vertex_count": result["vertex_count"],
        "edge_count": result["edge_count"],
        "records": result["records"],
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    return _with_world_context(db, world_id, payload) if world_id is not None else payload


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
    label_counts: dict[str, int] = {}
    seen_vertex_keys: set[str] = set()
    for record in records:
        if record.payload.get("kind") != "vertex":
            continue
        if record.entity_key in seen_vertex_keys:
            continue
        seen_vertex_keys.add(record.entity_key)
        label = str(record.payload.get("label") or "unknown")
        label_counts[label] = label_counts.get(label, 0) + 1
    recent_records = [
        {
            "entity_key": record.entity_key,
            "projection_type": record.projection_type,
            "kind": record.payload.get("kind"),
            "label": record.payload.get("label"),
        }
        for record in records[:12]
    ]
    state_changes = [
        {
            "entity_key": record.entity_key,
            "label": str(record.payload.get("label") or "unknown"),
            "kind": str(record.payload.get("kind") or "unknown"),
        }
        for record in records
        if str(record.payload.get("label") or "") in {"Faction", "Quest", "Item", "AFFECTS", "PURSUES", "REWARDS"}
    ][:12]

    primary_actor = (
        db.execute(
            select(Actor)
            .where(Actor.world_id == world_id, Actor.actor_type == "npc")
            .order_by(Actor.created_at.asc(), Actor.id.asc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    counterpart = (
        db.execute(
            select(Actor)
            .where(Actor.world_id == world_id, Actor.actor_type == "player")
            .order_by(Actor.created_at.asc(), Actor.id.asc())
            .limit(1)
        )
        .scalars()
        .first()
    )
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

    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "vertex_count": len(vertex_keys),
        "edge_count": len(edge_keys),
        "label_counts": label_counts,
        "recent_records": recent_records,
        "state_changes": state_changes,
        "neighborhood_summary": neighborhood_summary,
    })


def sp_overview(db: Session, economy_service: EconomyService) -> dict[str, object]:
    payload = economy_service.overview(db)
    payload["recent_adjustments"] = _ledger_entries_with_world_context(
        db,
        list(payload.get("recent_adjustments") or []),
    )
    return payload


def sp_ledger(
    db: Session,
    economy_service: EconomyService,
    *,
    user_sub: str | None,
    world_id: str | None,
    limit: int,
) -> dict[str, object]:
    return {
        "items": _ledger_entries_with_world_context(
            db,
            economy_service.list_ledger(db, user_sub=user_sub, world_id=world_id, limit=limit),
        ),
    }


def list_world_contexts(
    db: Session,
    *,
    pack_id: str | None = None,
    world_template_id: str | None = None,
) -> dict[str, object]:
    active_session_counts = {
        world_id: int(count)
        for world_id, count in db.execute(
            select(GameSession.world_id, func.count(GameSession.id))
            .where(GameSession.status == "active")
            .group_by(GameSession.world_id)
        ).all()
    }
    worlds = list(db.execute(select(World).order_by(World.updated_at.desc(), World.id.asc())).scalars())
    items = []
    for world in worlds:
        context = world_context_for_world(db, world.id)
        if pack_id and context["pack_id"] != pack_id:
            continue
        if world_template_id and context["world_template_id"] != world_template_id:
            continue
        items.append(
            {
                "world_context": context,
                "status": world.status,
                "active_session_count": active_session_counts.get(world.id, 0),
                "updated_at": world.updated_at.isoformat(),
            }
        )
    return {
        "items": items,
    }


def _ledger_entries_with_world_context(db: Session, entries: list[dict[str, object]]) -> list[dict[str, object]]:
    contexts: dict[str | None, dict[str, object] | None] = {None: None}
    enriched = []
    for entry in entries:
        world_id = entry.get("world_id")
        normalized_world_id = str(world_id) if world_id is not None else None
        if normalized_world_id not in contexts:
            contexts[normalized_world_id] = nullable_world_context_for_world(db, normalized_world_id)
        enriched.append({**entry, "world_context": contexts[normalized_world_id]})
    return enriched


def _with_world_context(db: Session, world_id: str, payload: dict[str, object]) -> dict[str, object]:
    return {**payload, "world_context": world_context_for_world(db, world_id)}


def _cleanup_observability_snapshots(db: Session) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=OBSERVABILITY_SNAPSHOT_RETENTION_DAYS)
    db.execute(delete(ObservabilitySnapshot).where(ObservabilitySnapshot.created_at < cutoff))


def _snapshot_scope(
    settings: Settings,
    *,
    pack_id: str | None,
    world_template_id: str | None,
) -> dict[str, str | bool | None]:
    scope = {
        "known": False,
        "pack_id": pack_id,
        "pack_display_name": None,
        "world_template_id": world_template_id,
        "world_template_display_name": None,
    }
    if not pack_id and not world_template_id:
        return {
            "known": True,
            "pack_id": None,
            "pack_display_name": None,
            "world_template_id": None,
            "world_template_display_name": None,
        }
    try:
        registry = get_pack_registry(settings)
        if pack_id:
            pack = registry.get_pack(pack_id)
        else:
            pack = next(
                item
                for item in registry.list_packs()
                if world_template_id is not None and world_template_id in item.templates
            )
        scope["pack_id"] = pack.manifest.pack_id
        scope["pack_display_name"] = pack.manifest.display_name
        if world_template_id:
            template = pack.template(world_template_id)
            scope["world_template_id"] = template.template_id
            scope["world_template_display_name"] = template.display_name
        scope["known"] = True
    except Exception:
        pass
    return scope


def _observability_snapshot_to_dict(snapshot: ObservabilitySnapshot) -> dict[str, object]:
    return {
        "id": snapshot.id,
        "snapshot_kind": snapshot.snapshot_kind,
        "runtime_role": snapshot.runtime_role,
        "pack_id": snapshot.pack_id,
        "pack_display_name": snapshot.pack_display_name,
        "world_template_id": snapshot.world_template_id,
        "world_template_display_name": snapshot.world_template_display_name,
        "release_gate_report_id": snapshot.release_gate_report_id,
        "primary_slo": snapshot.primary_slo,
        "canary_health": snapshot.canary_health,
        "langfuse_status": snapshot.langfuse_status,
        "metrics": snapshot.metrics,
        "trace_count": snapshot.trace_count,
        "created_at": snapshot.created_at.isoformat(),
        "updated_at": snapshot.updated_at.isoformat(),
    }


def _trace_matches_pack_scope(attributes: object, pack_id: str | None, world_template_id: str | None) -> bool:
    if not pack_id and not world_template_id:
        return True
    if not isinstance(attributes, dict):
        return False

    trace_pack_id = attributes.get("pack_id")
    trace_template_id = attributes.get("world_template_id")
    if isinstance(trace_pack_id, str) or isinstance(trace_template_id, str):
        if pack_id and trace_pack_id != pack_id:
            return False
        if world_template_id and trace_template_id != world_template_id:
            return False
        return True

    eval_pack_ids = _csv_attribute_values(attributes.get("eval.pack_ids"))
    eval_template_ids = _csv_attribute_values(attributes.get("eval.world_template_ids"))
    if eval_pack_ids or eval_template_ids:
        return (not pack_id or pack_id in eval_pack_ids) and (
            not world_template_id or world_template_id in eval_template_ids
        )
    return False


def _csv_attribute_values(value: object) -> set[str]:
    if not isinstance(value, str):
        return set()
    return {item.strip() for item in value.split(",") if item.strip()}


def _nullable_world_context(db: Session, world_id: str | None) -> dict[str, object] | None:
    try:
        return nullable_world_context_for_world(db, world_id)
    except (LookupError, ValueError, KeyError):
        return None


def memory_status(db: Session, memory_service: MemoryService) -> dict[str, object]:
    return memory_service.status_summary(db)


def reindex_memories(
    db: Session,
    memory_service: MemoryService,
    *,
    world_id: str | None,
    limit: int,
) -> dict[str, object]:
    return memory_service.reindex(db, world_id=world_id, limit=limit)


def world_memory_search(
    db: Session,
    memory_service: MemoryService,
    *,
    world_id: str,
    query: str,
    actor_id: str | None,
    location_id: str | None,
    limit: int,
) -> dict[str, object]:
    result = memory_service.search(
        db,
        world_id=world_id,
        query_text=query,
        actor_id=actor_id,
        location_id=location_id,
        limit=limit,
    )
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "query": query,
        "hits": [
            {
                "id": item.id,
                "text": item.text,
                "scope": item.scope,
                "actor_id": item.actor_id,
                "location_id": item.location_id,
                "salience": item.salience,
                "score": item.score,
            }
            for item in result.hits
        ],
        "trace": {
            "status": result.trace.status,
            "query_text_hash": result.trace.query_text_hash,
            "retrieved_memory_ids": result.trace.retrieved_memory_ids,
            "top_scores": result.trace.top_scores,
            "used_fallback": result.trace.used_fallback,
        },
    })


def world_relationships(db: Session, *, world_id: str) -> dict[str, object]:
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "items": list_relationship_debug(db, world_id),
    })


def world_consequence_threads(db: Session, *, world_id: str) -> dict[str, object]:
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "items": list_consequence_threads_debug(db, world_id),
    })


def world_chapters(db: Session, *, world_id: str) -> dict[str, object]:
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "items": list_chapter_tracks_debug(db, world_id),
    })


def world_chapter_branches(db: Session, *, world_id: str) -> dict[str, object]:
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "items": [
            {
                "chapter_id": item["id"],
                "owner_actor_id": item["owner_actor_id"],
                "owner_actor_name": item["owner_actor_name"],
                "chapter_key": item["chapter_key"],
                "status": item["status"],
                "branch_key": item.get("branch_key"),
                "crossroads_status": item.get("crossroads_status"),
                "crossroads_summary": item.get("crossroads_summary"),
                "committed_at": item.get("committed_at"),
                "updated_at": item["updated_at"],
            }
            for item in list_chapter_tracks_debug(db, world_id)
        ],
    })


def world_scenes(db: Session, *, world_id: str) -> dict[str, object]:
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "items": list_scene_frames_debug(db, world_id),
    })


def world_npc_routines(db: Session, *, world_id: str) -> dict[str, object]:
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "items": list_npc_routines_debug(db, world_id),
    })


def world_ambient_beats(db: Session, *, world_id: str) -> dict[str, object]:
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "items": list_ambient_beats_debug(db, world_id),
    })


def world_ticks(db: Session, *, world_id: str) -> dict[str, object]:
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "items": list_world_ticks_debug(db, world_id),
    })


def world_npc_locations(db: Session, *, world_id: str) -> dict[str, object]:
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "items": list_npc_locations(db, world_id),
    })


def world_offstage_beats(db: Session, *, world_id: str) -> dict[str, object]:
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "items": list_offstage_beats_debug(db, world_id),
    })


def world_route_pressures(db: Session, *, world_id: str) -> dict[str, object]:
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "items": list_route_pressures_debug(db, world_id),
    })


def trigger_idle_world_pass(
    db: Session,
    ambient_world_service: Any,
    *,
    world_id: str,
) -> dict[str, object] | None:
    result = ambient_world_service.run_idle_world_pass(db, world_id=world_id)
    if result is None:
        return None
    return {
        "world_id": world_id,
        "tick": {
            "tick_id": result.tick.id,
            "status": result.tick.status,
            "summary": result.tick.summary,
            "location_id": result.tick.location_id,
            "langfuse_status": result.langfuse_status,
        },
        "idle_updates": result.updates,
        "recent_offstage_beats": result.recent_offstage_beats,
        "offstage_murmurs": result.offstage_murmurs,
        "npc_locations": result.npc_locations,
        "scene_updates": result.scene_updates,
        "scene_summary": result.scene_summary,
    }


def world_locations(db: Session, *, world_id: str) -> dict[str, object]:
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "items": list_locations_debug(db, world_id),
    })


def world_shared_context(db: Session, *, world_id: str) -> dict[str, object]:
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "shared_world_context": build_shared_world_context(
            db,
            world_id=world_id,
            actor_id=None,
            location_id=None,
            include_all_axes=True,
            limit=12,
        ),
    })


def world_history(
    db: Session,
    *,
    world_id: str,
    status: str | None = None,
    level: str | None = None,
    limit: int = 50,
) -> dict[str, object]:
    stmt = select(SharedHistoryRecord).where(SharedHistoryRecord.world_id == world_id)
    if status:
        stmt = stmt.where(SharedHistoryRecord.status == status)
    if level:
        stmt = stmt.where(SharedHistoryRecord.level == level)
    rows = list(
        db.execute(
            stmt.order_by(
                SharedHistoryRecord.created_at.desc(),
                SharedHistoryRecord.id.desc(),
            ).limit(limit)
        ).scalars()
    )
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "items": [history_record_to_dict(row) for row in rows],
    })


def world_titles(
    db: Session,
    *,
    world_id: str,
    actor_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> dict[str, object]:
    stmt = select(ActorTitleProgress).where(ActorTitleProgress.world_id == world_id)
    if actor_id:
        stmt = stmt.where(ActorTitleProgress.actor_id == actor_id)
    if status:
        stmt = stmt.where(ActorTitleProgress.status == status)
    rows = list(
        db.execute(
            stmt.order_by(
                ActorTitleProgress.updated_at.desc(),
                ActorTitleProgress.actor_id.asc(),
                ActorTitleProgress.title_rule_id.asc(),
            ).limit(limit)
        ).scalars()
    )
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "items": [title_progress_to_dict(row) for row in rows],
    })


def world_travel_log(db: Session, *, world_id: str) -> dict[str, object]:
    return _with_world_context(db, world_id, {
        "world_id": world_id,
        "items": list_travel_log_debug(db, world_id),
    })


def recent_runtime_failures(db: Session) -> list[dict[str, object]]:
    failed_outbox = list(
        db.execute(
            select(OutboxEvent)
            .where(OutboxEvent.status == "failed")
            .order_by(OutboxEvent.updated_at.desc(), OutboxEvent.id.desc())
            .limit(8)
        ).scalars()
    )
    return [
        {
            "id": item.id,
            "event_id": item.event_id,
            "world_id": item.world_id,
            "world_context": _nullable_world_context(db, item.world_id),
            "projection_type": item.projection_type,
            "last_error": item.last_error,
            "attempts": item.attempts,
        }
        for item in failed_outbox
    ]


def _llm_rates(db: Session) -> dict[str, float]:
    llm_total = int(db.execute(select(func.count(LLMRun.id))).scalar_one())
    llm_valid = int(db.execute(select(func.count(LLMRun.id)).where(LLMRun.output_schema_status == "valid")).scalar_one())
    turn_count = int(db.execute(select(func.count(func.distinct(LLMRun.turn_id)))).scalar_one())
    fallback_groups = db.execute(
        select(LLMRun.turn_id, LLMRun.stage_index, LLMRun.council_role, func.count(LLMRun.id))
        .group_by(LLMRun.turn_id, LLMRun.stage_index, LLMRun.council_role)
    ).all()
    fallback_turns = len({row[0] for row in fallback_groups if int(row[3]) > 1})
    return {
        "llm_schema_valid_rate": (llm_valid / llm_total) if llm_total else 0.0,
        "llm_fallback_rate": (fallback_turns / turn_count) if turn_count else 0.0,
    }


def _canary_probe_dict(probe: CanaryProbeResult) -> dict[str, object]:
    return {
        "status": probe.status,
        "url": probe.url,
        "http_status": probe.http_status,
        "detail": probe.detail,
        "graph_runtime_status": probe.graph_runtime_status,
        "release_gate_verdict": probe.release_gate_verdict,
        "projection_lag_seconds": probe.projection_lag_seconds,
        "outbox_pending_count": probe.outbox_pending_count,
        "outbox_failed_count": probe.outbox_failed_count,
        "llm_schema_valid_rate": probe.llm_schema_valid_rate,
        "llm_fallback_rate": probe.llm_fallback_rate,
    }


def list_council_turns(
    db: Session,
    *,
    limit: int,
    session_id: str | None = None,
    world_id: str | None = None,
) -> dict[str, object]:
    stmt = select(Turn).where(Turn.resolution_mode == "gm_council").order_by(Turn.created_at.desc(), Turn.id.desc())
    if session_id is not None:
        stmt = stmt.where(Turn.session_id == session_id)
    if world_id is not None:
        stmt = stmt.where(Turn.world_id == world_id)
    turns = list(db.execute(stmt.limit(limit)).scalars())
    return {"items": [_turn_trace(db, turn, include_attempts=False) for turn in turns]}


def get_council_turn(db: Session, turn_id: str) -> dict[str, object]:
    turn = db.execute(select(Turn).where(Turn.id == turn_id)).scalar_one()
    return _turn_trace(db, turn, include_attempts=True)


def _turn_trace(db: Session, turn: Turn, *, include_attempts: bool) -> dict[str, object]:
    llm_runs = list(
        db.execute(
            select(LLMRun)
            .where(
                LLMRun.turn_id == turn.id,
                LLMRun.world_id == turn.world_id,
                LLMRun.workflow_name == "gm_council",
            )
            .order_by(LLMRun.stage_index.asc(), LLMRun.created_at.asc(), LLMRun.id.asc())
        ).scalars()
    )
    grouped: dict[tuple[int | None, str | None], list[LLMRun]] = {}
    for item in llm_runs:
        grouped.setdefault((item.stage_index, item.council_role), []).append(item)

    roles = []
    for key in sorted(grouped, key=lambda item: ((item[0] or 0), item[1] or "")):
        runs = grouped[key]
        final_run = runs[-1]
        role_payload = {
            "council_role": final_run.council_role,
            "stage_index": final_run.stage_index,
            "approval_status": final_run.approval_status,
            "prompt_id": final_run.prompt_id,
            "model_id": final_run.model_id,
            "model_lane": final_run.model_lane,
            "provider_name": final_run.provider_name,
            "provider_response_id": final_run.provider_response_id,
            "output_schema_status": final_run.output_schema_status,
            "langfuse_trace_id": final_run.langfuse_trace_id,
            "langfuse_observation_id": final_run.langfuse_observation_id,
            "langfuse_trace_url": final_run.langfuse_trace_url,
            "langfuse_status": final_run.langfuse_status,
            "failure_reason": (
                final_run.output_payload.get("reason")
                if isinstance(final_run.output_payload, dict)
                else None
            ),
        }
        if include_attempts:
            role_payload["attempts"] = [
                {
                    "id": item.id,
                    "model_lane": item.model_lane,
                    "model_id": item.model_id,
                    "provider_name": item.provider_name,
                    "provider_response_id": item.provider_response_id,
                    "approval_status": item.approval_status,
                    "output_schema_status": item.output_schema_status,
                    "langfuse_trace_id": item.langfuse_trace_id,
                    "langfuse_observation_id": item.langfuse_observation_id,
                    "langfuse_trace_url": item.langfuse_trace_url,
                    "langfuse_status": item.langfuse_status,
                    "output_payload": item.output_payload,
                    "created_at": item.created_at.isoformat(),
                }
                for item in runs
            ]
        roles.append(role_payload)

    return {
        "turn_id": turn.id,
        "session_id": turn.session_id,
        "world_id": turn.world_id,
        "world_context": _nullable_world_context(db, turn.world_id),
        "input_text": turn.input_text,
        "model_lane": turn.model_lane,
        "resolution_mode": turn.resolution_mode,
        "resolved_output": turn.resolved_output,
        "created_at": turn.created_at.isoformat(),
        "langfuse_trace_id": turn.langfuse_trace_id,
        "langfuse_trace_url": turn.langfuse_trace_url,
        "langfuse_status": turn.langfuse_status,
        "roles": roles,
    }
