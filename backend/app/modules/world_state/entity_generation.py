from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.entities import Actor, Faction, Location, LocationRoute, WorldResourceLock, route_id
from app.modules.world_pack.service import resolve_world_pack


GeneratedEntityType = Literal["npc", "location", "community"]
GeneratedOriginKind = Literal["pack_seed", "archetype_generated", "freeform_generated"]
NPC_PERSONAL_NAMES = ("Kanata", "Mio", "Riku", "Sena", "Iori", "Towa", "Akari", "Ren")


def pack_scoped_entity_id(world_id: str, base_id: str) -> str:
    return f"{world_id}:{base_id}"


@dataclass(frozen=True)
class MaterializedEntity:
    entity_type: GeneratedEntityType
    entity_id: str
    entity_key: str
    display_name: str
    origin_kind: str
    created: bool

    def payload(self) -> dict[str, Any]:
        return {
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "entity_key": self.entity_key,
            "display_name": self.display_name,
            "origin_kind": self.origin_kind,
            "created": self.created,
        }


def normalize_entity_key_part(value: object) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9ぁ-んァ-ン一-龥ー]+", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    if text:
        return text[:80]
    return hashlib.sha1(str(value or "generated").encode("utf-8")).hexdigest()[:16]


def generated_entity_key(
    *,
    entity_type: GeneratedEntityType,
    semantic_key_hint: object,
    archetype_id: object = "",
    location_key: object = "",
    community_id: object = "",
) -> str:
    semantic = normalize_entity_key_part(semantic_key_hint)
    context = ":".join(
        part
        for part in (
            normalize_entity_key_part(archetype_id),
            normalize_entity_key_part(location_key),
            normalize_entity_key_part(community_id),
        )
        if part
    )
    return f"{entity_type}:{context + ':' if context else ''}{semantic}"[:160]


def pack_seed_entity_key(entity_type: GeneratedEntityType, base_id: str) -> str:
    return f"{entity_type}:pack:{normalize_entity_key_part(base_id)}"


def _stable_npc_personal_name(entity_key: str, archetype_id: str) -> str:
    if archetype_id == "nexus_entry_liaison" or "nexus_entry_liaison" in entity_key:
        return "Kanata"
    digest = hashlib.sha1(entity_key.encode("utf-8")).hexdigest()
    return NPC_PERSONAL_NAMES[int(digest[:2], 16) % len(NPC_PERSONAL_NAMES)]


def _generated_npc_display_name(display_name: str, *, entity_key: str, archetype_id: str) -> str:
    base = display_name.strip() or "Generated NPC"
    if any(base.endswith(f" {name}") or base.endswith(name) for name in NPC_PERSONAL_NAMES):
        return base[:120]
    return f"{base} {_stable_npc_personal_name(entity_key, archetype_id)}"[:120]


def active_resource_locked(db: Session, *, world_id: str, resource_type: str, resource_id: str) -> bool:
    now = datetime.now(timezone.utc)
    return (
        db.execute(
            select(WorldResourceLock)
            .where(
                WorldResourceLock.world_id == world_id,
                WorldResourceLock.resource_type == resource_type,
                WorldResourceLock.resource_id == resource_id,
                WorldResourceLock.status == "active",
                WorldResourceLock.expires_at > now,
            )
            .limit(1)
        ).scalar_one_or_none()
        is not None
    )


def _archetype(template: Any, *, entity_type: str, archetype_id: str | None) -> Any | None:
    if not archetype_id:
        return None
    collections = {
        "npc": template.npc_archetypes,
        "location": template.location_archetypes,
        "community": template.community_archetypes,
    }
    return next((item for item in collections.get(entity_type, []) if item.id == archetype_id), None)


def _location_by_key(db: Session, world_id: str, location_key: str | None) -> Location | None:
    if not location_key:
        return None
    from app.modules.world_state.service import get_location_by_key

    return get_location_by_key(db, world_id, location_key)


def _metadata(
    *,
    entity_key: str,
    origin_kind: GeneratedOriginKind,
    origin_ref: str,
    session_id: str | None,
    actor_id: str | None,
    source_event_id: str | None,
) -> dict[str, Any]:
    return {
        "entity_key": entity_key,
        "origin_kind": origin_kind,
        "origin_ref": origin_ref,
        "visibility_scope": "world",
        "first_seen_session_id": session_id,
        "first_seen_actor_id": actor_id,
        "source_event_id": source_event_id,
    }


def _set_missing_metadata(row: Any, metadata: dict[str, Any]) -> None:
    for key, value in metadata.items():
        if key in {"first_seen_session_id", "first_seen_actor_id", "source_event_id"}:
            if getattr(row, key) is None and value is not None:
                setattr(row, key, value)
        elif not str(getattr(row, key, "") or "").strip() and value is not None:
                setattr(row, key, value)


def _alternate_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    suffix = hashlib.sha1(f"{metadata}:{datetime.now(timezone.utc).timestamp()}".encode("utf-8")).hexdigest()[:8]
    alternate = dict(metadata)
    alternate["entity_key"] = f"{metadata['entity_key']}:alt:{suffix}"[:160]
    return alternate


def materialize_entity_drafts(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    session_id: str | None,
    source_event_id: str,
    current_location_id: str | None,
    drafts: list[dict[str, Any]] | None,
) -> list[MaterializedEntity]:
    results: list[MaterializedEntity] = []
    for raw_draft in drafts or []:
        if not isinstance(raw_draft, dict):
            continue
        entity_type = str(raw_draft.get("entity_type") or "").strip()
        if entity_type not in {"npc", "location", "community"}:
            continue
        result = materialize_entity_draft(
            db,
            world_id=world_id,
            actor_id=actor_id,
            session_id=session_id,
            source_event_id=source_event_id,
            current_location_id=current_location_id,
            draft=raw_draft,
        )
        if result is not None:
            results.append(result)
    return results


def materialize_entity_draft(
    db: Session,
    *,
    world_id: str,
    actor_id: str | None,
    session_id: str | None,
    source_event_id: str | None,
    current_location_id: str | None,
    draft: dict[str, Any],
) -> MaterializedEntity | None:
    entity_type = str(draft.get("entity_type") or "").strip()
    if entity_type not in {"npc", "location", "community"}:
        return None
    _, template = resolve_world_pack(db, world_id)
    archetype_id = str(draft.get("archetype_id") or "").strip()
    archetype = _archetype(template, entity_type=entity_type, archetype_id=archetype_id)
    origin_kind: GeneratedOriginKind = "archetype_generated" if archetype is not None else "freeform_generated"
    origin_ref = archetype_id if archetype is not None else "freeform"
    display_name = str(draft.get("display_name") or "").strip()
    if not display_name and archetype is not None:
        display_name = str(archetype.display_name)
    if not display_name:
        display_name = "Generated Entity"
    description = str(draft.get("description") or "").strip()
    if not description and archetype is not None:
        description = str(archetype.description or "")
    semantic_key_hint = str(draft.get("semantic_key_hint") or display_name)
    location_key = str(draft.get("location_key") or "").strip()
    community_id = str(draft.get("community_id") or "").strip()
    if archetype is not None:
        location_key = location_key or str(archetype.default_location_key or "")
        community_id = community_id or str(archetype.default_community_id or "")
    entity_key = generated_entity_key(
        entity_type=entity_type,  # type: ignore[arg-type]
        semantic_key_hint=semantic_key_hint,
        archetype_id=archetype_id,
        location_key=location_key,
        community_id=community_id,
    )
    if entity_type == "npc":
        display_name = _generated_npc_display_name(display_name, entity_key=entity_key, archetype_id=archetype_id)
    metadata = _metadata(
        entity_key=entity_key,
        origin_kind=origin_kind,
        origin_ref=origin_ref,
        session_id=session_id,
        actor_id=actor_id,
        source_event_id=source_event_id,
    )
    if entity_type == "npc":
        return _materialize_npc(
            db,
            world_id=world_id,
            display_name=display_name,
            description=description,
            location_key=location_key,
            community_id=community_id,
            metadata=metadata,
        )
    if entity_type == "location":
        return _materialize_location(
            db,
            world_id=world_id,
            display_name=display_name,
            description=description,
            location_key=location_key,
            community_id=community_id,
            current_location_id=current_location_id,
            metadata=metadata,
        )
    return _materialize_community(
        db,
        world_id=world_id,
        display_name=display_name,
        description=description,
        location_key=location_key,
        metadata=metadata,
    )


def _materialize_npc(
    db: Session,
    *,
    world_id: str,
    display_name: str,
    description: str,
    location_key: str,
    community_id: str,
    metadata: dict[str, Any],
) -> MaterializedEntity:
    existing = db.execute(
        select(Actor).where(Actor.world_id == world_id, Actor.entity_key == metadata["entity_key"])
    ).scalar_one_or_none()
    if existing is not None and not active_resource_locked(db, world_id=world_id, resource_type="npc", resource_id=existing.id):
        _set_missing_metadata(existing, metadata)
        db.flush()
        return MaterializedEntity("npc", existing.id, metadata["entity_key"], existing.display_name, existing.origin_kind, False)

    if existing is not None:
        metadata = _alternate_metadata(metadata)
    suffix = "" if existing is None else f" {hashlib.sha1(str(metadata).encode('utf-8')).hexdigest()[:4]}"
    location = _location_by_key(db, world_id, location_key)
    actor = Actor(
        world_id=world_id,
        actor_type="npc",
        current_location_id=location.id if location is not None else None,
        display_name=(display_name + suffix)[:120],
        status="active",
        **metadata,
    )
    db.add(actor)
    db.flush()
    from app.models.entities import NPCProfile

    db.add(
        NPCProfile(
            actor_id=actor.id,
            world_id=world_id,
            personality=description or "situational and grounded in the current community",
            goals={"community_id": community_id} if community_id else {},
            routine_state={
                "routine_role": metadata["origin_ref"],
                "beat_state": "observe",
                "attention_target_actor_id": None,
                "last_ambient_turn_id": None,
                "last_idle_tick_id": None,
                "rumor_focus": description,
                "tension_band": "medium",
                "home_location_id": location.id if location is not None else None,
                "active_location_id": location.id if location is not None else None,
            },
        )
    )
    db.flush()
    return MaterializedEntity("npc", actor.id, metadata["entity_key"], actor.display_name, actor.origin_kind, True)


def _generated_location_id(world_id: str, entity_key: str) -> str:
    digest = hashlib.sha1(f"{world_id}:{entity_key}".encode("utf-8")).hexdigest()[:16]
    return f"loc-{digest}"


def _generated_community_id(world_id: str, entity_key: str) -> str:
    digest = hashlib.sha1(f"{world_id}:{entity_key}".encode("utf-8")).hexdigest()[:16]
    return pack_scoped_entity_id(world_id, f"community-{digest}")


def _materialize_location(
    db: Session,
    *,
    world_id: str,
    display_name: str,
    description: str,
    location_key: str,
    community_id: str,
    current_location_id: str | None,
    metadata: dict[str, Any],
) -> MaterializedEntity:
    existing = db.execute(
        select(Location).where(Location.world_id == world_id, Location.entity_key == metadata["entity_key"])
    ).scalar_one_or_none()
    if existing is not None and not active_resource_locked(db, world_id=world_id, resource_type="location", resource_id=existing.id):
        _set_missing_metadata(existing, metadata)
        db.flush()
        return MaterializedEntity("location", existing.id, metadata["entity_key"], existing.name, existing.origin_kind, False)

    if existing is not None:
        metadata = _alternate_metadata(metadata)
    location_id = _generated_location_id(world_id, metadata["entity_key"])
    state = {
        "kind": "generated",
        "key": location_key or normalize_entity_key_part(display_name),
        "community_id": community_id,
        "generated": True,
        "public_state": {},
    }
    location = Location(
        id=location_id,
        world_id=world_id,
        name=display_name[:120],
        description=description,
        state=state,
        **metadata,
    )
    db.add(location)
    db.flush()
    if current_location_id and current_location_id != location.id:
        route_key = f"generated_{normalize_entity_key_part(display_name)}"
        existing_route = db.execute(
            select(LocationRoute).where(LocationRoute.world_id == world_id, LocationRoute.route_key == route_key)
        ).scalar_one_or_none()
        if existing_route is None:
            db.add(
                LocationRoute(
                    id=route_id(world_id, route_key),
                    world_id=world_id,
                    from_location_id=current_location_id,
                    to_location_id=location.id,
                    route_key=route_key,
                    status="open",
                    travel_summary=f"A newly discovered route leads toward {display_name}.",
                    unlock_requirements_json={"origin_kind": metadata["origin_kind"], "generated": True},
                )
            )
            db.flush()
    return MaterializedEntity("location", location.id, metadata["entity_key"], location.name, location.origin_kind, True)


def _materialize_community(
    db: Session,
    *,
    world_id: str,
    display_name: str,
    description: str,
    location_key: str,
    metadata: dict[str, Any],
) -> MaterializedEntity:
    existing = db.execute(
        select(Faction).where(Faction.world_id == world_id, Faction.entity_key == metadata["entity_key"])
    ).scalar_one_or_none()
    if existing is not None and not active_resource_locked(db, world_id=world_id, resource_type="faction", resource_id=existing.id):
        _set_missing_metadata(existing, metadata)
        db.flush()
        return MaterializedEntity("community", existing.id, metadata["entity_key"], existing.name, existing.origin_kind, False)

    if existing is not None:
        metadata = _alternate_metadata(metadata)
    faction_id = _generated_community_id(world_id, metadata["entity_key"])
    pack_faction_id = f"generated_{hashlib.sha1(metadata['entity_key'].encode('utf-8')).hexdigest()[:16]}"
    state = {
        "pack_faction_id": pack_faction_id,
        "community_generated": True,
        "location_keys": [location_key] if location_key else [],
        "policy": description,
        "relationships": {},
        "world_axis_interests": {},
        "influence": 0.0,
    }
    faction = Faction(
        id=faction_id,
        world_id=world_id,
        name=display_name[:120],
        description=description,
        status="active",
        state=state,
        **metadata,
    )
    try:
        with db.begin_nested():
            db.add(faction)
            db.flush()
    except IntegrityError:
        faction = db.execute(select(Faction).where(Faction.world_id == world_id, Faction.id == faction_id)).scalar_one()
    return MaterializedEntity("community", faction.id, metadata["entity_key"], faction.name, faction.origin_kind, True)
