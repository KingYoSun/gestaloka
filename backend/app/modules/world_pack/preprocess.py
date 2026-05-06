from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models.entities import (
    Actor,
    Event,
    Location,
    Memory,
    OutboxEvent,
    PackPreprocessRun,
    ProjectionRecord,
    Session as GameSession,
    Turn,
    World,
    WorldTimelineEntry,
    new_id,
)
from app.modules.actor.service import ensure_pack_npcs
from app.modules.graph_projection.service import ProjectionService
from app.modules.world_memory.service import MemoryService
from app.modules.world_pack.service import (
    PackRegistry,
    pack_content_hash,
    pack_preprocess_run_to_dict,
    pack_preprocess_status,
    template_world_id,
)
from app.modules.world_state.entity_generation import pack_seed_entity_key
from app.modules.world_state.service import (
    ensure_followup_quest_template,
    ensure_location_routes,
    ensure_seeded_locations,
    ensure_starter_quest_template,
    ensure_world,
)
from app.modules.world_state.shared_consequence import ensure_shared_world_seed
from app.modules.world_state.timeline import canonicalize_event


PACK_PREPROCESS_EVENT_TYPES = {
    "pack.preprocessed.world",
    "pack.preprocessed.location",
}


def list_pack_preprocess_statuses(db: Session, registry: PackRegistry) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for pack in registry.list_packs():
        for template_id in sorted(pack.templates):
            template = pack.template(template_id)
            items.append(
                {
                    "pack_id": pack.manifest.pack_id,
                    "pack_display_name": pack.manifest.display_name,
                    "world_template_id": template.template_id,
                    "world_template_display_name": template.display_name,
                    "world_id": template_world_id(template),
                    **pack_preprocess_status(db, pack, template),
                }
            )
    return {"items": items}


def run_pack_preprocess(
    db: Session,
    *,
    registry: PackRegistry,
    memory_service: MemoryService,
    projection_service: ProjectionService,
    pack_id: str,
    world_template_id: str,
    triggered_by_sub: str,
) -> dict[str, Any]:
    pack = registry.get_pack(pack_id)
    template = pack.template(world_template_id)
    world_id = template_world_id(template)
    content_hash = pack_content_hash(pack, world_template_id)
    now = _now()
    run = PackPreprocessRun(
        id=new_id(),
        pack_id=pack_id,
        world_template_id=world_template_id,
        world_id=world_id,
        pack_content_hash=content_hash,
        status="running",
        counts={},
        error={},
        triggered_by_sub=triggered_by_sub,
        started_at=now,
        completed_at=None,
    )
    db.add(run)
    db.flush()

    try:
        with db.begin_nested():
            counts = _materialize_pack(
                db,
                registry=registry,
                memory_service=memory_service,
                projection_service=projection_service,
                pack_id=pack_id,
                world_template_id=world_template_id,
                world_id=world_id,
                preprocess_run_id=run.id,
                content_hash=content_hash,
            )
        run.status = "ready"
        run.counts = counts
        run.error = {}
        run.completed_at = _now()
    except Exception as exc:
        run.status = "failed"
        run.error = {"message": str(exc), "type": exc.__class__.__name__}
        run.completed_at = _now()
    db.flush()
    return {"status": run.status, "run": pack_preprocess_run_to_dict(run)}


def _materialize_pack(
    db: Session,
    *,
    registry: PackRegistry,
    memory_service: MemoryService,
    projection_service: ProjectionService,
    pack_id: str,
    world_template_id: str,
    world_id: str,
    preprocess_run_id: str,
    content_hash: str,
) -> dict[str, int]:
    pack = registry.get_pack(pack_id)
    template = pack.template(world_template_id)
    world = ensure_world(
        db,
        world_id,
        pack_id=pack_id,
        world_template_id=world_template_id,
        world_name=str((template.world or {}).get("default_name") or template.display_name),
    )
    _update_world_preprocess_state(world, preprocess_run_id=preprocess_run_id, content_hash=content_hash)
    locations_by_key = ensure_seeded_locations(db, world_id)
    routes_by_key = ensure_location_routes(db, world_id, locations_by_key=locations_by_key)
    npcs = ensure_pack_npcs(
        db,
        world_id,
        location_ids_by_key={key: location.id for key, location in locations_by_key.items()},
    )
    shared_counts = ensure_shared_world_seed(db, world_id=world_id, actor_id=None)
    quest_template_count = 0
    if template.quest is not None:
        ensure_starter_quest_template(db, world_id)
        quest_template_count += 1
    if template.followup_quest is not None:
        ensure_followup_quest_template(db, world_id)
        quest_template_count += 1

    _cleanup_existing_pack_preprocess_artifacts(db, world_id=world_id, pack_id=pack_id, world_template_id=world_template_id)
    source_actor = _ensure_preprocess_actor(db, world_id=world_id, locations_by_key=locations_by_key)
    synthetic_session = GameSession(
        id=new_id(),
        world_id=world_id,
        player_actor_id=source_actor.id,
        status="pack_preprocess",
    )
    synthetic_turn = Turn(
        id=new_id(),
        world_id=world_id,
        session_id=synthetic_session.id,
        actor_id=source_actor.id,
        input_text="Pack preprocess materialized public world knowledge.",
        resolved_output={"status": "pack_preprocess", "preprocess_run_id": preprocess_run_id},
        model_lane="system",
        action_type="pack_preprocess",
        resolution_mode="pack_preprocess",
    )
    db.add_all([synthetic_session, synthetic_turn])
    db.flush()

    drafts_by_location = _pack_memory_drafts(
        pack=pack,
        template=template,
        world_id=world_id,
        locations_by_key=locations_by_key,
        routes_by_key=routes_by_key,
        npcs=npcs,
    )
    event_ids: list[str] = []
    outbox_ids: list[str] = []
    memory_ids: list[str] = []
    for location_id, drafts in drafts_by_location.items():
        if not drafts:
            continue
        event = _create_preprocess_event(
            db,
            world_id=world_id,
            session_id=synthetic_session.id,
            turn_id=synthetic_turn.id,
            source_actor_id=source_actor.id,
            location_id=None if location_id == "__world__" else location_id,
            event_type="pack.preprocessed.world" if location_id == "__world__" else "pack.preprocessed.location",
            narrative=f"Pack preprocess materialized {len(drafts)} public knowledge entries.",
            payload={
                "origin": "pack_preprocess",
                "pack_id": pack_id,
                "world_template_id": world_template_id,
                "preprocess_run_id": preprocess_run_id,
                "pack_content_hash": content_hash,
            },
        )
        event_ids.append(event.id)
        created_memories = memory_service.materialize_memories(
            db,
            world_id=world_id,
            source_event_id=event.id,
            drafts=drafts,
            location_id=None if location_id == "__world__" else location_id,
        )
        memory_ids.extend(memory.id for memory in created_memories)
        outbox = OutboxEvent(
            id=new_id(),
            world_id=world_id,
            event_id=event.id,
            projection_type="world_graph.pack_preprocess",
            status="pending",
            payload={
                "world_id": world_id,
                "origin": "pack_preprocess",
                "pack_id": pack_id,
                "world_template_id": world_template_id,
                "preprocess_run_id": preprocess_run_id,
            },
        )
        db.add(outbox)
        outbox_ids.append(outbox.id)
    db.flush()

    if memory_ids:
        memory_service.process_pending(db, world_id=world_id, limit=max(len(memory_ids), 1))
    not_ready = int(
        db.execute(
            select(func.count(Memory.id)).where(
                Memory.id.in_(memory_ids),
                Memory.embedding_status != "ready",
            )
        ).scalar_one()
    ) if memory_ids else 0
    if not_ready:
        raise RuntimeError(f"Pack preprocess left {not_ready} memories without ready embeddings")

    if outbox_ids:
        projection_service.process_pending(db, world_id=world_id, limit=len(outbox_ids))
    failed_outboxes = list(
        db.execute(
            select(OutboxEvent).where(
                OutboxEvent.id.in_(outbox_ids),
                OutboxEvent.status != "projected",
            )
        ).scalars()
    ) if outbox_ids else []
    if failed_outboxes:
        summary = "; ".join(f"{item.id}:{item.status}:{item.last_error or ''}" for item in failed_outboxes[:3])
        raise RuntimeError(f"Pack preprocess graph projection did not complete: {summary}")

    projection_count = int(
        db.execute(
            select(func.count(ProjectionRecord.id)).where(ProjectionRecord.outbox_event_id.in_(outbox_ids))
        ).scalar_one()
    ) if outbox_ids else 0
    db.flush()
    return {
        "worlds": 1,
        "locations": len(locations_by_key),
        "routes": len(routes_by_key),
        "actors": len(npcs) + 1,
        "world_axes": int(shared_counts.get("axis_count") or 0),
        "factions": int(shared_counts.get("faction_count") or 0),
        "quest_templates": quest_template_count,
        "memories": len(memory_ids),
        "events": len(event_ids),
        "outbox_events": len(outbox_ids),
        "projection_records": projection_count,
    }


def _pack_memory_drafts(
    *,
    pack: Any,
    template: Any,
    world_id: str,
    locations_by_key: dict[str, Location],
    routes_by_key: dict[str, Any],
    npcs: list[Actor],
) -> dict[str, list[dict[str, Any]]]:
    del world_id
    location_id_by_key = {key: location.id for key, location in locations_by_key.items()}
    npc_by_name = {actor.display_name: actor for actor in npcs}
    drafts: dict[str, list[dict[str, Any]]] = defaultdict(list)

    drafts["__world__"].append(
        {
            "scope": "world",
            "text": (
                f"World pack: {pack.manifest.display_name}. "
                f"Template: {template.display_name}. {template.summary}"
            ).strip(),
            "salience": 0.82,
        }
    )
    for axis in template.world_axes:
        drafts["__world__"].append(
            {
                "scope": "world",
                "text": f"World axis {axis.display_name}: {axis.description}",
                "salience": 0.74,
            }
        )
    for faction in template.factions:
        drafts["__world__"].append(
            {
                "scope": "world",
                "text": f"Faction {faction.name}: {faction.description} Policy: {faction.policy}",
                "salience": 0.76,
            }
        )
    for entry in pack.localization.glossary:
        drafts["__world__"].append(
            {
                "scope": "world",
                "text": f"Glossary {entry.target_language}: {entry.source_text} = {entry.localized_text}",
                "salience": 0.66,
            }
        )
    for quest in [item for item in (template.quest, template.followup_quest) if item is not None]:
        drafts["__world__"].append(
            {
                "scope": "world",
                "text": f"Quest {quest.title}: {quest.description}",
                "salience": 0.78,
            }
        )

    for location_key, seed in template.locations.items():
        location_id = location_id_by_key.get(location_key)
        if location_id is None:
            continue
        aliases = [
            alias
            for language_aliases in (seed.public_aliases or {}).values()
            for alias in language_aliases
        ]
        details = [
            f"Location {seed.name}: {seed.description}",
            f"Facilities: {', '.join(seed.facilities)}" if seed.facilities else "",
            f"Aliases: {', '.join(aliases)}" if aliases else "",
            f"Rumors: {', '.join(seed.rumor_surface)}" if seed.rumor_surface else "",
        ]
        drafts[location_id].append(
            {
                "scope": "location",
                "location_id": location_id,
                "text": " ".join(part for part in details if part),
                "salience": 0.9 if seed.starter else 0.84,
            }
        )

    for route in routes_by_key.values():
        location = next((item for item in locations_by_key.values() if item.id == route.from_location_id), None)
        if location is None:
            continue
        destination = next((item for item in locations_by_key.values() if item.id == route.to_location_id), None)
        destination_name = destination.name if destination is not None else route.to_location_id
        drafts[location.id].append(
            {
                "scope": "location",
                "location_id": location.id,
                "text": f"Route from {location.name} to {destination_name} [{route.status}]: {route.travel_summary or route.status}",
                "salience": 0.8,
            }
        )

    for seed in pack.npcs:
        actor = npc_by_name.get(seed.display_name)
        location_id = location_id_by_key.get(seed.home_location_key)
        if actor is None or location_id is None:
            continue
        goals = "; ".join(f"{key}: {value}" for key, value in seed.goals.items())
        drafts[location_id].append(
            {
                "scope": "actor",
                "actor_id": actor.id,
                "location_id": location_id,
                "text": f"NPC {seed.display_name}: {seed.personality}. Goals: {goals}",
                "salience": 0.86,
            }
        )
    return drafts


def _cleanup_existing_pack_preprocess_artifacts(
    db: Session,
    *,
    world_id: str,
    pack_id: str,
    world_template_id: str,
) -> None:
    events = [
        event
        for event in db.execute(
            select(Event).where(
                Event.world_id == world_id,
                Event.event_type.in_(PACK_PREPROCESS_EVENT_TYPES),
            )
        ).scalars()
        if (event.payload or {}).get("pack_id") == pack_id
        and (event.payload or {}).get("world_template_id") == world_template_id
    ]
    if not events:
        return
    event_ids = [event.id for event in events]
    turn_ids = sorted({event.turn_id for event in events})
    session_ids = sorted({event.session_id for event in events})
    outbox_ids = list(
        db.execute(select(OutboxEvent.id).where(OutboxEvent.world_id == world_id, OutboxEvent.event_id.in_(event_ids))).scalars()
    )
    if outbox_ids:
        db.execute(delete(ProjectionRecord).where(ProjectionRecord.outbox_event_id.in_(outbox_ids)))
        db.execute(delete(OutboxEvent).where(OutboxEvent.id.in_(outbox_ids)))
    db.execute(delete(Memory).where(Memory.world_id == world_id, Memory.source_event_id.in_(event_ids)))
    db.execute(delete(WorldTimelineEntry).where(WorldTimelineEntry.world_id == world_id, WorldTimelineEntry.source_event_id.in_(event_ids)))
    db.execute(delete(Event).where(Event.world_id == world_id, Event.id.in_(event_ids)))
    if turn_ids:
        db.execute(delete(Turn).where(Turn.world_id == world_id, Turn.id.in_(turn_ids)))
    if session_ids:
        db.execute(delete(GameSession).where(GameSession.world_id == world_id, GameSession.id.in_(session_ids)))
    db.flush()


def _ensure_preprocess_actor(
    db: Session,
    *,
    world_id: str,
    locations_by_key: dict[str, Location],
) -> Actor:
    entity_key = pack_seed_entity_key("system_actor", "pack_preprocess")
    actor = db.execute(
        select(Actor).where(Actor.world_id == world_id, Actor.entity_key == entity_key)
    ).scalar_one_or_none()
    location = next((item for item in locations_by_key.values() if (item.state or {}).get("kind") == "starter"), None)
    if location is None:
        location = next(iter(locations_by_key.values()))
    if actor is not None:
        actor.current_location_id = location.id
        db.flush()
        return actor
    actor = Actor(
        id=new_id(),
        world_id=world_id,
        current_location_id=location.id,
        actor_type="system",
        display_name="Pack Preprocess System",
        status="active",
        entity_key=entity_key,
        origin_kind="system",
        origin_ref="pack_preprocess",
        visibility_scope="internal",
    )
    db.add(actor)
    db.flush()
    return actor


def _create_preprocess_event(
    db: Session,
    *,
    world_id: str,
    session_id: str,
    turn_id: str,
    source_actor_id: str,
    location_id: str | None,
    event_type: str,
    narrative: str,
    payload: dict[str, Any],
) -> Event:
    event = Event(
        id=new_id(),
        world_id=world_id,
        session_id=session_id,
        turn_id=turn_id,
        event_type=event_type,
        source_actor_id=source_actor_id,
        location_id=location_id,
        payload=payload,
        narrative=narrative,
        occurred_at=_now(),
    )
    db.add(event)
    db.flush()
    canonicalize_event(
        db,
        event,
        entry_kind="pack_preprocess",
        scope_kind="world",
        affected_location_ids=[location_id] if location_id else [],
        narrative_constraint="Pack content was materialized before publication.",
        payload=payload,
    )
    return event


def _update_world_preprocess_state(
    world: World,
    *,
    preprocess_run_id: str,
    content_hash: str,
) -> None:
    state = dict(world.state or {})
    state["pack_preprocess"] = {
        "run_id": preprocess_run_id,
        "pack_content_hash": content_hash,
        "updated_at": _now().isoformat(),
    }
    world.state = state


def _now() -> datetime:
    return datetime.now(timezone.utc)
