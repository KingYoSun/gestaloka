from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.entities import Actor, LLMRun, OutboxEvent, ProjectionRecord, Session as GameSession, Turn
from app.modules.economy_sp.service import EconomyService
from app.modules.graph_projection.service import ProjectionService
from app.modules.observability.service import CanaryProbeResult, ObservabilityService
from app.modules.world_memory.service import MemoryService


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
    return {
        "primary": {
            "runtime_role": settings.app_runtime_role,
            "graph_runtime_status": snapshot["graph_runtime_status"],
            "graph_read_mode": snapshot["graph_read_mode"],
            "projection_lag_seconds": snapshot["projection_lag_seconds"],
            "outbox_pending_count": snapshot["pending_outbox"],
            "outbox_failed_count": snapshot["failed_outbox"],
            "llm_schema_valid_rate": snapshot["llm_schema_valid_rate"],
            "llm_fallback_rate": snapshot["llm_fallback_rate"],
        },
        "canary": _canary_probe_dict(canary),
        "recent_traces": observability_service.recent_trace_attributes(),
        "metrics": observability_service.metric_snapshot(),
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
        "label_counts": label_counts,
        "recent_records": recent_records,
        "state_changes": state_changes,
        "neighborhood_summary": neighborhood_summary,
    }


def sp_overview(db: Session, economy_service: EconomyService) -> dict[str, object]:
    return economy_service.overview(db)


def sp_ledger(
    db: Session,
    economy_service: EconomyService,
    *,
    user_sub: str | None,
    world_id: str | None,
    limit: int,
) -> dict[str, object]:
    return {
        "items": economy_service.list_ledger(db, user_sub=user_sub, world_id=world_id, limit=limit),
    }


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
    return {
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
    }


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
) -> dict[str, object]:
    stmt = select(Turn).where(Turn.resolution_mode == "gm_council").order_by(Turn.created_at.desc(), Turn.id.desc())
    if session_id is not None:
        stmt = stmt.where(Turn.session_id == session_id)
    turns = list(db.execute(stmt.limit(limit)).scalars())
    return {"items": [_turn_trace(db, turn, include_attempts=False) for turn in turns]}


def get_council_turn(db: Session, turn_id: str) -> dict[str, object]:
    turn = db.execute(select(Turn).where(Turn.id == turn_id)).scalar_one()
    return _turn_trace(db, turn, include_attempts=True)


def _turn_trace(db: Session, turn: Turn, *, include_attempts: bool) -> dict[str, object]:
    llm_runs = list(
        db.execute(
            select(LLMRun)
            .where(LLMRun.turn_id == turn.id, LLMRun.world_id == turn.world_id)
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
        "input_text": turn.input_text,
        "model_lane": turn.model_lane,
        "resolution_mode": turn.resolution_mode,
        "resolved_output": turn.resolved_output,
        "created_at": turn.created_at.isoformat(),
        "roles": roles,
    }
