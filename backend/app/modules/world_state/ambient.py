from __future__ import annotations

from contextlib import nullcontext
from dataclasses import dataclass
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.entities import (
    Actor,
    ConsequenceThread,
    Event,
    Location,
    LocationRoute,
    Memory,
    NPCProfile,
    OutboxEvent,
    Relationship,
    Session as GameSession,
    Turn,
    WorldTick,
)
from app.modules.actor.service import adjust_relationship_strength, normalize_play_language
from app.modules.llm_harness.service import CouncilRoleRun, ModelRouter, PromptExecutionOutcome
from app.modules.world_memory.service import MemoryService, build_retrieval_query_text
from app.modules.world_state.consequence import relationship_band, relationship_summary, thread_summary, thread_title
from app.modules.world_state.branch import BranchPressureEngine
from app.modules.world_state.scene import SceneFrameEngine


AmbientBeatKind = Literal["observe", "murmur", "reassure", "question", "withdraw"]
IdleBeatKind = Literal["observe", "murmur", "reassure", "question", "withdraw", "relocate"]


class AmbientMemoryManagerPayload(BaseModel):
    memory_summary: str = Field(min_length=1)
    focus_memories: list[str] = Field(default_factory=list)
    scene_summary: str = Field(min_length=1)
    rumor_focus: str = Field(min_length=1)


class AmbientNPCManagerPayload(BaseModel):
    beat_kind: Literal["observe", "murmur", "reassure", "question", "withdraw"]
    summary: str = Field(min_length=1)
    tension_band: Literal["low", "medium", "high"] = "medium"


class IdleNPCManagerPayload(BaseModel):
    beat_kind: Literal["observe", "murmur", "reassure", "question", "withdraw", "relocate"]
    summary: str = Field(min_length=1)
    tension_band: Literal["low", "medium", "high"] = "medium"
    target_route_key: str | None = None


class AmbientSafetyGuardPayload(BaseModel):
    approval_status: Literal["approved", "rejected"]
    reason: str = Field(min_length=1)
    violations: list[str] = Field(default_factory=list)


@dataclass(frozen=True)
class AmbientPassResult:
    updates: list[dict[str, Any]]
    recent_world_beats: list[str]
    scene_updates: list[dict[str, Any]]
    chapter_updates: list[dict[str, Any]]
    scene_summary: str
    role_runs: list[CouncilRoleRun]


@dataclass(frozen=True)
class IdleWorldPassResult:
    tick: WorldTick
    updates: list[dict[str, Any]]
    recent_offstage_beats: list[str]
    offstage_murmurs: list[str]
    npc_locations: list[dict[str, Any]]
    scene_updates: list[dict[str, Any]]
    scene_summary: str
    langfuse_status: str


@dataclass(frozen=True)
class _NPCParticipant:
    actor: Actor
    profile: NPCProfile


def _routine_state_with_defaults(profile: NPCProfile) -> dict[str, Any]:
    routine_state = dict(profile.routine_state or {})
    routine_state.setdefault("routine_role", "watcher")
    routine_state.setdefault("beat_state", "observe")
    routine_state.setdefault("attention_target_actor_id", None)
    routine_state.setdefault("last_ambient_turn_id", None)
    routine_state.setdefault("last_idle_tick_id", None)
    routine_state.setdefault("rumor_focus", "the current district")
    routine_state.setdefault("tension_band", "medium")
    routine_state.setdefault("home_location_id", None)
    routine_state.setdefault("active_location_id", None)
    return routine_state


def _ambient_event_rows(db: Session, world_id: str, location_id: str | None, *, limit: int = 12) -> list[tuple[Event, Actor | None]]:
    actor_alias = Actor
    stmt = (
        select(Event, actor_alias)
        .join(
            actor_alias,
            (actor_alias.id == Event.source_actor_id) & (actor_alias.world_id == Event.world_id),
            isouter=True,
        )
        .where(Event.world_id == world_id, Event.event_type.like("ambient.npc.%"))
        .order_by(Event.created_at.desc(), Event.id.desc())
        .limit(limit)
    )
    if location_id is not None:
        stmt = stmt.where(Event.location_id == location_id)
    return list(db.execute(stmt).all())


def _idle_event_rows(db: Session, world_id: str, *, limit: int = 20) -> list[tuple[Event, Actor | None]]:
    actor_alias = Actor
    stmt = (
        select(Event, actor_alias)
        .join(
            actor_alias,
            (actor_alias.id == Event.source_actor_id) & (actor_alias.world_id == Event.world_id),
            isouter=True,
        )
        .where(
            Event.world_id == world_id,
            or_(
                Event.event_type.like("idle.npc.%"),
                Event.event_type.in_(("npc.arrived", "npc.departed")),
            ),
        )
        .order_by(Event.created_at.desc(), Event.id.desc())
        .limit(limit)
    )
    return list(db.execute(stmt).all())


def list_recent_world_beats(db: Session, world_id: str, location_id: str | None) -> list[str]:
    beats: list[str] = []
    for event, actor in _ambient_event_rows(db, world_id, location_id):
        payload = event.payload or {}
        summary = str(payload.get("visible_summary") or event.narrative or "").strip()
        if not summary:
            continue
        if actor is not None and actor.display_name not in summary:
            summary = f"{actor.display_name}: {summary}"
        beats.append(summary)
        if len(beats) >= 3:
            break
    return beats


def list_ambient_murmurs(db: Session, world_id: str, location_id: str | None) -> list[str]:
    murmurs: list[str] = []
    for event, actor in _ambient_event_rows(db, world_id, location_id):
        payload = event.payload or {}
        beat_kind = str(payload.get("beat_kind") or "")
        if beat_kind not in {"murmur", "question"}:
            continue
        summary = str(payload.get("visible_summary") or event.narrative or "").strip()
        if not summary:
            continue
        if actor is not None and actor.display_name not in summary:
            summary = f"{actor.display_name}: {summary}"
        murmurs.append(summary)
        if len(murmurs) >= 3:
            break
    return murmurs


def list_recent_offstage_beats(db: Session, world_id: str, current_location_id: str | None) -> list[str]:
    beats: list[str] = []
    for event, actor in _idle_event_rows(db, world_id):
        if current_location_id is not None and event.location_id == current_location_id:
            continue
        payload = event.payload or {}
        summary = str(payload.get("visible_summary") or event.narrative or "").strip()
        if not summary:
            continue
        if actor is not None and actor.display_name not in summary:
            summary = f"{actor.display_name}: {summary}"
        beats.append(summary)
        if len(beats) >= 3:
            break
    return beats


def list_offstage_murmurs(db: Session, world_id: str, current_location_id: str | None) -> list[str]:
    murmurs: list[str] = []
    for event, actor in _idle_event_rows(db, world_id):
        if current_location_id is not None and event.location_id == current_location_id:
            continue
        payload = event.payload or {}
        if str(payload.get("beat_kind") or "") not in {"murmur", "question", "relocate"}:
            continue
        summary = str(payload.get("visible_summary") or event.narrative or "").strip()
        if not summary:
            continue
        if actor is not None and actor.display_name not in summary:
            summary = f"{actor.display_name}: {summary}"
        murmurs.append(summary)
        if len(murmurs) >= 3:
            break
    return murmurs


def list_local_figures(db: Session, world_id: str, actor_id: str, location_id: str | None) -> list[dict[str, Any]]:
    stmt = (
        select(Actor, NPCProfile)
        .join(NPCProfile, (NPCProfile.actor_id == Actor.id) & (NPCProfile.world_id == Actor.world_id))
        .where(Actor.world_id == world_id, Actor.actor_type == "npc")
        .order_by(Actor.created_at.asc(), Actor.id.asc())
    )
    if location_id is not None:
        stmt = stmt.where(Actor.current_location_id == location_id)
    rows = list(db.execute(stmt).all())
    summaries: list[dict[str, Any]] = []
    for npc, profile in rows:
        routine_state = _routine_state_with_defaults(profile)
        relationship = db.execute(
            select(Relationship).where(
                Relationship.world_id == world_id,
                Relationship.from_actor_id == actor_id,
                Relationship.to_actor_id == npc.id,
                Relationship.relationship_type == "KNOWS",
            )
        ).scalar_one_or_none()
        band = relationship_band(float(relationship.strength)) if relationship is not None else "neutral"
        routine_role = str(routine_state.get("routine_role") or "watcher")
        tension_band = str(routine_state.get("tension_band") or "medium")
        summaries.append(
            {
                "actor_id": npc.id,
                "display_name": npc.display_name,
                "summary": f"{npc.display_name} keeps to the local district as the {routine_role}, carrying a {tension_band} edge while the scene reads as {band}.",
            }
        )
    return summaries


def list_plaza_figures(db: Session, world_id: str, actor_id: str, location_id: str | None) -> list[dict[str, Any]]:
    return list_local_figures(db, world_id, actor_id, location_id)


def list_npc_locations(db: Session, world_id: str) -> list[dict[str, Any]]:
    rows = list(
        db.execute(
            select(Actor, NPCProfile, Location)
            .join(NPCProfile, (NPCProfile.actor_id == Actor.id) & (NPCProfile.world_id == Actor.world_id))
            .join(
                Location,
                (Location.id == Actor.current_location_id) & (Location.world_id == Actor.world_id),
                isouter=True,
            )
            .where(Actor.world_id == world_id, Actor.actor_type == "npc")
            .order_by(Actor.created_at.asc(), Actor.id.asc())
        ).all()
    )
    payload: list[dict[str, Any]] = []
    for actor, profile, location in rows:
        routine_state = _routine_state_with_defaults(profile)
        location_name = location.name if location is not None else "somewhere out of view"
        routine_role = str(routine_state.get("routine_role") or "watcher")
        beat_state = str(routine_state.get("beat_state") or "observe")
        payload.append(
            {
                "actor_id": actor.id,
                "display_name": actor.display_name,
                "location_id": actor.current_location_id,
                "location_name": location_name,
                "summary": (
                    f"{actor.display_name} is presently around {location_name}, moving like a {routine_role} "
                    f"with a {beat_state} kind of attention."
                ),
            }
        )
    return payload


def list_npc_routines_debug(db: Session, world_id: str) -> list[dict[str, Any]]:
    rows = list(
        db.execute(
            select(Actor, NPCProfile)
            .join(NPCProfile, (NPCProfile.actor_id == Actor.id) & (NPCProfile.world_id == Actor.world_id))
            .where(Actor.world_id == world_id, Actor.actor_type == "npc")
            .order_by(Actor.created_at.asc(), Actor.id.asc())
        ).all()
    )
    return [
        {
            "actor_id": actor.id,
            "display_name": actor.display_name,
            "location_id": actor.current_location_id,
            "routine_state": _routine_state_with_defaults(profile),
            "updated_at": profile.updated_at.isoformat(),
        }
        for actor, profile in rows
    ]


def list_ambient_beats_debug(db: Session, world_id: str) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for event, actor in _ambient_event_rows(db, world_id, None, limit=40):
        event_payload = event.payload or {}
        payload.append(
            {
                "event_id": event.id,
                "world_id": world_id,
                "turn_id": event.turn_id,
                "session_id": event.session_id,
                "beat_kind": event_payload.get("beat_kind"),
                "display_name": actor.display_name if actor is not None else None,
                "actor_id": actor.id if actor is not None else None,
                "visible_summary": event_payload.get("visible_summary"),
                "relationship_updates": event_payload.get("relationship_updates") or [],
                "consequence_updates": event_payload.get("consequence_updates") or [],
                "created_at": event.created_at.isoformat(),
            }
        )
    return payload


def list_world_ticks_debug(db: Session, world_id: str) -> list[dict[str, Any]]:
    ticks = list(
        db.execute(
            select(WorldTick)
            .where(WorldTick.world_id == world_id)
            .order_by(WorldTick.created_at.desc(), WorldTick.id.desc())
            .limit(40)
        ).scalars()
    )
    return [
        {
            "tick_id": tick.id,
            "world_id": tick.world_id,
            "tick_kind": tick.tick_kind,
            "status": tick.status,
            "seed_turn_id": tick.seed_turn_id,
            "location_id": tick.location_id,
            "summary": tick.summary,
            "created_at": tick.created_at.isoformat(),
            "started_at": tick.started_at.isoformat() if tick.started_at is not None else None,
            "completed_at": tick.completed_at.isoformat() if tick.completed_at is not None else None,
        }
        for tick in ticks
    ]


def list_offstage_beats_debug(db: Session, world_id: str) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for event, actor in _idle_event_rows(db, world_id, limit=40):
        event_payload = event.payload or {}
        payload.append(
            {
                "event_id": event.id,
                "world_id": world_id,
                "turn_id": event.turn_id,
                "session_id": event.session_id,
                "event_type": event.event_type,
                "beat_kind": event_payload.get("beat_kind"),
                "display_name": actor.display_name if actor is not None else None,
                "actor_id": actor.id if actor is not None else None,
                "visible_summary": event_payload.get("visible_summary"),
                "location_id": event.location_id,
                "relationship_updates": event_payload.get("relationship_updates") or [],
                "consequence_updates": event_payload.get("consequence_updates") or [],
                "created_at": event.created_at.isoformat(),
            }
        )
    return payload


def _role_run(
    *,
    council_role: str,
    stage_index: int,
    prompt_id: str,
    approval_status: str,
    result: PromptExecutionOutcome[BaseModel],
) -> CouncilRoleRun:
    payload = result.final_payload.model_dump() if result.final_payload is not None else None
    return CouncilRoleRun(
        council_role=council_role,
        stage_index=stage_index,
        prompt_id=prompt_id,
        approval_status=approval_status,
        attempts=result.attempts,
        final_lane=result.final_lane,
        final_payload=payload,
        failure_reason=result.failure_reason,
    )


def _matching_thread(
    db: Session,
    *,
    world_id: str,
    owner_actor_id: str,
    thread_type: str,
    counterpart_actor_id: str | None,
    location_id: str | None,
) -> ConsequenceThread | None:
    rows = list(
        db.execute(
            select(ConsequenceThread)
            .where(
                ConsequenceThread.world_id == world_id,
                ConsequenceThread.owner_actor_id == owner_actor_id,
                ConsequenceThread.thread_type == thread_type,
            )
            .order_by(ConsequenceThread.updated_at.desc(), ConsequenceThread.id.desc())
        ).scalars()
    )
    for thread in rows:
        if thread.counterpart_actor_id == counterpart_actor_id and thread.location_id == location_id:
            return thread
    return rows[0] if rows else None


def _enforce_active_thread_cap(db: Session, *, world_id: str, owner_actor_id: str, keep_thread_id: str | None) -> None:
    active_rows = list(
        db.execute(
            select(ConsequenceThread)
            .where(
                ConsequenceThread.world_id == world_id,
                ConsequenceThread.owner_actor_id == owner_actor_id,
                ConsequenceThread.status == "active",
            )
            .order_by(ConsequenceThread.updated_at.asc(), ConsequenceThread.id.asc())
        ).scalars()
    )
    while len(active_rows) > 3:
        oldest = next((row for row in active_rows if row.id != keep_thread_id), active_rows[0])
        oldest.status = "cooling"
        oldest.pressure_band = "low"
        oldest.summary = thread_summary(str(oldest.thread_type), "low", counterpart_name=None)
        oldest.updated_at = datetime.now(timezone.utc)
        active_rows.remove(oldest)
    db.flush()


def _select_participants(
    db: Session,
    *,
    world_id: str,
    location_id: str | None,
    focus_actor_id: str | None,
) -> list[_NPCParticipant]:
    stmt = (
        select(Actor, NPCProfile)
        .join(NPCProfile, (NPCProfile.actor_id == Actor.id) & (NPCProfile.world_id == Actor.world_id))
        .where(Actor.world_id == world_id, Actor.actor_type == "npc")
        .order_by(Actor.created_at.asc(), Actor.id.asc())
    )
    if location_id is not None:
        stmt = stmt.where(Actor.current_location_id == location_id)
    rows = [_NPCParticipant(actor=actor, profile=profile) for actor, profile in db.execute(stmt).all()]
    if not rows:
        return []

    selected: list[_NPCParticipant] = []
    if focus_actor_id is not None:
        focus = next((row for row in rows if row.actor.id == focus_actor_id), None)
        if focus is not None:
            selected.append(focus)
    remaining = [row for row in rows if row.actor.id not in {item.actor.id for item in selected}]
    remaining.sort(
        key=lambda item: (
            str(_routine_state_with_defaults(item.profile).get("last_ambient_turn_id") or ""),
            item.actor.created_at,
            item.actor.id,
        )
    )
    selected.extend(remaining[: max(0, 2 - len(selected))])
    return selected[:2]


def _fallback_memory_payload(
    participant: _NPCParticipant,
    *,
    session_state: dict[str, Any],
    relevant_memories: list[str],
) -> AmbientMemoryManagerPayload:
    scene_summary = str((session_state.get("current_scene") or {}).get("summary") or "The current district holds its breath.")
    rumor_focus = str(_routine_state_with_defaults(participant.profile).get("rumor_focus") or "the current district")
    return AmbientMemoryManagerPayload(
        memory_summary=f"{participant.actor.display_name} keeps the local district in mind through {rumor_focus}.",
        focus_memories=relevant_memories[:2],
        scene_summary=scene_summary,
        rumor_focus=rumor_focus,
    )


def _fallback_beat(
    participant: _NPCParticipant,
    *,
    session_state: dict[str, Any],
) -> AmbientNPCManagerPayload:
    routine_state = _routine_state_with_defaults(participant.profile)
    location = session_state.get("current_location") or session_state.get("location") or {}
    location_name = str(location.get("name") or "the current district")
    thread_types = {str(item.get("thread_type") or "") for item in (session_state.get("active_consequence_threads") or [])}
    if "promise" in thread_types:
        return AmbientNPCManagerPayload(
            beat_kind="murmur",
            summary=f"{participant.actor.display_name} lets a low rumor move through the district about a promise still hanging in the air.",
            tension_band="medium",
        )
    if "scrutiny" in thread_types:
        return AmbientNPCManagerPayload(
            beat_kind="question",
            summary=f"{participant.actor.display_name} turns a sharper question toward the district, testing who still means what they said.",
            tension_band="high",
        )
    routine_role = str(routine_state.get("routine_role") or "watcher")
    return AmbientNPCManagerPayload(
        beat_kind="observe",
        summary=f"{participant.actor.display_name} keeps {location_name} in view as the {routine_role}, watching how the air settles after the player's move.",
        tension_band=str(routine_state.get("tension_band") or "medium"),  # type: ignore[arg-type]
    )


def _normalize_beat_payload(
    participant: _NPCParticipant,
    *,
    beat_payload: AmbientNPCManagerPayload,
    session_state: dict[str, Any],
) -> AmbientNPCManagerPayload:
    thread_types = {str(item.get("thread_type") or "") for item in (session_state.get("active_consequence_threads") or [])}
    location = session_state.get("current_location") or session_state.get("location") or {}
    location_name = str(location.get("name") or "the current district")
    if "scrutiny" in thread_types and beat_payload.beat_kind in {"observe", "withdraw"}:
        return AmbientNPCManagerPayload(
            beat_kind="question",
            summary=(
                f"{participant.actor.display_name} turns a sharper question through the district, "
                "pressing on the unease that is already being watched."
            ),
            tension_band="high",
        )
    if "promise" in thread_types and beat_payload.beat_kind in {"observe", "withdraw"}:
        return AmbientNPCManagerPayload(
            beat_kind="murmur",
            summary=(
                f"{participant.actor.display_name} lets a low murmur move across {location_name} about a promise "
                "that is still waiting to be answered."
            ),
            tension_band="medium",
        )
    return beat_payload


def _fallback_idle_beat(
    participant: _NPCParticipant,
    *,
    session_state: dict[str, Any],
) -> IdleNPCManagerPayload:
    routine_state = _routine_state_with_defaults(participant.profile)
    thread_types = {str(item.get("thread_type") or "") for item in (session_state.get("active_consequence_threads") or [])}
    if "promise" in thread_types:
        return IdleNPCManagerPayload(
            beat_kind="murmur",
            summary=f"{participant.actor.display_name} lets a rumor drift across the district about a promise still waiting to be answered.",
            tension_band="medium",
        )
    if "scrutiny" in thread_types:
        return IdleNPCManagerPayload(
            beat_kind="question",
            summary=f"{participant.actor.display_name} tests the district with a sharper question, keeping its unease alive.",
            tension_band="high",
        )
    if str(routine_state.get("routine_role") or "") in {"courier", "runner"}:
        return IdleNPCManagerPayload(
            beat_kind="relocate",
            summary=f"{participant.actor.display_name} carries the district's latest rumor onward with a courier's restlessness.",
            tension_band=str(routine_state.get("tension_band") or "medium"),  # type: ignore[arg-type]
            target_route_key=None,
        )
    return IdleNPCManagerPayload(
        beat_kind="observe",
        summary=f"{participant.actor.display_name} keeps a quiet watch on the district after the player has gone still.",
        tension_band=str(routine_state.get("tension_band") or "medium"),  # type: ignore[arg-type]
    )


def _normalize_idle_beat_payload(
    participant: _NPCParticipant,
    *,
    beat_payload: IdleNPCManagerPayload,
    session_state: dict[str, Any],
    allow_relocate: bool,
) -> IdleNPCManagerPayload:
    thread_types = {str(item.get("thread_type") or "") for item in (session_state.get("active_consequence_threads") or [])}
    if not allow_relocate and beat_payload.beat_kind == "relocate":
        return _fallback_idle_beat(participant, session_state=session_state)
    if "scrutiny" in thread_types and beat_payload.beat_kind in {"observe", "withdraw"}:
        return IdleNPCManagerPayload(
            beat_kind="question",
            summary=(
                f"{participant.actor.display_name} lets the district's sharper scrutiny keep speaking after the player has moved on."
            ),
            tension_band="high",
        )
    if "promise" in thread_types and beat_payload.beat_kind in {"observe", "withdraw"}:
        return IdleNPCManagerPayload(
            beat_kind="murmur",
            summary=(
                f"{participant.actor.display_name} keeps a half-finished promise alive as a low murmur in the district air."
            ),
            tension_band="medium",
        )
    return beat_payload


def _select_idle_participants(
    db: Session,
    *,
    world_id: str,
    location_id: str | None,
) -> list[_NPCParticipant]:
    stmt = (
        select(Actor, NPCProfile)
        .join(NPCProfile, (NPCProfile.actor_id == Actor.id) & (NPCProfile.world_id == Actor.world_id))
        .where(Actor.world_id == world_id, Actor.actor_type == "npc")
        .order_by(Actor.created_at.asc(), Actor.id.asc())
    )
    if location_id is not None:
        stmt = stmt.where(Actor.current_location_id == location_id)
    rows = [_NPCParticipant(actor=actor, profile=profile) for actor, profile in db.execute(stmt).all()]
    rows.sort(
        key=lambda item: (
            str(_routine_state_with_defaults(item.profile).get("last_idle_tick_id") or ""),
            item.actor.created_at,
            item.actor.id,
        )
    )
    return rows[:2]


def _select_idle_location_id(db: Session, *, world_id: str) -> str | None:
    rows = list(
        db.execute(
            select(Actor, NPCProfile)
            .join(NPCProfile, (NPCProfile.actor_id == Actor.id) & (NPCProfile.world_id == Actor.world_id))
            .where(Actor.world_id == world_id, Actor.actor_type == "npc", Actor.current_location_id.is_not(None))
            .order_by(Actor.created_at.asc(), Actor.id.asc())
        ).all()
    )
    if not rows:
        return None
    rows.sort(
        key=lambda row: (
            str(_routine_state_with_defaults(row[1]).get("last_idle_tick_id") or ""),
            row[0].created_at,
            row[0].id,
        )
    )
    return rows[0][0].current_location_id


def _route_by_key(db: Session, *, world_id: str, route_key: str) -> tuple[LocationRoute, Location] | None:
    row = db.execute(
        select(LocationRoute, Location)
        .join(
            Location,
            (Location.id == LocationRoute.to_location_id) & (Location.world_id == LocationRoute.world_id),
        )
        .where(LocationRoute.world_id == world_id, LocationRoute.route_key == route_key)
    ).first()
    if row is None:
        return None
    route, location = row
    return route, location


def _route_key_between(db: Session, *, world_id: str, from_location_id: str | None, to_location_id: str | None) -> str | None:
    if from_location_id is None or to_location_id is None:
        return None
    route = db.execute(
        select(LocationRoute).where(
            LocationRoute.world_id == world_id,
            LocationRoute.from_location_id == from_location_id,
            LocationRoute.to_location_id == to_location_id,
        )
    ).scalar_one_or_none()
    return route.route_key if route is not None else None


def _pick_murmur_thread_type(session_state: dict[str, Any]) -> Literal["rumor", "scrutiny"]:
    thread_types = {str(item.get("thread_type") or "") for item in (session_state.get("active_consequence_threads") or [])}
    return "rumor" if "promise" in thread_types else "scrutiny"


def _memory_payload(memory: Memory) -> dict[str, Any]:
    return {
        "id": memory.id,
        "scope": memory.scope,
        "text": memory.text,
        "actor_id": memory.actor_id,
        "location_id": memory.location_id,
        "salience": memory.salience,
    }


class AmbientWorldPassService:
    def __init__(
        self,
        settings: Settings,
        model_router: ModelRouter,
        memory_service: MemoryService,
        observability_service: Any | None = None,
    ) -> None:
        self.settings = settings
        self.model_router = model_router
        self.memory_service = memory_service
        self.observability_service = observability_service

    def due_world_ids(self, db: Session) -> list[str]:
        now = datetime.now(timezone.utc)
        sessions = list(
            db.execute(
                select(GameSession)
                .where(GameSession.status == "active")
                .order_by(GameSession.updated_at.desc(), GameSession.id.asc())
            ).scalars()
        )
        due_worlds: list[str] = []
        seen_worlds: set[str] = set()
        for game_session in sessions:
            if game_session.world_id in seen_worlds:
                continue
            seen_worlds.add(game_session.world_id)
            last_turn = db.execute(
                select(Turn)
                .where(Turn.world_id == game_session.world_id, Turn.action_type != "system")
                .order_by(Turn.created_at.desc(), Turn.id.desc())
                .limit(1)
            ).scalar_one_or_none()
            last_activity_at = last_turn.created_at if last_turn is not None else game_session.created_at
            if (now - last_activity_at).total_seconds() < self.settings.world_idle_grace_seconds:
                continue
            last_tick = db.execute(
                select(WorldTick)
                .where(
                    WorldTick.world_id == game_session.world_id,
                    WorldTick.tick_kind == "idle_world_pass",
                    WorldTick.status == "completed",
                )
                .order_by(WorldTick.completed_at.desc(), WorldTick.created_at.desc(), WorldTick.id.desc())
                .limit(1)
            ).scalar_one_or_none()
            if last_tick is not None:
                last_tick_at = last_tick.completed_at or last_tick.created_at
                if (now - last_tick_at).total_seconds() < self.settings.world_idle_interval_seconds:
                    continue
            due_worlds.append(game_session.world_id)
        return due_worlds

    def run_due_idle_world_passes(self, db: Session) -> list[IdleWorldPassResult]:
        results: list[IdleWorldPassResult] = []
        for world_id in self.due_world_ids(db):
            result = self.run_idle_world_pass(db, world_id=world_id)
            if result is not None:
                results.append(result)
        return results

    def run_idle_world_pass(
        self,
        db: Session,
        *,
        world_id: str,
        forced_location_id: str | None = None,
    ) -> IdleWorldPassResult | None:
        from app.modules.world_state.service import build_session_state

        active_session = db.execute(
            select(GameSession)
            .where(GameSession.world_id == world_id, GameSession.status == "active")
            .order_by(GameSession.updated_at.desc(), GameSession.created_at.desc(), GameSession.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        if active_session is None:
            return None

        player_actor = db.execute(
            select(Actor).where(Actor.world_id == world_id, Actor.id == active_session.player_actor_id)
        ).scalar_one_or_none()
        if player_actor is None:
            return None
        seed_turn = db.execute(
            select(Turn)
            .where(Turn.world_id == world_id)
            .order_by(Turn.created_at.desc(), Turn.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        if seed_turn is None:
            return None

        observer_location_id = player_actor.current_location_id
        location_id = forced_location_id or _select_idle_location_id(db, world_id=world_id) or observer_location_id
        if location_id is None:
            return None

        idle_state = build_session_state(
            db,
            world_id=world_id,
            actor_id=player_actor.id,
            location_id=location_id,
            include_internal=True,
        )
        tick = WorldTick(
            world_id=world_id,
            tick_kind="idle_world_pass",
            status="running",
            seed_turn_id=seed_turn.id,
            location_id=location_id,
            summary="The district shifts a little while the player is away.",
            started_at=datetime.now(timezone.utc),
        )
        db.add(tick)
        db.flush()

        trace_context = (
            self.observability_service.langfuse_trace(
                seed_id=tick.id,
                name="idle_world_pass",
                input_payload={"world_id": world_id, "location_id": location_id, "tick_id": tick.id},
                metadata={
                    "world_id": world_id,
                    "location_id": location_id,
                    "tick_id": tick.id,
                    "runtime_role": self.settings.app_runtime_role,
                },
            )
            if self.observability_service is not None
            else nullcontext(SimpleNamespace(status="disabled", observation=None, trace_id=None, trace_url=None))
        )

        with trace_context as langfuse_link:
            result = self._run_idle_pass_inner(
                db,
                world_id=world_id,
                game_session=active_session,
                player_actor=player_actor,
                location_id=location_id,
                tick=tick,
                seed_turn_id=seed_turn.id,
                session_state=idle_state,
            )
            observation = getattr(langfuse_link, "observation", None)
            if observation is not None:
                try:
                    observation.update(
                        output={
                            "updates": result.updates,
                            "recent_offstage_beats": result.recent_offstage_beats,
                            "offstage_murmurs": result.offstage_murmurs,
                        },
                        metadata={
                            "world_id": world_id,
                            "location_id": location_id,
                            "tick_id": tick.id,
                            "npc_ids": [item.get("actor_id") for item in result.updates],
                            "retrieval_status": "ready",
                        },
                    )
                except Exception:
                    langfuse_link.status = "degraded"
            tick.status = "completed"
            tick.summary = result.scene_summary or tick.summary
            tick.completed_at = datetime.now(timezone.utc)
            db.flush()
            return IdleWorldPassResult(
                tick=tick,
                updates=result.updates,
                recent_offstage_beats=result.recent_offstage_beats,
                offstage_murmurs=result.offstage_murmurs,
                npc_locations=result.npc_locations,
                scene_updates=result.scene_updates,
                scene_summary=result.scene_summary,
                langfuse_status=str(getattr(langfuse_link, "status", "disabled")),
            )

    def run(
        self,
        db: Session,
        *,
        world_id: str,
        session_id: str,
        player_turn_id: str,
        player_actor_id: str,
        player_name: str,
        location_id: str | None,
        session_state: dict[str, Any],
    ) -> AmbientPassResult:
        current_scene = session_state.get("current_scene") or {}
        player_profile = session_state.get("player_profile") if isinstance(session_state.get("player_profile"), dict) else {}
        play_language = normalize_play_language((player_profile or {}).get("play_language"))
        focus_actor = current_scene.get("focus_actor") or {}
        focus_actor_id = focus_actor.get("actor_id") if isinstance(focus_actor, dict) else None
        participants = _select_participants(
            db,
            world_id=world_id,
            location_id=location_id,
            focus_actor_id=focus_actor_id if isinstance(focus_actor_id, str) else None,
        )
        if not participants:
            return AmbientPassResult(
                updates=[],
                recent_world_beats=list_recent_world_beats(db, world_id, location_id),
                scene_updates=[],
                chapter_updates=[],
                scene_summary=str(current_scene.get("summary") or ""),
                role_runs=[],
            )

        updates: list[dict[str, Any]] = []
        role_runs: list[CouncilRoleRun] = []
        thread_mutation_used = False
        relationship_delta_used = False
        beat_kinds: list[AmbientBeatKind] = []
        last_event_id: str | None = None
        focus_actor_id_for_scene: str | None = None

        for participant_index, participant in enumerate(participants):
            routine_state = _routine_state_with_defaults(participant.profile)
            relation_context = [
                f"location={session_state.get('location', {}).get('name', 'the active world')}",
                f"npc={participant.actor.display_name}",
                f"routine_role={routine_state.get('routine_role')}",
            ]
            retrieval = self.memory_service.search(
                db,
                world_id=world_id,
                query_text=build_retrieval_query_text(
                    f"{participant.actor.display_name} reacts to the district after {session_state.get('recent_consequence_history', ['the latest turn'])[0] if session_state.get('recent_consequence_history') else 'the latest turn'}",
                    session_state=session_state,
                    relation_context=relation_context,
                ),
                actor_id=participant.actor.id,
                location_id=location_id,
            )
            relevant_memories = [item.text for item in retrieval.memories]

            stage_base = participant_index * 3
            memory_result = self.model_router.execute_structured_prompt(
                prompt_id="ambient.memory_manager",
                response_model=AmbientMemoryManagerPayload,
                input_payload={
                    "world_id": world_id,
                    "player_name": player_name,
                    "play_language": play_language,
                    "npc_name": participant.actor.display_name,
                    "routine_state": routine_state,
                    "relevant_memories": relevant_memories,
                    "relationship_summaries": session_state.get("relationships") or [],
                    "active_consequence_threads": session_state.get("active_consequence_threads") or [],
                    "recent_scene_history": session_state.get("recent_scene_history") or [],
                    "recent_world_beats": session_state.get("recent_world_beats") or [],
                    "ambient_murmurs": session_state.get("ambient_murmurs") or [],
                    "current_scene": session_state.get("current_scene") or {},
                    "current_location": session_state.get("current_location") or session_state.get("location") or {},
                    "shared_world_context": session_state.get("shared_world_context") or {},
                },
                world_id=world_id,
                turn_id=player_turn_id,
                graph_context_status=retrieval.trace.status,
            )
            role_runs.append(
                _role_run(
                    council_role="ambient_memory_manager",
                    stage_index=stage_base + 1,
                    prompt_id="ambient.memory_manager",
                    approval_status="prepared" if memory_result.succeeded else "failed",
                    result=memory_result,
                )
            )
            memory_payload = (
                memory_result.final_payload
                if memory_result.succeeded and memory_result.final_payload is not None
                else _fallback_memory_payload(participant, session_state=session_state, relevant_memories=relevant_memories)
            )

            npc_result = self.model_router.execute_structured_prompt(
                prompt_id="ambient.npc_manager",
                response_model=AmbientNPCManagerPayload,
                input_payload={
                    "world_id": world_id,
                    "player_name": player_name,
                    "play_language": play_language,
                    "npc_name": participant.actor.display_name,
                    "routine_state": routine_state,
                    "memory_summary": memory_payload.memory_summary,
                    "focus_memories": memory_payload.focus_memories,
                    "scene_summary": memory_payload.scene_summary,
                    "rumor_focus": memory_payload.rumor_focus,
                    "active_consequence_threads": session_state.get("active_consequence_threads") or [],
                    "recent_world_beats": session_state.get("recent_world_beats") or [],
                    "current_location": session_state.get("current_location") or session_state.get("location") or {},
                    "shared_world_context": session_state.get("shared_world_context") or {},
                },
                world_id=world_id,
                turn_id=player_turn_id,
                graph_context_status=retrieval.trace.status,
            )
            role_runs.append(
                _role_run(
                    council_role="ambient_npc_manager",
                    stage_index=stage_base + 2,
                    prompt_id="ambient.npc_manager",
                    approval_status="prepared" if npc_result.succeeded else "failed",
                    result=npc_result,
                )
            )
            beat_payload = (
                npc_result.final_payload
                if npc_result.succeeded and npc_result.final_payload is not None
                else _fallback_beat(participant, session_state=session_state)
            )
            beat_payload = _normalize_beat_payload(
                participant,
                beat_payload=beat_payload,
                session_state=session_state,
            )

            safety_result = self.model_router.execute_structured_prompt(
                prompt_id="ambient.safety_guard",
                response_model=AmbientSafetyGuardPayload,
                input_payload={
                    "world_id": world_id,
                    "play_language": play_language,
                    "npc_name": participant.actor.display_name,
                    "beat_kind": beat_payload.beat_kind,
                    "summary": beat_payload.summary,
                    "routine_state": routine_state,
                    "current_scene": session_state.get("current_scene") or {},
                },
                world_id=world_id,
                turn_id=player_turn_id,
                graph_context_status=retrieval.trace.status,
            )
            safety_approved = (
                safety_result.succeeded
                and safety_result.final_payload is not None
                and safety_result.final_payload.approval_status == "approved"
            )
            role_runs.append(
                _role_run(
                    council_role="ambient_safety_guard",
                    stage_index=stage_base + 3,
                    prompt_id="ambient.safety_guard",
                    approval_status=(
                        "approved"
                        if safety_approved
                        else ("rejected" if safety_result.succeeded else "failed")
                    ),
                    result=safety_result,
                )
            )
            if not safety_approved:
                beat_payload = _fallback_beat(participant, session_state=session_state)
                beat_payload = _normalize_beat_payload(
                    participant,
                    beat_payload=beat_payload,
                    session_state=session_state,
                )

            beat_kind = beat_payload.beat_kind
            beat_kinds.append(beat_kind)
            focus_actor_id_for_scene = focus_actor_id_for_scene or participant.actor.id

            event, relationship_updates, consequence_updates = self._apply_beat_effect(
                db,
                world_id=world_id,
                session_id=session_id,
                player_turn_id=player_turn_id,
                player_actor_id=player_actor_id,
                location_id=location_id,
                participant=participant,
                beat_kind=beat_kind,
                summary=beat_payload.summary,
                tension_band=beat_payload.tension_band,
                session_state=session_state,
                allow_thread_mutation=not thread_mutation_used,
                allow_relationship_delta=not relationship_delta_used,
            )
            thread_mutation_used = thread_mutation_used or bool(consequence_updates)
            relationship_delta_used = relationship_delta_used or bool(relationship_updates)
            routine_state.update(
                {
                    "beat_state": beat_kind,
                    "attention_target_actor_id": player_actor_id,
                    "last_ambient_turn_id": player_turn_id,
                    "tension_band": beat_payload.tension_band,
                    "rumor_focus": memory_payload.rumor_focus,
                }
            )
            participant.profile.routine_state = routine_state
            last_event_id = event.id
            updates.append(
                {
                    "event_id": event.id,
                    "actor_id": participant.actor.id,
                    "display_name": participant.actor.display_name,
                    "beat_kind": beat_kind,
                    "summary": str(event.payload.get("visible_summary") or event.narrative or ""),
                    "relationship_updates": relationship_updates,
                    "consequence_updates": consequence_updates,
                }
            )

        scene_updates: list[dict[str, Any]] = []
        chapter_updates: list[dict[str, Any]] = []
        scene_summary = str((session_state.get("current_scene") or {}).get("summary") or "")
        if last_event_id is not None:
            scene_move = "deepen" if {"murmur", "question"} & set(beat_kinds) else "hold"
            scene_pressure = (
                "high"
                if "question" in beat_kinds
                else ("medium" if {"murmur", "withdraw"} & set(beat_kinds) else "low")
            )
            scene_result = SceneFrameEngine.apply(
                db,
                world_id=world_id,
                actor_id=player_actor_id,
                location_id=location_id,
                focus_actor_id=focus_actor_id_for_scene,
                source_event_id=last_event_id,
                action_kind="ambient_world_pass",
                session_state=session_state,
                outcome_band="tangled" if {"murmur", "question"} & set(beat_kinds) else "steady",
                requested_scene_move=scene_move,
                requested_scene_pressure=scene_pressure,
            )
            scene_updates = scene_result.scene_updates
            chapter_updates = scene_result.chapter_updates
            scene_summary = scene_result.scene_summary

        db.flush()
        return AmbientPassResult(
            updates=updates,
            recent_world_beats=list_recent_world_beats(db, world_id, location_id),
            scene_updates=scene_updates,
            chapter_updates=chapter_updates,
            scene_summary=scene_summary,
            role_runs=role_runs,
        )

    def _run_idle_pass_inner(
        self,
        db: Session,
        *,
        world_id: str,
        game_session: GameSession,
        player_actor: Actor,
        location_id: str,
        tick: WorldTick,
        seed_turn_id: str,
        session_state: dict[str, Any],
    ) -> IdleWorldPassResult:
        player_profile = session_state.get("player_profile") if isinstance(session_state.get("player_profile"), dict) else {}
        play_language = normalize_play_language((player_profile or {}).get("play_language"))
        participants = _select_idle_participants(db, world_id=world_id, location_id=location_id)
        if not participants:
            return IdleWorldPassResult(
                tick=tick,
                updates=[],
                recent_offstage_beats=list_recent_offstage_beats(db, world_id, player_actor.current_location_id),
                offstage_murmurs=list_offstage_murmurs(db, world_id, player_actor.current_location_id),
                npc_locations=list_npc_locations(db, world_id),
                scene_updates=[],
                scene_summary=str((session_state.get("current_scene") or {}).get("summary") or ""),
                langfuse_status="disabled",
            )

        updates: list[dict[str, Any]] = []
        relationship_delta_used = False
        thread_mutation_used = False
        movement_used = False
        beat_kinds: list[IdleBeatKind] = []
        last_event_id: str | None = None
        focus_actor_id: str | None = None

        for participant_index, participant in enumerate(participants):
            stage_base = participant_index * 3
            routine_state = _routine_state_with_defaults(participant.profile)
            local_state = dict(session_state)
            local_state["current_location"] = local_state.get("current_location") or local_state.get("location") or {}
            relation_context = [
                f"location={(local_state.get('current_location') or {}).get('name', 'the active world')}",
                f"npc={participant.actor.display_name}",
                f"routine_role={routine_state.get('routine_role')}",
            ]
            retrieval = self.memory_service.search(
                db,
                world_id=world_id,
                query_text=build_retrieval_query_text(
                    f"{participant.actor.display_name} follows the district after the player's absence.",
                    session_state=local_state,
                    relation_context=relation_context,
                ),
                actor_id=participant.actor.id,
                location_id=location_id,
            )
            memory_result = self.model_router.execute_structured_prompt(
                prompt_id="idle.memory_manager",
                response_model=AmbientMemoryManagerPayload,
                input_payload={
                    "world_id": world_id,
                    "play_language": play_language,
                    "npc_name": participant.actor.display_name,
                    "routine_state": routine_state,
                    "relevant_memories": [item.text for item in retrieval.memories],
                    "relationship_summaries": local_state.get("relationships") or [],
                    "active_consequence_threads": local_state.get("active_consequence_threads") or [],
                    "recent_scene_history": local_state.get("recent_scene_history") or [],
                    "recent_offstage_beats": list_recent_offstage_beats(db, world_id, player_actor.current_location_id),
                    "offstage_murmurs": list_offstage_murmurs(db, world_id, player_actor.current_location_id),
                    "current_scene": local_state.get("current_scene") or {},
                },
                world_id=world_id,
                turn_id=tick.id,
                graph_context_status=retrieval.trace.status,
            )
            memory_payload = (
                memory_result.final_payload
                if memory_result.succeeded and memory_result.final_payload is not None
                else _fallback_memory_payload(participant, session_state=local_state, relevant_memories=[item.text for item in retrieval.memories])
            )
            npc_result = self.model_router.execute_structured_prompt(
                prompt_id="idle.npc_manager",
                response_model=IdleNPCManagerPayload,
                input_payload={
                    "world_id": world_id,
                    "play_language": play_language,
                    "npc_name": participant.actor.display_name,
                    "routine_state": routine_state,
                    "memory_summary": memory_payload.memory_summary,
                    "focus_memories": memory_payload.focus_memories,
                    "scene_summary": memory_payload.scene_summary,
                    "rumor_focus": memory_payload.rumor_focus,
                    "active_consequence_threads": local_state.get("active_consequence_threads") or [],
                    "nearby_routes": [
                        {
                            "route_key": route.route_key,
                            "status": route.status,
                            "to_location_id": route.to_location_id,
                        }
                        for route in db.execute(
                            select(LocationRoute).where(
                                LocationRoute.world_id == world_id,
                                LocationRoute.from_location_id == participant.actor.current_location_id,
                            )
                        ).scalars()
                    ],
                },
                world_id=world_id,
                turn_id=tick.id,
                graph_context_status=retrieval.trace.status,
            )
            beat_payload = (
                npc_result.final_payload
                if npc_result.succeeded and npc_result.final_payload is not None
                else _fallback_idle_beat(participant, session_state=local_state)
            )
            beat_payload = _normalize_idle_beat_payload(
                participant,
                beat_payload=beat_payload,
                session_state=local_state,
                allow_relocate=not movement_used,
            )
            safety_result = self.model_router.execute_structured_prompt(
                prompt_id="idle.safety_guard",
                response_model=AmbientSafetyGuardPayload,
                input_payload={
                    "world_id": world_id,
                    "play_language": play_language,
                    "npc_name": participant.actor.display_name,
                    "beat_kind": beat_payload.beat_kind,
                    "summary": beat_payload.summary,
                    "routine_state": routine_state,
                    "current_scene": local_state.get("current_scene") or {},
                },
                world_id=world_id,
                turn_id=tick.id,
                graph_context_status=retrieval.trace.status,
            )
            safety_approved = (
                safety_result.succeeded
                and safety_result.final_payload is not None
                and safety_result.final_payload.approval_status == "approved"
            )
            if not safety_approved:
                beat_payload = _normalize_idle_beat_payload(
                    participant,
                    beat_payload=_fallback_idle_beat(participant, session_state=local_state),
                    session_state=local_state,
                    allow_relocate=not movement_used,
                )

            beat_kinds.append(beat_payload.beat_kind)
            focus_actor_id = focus_actor_id or participant.actor.id
            event, relationship_updates, consequence_updates, moved = self._apply_idle_beat_effect(
                db,
                world_id=world_id,
                session_id=game_session.id,
                tick=tick,
                seed_turn_id=seed_turn_id,
                player_actor_id=player_actor.id,
                observer_location_id=player_actor.current_location_id,
                location_id=location_id,
                participant=participant,
                beat_kind=beat_payload.beat_kind,
                summary=beat_payload.summary,
                tension_band=beat_payload.tension_band,
                target_route_key=beat_payload.target_route_key,
                session_state=local_state,
                allow_thread_mutation=not thread_mutation_used,
                allow_relationship_delta=not relationship_delta_used,
                allow_relocate=not movement_used,
            )
            thread_mutation_used = thread_mutation_used or bool(consequence_updates)
            relationship_delta_used = relationship_delta_used or bool(relationship_updates)
            movement_used = movement_used or moved
            updated_routine_state = _routine_state_with_defaults(participant.profile)
            updated_routine_state.update(
                {
                    "beat_state": beat_payload.beat_kind,
                    "attention_target_actor_id": player_actor.id,
                    "last_idle_tick_id": tick.id,
                    "tension_band": beat_payload.tension_band,
                    "rumor_focus": memory_payload.rumor_focus,
                    "active_location_id": participant.actor.current_location_id,
                }
            )
            participant.profile.routine_state = updated_routine_state
            last_event_id = event.id
            updates.append(
                {
                    "event_id": event.id,
                    "actor_id": participant.actor.id,
                    "display_name": participant.actor.display_name,
                    "beat_kind": beat_payload.beat_kind,
                    "summary": str(event.payload.get("visible_summary") or event.narrative or ""),
                    "relationship_updates": relationship_updates,
                    "consequence_updates": consequence_updates,
                    "moved": moved,
                }
            )

        scene_updates: list[dict[str, Any]] = []
        scene_summary = str((session_state.get("current_scene") or {}).get("summary") or "")
        BranchPressureEngine.apply_idle_pass(
            db,
            world_id=world_id,
            actor_id=player_actor.id,
            session_state=session_state,
            beat_updates=updates,
        )
        if last_event_id is not None:
            scene_result = SceneFrameEngine.apply(
                db,
                world_id=world_id,
                actor_id=player_actor.id,
                location_id=player_actor.current_location_id,
                focus_actor_id=focus_actor_id,
                source_event_id=last_event_id,
                action_kind="idle_world_pass",
                session_state=session_state,
                outcome_band="tangled" if {"murmur", "question", "relocate"} & set(beat_kinds) else "steady",
                requested_scene_move="deepen" if {"murmur", "question", "relocate"} & set(beat_kinds) else "hold",
                requested_scene_pressure=(
                    "high"
                    if "question" in beat_kinds
                    else ("medium" if {"murmur", "relocate", "withdraw"} & set(beat_kinds) else "low")
                ),
            )
            scene_updates = scene_result.scene_updates
            scene_summary = scene_result.scene_summary

        db.flush()
        return IdleWorldPassResult(
            tick=tick,
            updates=updates,
            recent_offstage_beats=list_recent_offstage_beats(db, world_id, player_actor.current_location_id),
            offstage_murmurs=list_offstage_murmurs(db, world_id, player_actor.current_location_id),
            npc_locations=list_npc_locations(db, world_id),
            scene_updates=scene_updates,
            scene_summary=scene_summary,
            langfuse_status="ok",
        )

    def _apply_beat_effect(
        self,
        db: Session,
        *,
        world_id: str,
        session_id: str,
        player_turn_id: str,
        player_actor_id: str,
        location_id: str | None,
        participant: _NPCParticipant,
        beat_kind: AmbientBeatKind,
        summary: str,
        tension_band: str,
        session_state: dict[str, Any],
        allow_thread_mutation: bool,
        allow_relationship_delta: bool,
    ) -> tuple[Event, list[dict[str, Any]], list[dict[str, Any]]]:
        relationship_updates: list[dict[str, Any]] = []
        consequence_updates: list[dict[str, Any]] = []
        visible_summary = summary.strip()

        if beat_kind == "murmur":
            visible_summary = summary.strip() or f"{participant.actor.display_name} lets a rumor move through the district."
        elif beat_kind == "reassure":
            visible_summary = summary.strip() or f"{participant.actor.display_name} eases the district's edge without calling attention to it."
        elif beat_kind == "question":
            visible_summary = summary.strip() or f"{participant.actor.display_name} asks a sharper question of what the district has just seen."
        elif beat_kind == "withdraw":
            visible_summary = summary.strip() or f"{participant.actor.display_name} steps back and leaves the district listening to itself."
        else:
            visible_summary = summary.strip() or f"{participant.actor.display_name} keeps watch on the district."

        if beat_kind in {"reassure", "question"} and allow_relationship_delta:
            delta = 0.05 if beat_kind == "reassure" else -0.05
            relationship = adjust_relationship_strength(
                db,
                world_id=world_id,
                from_actor_id=player_actor_id,
                to_actor_id=participant.actor.id,
                relationship_type="KNOWS",
                delta=delta,
                default_strength=0.55,
            )
            band = relationship_band(float(relationship.strength))
            relationship_updates.append(
                {
                    "actor_id": participant.actor.id,
                    "display_name": participant.actor.display_name,
                    "band": band,
                    "summary": relationship_summary(participant.actor.display_name, band),
                    "delta": round(delta, 3),
                }
            )

        if allow_thread_mutation and beat_kind in {"murmur", "reassure", "question"}:
            thread_type: str | None = None
            if beat_kind == "murmur":
                thread_type = _pick_murmur_thread_type(session_state)
            elif beat_kind == "question":
                thread_type = "scrutiny"
            elif beat_kind == "reassure":
                active_threads = session_state.get("active_consequence_threads") or []
                thread_type = next(
                    (
                        str(item.get("thread_type"))
                        for item in active_threads
                        if item.get("thread_type") in {"promise", "scrutiny"}
                    ),
                    None,
                )
            if thread_type is not None:
                thread = _matching_thread(
                    db,
                    world_id=world_id,
                    owner_actor_id=player_actor_id,
                    thread_type=thread_type,
                    counterpart_actor_id=participant.actor.id,
                    location_id=location_id,
                )
                now = datetime.now(timezone.utc)
                if thread is None and beat_kind in {"murmur", "question"}:
                    pressure_band = "medium" if beat_kind == "murmur" else "high"
                    thread = ConsequenceThread(
                        world_id=world_id,
                        owner_actor_id=player_actor_id,
                        counterpart_actor_id=participant.actor.id,
                        location_id=location_id,
                        thread_type=thread_type,
                        status="active",
                        pressure_band=pressure_band,
                        title=thread_title(thread_type),
                        summary=thread_summary(thread_type, pressure_band, counterpart_name=participant.actor.display_name),
                        source_event_id=None,
                        last_event_id=None,
                        opened_at=now,
                        updated_at=now,
                        resolved_at=None,
                    )
                    db.add(thread)
                    db.flush()
                elif thread is not None:
                    if beat_kind == "reassure":
                        thread.status = "cooling"
                        thread.pressure_band = "low"
                    else:
                        thread.status = "active"
                        thread.pressure_band = "high" if beat_kind == "question" else "medium"
                    thread.title = thread_title(thread_type)
                    thread.summary = thread_summary(thread_type, str(thread.pressure_band), counterpart_name=participant.actor.display_name)
                    thread.updated_at = now
                    db.flush()
                if thread is not None:
                    thread.last_event_id = None
                    _enforce_active_thread_cap(db, world_id=world_id, owner_actor_id=player_actor_id, keep_thread_id=thread.id)
                    consequence_updates.append(
                        {
                            "id": thread.id,
                            "title": thread.title,
                            "summary": thread.summary,
                            "pressure_band": thread.pressure_band,
                            "status": thread.status,
                            "action": "cooled" if beat_kind == "reassure" else ("raised" if beat_kind == "question" else "opened"),
                        }
                    )

        memory_scope = "location"
        memory_text = visible_summary
        memory_salience = 0.72
        if beat_kind == "murmur":
            memory_scope = "world"
            memory_salience = 0.86
        elif beat_kind == "question":
            memory_scope = "world"
            memory_salience = 0.88
        elif beat_kind == "reassure":
            memory_scope = "actor"
            memory_salience = 0.76
        elif beat_kind == "withdraw":
            memory_salience = 0.7

        event = Event(
            world_id=world_id,
            session_id=session_id,
            turn_id=player_turn_id,
            event_type=f"ambient.npc.{beat_kind}",
            source_actor_id=participant.actor.id,
            location_id=location_id,
            payload={
                "action_type": "ambient_world_pass",
                "beat_kind": beat_kind,
                "visible_summary": visible_summary,
                "tension_band": tension_band,
                "relationship_updates": relationship_updates,
                "consequence_updates": consequence_updates,
            },
            narrative=visible_summary,
        )
        db.add(event)
        db.flush()

        for update in consequence_updates:
            thread = db.execute(select(ConsequenceThread).where(ConsequenceThread.id == update["id"])).scalar_one_or_none()
            if thread is not None:
                thread.source_event_id = thread.source_event_id or event.id
                thread.last_event_id = event.id
        memories = self.memory_service.materialize_memories(
            db,
            world_id=world_id,
            source_event_id=event.id,
            location_id=location_id,
            drafts=[
                {
                    "scope": memory_scope,
                    "text": memory_text,
                    "salience": memory_salience,
                    "actor_id": participant.actor.id if memory_scope == "actor" else None,
                    "location_id": location_id,
                }
            ],
        )
        event.payload = {
            **event.payload,
            "memory_ids": [memory.id for memory in memories],
            "memory_texts": [_memory_payload(memory)["text"] for memory in memories],
        }
        db.add(
            OutboxEvent(
                world_id=world_id,
                event_id=event.id,
                projection_type="world_graph.upsert",
                payload={
                    "turn_id": player_turn_id,
                    "outcome": "ambient_world_pass",
                    "location_id": location_id,
                    "beat_kind": beat_kind,
                },
            )
        )
        db.flush()
        return event, relationship_updates, consequence_updates

    def _apply_idle_beat_effect(
        self,
        db: Session,
        *,
        world_id: str,
        session_id: str,
        tick: WorldTick,
        seed_turn_id: str,
        player_actor_id: str,
        observer_location_id: str | None,
        location_id: str | None,
        participant: _NPCParticipant,
        beat_kind: IdleBeatKind,
        summary: str,
        tension_band: str,
        target_route_key: str | None,
        session_state: dict[str, Any],
        allow_thread_mutation: bool,
        allow_relationship_delta: bool,
        allow_relocate: bool,
    ) -> tuple[Event, list[dict[str, Any]], list[dict[str, Any]], bool]:
        relationship_updates: list[dict[str, Any]] = []
        consequence_updates: list[dict[str, Any]] = []
        moved = False
        event_type = f"idle.npc.{beat_kind}"
        effective_location_id = location_id
        visible_summary = summary.strip() or f"{participant.actor.display_name} keeps the district moving in small ways."

        if beat_kind in {"reassure", "question"} and allow_relationship_delta:
            delta = 0.05 if beat_kind == "reassure" else -0.05
            relationship = adjust_relationship_strength(
                db,
                world_id=world_id,
                from_actor_id=player_actor_id,
                to_actor_id=participant.actor.id,
                relationship_type="KNOWS",
                delta=delta,
                default_strength=0.55,
            )
            relationship_updates.append(
                {
                    "actor_id": participant.actor.id,
                    "display_name": participant.actor.display_name,
                    "band": relationship_band(float(relationship.strength)),
                    "summary": relationship_summary(participant.actor.display_name, relationship_band(float(relationship.strength))),
                    "delta": round(delta, 3),
                }
            )

        if allow_thread_mutation and beat_kind in {"murmur", "reassure", "question"}:
            thread_type: str | None = None
            if beat_kind == "murmur":
                thread_type = _pick_murmur_thread_type(session_state)
            elif beat_kind == "question":
                thread_type = "scrutiny"
            elif beat_kind == "reassure":
                active_threads = session_state.get("active_consequence_threads") or []
                thread_type = next(
                    (
                        str(item.get("thread_type"))
                        for item in active_threads
                        if item.get("thread_type") in {"promise", "scrutiny"}
                    ),
                    None,
                )
            if thread_type is not None:
                thread = _matching_thread(
                    db,
                    world_id=world_id,
                    owner_actor_id=player_actor_id,
                    thread_type=thread_type,
                    counterpart_actor_id=participant.actor.id,
                    location_id=participant.actor.current_location_id,
                )
                now = datetime.now(timezone.utc)
                if thread is None and beat_kind in {"murmur", "question"}:
                    pressure_band = "medium" if beat_kind == "murmur" else "high"
                    thread = ConsequenceThread(
                        world_id=world_id,
                        owner_actor_id=player_actor_id,
                        counterpart_actor_id=participant.actor.id,
                        location_id=participant.actor.current_location_id,
                        thread_type=thread_type,
                        status="active",
                        pressure_band=pressure_band,
                        title=thread_title(thread_type),
                        summary=thread_summary(thread_type, pressure_band, counterpart_name=participant.actor.display_name),
                        source_event_id=None,
                        last_event_id=None,
                        opened_at=now,
                        updated_at=now,
                        resolved_at=None,
                    )
                    db.add(thread)
                    db.flush()
                elif thread is not None:
                    if beat_kind == "reassure":
                        thread.status = "cooling"
                        thread.pressure_band = "low"
                    else:
                        thread.status = "active"
                        thread.pressure_band = "high" if beat_kind == "question" else "medium"
                    thread.title = thread_title(thread_type)
                    thread.summary = thread_summary(thread_type, str(thread.pressure_band), counterpart_name=participant.actor.display_name)
                    thread.updated_at = now
                    db.flush()
                if thread is not None:
                    _enforce_active_thread_cap(db, world_id=world_id, owner_actor_id=player_actor_id, keep_thread_id=thread.id)
                    consequence_updates.append(
                        {
                            "id": thread.id,
                            "title": thread.title,
                            "summary": thread.summary,
                            "pressure_band": thread.pressure_band,
                            "status": thread.status,
                            "action": "cooled" if beat_kind == "reassure" else ("raised" if beat_kind == "question" else "opened"),
                        }
                    )

        if beat_kind == "relocate" and allow_relocate:
            relocation = self._resolve_idle_relocation(
                db,
                world_id=world_id,
                participant=participant,
                target_route_key=target_route_key,
                session_state=session_state,
            )
            if relocation is None:
                beat_kind = "observe"
                event_type = "idle.npc.observe"
                visible_summary = (
                    f"{participant.actor.display_name} thinks better of moving and keeps watch where the district already holds them."
                )
            else:
                route, destination = relocation
                origin_location_id = participant.actor.current_location_id
                participant.actor.current_location_id = destination.id
                routine_state = _routine_state_with_defaults(participant.profile)
                routine_state["active_location_id"] = destination.id
                participant.profile.routine_state = routine_state
                moved = True
                effective_location_id = destination.id
                if destination.id == observer_location_id:
                    event_type = "npc.arrived"
                elif origin_location_id == observer_location_id:
                    event_type = "npc.departed"
                else:
                    event_type = "idle.npc.relocate"
                visible_summary = (
                    summary.strip()
                    or f"{participant.actor.display_name} crosses by {route.route_key.replace('_', ' ')} and leaves the district feeling slightly rearranged."
                )
                visible_summary = (
                    f"{participant.actor.display_name} shifts toward {destination.name}, leaving a rumor of movement in their wake."
                    if not visible_summary
                    else visible_summary
                )

        if beat_kind == "withdraw":
            visible_summary = summary.strip() or f"{participant.actor.display_name} falls back from the district's edge and lets the silence do the rest."
        elif beat_kind == "reassure":
            visible_summary = summary.strip() or f"{participant.actor.display_name} eases the district's pressure without making a show of it."
        elif beat_kind == "question":
            visible_summary = summary.strip() or f"{participant.actor.display_name} sharpens a question the district will keep remembering."
        elif beat_kind == "murmur":
            visible_summary = summary.strip() or f"{participant.actor.display_name} lets a rumor move farther than the player can presently hear."

        event = Event(
            world_id=world_id,
            session_id=session_id,
            turn_id=seed_turn_id,
            event_type=event_type,
            source_actor_id=participant.actor.id,
            location_id=effective_location_id,
            payload={
                "action_type": "idle_world_pass",
                "beat_kind": beat_kind,
                "tick_id": tick.id,
                "visible_summary": visible_summary,
                "tension_band": tension_band,
                "relationship_updates": relationship_updates,
                "consequence_updates": consequence_updates,
                "moved": moved,
            },
            narrative=visible_summary,
        )
        db.add(event)
        db.flush()

        for update in consequence_updates:
            thread = db.execute(select(ConsequenceThread).where(ConsequenceThread.id == update["id"])).scalar_one_or_none()
            if thread is not None:
                thread.source_event_id = thread.source_event_id or event.id
                thread.last_event_id = event.id

        memory_text = visible_summary
        memory_scope = "location"
        memory_location_id = effective_location_id
        memory_salience = 0.8 if beat_kind in {"murmur", "question", "relocate"} else 0.72
        if beat_kind in {"murmur", "question"}:
            memory_scope = "world"
        memories = self.memory_service.materialize_memories(
            db,
            world_id=world_id,
            source_event_id=event.id,
            location_id=memory_location_id,
            drafts=[
                {
                    "scope": memory_scope,
                    "text": memory_text,
                    "salience": memory_salience,
                    "actor_id": None,
                    "location_id": memory_location_id,
                }
            ],
        )
        event.payload = {
            **event.payload,
            "memory_ids": [memory.id for memory in memories],
            "memory_texts": [_memory_payload(memory)["text"] for memory in memories],
        }
        db.add(
            OutboxEvent(
                world_id=world_id,
                event_id=event.id,
                projection_type="world_graph.upsert",
                payload={
                    "tick_id": tick.id,
                    "outcome": "idle_world_pass",
                    "location_id": effective_location_id,
                    "beat_kind": beat_kind,
                    "moved": moved,
                },
            )
        )
        db.flush()
        return event, relationship_updates, consequence_updates, moved

    def _resolve_idle_relocation(
        self,
        db: Session,
        *,
        world_id: str,
        participant: _NPCParticipant,
        target_route_key: str | None,
        session_state: dict[str, Any],
    ) -> tuple[LocationRoute, Location] | None:
        current_location_id = participant.actor.current_location_id
        if current_location_id is None:
            return None
        routes = list(
            db.execute(
                select(LocationRoute, Location)
                .join(
                    Location,
                    (Location.id == LocationRoute.to_location_id) & (Location.world_id == LocationRoute.world_id),
                )
                .where(
                    LocationRoute.world_id == world_id,
                    LocationRoute.from_location_id == current_location_id,
                    LocationRoute.status == "open",
                )
                .order_by(LocationRoute.route_key.asc())
            ).all()
        )
        if not routes:
            return None
        allowed: list[tuple[LocationRoute, Location]] = []
        active_threads = session_state.get("active_consequence_threads") or []
        has_pressure = any(
            str(item.get("thread_type") or "") in {"promise", "scrutiny"} and str(item.get("pressure_band") or "") in {"medium", "high"}
            for item in active_threads
        )
        routine_role = str(_routine_state_with_defaults(participant.profile).get("routine_role") or "")
        for route, location in routes:
            if routine_role in {"courier", "runner"}:
                allowed.append((route, location))
            elif routine_role in {"archivist", "scribe"} and has_pressure:
                allowed.append((route, location))
            elif routine_role in {"lamplighter", "beacon_keeper"}:
                allowed.append((route, location))
        if not allowed:
            return None
        if target_route_key:
            exact = next((item for item in allowed if item[0].route_key == target_route_key), None)
            if exact is not None:
                return exact
        return allowed[0]
