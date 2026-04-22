from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.entities import Actor, ConsequenceThread, Event, Memory, NPCProfile, OutboxEvent, Relationship
from app.modules.actor.service import adjust_relationship_strength
from app.modules.llm_harness.service import CouncilRoleRun, ModelRouter, PromptExecutionOutcome
from app.modules.world_memory.service import MemoryService, build_retrieval_query_text
from app.modules.world_state.consequence import relationship_band, relationship_summary, thread_summary, thread_title
from app.modules.world_state.scene import SceneFrameEngine


AmbientBeatKind = Literal["observe", "murmur", "reassure", "question", "withdraw"]


class AmbientMemoryManagerPayload(BaseModel):
    memory_summary: str = Field(min_length=1)
    focus_memories: list[str] = Field(default_factory=list)
    scene_summary: str = Field(min_length=1)
    rumor_focus: str = Field(min_length=1)


class AmbientNPCManagerPayload(BaseModel):
    beat_kind: Literal["observe", "murmur", "reassure", "question", "withdraw"]
    summary: str = Field(min_length=1)
    tension_band: Literal["low", "medium", "high"] = "medium"


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
class _NPCParticipant:
    actor: Actor
    profile: NPCProfile


def _routine_state_with_defaults(profile: NPCProfile) -> dict[str, Any]:
    routine_state = dict(profile.routine_state or {})
    routine_state.setdefault("routine_role", "watcher")
    routine_state.setdefault("beat_state", "observe")
    routine_state.setdefault("attention_target_actor_id", None)
    routine_state.setdefault("last_ambient_turn_id", None)
    routine_state.setdefault("rumor_focus", "the square")
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


def list_plaza_figures(db: Session, world_id: str, actor_id: str, location_id: str | None) -> list[dict[str, Any]]:
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
                "summary": f"{npc.display_name} keeps to the square as the {routine_role}, carrying a {tension_band} edge while the scene reads as {band}.",
            }
        )
    return summaries


def list_local_figures(db: Session, world_id: str, actor_id: str, location_id: str | None) -> list[dict[str, Any]]:
    return list_plaza_figures(db, world_id, actor_id, location_id)


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
    scene_summary = str((session_state.get("current_scene") or {}).get("summary") or "The square holds its breath.")
    rumor_focus = str(_routine_state_with_defaults(participant.profile).get("rumor_focus") or "the square")
    return AmbientMemoryManagerPayload(
        memory_summary=f"{participant.actor.display_name} keeps the square in mind through {rumor_focus}.",
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
    thread_types = {str(item.get("thread_type") or "") for item in (session_state.get("active_consequence_threads") or [])}
    if "promise" in thread_types:
        return AmbientNPCManagerPayload(
            beat_kind="murmur",
            summary=f"{participant.actor.display_name} lets a low rumor move through the square about a promise still hanging in the air.",
            tension_band="medium",
        )
    if "scrutiny" in thread_types:
        return AmbientNPCManagerPayload(
            beat_kind="question",
            summary=f"{participant.actor.display_name} turns a sharper question toward the square, testing who still means what they said.",
            tension_band="high",
        )
    routine_role = str(routine_state.get("routine_role") or "watcher")
    return AmbientNPCManagerPayload(
        beat_kind="observe",
        summary=f"{participant.actor.display_name} keeps the plaza in view as the {routine_role}, watching how the air settles after the player's move.",
        tension_band=str(routine_state.get("tension_band") or "medium"),  # type: ignore[arg-type]
    )


def _normalize_beat_payload(
    participant: _NPCParticipant,
    *,
    beat_payload: AmbientNPCManagerPayload,
    session_state: dict[str, Any],
) -> AmbientNPCManagerPayload:
    thread_types = {str(item.get("thread_type") or "") for item in (session_state.get("active_consequence_threads") or [])}
    if "scrutiny" in thread_types and beat_payload.beat_kind in {"observe", "withdraw"}:
        return AmbientNPCManagerPayload(
            beat_kind="question",
            summary=(
                f"{participant.actor.display_name} turns a sharper question through the square, "
                "pressing on the unease that is already being watched."
            ),
            tension_band="high",
        )
    if "promise" in thread_types and beat_payload.beat_kind in {"observe", "withdraw"}:
        return AmbientNPCManagerPayload(
            beat_kind="murmur",
            summary=(
                f"{participant.actor.display_name} lets a low murmur move across the plaza about a promise "
                "that is still waiting to be answered."
            ),
            tension_band="medium",
        )
    return beat_payload


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
    def __init__(self, settings: Settings, model_router: ModelRouter, memory_service: MemoryService) -> None:
        self.settings = settings
        self.model_router = model_router
        self.memory_service = memory_service

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
                f"location={session_state.get('location', {}).get('name', 'Founders Reach')}",
                f"npc={participant.actor.display_name}",
                f"routine_role={routine_state.get('routine_role')}",
            ]
            retrieval = self.memory_service.search(
                db,
                world_id=world_id,
                query_text=build_retrieval_query_text(
                    f"{participant.actor.display_name} reacts to the square after {session_state.get('recent_consequence_history', ['the latest turn'])[0] if session_state.get('recent_consequence_history') else 'the latest turn'}",
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
                    "npc_name": participant.actor.display_name,
                    "routine_state": routine_state,
                    "relevant_memories": relevant_memories,
                    "relationship_summaries": session_state.get("relationships") or [],
                    "active_consequence_threads": session_state.get("active_consequence_threads") or [],
                    "recent_scene_history": session_state.get("recent_scene_history") or [],
                    "recent_world_beats": session_state.get("recent_world_beats") or [],
                    "ambient_murmurs": session_state.get("ambient_murmurs") or [],
                    "current_scene": session_state.get("current_scene") or {},
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
                    "npc_name": participant.actor.display_name,
                    "routine_state": routine_state,
                    "memory_summary": memory_payload.memory_summary,
                    "focus_memories": memory_payload.focus_memories,
                    "scene_summary": memory_payload.scene_summary,
                    "rumor_focus": memory_payload.rumor_focus,
                    "active_consequence_threads": session_state.get("active_consequence_threads") or [],
                    "recent_world_beats": session_state.get("recent_world_beats") or [],
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
            visible_summary = summary.strip() or f"{participant.actor.display_name} lets a rumor move through the square."
        elif beat_kind == "reassure":
            visible_summary = summary.strip() or f"{participant.actor.display_name} eases the square's edge without calling attention to it."
        elif beat_kind == "question":
            visible_summary = summary.strip() or f"{participant.actor.display_name} asks a sharper question of what the square has just seen."
        elif beat_kind == "withdraw":
            visible_summary = summary.strip() or f"{participant.actor.display_name} steps back and leaves the plaza listening to itself."
        else:
            visible_summary = summary.strip() or f"{participant.actor.display_name} keeps watch on the plaza."

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
