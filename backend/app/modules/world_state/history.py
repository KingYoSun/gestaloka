from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import ActorTitleProgress, SharedHistoryRecord
from app.modules.world_pack.service import resolve_world_pack


def canonize_history_candidates(
    db: Session,
    *,
    world_id: str,
    source_event_ids: Sequence[str] | None = None,
) -> list[SharedHistoryRecord]:
    """Promote eligible pack-defined history candidates without changing their level."""
    _, template = resolve_world_pack(db, world_id)
    history_rules = {rule.id: rule for rule in template.history_rules}
    stmt = select(SharedHistoryRecord).where(
        SharedHistoryRecord.world_id == world_id,
        SharedHistoryRecord.status == "candidate",
    )
    if source_event_ids is not None:
        resolved_event_ids = [str(item) for item in source_event_ids if str(item)]
        if not resolved_event_ids:
            return []
        stmt = stmt.where(SharedHistoryRecord.source_event_id.in_(resolved_event_ids))

    promoted: list[SharedHistoryRecord] = []
    for record in db.execute(stmt.order_by(SharedHistoryRecord.created_at.asc(), SharedHistoryRecord.id.asc())).scalars():
        rule = history_rules.get(record.history_rule_id)
        if rule is None:
            continue
        if float(record.salience) < float(rule.minimum_salience):
            continue
        record.status = "canonized"
        record.payload = {
            **dict(record.payload or {}),
            "canonized_by": "pack_history_rule",
            "minimum_salience": float(rule.minimum_salience),
        }
        promoted.append(record)
    if promoted:
        db.flush()
    return promoted


def history_record_to_dict(record: SharedHistoryRecord) -> dict[str, Any]:
    return {
        "id": record.id,
        "world_id": record.world_id,
        "source_event_id": record.source_event_id,
        "actor_id": record.actor_id,
        "location_id": record.location_id,
        "history_rule_id": record.history_rule_id,
        "level": record.level,
        "status": record.status,
        "summary": record.summary,
        "salience": record.salience,
        "tags": list(record.tags or []),
        "payload": dict(record.payload or {}),
        "created_at": record.created_at.isoformat(),
        "updated_at": record.updated_at.isoformat(),
    }


def title_progress_to_dict(progress: ActorTitleProgress) -> dict[str, Any]:
    return {
        "world_id": progress.world_id,
        "actor_id": progress.actor_id,
        "title_rule_id": progress.title_rule_id,
        "display_name": progress.display_name,
        "description": progress.description,
        "progress": progress.progress,
        "progress_target": progress.progress_target,
        "status": progress.status,
        "source_event_id": progress.source_event_id,
        "payload": dict(progress.payload or {}),
        "updated_at": progress.updated_at.isoformat(),
    }
