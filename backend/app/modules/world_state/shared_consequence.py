from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    Actor,
    ActorTitleProgress,
    Event,
    Faction,
    FactionStanding,
    Location,
    Memory,
    Relationship,
    SharedConsequenceApplication,
    SharedHistoryRecord,
    WorldAxisState,
)
from app.modules.actor.service import adjust_relationship_strength
from app.modules.world_memory.service import MemoryService
from app.modules.world_pack.service import PackConsequenceRule, SharedWorldActionTag, resolve_world_pack
from app.modules.world_state.rules import standing_band


ACTION_TAG_VALUES = {
    "help",
    "harm",
    "investigate",
    "trade",
    "negotiate",
    "protect",
    "explore",
    "restore",
    "destabilize",
    "none",
}


@dataclass(frozen=True)
class SharedConsequenceResult:
    action_tag: str
    applied_rule_ids: list[str] = field(default_factory=list)
    axis_updates: list[dict[str, Any]] = field(default_factory=list)
    faction_updates: list[dict[str, Any]] = field(default_factory=list)
    location_updates: list[dict[str, Any]] = field(default_factory=list)
    relationship_updates: list[dict[str, Any]] = field(default_factory=list)
    history_records: list[dict[str, Any]] = field(default_factory=list)
    title_progress: list[dict[str, Any]] = field(default_factory=list)
    memories: list[Memory] = field(default_factory=list)

    def payload(self) -> dict[str, Any]:
        return {
            "shared_action_tag": self.action_tag,
            "applied_rule_ids": list(self.applied_rule_ids),
            "axis_updates": list(self.axis_updates),
            "faction_updates": list(self.faction_updates),
            "location_updates": list(self.location_updates),
            "relationship_updates": list(self.relationship_updates),
            "history_records": list(self.history_records),
            "title_progress": list(self.title_progress),
            "memory_ids": [memory.id for memory in self.memories],
        }


def pack_scoped_entity_id(world_id: str, base_id: str) -> str:
    return f"{world_id}:{base_id}"


def resolve_shared_action_tag(
    *,
    explicit_action_tag: str | None = None,
    world_tags: list[str] | None = None,
    consequence_tags: list[str] | None = None,
    action_kind: str | None = None,
    fail_forward: bool = False,
) -> SharedWorldActionTag:
    candidate = str(explicit_action_tag or "").strip()
    if candidate in ACTION_TAG_VALUES and candidate != "none":
        return candidate  # type: ignore[return-value]

    world_tag_set = {str(tag) for tag in world_tags or []}
    consequence_tag_set = {str(tag) for tag in consequence_tags or []}
    resolved_action_kind = str(action_kind or "").strip()

    if fail_forward or "threaten_local" in world_tag_set or "overreach" in consequence_tag_set:
        return "destabilize"
    if resolved_action_kind == "travel":
        return "explore"
    if resolved_action_kind == "use_reward_item" or "collect_reward" in world_tag_set:
        return "protect"
    if "promise_followup" in world_tag_set or "kept_promise" in consequence_tag_set:
        return "protect"
    if "investigate" in world_tag_set or "careful_observation" in consequence_tag_set:
        return "investigate"
    if "aid_local" in world_tag_set or "earned_trust" in consequence_tag_set:
        return "help"
    return "none"


def ensure_shared_world_seed(db: Session, *, world_id: str, actor_id: str | None = None) -> dict[str, Any]:
    _, template = resolve_world_pack(db, world_id)
    locations = _locations_by_pack_key(db, world_id)

    axis_count = 0
    for axis in template.world_axes:
        state = db.execute(
            select(WorldAxisState).where(WorldAxisState.world_id == world_id, WorldAxisState.axis_id == axis.id)
        ).scalar_one_or_none()
        thresholds = [threshold.model_dump() for threshold in axis.thresholds]
        if state is None:
            state = WorldAxisState(
                world_id=world_id,
                axis_id=axis.id,
                display_name=axis.display_name,
                description=axis.description,
                min_value=axis.min_value,
                max_value=axis.max_value,
                current_value=axis.initial_value,
                expose_to_session_context=axis.expose_to_session_context,
                thresholds=thresholds,
            )
            db.add(state)
        else:
            state.display_name = axis.display_name
            state.description = axis.description
            state.min_value = axis.min_value
            state.max_value = axis.max_value
            state.current_value = _clamp(state.current_value, axis.min_value, axis.max_value)
            state.expose_to_session_context = axis.expose_to_session_context
            state.thresholds = thresholds
        axis_count += 1

    for location_key, seed in template.locations.items():
        location = locations.get(location_key)
        if location is None:
            continue
        state = dict(location.state or {})
        public_state = dict(state.get("public_state") or {})
        for key, value in dict(seed.public_state or {}).items():
            public_state.setdefault(str(key), value)
        state.update(
            {
                "key": location_key,
                "hierarchy": seed.hierarchy,
                "region": seed.region,
                "kind": seed.kind or state.get("kind") or ("starter" if seed.starter else "district"),
                "danger_level": seed.danger_level,
                "facilities": list(seed.facilities),
                "public_state": public_state,
                "discovery": dict(seed.discovery or {}),
                "related_factions": list(seed.related_factions),
                "related_world_axes": list(seed.related_world_axes),
                "rumor_surface": list(seed.rumor_surface),
            }
        )
        location.state = state

    npcs_by_name = _npcs_by_name(db, world_id)
    faction_count = 0
    for faction_seed in template.factions:
        faction_id = pack_scoped_entity_id(world_id, faction_seed.id)
        faction = db.execute(
            select(Faction).where(Faction.world_id == world_id, Faction.id == faction_id)
        ).scalar_one_or_none()
        state_payload = {
            **dict(faction_seed.state or {}),
            "pack_faction_id": faction_seed.id,
            "policy": faction_seed.policy,
            "influence_scope": list(faction_seed.influence_scope),
            "relationships": {
                pack_scoped_entity_id(world_id, key): value for key, value in faction_seed.relationships.items()
            },
            "world_axis_interests": dict(faction_seed.world_axis_interests),
            "location_keys": list(faction_seed.location_keys),
            "npc_names": list(faction_seed.npc_names),
            "influence": float((faction.state or {}).get("influence") or 0.0) if faction is not None else 0.0,
        }
        if faction is None:
            faction = Faction(
                id=faction_id,
                world_id=world_id,
                name=faction_seed.name,
                description=faction_seed.description,
                state=state_payload,
            )
            db.add(faction)
        else:
            faction.name = faction_seed.name
            faction.description = faction_seed.description
            faction.state = state_payload
        faction_count += 1

        for npc_name in faction_seed.npc_names:
            npc = npcs_by_name.get(npc_name)
            if npc is None:
                continue
            _ensure_membership_relationship(db, world_id=world_id, actor_id=npc.id, faction_id=faction_id)

        if actor_id is not None:
            _ensure_actor_faction_standing(
                db,
                world_id=world_id,
                actor_id=actor_id,
                faction_id=faction_id,
                initial_standing=faction_seed.initial_standing,
            )

    db.flush()
    return {"axis_count": axis_count, "faction_count": faction_count}


def apply_shared_consequence_rules(
    db: Session,
    *,
    memory_service: MemoryService,
    world_id: str,
    actor_id: str,
    location_id: str | None,
    source_event_id: str,
    world_tags: list[str] | None,
    consequence_tags: list[str] | None,
    action_kind: str,
    explicit_action_tag: str | None = None,
    interpreted_intent: dict[str, Any] | None = None,
    fail_forward: bool = False,
) -> SharedConsequenceResult:
    ensure_shared_world_seed(db, world_id=world_id, actor_id=actor_id)
    action_tag = resolve_shared_action_tag(
        explicit_action_tag=explicit_action_tag,
        world_tags=world_tags,
        consequence_tags=consequence_tags,
        action_kind=action_kind,
        fail_forward=fail_forward,
    )
    if action_tag == "none":
        return SharedConsequenceResult(action_tag=action_tag)

    _, template = resolve_world_pack(db, world_id)
    outcome_tag_set = _outcome_tag_set(consequence_tags, interpreted_intent)
    candidate_rules = [
        rule
        for rule in template.consequence_rules
        if rule.action_tag == action_tag and (not rule.outcome_tags or bool(set(rule.outcome_tags) & outcome_tag_set))
    ]
    if not candidate_rules:
        return SharedConsequenceResult(action_tag=action_tag)

    event = db.execute(select(Event).where(Event.world_id == world_id, Event.id == source_event_id)).scalar_one()
    locations = _locations_by_pack_key(db, world_id)
    npcs_by_name = _npcs_by_name(db, world_id)

    applied_rule_ids: list[str] = []
    axis_updates: list[dict[str, Any]] = []
    faction_updates: list[dict[str, Any]] = []
    location_updates: list[dict[str, Any]] = []
    relationship_updates: list[dict[str, Any]] = []
    history_records: list[dict[str, Any]] = []
    title_progress_updates: list[dict[str, Any]] = []
    created_memories: list[Memory] = []

    for rule in candidate_rules:
        existing = db.execute(
            select(SharedConsequenceApplication).where(
                SharedConsequenceApplication.world_id == world_id,
                SharedConsequenceApplication.source_event_id == source_event_id,
                SharedConsequenceApplication.rule_id == rule.id,
            )
        ).scalar_one_or_none()
        if existing is not None:
            continue

        axis_updates.extend(_apply_axis_deltas(db, world_id=world_id, source_event_id=source_event_id, rule=rule))
        faction_updates.extend(
            _apply_faction_deltas(db, world_id=world_id, actor_id=actor_id, source_event_id=source_event_id, rule=rule)
        )
        location_updates.extend(
            _apply_location_deltas(db, world_id=world_id, locations=locations, source_event_id=source_event_id, rule=rule)
        )
        relationship_updates.extend(
            _apply_relationship_deltas(
                db,
                world_id=world_id,
                actor_id=actor_id,
                npcs_by_name=npcs_by_name,
                rule=rule,
            )
        )
        created_memories.extend(
            _materialize_rule_memories(
                db,
                memory_service=memory_service,
                world_id=world_id,
                source_event_id=source_event_id,
                location_id=location_id,
                npcs_by_name=npcs_by_name,
                rule=rule,
            )
        )
        history_record = _create_history_candidate(
            db,
            world_id=world_id,
            actor_id=actor_id,
            location_id=location_id,
            event=event,
            rule=rule,
        )
        if history_record is not None:
            history_records.append(
                {
                    "id": history_record.id,
                    "history_rule_id": history_record.history_rule_id,
                    "level": history_record.level,
                    "status": history_record.status,
                    "summary": history_record.summary,
                }
            )
        title_progress_updates.extend(
            _apply_title_progress(
                db,
                world_id=world_id,
                actor_id=actor_id,
                source_event_id=source_event_id,
                rule=rule,
            )
        )

        db.add(
            SharedConsequenceApplication(
                world_id=world_id,
                source_event_id=source_event_id,
                rule_id=rule.id,
                action_tag=action_tag,
                payload={
                    "outcome_tags": list(outcome_tag_set),
                    "world_tags": list(world_tags or []),
                    "consequence_tags": list(consequence_tags or []),
                },
            )
        )
        applied_rule_ids.append(rule.id)

    db.flush()
    return SharedConsequenceResult(
        action_tag=action_tag,
        applied_rule_ids=applied_rule_ids,
        axis_updates=axis_updates,
        faction_updates=faction_updates,
        location_updates=location_updates,
        relationship_updates=relationship_updates,
        history_records=history_records,
        title_progress=title_progress_updates,
        memories=created_memories,
    )


def _outcome_tag_set(consequence_tags: list[str] | None, interpreted_intent: dict[str, Any] | None) -> set[str]:
    tags = {str(tag) for tag in consequence_tags or [] if str(tag)}
    if interpreted_intent:
        tags.update(str(tag) for tag in interpreted_intent.get("consequence_flags") or [] if str(tag))
        tags.update(str(tag) for tag in interpreted_intent.get("outcome_tags") or [] if str(tag))
    return tags


def _apply_axis_deltas(
    db: Session,
    *,
    world_id: str,
    source_event_id: str,
    rule: PackConsequenceRule,
) -> list[dict[str, Any]]:
    updates: list[dict[str, Any]] = []
    for axis_id, delta in rule.world_axis_deltas.items():
        axis = db.execute(
            select(WorldAxisState).where(WorldAxisState.world_id == world_id, WorldAxisState.axis_id == axis_id)
        ).scalar_one_or_none()
        if axis is None:
            continue
        before = float(axis.current_value)
        axis.current_value = _clamp(before + float(delta), axis.min_value, axis.max_value)
        axis.last_event_id = source_event_id
        updates.append({"axis_id": axis.axis_id, "delta": float(delta), "before": before, "after": axis.current_value})
    return updates


def _apply_faction_deltas(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    source_event_id: str,
    rule: PackConsequenceRule,
) -> list[dict[str, Any]]:
    updates: list[dict[str, Any]] = []
    for base_faction_id, delta in rule.faction_standing_deltas.items():
        faction_id = pack_scoped_entity_id(world_id, base_faction_id)
        standing = _ensure_actor_faction_standing(
            db,
            world_id=world_id,
            actor_id=actor_id,
            faction_id=faction_id,
            initial_standing=0.0,
        )
        before = float(standing.standing)
        standing.standing = _clamp(before + float(delta), -1.0, 1.0)
        standing.band = standing_band(standing.standing)
        updates.append(
            {
                "faction_id": faction_id,
                "pack_faction_id": base_faction_id,
                "delta": float(delta),
                "before": before,
                "after": standing.standing,
                "band": standing.band,
            }
        )
    for base_faction_id, delta in rule.faction_influence_deltas.items():
        faction_id = pack_scoped_entity_id(world_id, base_faction_id)
        faction = db.execute(select(Faction).where(Faction.world_id == world_id, Faction.id == faction_id)).scalar_one_or_none()
        if faction is None:
            continue
        state = dict(faction.state or {})
        before = float(state.get("influence") or 0.0)
        state["influence"] = round(before + float(delta), 3)
        state["last_influence_event_id"] = source_event_id
        faction.state = state
        updates.append(
            {
                "faction_id": faction_id,
                "pack_faction_id": base_faction_id,
                "influence_delta": float(delta),
                "influence_before": before,
                "influence_after": state["influence"],
            }
        )
    return updates


def _apply_location_deltas(
    db: Session,
    *,
    world_id: str,
    locations: dict[str, Location],
    source_event_id: str,
    rule: PackConsequenceRule,
) -> list[dict[str, Any]]:
    del db, world_id
    updates: list[dict[str, Any]] = []
    for location_key, deltas in rule.location_public_state_deltas.items():
        location = locations.get(location_key)
        if location is None:
            continue
        state = dict(location.state or {})
        public_state = dict(state.get("public_state") or {})
        changed: dict[str, Any] = {}
        for key, delta in deltas.items():
            before = public_state.get(key)
            if isinstance(before, (int, float)) and isinstance(delta, (int, float)):
                public_state[key] = before + delta
            else:
                public_state[key] = delta
            changed[key] = {"before": before, "after": public_state[key]}
        state["public_state"] = public_state
        state["last_public_state_event_id"] = source_event_id
        location.state = state
        updates.append({"location_key": location_key, "location_id": location.id, "changes": changed})
    return updates


def _apply_relationship_deltas(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    npcs_by_name: dict[str, Actor],
    rule: PackConsequenceRule,
) -> list[dict[str, Any]]:
    updates: list[dict[str, Any]] = []
    for raw_delta in rule.relationship_deltas:
        npc_name = _first_text(raw_delta, "npc_name", "target_npc_name", "counterpart_npc_name", "display_name")
        npc = npcs_by_name.get(npc_name)
        if npc is None:
            continue
        delta = float(raw_delta.get("delta") or raw_delta.get("strength_delta") or 0.0)
        relationship_type = str(raw_delta.get("relationship_type") or "KNOWS")
        relationship = adjust_relationship_strength(
            db,
            world_id=world_id,
            from_actor_id=actor_id,
            to_actor_id=npc.id,
            relationship_type=relationship_type,
            delta=delta,
            default_strength=0.55,
        )
        updates.append(
            {
                "actor_id": npc.id,
                "display_name": npc.display_name,
                "relationship_type": relationship.relationship_type,
                "delta": delta,
                "strength": relationship.strength,
            }
        )
    return updates


def _materialize_rule_memories(
    db: Session,
    *,
    memory_service: MemoryService,
    world_id: str,
    source_event_id: str,
    location_id: str | None,
    npcs_by_name: dict[str, Actor],
    rule: PackConsequenceRule,
) -> list[Memory]:
    drafts: list[dict[str, Any]] = []
    for raw_draft in rule.npc_memory_drafts:
        npc_name = _first_text(raw_draft, "npc_name", "target_npc_name", "display_name")
        npc = npcs_by_name.get(npc_name)
        text = str(raw_draft.get("text") or raw_draft.get("summary") or "").strip()
        if not text:
            continue
        scope = str(raw_draft.get("scope") or "actor").strip() or "actor"
        drafts.append(
            {
                "scope": scope,
                "text": text,
                "salience": float(raw_draft.get("salience") or 0.72),
                "actor_id": npc.id if scope == "actor" and npc is not None else None,
                "location_id": location_id,
            }
        )
    if rule.rumor_draft:
        drafts.append(
            {
                "scope": "location" if location_id else "world",
                "text": rule.rumor_draft,
                "salience": 0.7,
                "actor_id": None,
                "location_id": location_id,
            }
        )
    if not drafts:
        return []
    return memory_service.materialize_memories(
        db,
        world_id=world_id,
        source_event_id=source_event_id,
        location_id=location_id,
        drafts=drafts,
    )


def _create_history_candidate(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    location_id: str | None,
    event: Event,
    rule: PackConsequenceRule,
) -> SharedHistoryRecord | None:
    level = rule.history_candidate_level
    if level is None:
        return None
    history_rule_id = rule.history_rule_id or rule.id
    existing = db.execute(
        select(SharedHistoryRecord).where(
            SharedHistoryRecord.world_id == world_id,
            SharedHistoryRecord.source_event_id == event.id,
            SharedHistoryRecord.history_rule_id == history_rule_id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    record = SharedHistoryRecord(
        world_id=world_id,
        source_event_id=event.id,
        actor_id=actor_id,
        location_id=location_id,
        history_rule_id=history_rule_id,
        level=level,
        status="candidate",
        summary=rule.rumor_draft or event.narrative,
        salience=0.6,
        tags=list(rule.outcome_tags),
        payload={"consequence_rule_id": rule.id, "event_type": event.event_type},
    )
    db.add(record)
    db.flush()
    return record


def _apply_title_progress(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    source_event_id: str,
    rule: PackConsequenceRule,
) -> list[dict[str, Any]]:
    _, template = resolve_world_pack(db, world_id)
    title_rules = {title_rule.id: title_rule for title_rule in template.title_rules}
    updates: list[dict[str, Any]] = []
    for title_rule_id, delta in rule.title_progress_deltas.items():
        title_rule = title_rules.get(title_rule_id)
        if title_rule is None:
            continue
        progress = db.execute(
            select(ActorTitleProgress).where(
                ActorTitleProgress.world_id == world_id,
                ActorTitleProgress.actor_id == actor_id,
                ActorTitleProgress.title_rule_id == title_rule_id,
            )
        ).scalar_one_or_none()
        if progress is None:
            progress = ActorTitleProgress(
                world_id=world_id,
                actor_id=actor_id,
                title_rule_id=title_rule_id,
                display_name=title_rule.display_name,
                description=title_rule.description,
                progress=0.0,
                progress_target=title_rule.progress_target,
                status="in_progress",
                payload={},
            )
            db.add(progress)
            db.flush()
        before = float(progress.progress)
        progress.display_name = title_rule.display_name
        progress.description = title_rule.description
        progress.progress_target = title_rule.progress_target
        progress.progress = min(progress.progress_target, max(0.0, before + float(delta)))
        progress.status = "candidate" if progress.progress >= progress.progress_target else "in_progress"
        progress.source_event_id = source_event_id
        progress.payload = {"last_delta": float(delta), "consequence_rule_id": rule.id}
        updates.append(
            {
                "title_rule_id": title_rule_id,
                "display_name": progress.display_name,
                "delta": float(delta),
                "before": before,
                "after": progress.progress,
                "progress_target": progress.progress_target,
                "status": progress.status,
            }
        )
    return updates


def _locations_by_pack_key(db: Session, world_id: str) -> dict[str, Location]:
    locations = list(db.execute(select(Location).where(Location.world_id == world_id)).scalars())
    return {
        str((location.state or {}).get("key") or ""): location
        for location in locations
        if str((location.state or {}).get("key") or "")
    }


def _npcs_by_name(db: Session, world_id: str) -> dict[str, Actor]:
    return {
        actor.display_name: actor
        for actor in db.execute(
            select(Actor).where(Actor.world_id == world_id, Actor.actor_type == "npc").order_by(Actor.display_name.asc())
        ).scalars()
    }


def _ensure_actor_faction_standing(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    faction_id: str,
    initial_standing: float,
) -> FactionStanding:
    standing = db.execute(
        select(FactionStanding).where(
            FactionStanding.world_id == world_id,
            FactionStanding.actor_id == actor_id,
            FactionStanding.faction_id == faction_id,
        )
    ).scalar_one_or_none()
    if standing is not None:
        return standing
    standing = FactionStanding(
        world_id=world_id,
        actor_id=actor_id,
        faction_id=faction_id,
        standing=round(float(initial_standing), 3),
        band=standing_band(float(initial_standing)),
    )
    db.add(standing)
    db.flush()
    return standing


def _ensure_membership_relationship(db: Session, *, world_id: str, actor_id: str, faction_id: str) -> None:
    actor = db.execute(
        select(Actor).where(Actor.world_id == world_id, Actor.id == actor_id)
    ).scalar_one_or_none()
    if actor is None:
        return
    # Membership is projected from Relationship rows, but NPCs do not need a standing row.
    existing_relationship = db.execute(
        select(Relationship).where(
            Relationship.world_id == world_id,
            Relationship.from_actor_id == actor_id,
            Relationship.to_entity_id == faction_id,
            Relationship.relationship_type == "MEMBER_OF",
        )
    ).scalar_one_or_none()
    if existing_relationship is not None:
        existing_relationship.strength = 1.0
        return
    db.add(
        Relationship(
            world_id=world_id,
            from_actor_id=actor_id,
            to_entity_id=faction_id,
            to_actor_id=None,
            relationship_type="MEMBER_OF",
            strength=1.0,
        )
    )


def _first_text(payload: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = str(payload.get(key) or "").strip()
        if value:
            return value
    return ""


def _clamp(value: float, low: float, high: float) -> float:
    return round(max(float(low), min(float(high), float(value))), 3)
