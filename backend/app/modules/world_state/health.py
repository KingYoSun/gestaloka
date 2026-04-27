from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    ActorTitleProgress,
    Event,
    Memory,
    SharedConsequenceApplication,
    SharedHistoryRecord,
    World,
    WorldAxisState,
)
from app.modules.world_pack.service import resolve_world_pack


def shared_world_health(db: Session) -> dict[str, Any]:
    """Validate rebuildable shared-world state against pack rules and same-world event links."""
    world_summaries: list[dict[str, Any]] = []
    totals = {
        "world_count": 0,
        "axis_drift_count": 0,
        "memory_gap_count": 0,
        "event_integrity_gap_count": 0,
    }

    worlds = list(db.execute(select(World).order_by(World.id.asc())).scalars())
    for world in worlds:
        state = dict(world.state or {})
        if not state.get("pack_id") or not state.get("world_template_id"):
            continue
        try:
            summary = _world_health(db, world)
        except Exception as exc:
            summary = {
                "world_id": world.id,
                "pack_id": state.get("pack_id"),
                "pack_display_name": state.get("pack_id"),
                "world_template_id": state.get("world_template_id"),
                "world_template_display_name": state.get("world_template_id"),
                "world_axis_ids": [],
                "faction_ids": [],
                "history_levels": [],
                "axis_drift_count": 0,
                "memory_gap_count": 0,
                "event_integrity_gap_count": 1,
                "axis_drift": [],
                "memory_gaps": [],
                "event_integrity_gaps": [
                    {
                        "entity_type": "world_pack_binding",
                        "entity_id": world.id,
                        "reason": "unresolvable_pack_template",
                        "detail": str(exc),
                    }
                ],
            }
        world_summaries.append(summary)
        totals["world_count"] += 1
        totals["axis_drift_count"] += int(summary["axis_drift_count"])
        totals["memory_gap_count"] += int(summary["memory_gap_count"])
        totals["event_integrity_gap_count"] += int(summary["event_integrity_gap_count"])

    drift_count = totals["axis_drift_count"] + totals["memory_gap_count"] + totals["event_integrity_gap_count"]
    return {
        "status": "ready" if drift_count == 0 else "drift_detected",
        "drift_count": drift_count,
        **totals,
        "worlds": world_summaries,
    }


def _world_health(db: Session, world: World) -> dict[str, Any]:
    pack, template = resolve_world_pack(db, world.id)
    axis_drift = _axis_drift(db, world_id=world.id, template=template)
    memory_gaps = _memory_gaps(db, world_id=world.id, template=template)
    event_integrity_gaps = _event_integrity_gaps(db, world_id=world.id)
    history_levels = sorted(
        {
            str(level)
            for (level,) in db.execute(
                select(SharedHistoryRecord.level).where(SharedHistoryRecord.world_id == world.id).distinct()
            ).all()
            if level
        }
    )
    return {
        "world_id": world.id,
        "pack_id": pack.manifest.pack_id,
        "pack_display_name": pack.manifest.display_name,
        "world_template_id": template.template_id,
        "world_template_display_name": template.display_name,
        "world_axis_ids": [
            axis.axis_id
            for axis in db.execute(
                select(WorldAxisState)
                .where(WorldAxisState.world_id == world.id)
                .order_by(WorldAxisState.axis_id.asc())
            ).scalars()
        ],
        "faction_ids": [faction.id for faction in template.factions],
        "history_levels": history_levels,
        "axis_drift_count": len(axis_drift),
        "memory_gap_count": len(memory_gaps),
        "event_integrity_gap_count": len(event_integrity_gaps),
        "axis_drift": axis_drift,
        "memory_gaps": memory_gaps,
        "event_integrity_gaps": event_integrity_gaps,
    }


def _axis_drift(db: Session, *, world_id: str, template: Any) -> list[dict[str, Any]]:
    rules = {rule.id: rule for rule in template.consequence_rules}
    rule_order = {rule.id: index for index, rule in enumerate(template.consequence_rules)}
    axis_definitions = {axis.id: axis for axis in template.world_axes}
    expected = {
        axis_id: float(axis.initial_value)
        for axis_id, axis in axis_definitions.items()
    }
    application_rows = list(
        db.execute(
            select(SharedConsequenceApplication)
            .where(SharedConsequenceApplication.world_id == world_id)
            .order_by(SharedConsequenceApplication.created_at.asc(), SharedConsequenceApplication.source_event_id.asc(), SharedConsequenceApplication.rule_id.asc())
        ).scalars()
    )
    applications = sorted(
        application_rows,
        key=lambda application: (
            application.created_at,
            application.source_event_id,
            rule_order.get(application.rule_id, len(rule_order)),
        ),
    )
    for application in applications:
        rule = rules.get(application.rule_id)
        if rule is None:
            continue
        for axis_id, delta in rule.world_axis_deltas.items():
            axis = axis_definitions.get(axis_id)
            if axis is None:
                continue
            before = expected.get(axis_id, float(axis.initial_value))
            expected[axis_id] = min(max(before + float(delta), float(axis.min_value)), float(axis.max_value))

    drift: list[dict[str, Any]] = []
    rows = list(db.execute(select(WorldAxisState).where(WorldAxisState.world_id == world_id)).scalars())
    for row in rows:
        expected_value = expected.get(row.axis_id)
        if expected_value is None:
            drift.append(
                {
                    "axis_id": row.axis_id,
                    "reason": "axis_not_in_pack_template",
                    "expected": None,
                    "actual": row.current_value,
                }
            )
            continue
        if abs(float(row.current_value) - expected_value) > 0.000001:
            drift.append(
                {
                    "axis_id": row.axis_id,
                    "reason": "current_value_drift",
                    "expected": expected_value,
                    "actual": row.current_value,
                    "last_event_id": row.last_event_id,
                }
            )
    return drift


def _memory_gaps(db: Session, *, world_id: str, template: Any) -> list[dict[str, Any]]:
    rules = {rule.id: rule for rule in template.consequence_rules}
    gaps: list[dict[str, Any]] = []
    applications = list(
        db.execute(
            select(SharedConsequenceApplication)
            .where(SharedConsequenceApplication.world_id == world_id)
            .order_by(SharedConsequenceApplication.created_at.asc(), SharedConsequenceApplication.source_event_id.asc(), SharedConsequenceApplication.rule_id.asc())
        ).scalars()
    )
    for application in applications:
        rule = rules.get(application.rule_id)
        if rule is None or not _rule_expects_memory(rule):
            continue
        memory_count = db.execute(
            select(Memory.id).where(
                Memory.world_id == world_id,
                Memory.source_event_id == application.source_event_id,
            ).limit(1)
        ).scalar_one_or_none()
        if memory_count is None:
            gaps.append(
                {
                    "source_event_id": application.source_event_id,
                    "rule_id": application.rule_id,
                    "action_tag": application.action_tag,
                }
            )
    return gaps


def _rule_expects_memory(rule: Any) -> bool:
    if str(rule.rumor_draft or "").strip():
        return True
    return any(str(draft.get("text") or draft.get("summary") or "").strip() for draft in rule.npc_memory_drafts)


def _event_integrity_gaps(db: Session, *, world_id: str) -> list[dict[str, Any]]:
    gaps: list[dict[str, Any]] = []
    event_worlds = {
        event_id: event_world_id
        for event_id, event_world_id in db.execute(select(Event.id, Event.world_id)).all()
    }

    def check(entity_type: str, entity_id: str, source_event_id: str | None) -> None:
        if not source_event_id:
            return
        event_world_id = event_worlds.get(source_event_id)
        if event_world_id != world_id:
            gaps.append(
                {
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "source_event_id": source_event_id,
                    "expected_world_id": world_id,
                    "actual_event_world_id": event_world_id,
                    "reason": "missing_event" if event_world_id is None else "cross_world_event",
                }
            )

    for axis in db.execute(select(WorldAxisState).where(WorldAxisState.world_id == world_id)).scalars():
        check("world_axis", axis.axis_id, axis.last_event_id)
    for memory in db.execute(select(Memory).where(Memory.world_id == world_id)).scalars():
        check("memory", memory.id, memory.source_event_id)
    for history in db.execute(select(SharedHistoryRecord).where(SharedHistoryRecord.world_id == world_id)).scalars():
        check("shared_history", history.id, history.source_event_id)
    for progress in db.execute(select(ActorTitleProgress).where(ActorTitleProgress.world_id == world_id)).scalars():
        check("title_progress", f"{progress.actor_id}:{progress.title_rule_id}", progress.source_event_id)

    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for gap in gaps:
        key = (str(gap["entity_type"]), str(gap["entity_id"]))
        grouped[key] = gap
    return list(grouped.values())
