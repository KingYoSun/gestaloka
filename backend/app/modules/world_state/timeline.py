from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.entities import (
    Actor,
    Event,
    LocationRoute,
    Session as GameSession,
    WorldBroadcastDelivery,
    WorldBroadcastEvent,
    WorldResourceLock,
    WorldTimelineCounter,
    WorldTimelineEntry,
)
from app.modules.world_pack.service import resolve_world_pack
from app.modules.world_state.shared_consequence import resolve_shared_action_tag, pack_scoped_entity_id


LOCK_LEASE_SECONDS = 120


@dataclass(frozen=True)
class ResourceRef:
    resource_type: str
    resource_id: str
    summary: str


@dataclass(frozen=True)
class ResourceReservationResult:
    held: list[WorldResourceLock]
    constraints: list[dict[str, Any]]


def canonicalize_event(
    db: Session,
    event: Event,
    *,
    entry_kind: str = "event",
    scope_kind: str = "event",
    affected_location_ids: list[str] | None = None,
    narrative_constraint: str = "",
    payload: dict[str, Any] | None = None,
) -> WorldTimelineEntry:
    if event.canonical_sequence is not None and event.timeline_entry_id:
        existing = db.execute(
            select(WorldTimelineEntry).where(
                WorldTimelineEntry.world_id == event.world_id,
                WorldTimelineEntry.id == event.timeline_entry_id,
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing

    sequence = _next_sequence(db, event.world_id)
    entry = WorldTimelineEntry(
        world_id=event.world_id,
        sequence=sequence,
        entry_kind=entry_kind,
        source_event_id=event.id,
        scope_kind=scope_kind,
        location_id=event.location_id,
        affected_location_ids=list(affected_location_ids or ([event.location_id] if event.location_id else [])),
        status="canon",
        narrative_constraint=narrative_constraint,
        payload=payload or {},
    )
    db.add(entry)
    db.flush()
    event.canonical_sequence = sequence
    event.canonical_status = "canon"
    event.timeline_entry_id = entry.id
    db.flush()
    return entry


def _next_sequence(db: Session, world_id: str) -> int:
    stmt = select(WorldTimelineCounter).where(WorldTimelineCounter.world_id == world_id)
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        stmt = stmt.with_for_update()
    counter = db.execute(stmt).scalar_one_or_none()
    if counter is None:
        max_sequence = db.execute(
            select(func.max(Event.canonical_sequence)).where(Event.world_id == world_id)
        ).scalar_one()
        next_sequence = int(max_sequence or 0) + 1
        counter = WorldTimelineCounter(world_id=world_id, next_sequence=next_sequence)
        db.add(counter)
        db.flush()
    sequence = int(counter.next_sequence)
    counter.next_sequence = sequence + 1
    db.flush()
    return sequence


def plan_shared_resources(
    db: Session,
    *,
    world_id: str,
    location_id: str | None,
    guide_actor_id: str | None,
    session_state: dict[str, Any],
    selected_choice: dict[str, Any] | None,
    action_kind: str,
    world_tags: list[str] | None = None,
    consequence_tags: list[str] | None = None,
) -> list[ResourceRef]:
    resources: list[ResourceRef] = []
    if guide_actor_id:
        resources.append(ResourceRef("npc", guide_actor_id, "A local NPC is already answering another turn."))
    if location_id:
        resources.append(ResourceRef("location", location_id, "The current place is already settling another event."))

    if action_kind == "travel":
        route_key = str((selected_choice or {}).get("travel_target_key") or "").strip()
        if route_key:
            route = db.execute(
                select(LocationRoute).where(LocationRoute.world_id == world_id, LocationRoute.route_key == route_key)
            ).scalar_one_or_none()
            if route is not None:
                resources.append(ResourceRef("route", route.id, "The route is already under another scene's pressure."))
                resources.append(ResourceRef("location", route.to_location_id, "The destination is already settling another arrival."))

    action_tag = resolve_shared_action_tag(
        world_tags=world_tags,
        consequence_tags=consequence_tags,
        action_kind=action_kind,
        fail_forward=False,
    )
    if action_tag != "none":
        _, template = resolve_world_pack(db, world_id)
        for rule in template.consequence_rules:
            if rule.action_tag != action_tag:
                continue
            for axis_id in rule.world_axis_deltas:
                resources.append(ResourceRef("world_axis", axis_id, "A world axis is already absorbing another canonical change."))
            for faction_id in set(rule.faction_influence_deltas) | set(rule.faction_standing_deltas):
                resources.append(
                    ResourceRef("faction", pack_scoped_entity_id(world_id, faction_id), "A faction record is already being revised.")
                )
            for location_key in rule.location_public_state_deltas:
                location_resource = _location_resource_id_for_key(session_state, location_key)
                if location_resource:
                    resources.append(
                        ResourceRef("location", location_resource, "A public location state is already being revised.")
                    )

    deduped: dict[tuple[str, str], ResourceRef] = {}
    for resource in resources:
        deduped[(resource.resource_type, resource.resource_id)] = resource
    return list(deduped.values())


def reserve_resources(
    db: Session,
    *,
    world_id: str,
    session_id: str,
    turn_id: str,
    resources: list[ResourceRef],
    lease_seconds: int = LOCK_LEASE_SECONDS,
) -> ResourceReservationResult:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=lease_seconds)
    held: list[WorldResourceLock] = []
    constraints: list[dict[str, Any]] = []
    for resource in resources:
        if not _try_resource_advisory_lock(db, world_id=world_id, resource=resource):
            constraints.append(
                {
                    "resource_type": resource.resource_type,
                    "resource_id": resource.resource_id,
                    "holder_turn_id": None,
                    "holder_session_id": None,
                    "constraint_summary": resource.summary,
                    "expires_at": expires_at.isoformat(),
                }
            )
            continue
        existing = _active_lock(db, world_id=world_id, resource=resource, now=now)
        if existing is not None and existing.holder_turn_id != turn_id:
            constraints.append(
                {
                    "resource_type": resource.resource_type,
                    "resource_id": resource.resource_id,
                    "holder_turn_id": existing.holder_turn_id,
                    "holder_session_id": existing.holder_session_id,
                    "constraint_summary": existing.constraint_summary or resource.summary,
                    "expires_at": existing.expires_at.isoformat(),
                }
            )
            continue
        if existing is not None:
            held.append(existing)
            continue
        lock = WorldResourceLock(
            world_id=world_id,
            resource_type=resource.resource_type,
            resource_id=resource.resource_id,
            holder_turn_id=turn_id,
            holder_session_id=session_id,
            status="active",
            acquired_at=now,
            expires_at=expires_at,
            constraint_summary=resource.summary,
        )
        db.add(lock)
        db.flush()
        held.append(lock)
    return ResourceReservationResult(held=held, constraints=constraints)


def _try_resource_advisory_lock(db: Session, *, world_id: str, resource: ResourceRef) -> bool:
    if db.bind is None or db.bind.dialect.name != "postgresql":
        return True
    lock_key = _resource_advisory_lock_key(world_id, resource)
    return bool(db.execute(select(func.pg_try_advisory_xact_lock(lock_key))).scalar_one())


def _resource_advisory_lock_key(world_id: str, resource: ResourceRef) -> int:
    raw = f"{world_id}:{resource.resource_type}:{resource.resource_id}"
    return int.from_bytes(hashlib.sha256(raw.encode("utf-8")).digest()[:8], "big", signed=True)


def release_resources(db: Session, locks: list[WorldResourceLock]) -> None:
    now = datetime.now(timezone.utc)
    for lock in locks:
        if lock.status == "active":
            lock.status = "released"
            lock.released_at = now
    if locks:
        db.flush()


def held_resource_keys(locks: list[WorldResourceLock]) -> set[tuple[str, str]]:
    return {(lock.resource_type, lock.resource_id) for lock in locks}


def skipped_resource_constraints(
    resources: list[ResourceRef],
    held_locks: list[WorldResourceLock],
    constraints: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    held = held_resource_keys(held_locks)
    skipped: list[dict[str, Any]] = []
    constrained = {(item["resource_type"], item["resource_id"]): item for item in constraints}
    for resource in resources:
        key = (resource.resource_type, resource.resource_id)
        if key in held:
            continue
        payload = dict(constrained.get(key) or {})
        payload.setdefault("resource_type", resource.resource_type)
        payload.setdefault("resource_id", resource.resource_id)
        payload.setdefault("constraint_summary", resource.summary)
        skipped.append(payload)
    return skipped


def create_timeline_constraint(
    db: Session,
    *,
    world_id: str,
    source_event_id: str | None,
    location_id: str | None,
    constraints: list[dict[str, Any]],
) -> WorldTimelineEntry | None:
    if not constraints:
        return None
    sequence = _next_sequence(db, world_id)
    entry = WorldTimelineEntry(
        world_id=world_id,
        sequence=sequence,
        entry_kind="resource_conflict",
        source_event_id=source_event_id,
        scope_kind="resource",
        location_id=location_id,
        affected_location_ids=[location_id] if location_id else [],
        status="constraint",
        narrative_constraint="Some shared resources were already moving through another turn.",
        payload={"resource_constraints": constraints},
    )
    db.add(entry)
    db.flush()
    return entry


def create_timeline_entry(
    db: Session,
    *,
    world_id: str,
    entry_kind: str,
    source_event_id: str | None,
    scope_kind: str,
    location_id: str | None,
    affected_location_ids: list[str] | None,
    status: str,
    narrative_constraint: str,
    payload: dict[str, Any] | None = None,
) -> WorldTimelineEntry:
    entry = WorldTimelineEntry(
        world_id=world_id,
        sequence=_next_sequence(db, world_id),
        entry_kind=entry_kind,
        source_event_id=source_event_id,
        scope_kind=scope_kind,
        location_id=location_id,
        affected_location_ids=list(affected_location_ids or []),
        status=status,
        narrative_constraint=narrative_constraint,
        payload=payload or {},
    )
    db.add(entry)
    db.flush()
    return entry


def sync_active_broadcast_deliveries(
    db: Session,
    *,
    world_id: str,
    session_id: str,
    actor_id: str,
    location_id: str | None,
) -> list[WorldBroadcastDelivery]:
    if location_id is None:
        return []
    broadcasts = list(
        db.execute(
            select(WorldBroadcastEvent).where(
                WorldBroadcastEvent.world_id == world_id,
                WorldBroadcastEvent.status == "active",
            )
        ).scalars()
    )
    deliveries: list[WorldBroadcastDelivery] = []
    for broadcast in broadcasts:
        affected = {str(item) for item in broadcast.affected_location_ids or []}
        if location_id not in affected:
            continue
        existing = db.execute(
            select(WorldBroadcastDelivery).where(
                WorldBroadcastDelivery.world_id == world_id,
                WorldBroadcastDelivery.broadcast_event_id == broadcast.id,
                WorldBroadcastDelivery.session_id == session_id,
            )
        ).scalar_one_or_none()
        if existing is None:
            existing = WorldBroadcastDelivery(
                world_id=world_id,
                broadcast_event_id=broadcast.id,
                session_id=session_id,
                actor_id=actor_id,
                status="pending",
                payload={"reason": "active_broadcast_scope_match"},
            )
            db.add(existing)
            db.flush()
        deliveries.append(existing)
    return deliveries


def pending_broadcast_constraints(
    db: Session,
    *,
    world_id: str,
    session_id: str,
) -> list[dict[str, Any]]:
    rows = list(
        db.execute(
            select(WorldBroadcastDelivery, WorldBroadcastEvent)
            .join(
                WorldBroadcastEvent,
                (WorldBroadcastEvent.id == WorldBroadcastDelivery.broadcast_event_id)
                & (WorldBroadcastEvent.world_id == WorldBroadcastDelivery.world_id),
            )
            .where(
                WorldBroadcastDelivery.world_id == world_id,
                WorldBroadcastDelivery.session_id == session_id,
                WorldBroadcastDelivery.status.in_(("pending", "delivered")),
                WorldBroadcastEvent.status == "active",
            )
            .order_by(WorldBroadcastEvent.created_at.asc(), WorldBroadcastEvent.id.asc())
        ).all()
    )
    now = datetime.now(timezone.utc)
    payload: list[dict[str, Any]] = []
    for delivery, broadcast in rows:
        if delivery.status == "pending":
            delivery.status = "delivered"
            delivery.delivered_at = now
        payload.append(_broadcast_constraint_payload(broadcast, delivery))
    if rows:
        db.flush()
    return payload


def consume_broadcast_constraints(db: Session, *, world_id: str, session_id: str) -> None:
    rows = list(
        db.execute(
            select(WorldBroadcastDelivery).where(
                WorldBroadcastDelivery.world_id == world_id,
                WorldBroadcastDelivery.session_id == session_id,
                WorldBroadcastDelivery.status == "delivered",
            )
        ).scalars()
    )
    now = datetime.now(timezone.utc)
    for row in rows:
        row.status = "consumed"
        row.consumed_at = now
    if rows:
        db.flush()


def create_broadcast_from_turn(
    db: Session,
    *,
    event: Event,
    broadcast_draft: dict[str, Any] | None,
    action_tag: str,
    relevance_tags: list[str] | None = None,
) -> tuple[WorldBroadcastEvent | None, list[WorldBroadcastDelivery]]:
    draft = dict(broadcast_draft or {})
    summary = str(draft.get("summary") or event.payload.get("consequence_summary") or event.narrative or "").strip()
    constraint_text = str(draft.get("constraint_text") or summary).strip()
    tags = [str(item) for item in (draft.get("relevance_tags") or relevance_tags or []) if str(item)]
    if action_tag == "none" and not tags:
        return None, []
    if not summary:
        return None, []
    affected_location_ids = affected_locations_for_broadcast(db, world_id=event.world_id, origin_location_id=event.location_id)
    if not affected_location_ids:
        return None, []
    semantic_key = _semantic_broadcast_key(
        world_id=event.world_id,
        origin_location_id=event.location_id,
        action_tag=action_tag,
        relevance_tags=tags,
    )
    existing = db.execute(
        select(WorldBroadcastEvent).where(
            WorldBroadcastEvent.world_id == event.world_id,
            WorldBroadcastEvent.semantic_key == semantic_key,
        )
    ).scalar_one_or_none()
    if existing is not None:
        broadcast = existing
        broadcast.status = "active"
        broadcast.resolved_at = None
        broadcast.resolved_by_event_id = None
        broadcast.source_event_id = event.id
        broadcast.scope_kind = str(draft.get("scope_kind") or "location")
        broadcast.lifecycle_kind = str(draft.get("lifecycle_kind") or "scene")
        broadcast.origin_location_id = event.location_id
        broadcast.affected_location_ids = affected_location_ids
        broadcast.summary = summary
        broadcast.constraint_text = constraint_text
        broadcast.relevance_tags = tags
        broadcast.payload = {"action_tag": action_tag, "source_event_type": event.event_type}
        db.flush()
    else:
        broadcast = WorldBroadcastEvent(
            world_id=event.world_id,
            source_event_id=event.id,
            semantic_key=semantic_key,
            status="active",
            scope_kind=str(draft.get("scope_kind") or "location"),
            lifecycle_kind=str(draft.get("lifecycle_kind") or "scene"),
            origin_location_id=event.location_id,
            affected_location_ids=affected_location_ids,
            summary=summary,
            constraint_text=constraint_text,
            relevance_tags=tags,
            payload={"action_tag": action_tag, "source_event_type": event.event_type},
        )
        db.add(broadcast)
        db.flush()
    deliveries = deliver_broadcast_to_active_sessions(db, broadcast=broadcast)
    return broadcast, deliveries


def deliver_broadcast_to_active_sessions(db: Session, *, broadcast: WorldBroadcastEvent) -> list[WorldBroadcastDelivery]:
    affected = {str(item) for item in broadcast.affected_location_ids or []}
    if not affected:
        return []
    rows = list(
        db.execute(
            select(GameSession, Actor)
            .join(Actor, (Actor.id == GameSession.player_actor_id) & (Actor.world_id == GameSession.world_id))
            .where(
                GameSession.world_id == broadcast.world_id,
                GameSession.status == "active",
                Actor.current_location_id.in_(affected),
            )
        ).all()
    )
    deliveries: list[WorldBroadcastDelivery] = []
    for session, actor in rows:
        existing = db.execute(
            select(WorldBroadcastDelivery).where(
                WorldBroadcastDelivery.world_id == broadcast.world_id,
                WorldBroadcastDelivery.broadcast_event_id == broadcast.id,
                WorldBroadcastDelivery.session_id == session.id,
            )
        ).scalar_one_or_none()
        if existing is not None:
            deliveries.append(existing)
            continue
        delivery = WorldBroadcastDelivery(
            world_id=broadcast.world_id,
            broadcast_event_id=broadcast.id,
            session_id=session.id,
            actor_id=actor.id,
            status="pending",
            payload={"reason": "broadcast_created"},
        )
        db.add(delivery)
        db.flush()
        deliveries.append(delivery)
    return deliveries


def affected_locations_for_broadcast(db: Session, *, world_id: str, origin_location_id: str | None) -> list[str]:
    if origin_location_id is None:
        return []
    locations = {origin_location_id}
    routes = list(
        db.execute(
            select(LocationRoute).where(
                LocationRoute.world_id == world_id,
                or_(
                    LocationRoute.from_location_id == origin_location_id,
                    LocationRoute.to_location_id == origin_location_id,
                ),
            )
        ).scalars()
    )
    for route in routes:
        locations.add(route.from_location_id)
        locations.add(route.to_location_id)
    return sorted(locations)


def _active_lock(db: Session, *, world_id: str, resource: ResourceRef, now: datetime) -> WorldResourceLock | None:
    row = db.execute(
        select(WorldResourceLock)
        .where(
            WorldResourceLock.world_id == world_id,
            WorldResourceLock.resource_type == resource.resource_type,
            WorldResourceLock.resource_id == resource.resource_id,
            WorldResourceLock.status == "active",
        )
        .order_by(WorldResourceLock.expires_at.desc(), WorldResourceLock.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    if row is None:
        return None
    if _aware_datetime(row.expires_at) <= now:
        row.status = "expired"
        row.released_at = now
        db.flush()
        return None
    return row


def _aware_datetime(value: datetime) -> datetime:
    if value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


def _location_resource_id_for_key(session_state: dict[str, Any], location_key: str) -> str | None:
    current = session_state.get("current_location") or session_state.get("location") or {}
    if isinstance(current, dict) and current.get("key") == location_key and current.get("id"):
        return str(current["id"])
    for route in session_state.get("nearby_routes") or []:
        if not isinstance(route, dict):
            continue
        destination = route.get("to_location") or {}
        if isinstance(destination, dict) and destination.get("key") == location_key and destination.get("id"):
            return str(destination["id"])
    return None


def _semantic_broadcast_key(
    *,
    world_id: str,
    origin_location_id: str | None,
    action_tag: str,
    relevance_tags: list[str],
) -> str:
    raw = "|".join([world_id, origin_location_id or "world", action_tag, ",".join(sorted(relevance_tags))])
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    return f"{origin_location_id or 'world'}:{action_tag}:{digest}"


def _broadcast_constraint_payload(broadcast: WorldBroadcastEvent, delivery: WorldBroadcastDelivery) -> dict[str, Any]:
    return {
        "semantic_key": broadcast.semantic_key,
        "scope_kind": broadcast.scope_kind,
        "lifecycle_kind": broadcast.lifecycle_kind,
        "origin_location_id": broadcast.origin_location_id,
        "affected_location_ids": list(broadcast.affected_location_ids or []),
        "summary": broadcast.summary,
        "constraint_text": broadcast.constraint_text,
        "relevance_tags": list(broadcast.relevance_tags or []),
        "delivery_status": delivery.status,
    }


def stale_active_lock_count(db: Session, *, world_id: str | None = None) -> int:
    now = datetime.now(timezone.utc)
    stmt = select(func.count(WorldResourceLock.id)).where(
        WorldResourceLock.status == "active",
        WorldResourceLock.expires_at <= now,
    )
    if world_id is not None:
        stmt = stmt.where(WorldResourceLock.world_id == world_id)
    return int(
        db.execute(stmt).scalar_one()
    )
