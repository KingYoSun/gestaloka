from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterator

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.container import AppContainer
from app.models.entities import (
    Actor,
    ChapterTrack,
    Event,
    LLMRun,
    Location,
    OutboxEvent,
    PlayerProfile,
    SceneFrame,
    Session as GameSession,
    SPLedgerEntry,
    Turn,
    new_id,
)
from app.modules.world_pack.service import resolve_world_pack
from app.modules.actor.service import (
    ensure_relationship,
    get_player_profile,
    get_player_profile_for_user,
    get_or_create_guide_npc,
    get_guide_npc_for_location,
    lock_player_profile,
    player_profile_to_dict,
)
from app.modules.economy_sp.service import InsufficientSPError, SPMutationResult
from app.modules.gm_council.service import CouncilRequest
from app.modules.identity.oidc import UserIdentity
from app.modules.session.progress import elapsed_ms_since, emit_turn_progress
from app.modules.world_memory.service import build_retrieval_query_text, retrieval_trace_to_dict
from app.modules.world_state.branch import BranchCommitDraft, BranchPressureEngine, ensure_route_pressures
from app.modules.world_state.consequence import fallback_consequence_tags, scene_tone_for_band
from app.modules.world_state.entity_generation import materialize_entity_drafts
from app.modules.world_state.rules import normalize_world_tags
from app.modules.world_state.shared_consequence import SharedConsequenceResult, apply_shared_consequence_rules
from app.modules.world_state.timeline import (
    ResourceRef,
    canonicalize_event,
    consume_broadcast_constraints,
    create_broadcast_from_turn,
    create_timeline_entry,
    create_timeline_constraint,
    pending_broadcast_constraints,
    plan_shared_resources,
    release_resources,
    reserve_resources,
    skipped_resource_constraints,
    sync_active_broadcast_deliveries,
)
from app.modules.world_state.service import (
    apply_quest_lifecycle_action,
    apply_dynamic_chapter_progression,
    apply_scene_updates,
    apply_consequence_updates,
    apply_world_tag_updates,
    build_session_state,
    create_dynamic_quest_offer,
    ensure_starter_location,
    ensure_world,
    ensure_world_slice_seed,
    get_location_summary,
    get_location_by_key,
    quest_offer_repeats_resolution,
    record_quest_resolution_hint,
    travel_to_location,
    use_reward_item,
)

CHOICE_ORDER = ("safe", "progress", "explore")


def _session_has_live_quest(session_state: dict[str, Any], *, statuses: set[str] | None = None) -> bool:
    target_statuses = statuses or {"offered", "active", "paused"}
    return any(
        isinstance(item, dict) and str(item.get("status") or "") in target_statuses
        for item in session_state.get("quests") or []
    )


def _filter_dynamic_quest_offer_for_turn(
    offer: dict[str, Any] | None,
    *,
    resolution_summary: str | None,
    suppress_for_active_focus: bool = False,
) -> dict[str, Any] | None:
    if not isinstance(offer, dict) or not offer:
        return None
    if suppress_for_active_focus:
        return None
    if quest_offer_repeats_resolution(offer=offer, resolution_summary=resolution_summary):
        return None
    return offer


@contextmanager
def _turn_progress_span(phase: str, *, detail: str | None = None) -> Iterator[None]:
    started_at = time.perf_counter()
    emit_turn_progress(phase=phase, status="started", elapsed_ms=0, detail=detail)
    try:
        yield
    except Exception:
        emit_turn_progress(
            phase=phase,
            status="failed",
            elapsed_ms=elapsed_ms_since(started_at),
            detail=detail,
        )
        raise
    else:
        emit_turn_progress(
            phase=phase,
            status="completed",
            elapsed_ms=elapsed_ms_since(started_at),
            detail=detail,
        )


@dataclass
class SessionCreationResult:
    session: GameSession
    world: object
    player_actor: object
    player_profile: dict[str, object]
    guide_npc: object
    starter_location: object
    websocket_url: str


@dataclass
class TurnResolutionResult:
    turn: Turn
    event: Event
    memory_ids: list[str]
    event_payload: dict
    memories_payload: list[dict]
    graph_context_status: str
    sp_delta: int
    sp_balance: int
    paid_sp: int
    bonus_sp: int
    sp_ledger_id: str
    quest_updates: list[dict]
    faction_updates: list[dict]
    inventory_updates: list[dict]
    relationship_updates: list[dict]
    consequence_updates: list[dict]
    scene_updates: list[dict]
    chapter_updates: list[dict]
    branch_updates: list[dict]
    ambient_updates: list[dict]
    location_updates: list[dict]
    action_type: str
    input_mode: str
    interpreted_intent: dict[str, Any]
    next_choices: list[dict[str, Any]]
    consequence_summary: str
    scene_tone: str
    scene_summary: str
    crossroads_summary: str
    current_location: dict[str, Any] | None
    travel_summary: str | None
    recent_world_beats: list[str]
    recent_offstage_beats: list[str]
    idle_updates: list[dict[str, Any]]
    progress_phases: list[str]
    failure: dict[str, Any] | None = None
    error_detail: str | None = None
    status_code: int = 200

    @property
    def succeeded(self) -> bool:
        return self.error_detail is None


@dataclass
class PreparedTurnContext:
    session: GameSession
    player_actor: Actor
    guide_npc: Actor
    location_id: str
    turn_id: str
    debit: SPMutationResult
    input_mode: str


def _profile_prefers_english(profile_payload: dict[str, object]) -> bool:
    play_language = profile_payload.get("play_language") if isinstance(profile_payload, dict) else {}
    play_language = play_language if isinstance(play_language, dict) else {}
    return (
        str(play_language.get("preset") or "").strip().lower() == "en"
        or str(play_language.get("prompt_name") or "").strip().lower() == "english"
    )


def _bootstrap_text(template: Any, field: str, *, english: bool) -> str:
    bootstrap = template.bootstrap
    if english:
        localized = str(getattr(bootstrap, f"{field}_en", "") or "").strip()
        if localized:
            return localized
    return str(getattr(bootstrap, field, "") or "").strip()


def _opening_narrative(template: Any, *, profile_payload: dict[str, object], starter_location: Location, guide_npc: Actor) -> str:
    english = _profile_prefers_english(profile_payload)
    narrative = _bootstrap_text(template, "opening_narrative", english=english)
    if narrative:
        return narrative
    if english:
        return (
            f"{starter_location.name} is the first threshold into the city. "
            f"{guide_npc.display_name} is watching a disturbed arrival record and asks for calm help."
        )
    return (
        f"{starter_location.name}。ここは、この世界へ入る最初の場所だ。"
        f"{guide_npc.display_name}が乱れた到着記録を見つめ、落ち着いた助けを求めている。"
    )


def _ensure_opening_scene_seed(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    location_id: str,
    focus_actor_id: str,
    source_event_id: str,
    template: Any,
    profile_payload: dict[str, object],
) -> None:
    existing_scene = db.execute(
        select(SceneFrame)
        .where(
            SceneFrame.world_id == world_id,
            SceneFrame.owner_actor_id == actor_id,
            SceneFrame.status.in_(("active", "cooling")),
        )
        .order_by((SceneFrame.status == "active").desc(), SceneFrame.updated_at.desc(), SceneFrame.id.desc())
        .limit(1)
    ).scalar_one_or_none()

    english = _profile_prefers_english(profile_payload)
    starter_location = template.locations.get(template.roles.starter_location_key)
    situation = _bootstrap_text(template, "opening_situation", english=english)
    if not situation:
        situation = str(getattr(starter_location, "description", "") or "").strip() or "The first scene is ready."
    pressure = _bootstrap_text(template, "opening_pressure", english=english)
    if not pressure:
        pressure = str(template.bootstrap.start_consequence_summary or "").strip()
    title = _bootstrap_text(template, "opening_title", english=english)
    chapter_key = str(template.roles.opening_chapter_key or "")
    now = datetime.now(timezone.utc)
    chapter: ChapterTrack | None = None
    if chapter_key:
        chapter = db.execute(
            select(ChapterTrack).where(
                ChapterTrack.world_id == world_id,
                ChapterTrack.owner_actor_id == actor_id,
                ChapterTrack.chapter_key == chapter_key,
            )
        ).scalar_one_or_none()
        chapter_summary = title or situation
        if chapter is None:
            chapter = ChapterTrack(
                world_id=world_id,
                owner_actor_id=actor_id,
                chapter_key=chapter_key,
                chapter_kind="ambient",
                status="active",
                summary=chapter_summary,
                opening_event_id=source_event_id,
                opened_at=now,
            )
            db.add(chapter)
            db.flush()
        elif not str(chapter.summary or "").strip():
            chapter.summary = chapter_summary
            chapter.opening_event_id = chapter.opening_event_id or source_event_id
            chapter.updated_at = now
            db.flush()

    if existing_scene is not None:
        existing_scene.chapter_track_id = chapter.id if chapter is not None else existing_scene.chapter_track_id
        existing_scene.scene_phase = "establish"
        existing_scene.status = "active"
        existing_scene.location_id = location_id
        existing_scene.focus_actor_id = focus_actor_id
        existing_scene.stakes_summary = situation
        existing_scene.pressure_summary = pressure
        existing_scene.opening_event_id = existing_scene.opening_event_id or source_event_id
        existing_scene.updated_at = now
        db.flush()
        return

    db.add(
        SceneFrame(
            world_id=world_id,
            owner_actor_id=actor_id,
            chapter_track_id=chapter.id if chapter is not None else None,
            scene_phase="establish",
            status="active",
            location_id=location_id,
            focus_actor_id=focus_actor_id,
            stakes_summary=situation,
            pressure_summary=pressure,
            opening_event_id=source_event_id,
            opened_at=now,
        )
    )
    db.flush()


def create_session_for_user(
    db: Session,
    container: AppContainer,
    user: UserIdentity,
    world_id: str,
    *,
    pack_id: str,
    world_template_id: str,
    world_name: str | None = None,
    player_actor_id: str,
) -> SessionCreationResult:
    world = ensure_world(
        db,
        world_id,
        pack_id=pack_id,
        world_template_id=world_template_id,
        world_name=world_name,
    )
    _, template = resolve_world_pack(db, world_id)
    starter_location = ensure_starter_location(db, world_id)
    player_row = get_player_profile_for_user(db, world_id, user.sub, player_actor_id)
    if player_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player profile not found")
    player_actor, profile = player_row
    seeded = ensure_world_slice_seed(
        db,
        world_id=world_id,
        player_actor_id=player_actor.id,
    )
    existing_session = db.execute(
        select(GameSession)
        .where(
            GameSession.world_id == world.id,
            GameSession.player_actor_id == player_actor.id,
            GameSession.status == "active",
        )
        .order_by(GameSession.updated_at.desc(), GameSession.created_at.desc(), GameSession.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    if existing_session is not None:
        current_location_id = player_actor.current_location_id or starter_location.id
        current_location = db.execute(
            select(Location).where(Location.world_id == world.id, Location.id == current_location_id)
        ).scalar_one_or_none() or starter_location
        guide_npc = get_or_create_guide_npc(db, world_id, location_id=current_location.id)
        ensure_relationship(
            db,
            world_id=world_id,
            from_actor_id=player_actor.id,
            to_actor_id=guide_npc.id,
            relationship_type="KNOWS",
            strength=0.55,
        )
        ensure_relationship(
            db,
            world_id=world_id,
            from_actor_id=guide_npc.id,
            to_actor_id=player_actor.id,
            relationship_type="KNOWS",
            strength=0.55,
        )
        lock_player_profile(profile)
        profile_payload = player_profile_to_dict(player_actor, profile)
        sync_active_broadcast_deliveries(
            db,
            world_id=world.id,
            session_id=existing_session.id,
            actor_id=player_actor.id,
            location_id=current_location.id,
        )
        websocket_url = f"{container.settings.public_ws_base_url.rstrip('/')}/ws/sessions/{existing_session.id}"
        return SessionCreationResult(
            session=existing_session,
            world=world,
            player_actor=player_actor,
            player_profile=profile_payload,
            guide_npc=guide_npc,
            starter_location=current_location,
            websocket_url=websocket_url,
        )
    if player_actor.current_location_id != starter_location.id:
        player_actor.current_location_id = starter_location.id
        db.flush()
    guide_npc = get_or_create_guide_npc(db, world_id, location_id=starter_location.id)
    ensure_relationship(
        db,
        world_id=world_id,
        from_actor_id=player_actor.id,
        to_actor_id=guide_npc.id,
        relationship_type="KNOWS",
        strength=0.55,
    )
    ensure_relationship(
        db,
        world_id=world_id,
        from_actor_id=guide_npc.id,
        to_actor_id=player_actor.id,
        relationship_type="KNOWS",
        strength=0.55,
    )
    bootstrap_state = build_session_state(
        db,
        world_id=world.id,
        actor_id=player_actor.id,
        location_id=starter_location.id,
    )

    session = GameSession(world_id=world.id, player_actor_id=player_actor.id, status="active")
    db.add(session)
    db.flush()
    bootstrap_turn = Turn(
        world_id=world.id,
        session_id=session.id,
        actor_id=player_actor.id,
        input_text="[session started]",
        resolved_output={
            "status": "system",
            "action_type": "system",
            "input_mode": "choice",
            "next_choices": bootstrap_state["next_choices"],
            "consequence_summary": str(template.bootstrap.start_consequence_summary),
        },
        model_lane="system",
        action_type="system",
        resolution_mode="system",
    )
    db.add(bootstrap_turn)
    db.flush()

    if profile.profile_setup_event_id is None:
        profile_event = _materialize_player_profile_setup(
            db,
            container,
            session=session,
            turn=bootstrap_turn,
            player_actor=player_actor,
            profile=profile,
            location_id=starter_location.id,
        )
        profile.profile_setup_event_id = profile_event.id
    lock_player_profile(profile)
    profile_payload = player_profile_to_dict(player_actor, profile)

    bootstrap_payload = {
        "session_id": session.id,
        "world_id": world.id,
        "pack_id": pack_id,
        "world_template_id": world_template_id,
        "npc_actor_id": guide_npc.id,
        "location_id": starter_location.id,
        "faction_id": seeded.faction.id,
        "player_profile": profile_payload,
    }
    if seeded.quest_assignment is not None:
        bootstrap_payload["quest_assignment_id"] = seeded.quest_assignment.id

    bootstrap_event = Event(
        world_id=world.id,
        session_id=session.id,
        turn_id=bootstrap_turn.id,
        event_type="session.started",
        source_actor_id=player_actor.id,
        location_id=starter_location.id,
        payload=bootstrap_payload,
        narrative=str(template.bootstrap.session_started_narrative).format(
            player_name=player_actor.display_name,
            starter_location_name=starter_location.name,
            guide_npc_name=guide_npc.display_name,
            faction_name=seeded.faction.name,
        ),
    )
    db.add(bootstrap_event)
    db.flush()
    db.add(
        OutboxEvent(
            world_id=world.id,
            event_id=bootstrap_event.id,
            projection_type="world_graph.upsert",
            payload={"reason": "session_started", "session_id": session.id},
        )
    )
    db.flush()
    _finalize_event_timeline_and_broadcast(db, event=bootstrap_event)
    opening_event = Event(
        world_id=world.id,
        session_id=session.id,
        turn_id=bootstrap_turn.id,
        event_type="player.story.opening",
        source_actor_id=player_actor.id,
        location_id=starter_location.id,
        payload={
            "action_type": "story_opening",
            "player_visible": True,
            "title": _bootstrap_text(
                template,
                "opening_title",
                english=_profile_prefers_english(profile_payload),
            ),
        },
        narrative=_opening_narrative(
            template,
            profile_payload=profile_payload,
            starter_location=starter_location,
            guide_npc=guide_npc,
        ),
    )
    db.add(opening_event)
    db.flush()
    canonicalize_event(
        db,
        opening_event,
        entry_kind="event",
        scope_kind="story_opening",
        affected_location_ids=[starter_location.id],
        narrative_constraint=str(opening_event.payload.get("title") or ""),
        payload={"event_type": opening_event.event_type, "turn_id": opening_event.turn_id},
    )
    _ensure_opening_scene_seed(
        db,
        world_id=world.id,
        actor_id=player_actor.id,
        location_id=starter_location.id,
        focus_actor_id=guide_npc.id,
        source_event_id=opening_event.id,
        template=template,
        profile_payload=profile_payload,
    )
    sync_active_broadcast_deliveries(
        db,
        world_id=world.id,
        session_id=session.id,
        actor_id=player_actor.id,
        location_id=starter_location.id,
    )

    websocket_url = f"{container.settings.public_ws_base_url.rstrip('/')}/ws/sessions/{session.id}"
    return SessionCreationResult(
        session=session,
        world=world,
        player_actor=player_actor,
        player_profile=profile_payload,
        guide_npc=guide_npc,
        starter_location=starter_location,
        websocket_url=websocket_url,
    )


def _materialize_player_profile_setup(
    db: Session,
    container: AppContainer,
    *,
    session: GameSession,
    turn: Turn,
    player_actor: Actor,
    profile: PlayerProfile,
    location_id: str | None,
) -> Event:
    profile_payload = player_profile_to_dict(player_actor, profile)
    narrative_preferences = dict(profile_payload.get("narrative_preferences") or {})
    background = str(profile.background or "").strip()
    free_text = str(profile.free_text or "").strip()
    actor_memory_parts = [
        f"{player_actor.display_name} enters this world with gender={profile.gender}.",
    ]
    if background:
        actor_memory_parts.append(f"Self-declared background: {background}")
    if free_text:
        actor_memory_parts.append(f"Self-declared notes: {free_text}")
    actor_memory_parts.append(
        "Narrative preferences: "
        f"perspective={narrative_preferences.get('perspective')}; "
        f"tone={narrative_preferences.get('tone')}; "
        f"density={narrative_preferences.get('density')}; "
        f"dialogue_style={narrative_preferences.get('dialogue_style')}."
    )
    public_summary = f"{player_actor.display_name} has entered the world as a player-authored profile."
    event = Event(
        world_id=session.world_id,
        session_id=session.id,
        turn_id=turn.id,
        event_type="player.profile.created",
        source_actor_id=player_actor.id,
        location_id=location_id,
        payload={
            "actor_id": player_actor.id,
            "player_profile": profile_payload,
            "profile_source": "self_declared",
        },
        narrative=public_summary,
    )
    db.add(event)
    db.flush()
    container.memory_service.materialize_memories(
        db,
        world_id=session.world_id,
        source_event_id=event.id,
        location_id=location_id,
        drafts=[
            {
                "scope": "actor",
                "actor_id": player_actor.id,
                "text": " ".join(actor_memory_parts),
                "salience": 0.95,
            },
            {
                "scope": "world",
                "text": public_summary,
                "salience": 0.65,
            },
        ],
    )
    db.add(
        OutboxEvent(
            world_id=session.world_id,
            event_id=event.id,
            projection_type="world_graph.upsert",
            payload={"reason": "player_profile_created", "session_id": session.id, "actor_id": player_actor.id},
        )
    )
    db.flush()
    _finalize_event_timeline_and_broadcast(db, event=event)
    return event


def resolve_turn_for_session(
    db: Session,
    container: AppContainer,
    prepared: PreparedTurnContext,
    *,
    action_type: str | None = None,
    input_mode: str = "choice",
    choice_id: str | None = None,
    input_text: str | None = None,
    item_id: str | None = None,
    quest_assignment_id: str | None = None,
) -> TurnResolutionResult:
    trace_context = container.observability_service.langfuse_trace(
        seed_id=prepared.turn_id,
        name="player_turn",
        input_payload={
            "session_id": prepared.session.id,
            "world_id": prepared.session.world_id,
            "action_type": action_type or "narrative",
            "input_mode": input_mode,
            "choice_id": choice_id,
            "input_text": input_text,
            "item_id": item_id,
            "quest_assignment_id": quest_assignment_id,
        },
        metadata={
            "world_id": prepared.session.world_id,
            "session_id": prepared.session.id,
            "turn_id": prepared.turn_id,
            "action_type": action_type or "narrative",
            "input_mode": input_mode,
        },
        user_id=prepared.player_actor.user_sub,
        session_id=prepared.session.id,
        tags=[container.settings.app_runtime_role],
    )
    with trace_context as trace_link:
        if action_type in {"accept_quest", "decline_quest", "leave_quest", "resume_quest"}:
            if quest_assignment_id is None:
                raise ValueError("quest_assignment_id is required for quest lifecycle turns")
            result = _resolve_quest_lifecycle_turn_for_session(
                db,
                container,
                prepared,
                action_type=action_type,
                quest_assignment_id=quest_assignment_id,
                input_mode=input_mode,
            )
        elif action_type == "use_reward_item":
            if item_id is None:
                raise ValueError("item_id is required for use_reward_item")
            result = _resolve_reward_item_turn_for_session(
                db,
                container,
                prepared,
                item_id=item_id,
                input_mode=input_mode,
            )
        elif input_mode == "choice":
            if choice_id is None:
                raise ValueError("choice_id is required for choice turns")
            session_state = _session_state_with_latest_choices(
                db,
                session_id=prepared.session.id,
                world_id=prepared.session.world_id,
                actor_id=prepared.player_actor.id,
                location_id=prepared.location_id,
            )
            selected_choice = _select_choice(session_state.get("next_choices") or [], choice_id)
            if selected_choice is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"Unknown choice_id: {choice_id}",
                )
            input_text = str(selected_choice.get("canonical_input_text") or selected_choice.get("label") or "").strip()
            if not input_text:
                raise ValueError("Selected choice is missing canonical_input_text")
            result = _resolve_narrative_turn_for_session(
                db,
                container,
                prepared,
                input_mode="choice",
                input_text=input_text,
                selected_choice=selected_choice,
            )
        else:
            if input_text is None:
                raise ValueError("input_text is required for free_text turns")
            result = _resolve_narrative_turn_for_session(
                db,
                container,
                prepared,
                input_mode=input_mode,
                input_text=input_text,
            )

    _apply_langfuse_trace_to_turn(result.turn, trace_link)
    return result


def _persist_role_runs(
    db: Session,
    *,
    world_id: str,
    turn_id: str,
    workflow_name: str,
    role_runs: list[Any],
    graph_context_status: str,
) -> None:
    for role_run in role_runs:
        for attempt in role_run.attempts:
            db.add(
                LLMRun(
                    world_id=world_id,
                    turn_id=turn_id,
                    prompt_id=attempt.prompt_id,
                    workflow_name=workflow_name,
                    council_role=role_run.council_role,
                    stage_index=role_run.stage_index,
                    approval_status=(
                        "schema_invalid"
                        if attempt.output_schema_status != "valid"
                        else role_run.approval_status
                    ),
                    model_id=attempt.model_id,
                    model_lane=attempt.model_lane,
                    provider_name=attempt.provider_name,
                    provider_response_id=attempt.provider_response_id,
                    prompt_tokens=attempt.prompt_tokens,
                    completion_tokens=attempt.completion_tokens,
                    total_tokens=attempt.total_tokens,
                    prompt_cache_hit_tokens=attempt.prompt_cache_hit_tokens,
                    prompt_cache_miss_tokens=attempt.prompt_cache_miss_tokens,
                    input_hash=attempt.input_hash,
                    input_context_hash=attempt.input_context_hash,
                    schema_version=attempt.schema_version,
                    graph_context_status=graph_context_status,
                    output_schema_status=attempt.output_schema_status,
                    output_payload=attempt.output_payload,
                    langfuse_trace_id=attempt.langfuse_trace_id,
                    langfuse_observation_id=attempt.langfuse_observation_id,
                    langfuse_trace_url=attempt.langfuse_trace_url,
                    langfuse_status=attempt.langfuse_status,
                )
            )


def _run_ambient_world_pass(
    db: Session,
    container: AppContainer,
    *,
    game_session: GameSession,
    player_actor: Actor,
    turn: Turn,
    location_id: str | None,
    session_state: dict[str, Any],
) -> dict[str, Any]:
    ambient_context = container.observability_service.langfuse_observation(
        name="ambient_world_pass",
        as_type="agent",
        input_payload={
            "session_id": game_session.id,
            "player_turn_id": turn.id,
            "location_id": location_id,
        },
        metadata={
            "world_id": game_session.world_id,
            "session_id": game_session.id,
            "turn_id": turn.id,
            "location_id": location_id,
            "runtime_role": container.settings.app_runtime_role,
        },
    )
    with ambient_context as langfuse_link:
        ambient_result = container.ambient_world_service.run(
            db,
            world_id=game_session.world_id,
            session_id=game_session.id,
            player_turn_id=turn.id,
            player_actor_id=player_actor.id,
            player_name=player_actor.display_name,
            location_id=location_id,
            session_state=session_state,
        )
        observation = getattr(langfuse_link, "observation", None)
        if observation is not None:
            try:
                observation.update(
                    output={
                        "updates": ambient_result.updates,
                        "recent_world_beats": ambient_result.recent_world_beats,
                        "scene_summary": ambient_result.scene_summary,
                    },
                    metadata={
                        "world_id": game_session.world_id,
                        "turn_id": turn.id,
                        "location_id": location_id,
                    },
                )
            except Exception:
                langfuse_link.status = "degraded"
    _persist_role_runs(
        db,
        world_id=game_session.world_id,
        turn_id=turn.id,
        workflow_name="ambient_world_pass",
        role_runs=ambient_result.role_runs,
        graph_context_status="ready",
    )
    return {
        "ambient_updates": ambient_result.updates,
        "recent_world_beats": ambient_result.recent_world_beats,
        "scene_updates": ambient_result.scene_updates,
        "chapter_updates": ambient_result.chapter_updates,
        "scene_summary": ambient_result.scene_summary,
    }


def _apply_langfuse_trace_to_turn(turn: Turn, trace_link: Any) -> None:
    turn.langfuse_trace_id = getattr(trace_link, "trace_id", None)
    turn.langfuse_trace_url = getattr(trace_link, "trace_url", None)
    turn.langfuse_status = getattr(trace_link, "status", "disabled")
    if isinstance(turn.resolved_output, dict):
        turn.resolved_output = {
            **turn.resolved_output,
            "langfuse_trace_id": turn.langfuse_trace_id,
            "langfuse_trace_url": turn.langfuse_trace_url,
            "langfuse_status": turn.langfuse_status,
        }


def _persist_branch_commit(
    db: Session,
    container: AppContainer,
    *,
    game_session: GameSession,
    turn: Turn,
    player_actor: Actor,
    location_id: str | None,
    commit: BranchCommitDraft,
) -> tuple[Event, list[Any]]:
    event = Event(
        world_id=game_session.world_id,
        session_id=game_session.id,
        turn_id=turn.id,
        event_type=commit.event_type,
        source_actor_id=player_actor.id,
        location_id=location_id,
        payload={
            **commit.payload,
            "action_type": turn.action_type,
            "resolution_mode": turn.resolution_mode,
        },
        narrative=commit.narrative,
    )
    db.add(event)
    db.flush()
    memories = container.memory_service.materialize_memories(
        db,
        world_id=game_session.world_id,
        source_event_id=event.id,
        location_id=location_id,
        drafts=commit.memory_drafts,
    )
    db.add(
        OutboxEvent(
            world_id=game_session.world_id,
            event_id=event.id,
            projection_type="world_graph.upsert",
            payload={
                "turn_id": turn.id,
                "outcome": "branch_commit",
                "location_id": location_id,
            },
        )
    )
    db.flush()
    canonicalize_event(
        db,
        event,
        entry_kind="branch_commit",
        scope_kind="chapter",
        affected_location_ids=[location_id] if location_id else [],
        payload={"turn_id": turn.id, "branch_commit": True},
    )
    return event, memories


def _branch_response_from_state(session_state: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    chapter = session_state.get("chapter") or {}
    crossroads_summary = str(chapter.get("crossroads_summary") or "").strip()
    branch_hint = str(chapter.get("branch_hint") or "").strip()
    branch_status = str(chapter.get("branch_status") or "")
    if not crossroads_summary:
        return [], ""
    action = "committed" if branch_status == "committed" else "crossroads_opened"
    return (
        [
            {
                "action": action,
                "summary": crossroads_summary,
                "branch_hint": branch_hint or crossroads_summary,
                "crossroads_summary": crossroads_summary,
            }
        ],
        crossroads_summary,
    )


def _pre_intent_action_kind(selected_choice: dict[str, Any] | None, input_mode: str, input_text: str) -> str:
    if selected_choice:
        action_kind = str(selected_choice.get("action_kind") or "narrative").strip()
        return action_kind if action_kind in {"narrative", "use_reward_item", "travel"} else "narrative"
    normalized = input_text.lower()
    if any(token in normalized for token in ("向か", "行く", "進む", "移動", "go to", "head to", "walk to", "toward")):
        return "travel"
    return "narrative"


def _pre_intent_consequence_tags(selected_choice: dict[str, Any] | None) -> list[str]:
    posture = str((selected_choice or {}).get("posture") or "")
    if posture == "progress":
        return ["earned_trust"]
    if posture in {"safe", "explore"}:
        return ["careful_observation"]
    return []


def _reserve_turn_resources(
    db: Session,
    *,
    prepared: PreparedTurnContext,
    session_state: dict[str, Any],
    selected_choice: dict[str, Any] | None,
    input_mode: str,
    input_text: str,
    interpreted_intent: dict[str, Any] | None = None,
) -> tuple[list[ResourceRef], list[Any], list[dict[str, Any]]]:
    action_kind = str((interpreted_intent or {}).get("canonical_action_kind") or "").strip()
    if action_kind not in {"narrative", "use_reward_item", "travel"}:
        action_kind = _pre_intent_action_kind(selected_choice, input_mode, input_text)
    consequence_tags = [
        str(item) for item in ((interpreted_intent or {}).get("consequence_tags") or _pre_intent_consequence_tags(selected_choice))
    ]
    resources = plan_shared_resources(
        db,
        world_id=prepared.session.world_id,
        location_id=prepared.location_id,
        guide_actor_id=prepared.guide_npc.id if prepared.guide_npc is not None else None,
        session_state=session_state,
        selected_choice=selected_choice,
        action_kind=action_kind,
        consequence_tags=consequence_tags,
    )
    reservation = reserve_resources(
        db,
        world_id=prepared.session.world_id,
        session_id=prepared.session.id,
        turn_id=prepared.turn_id,
        resources=resources,
    )
    constraints = reservation.constraints
    if constraints:
        session_state["resource_constraints"] = constraints
        shared_context = dict(session_state.get("shared_world_context") or {})
        shared_context["resource_constraints"] = constraints
        session_state["shared_world_context"] = shared_context
    return resources, reservation.held, constraints


def _finalize_event_timeline_and_broadcast(
    db: Session,
    *,
    event: Event,
    resource_constraints: list[dict[str, Any]] | None = None,
    broadcast_draft: dict[str, Any] | None = None,
    shared_action_tag: str = "none",
    relevance_tags: list[str] | None = None,
) -> None:
    affected_locations = [event.location_id] if event.location_id else []
    canonicalize_event(
        db,
        event,
        entry_kind="event",
        scope_kind=str((event.payload or {}).get("action_type") or "event"),
        affected_location_ids=affected_locations,
        narrative_constraint=str((event.payload or {}).get("consequence_summary") or ""),
        payload={"event_type": event.event_type, "turn_id": event.turn_id},
    )
    if resource_constraints:
        create_timeline_constraint(
            db,
            world_id=event.world_id,
            source_event_id=event.id,
            location_id=event.location_id,
            constraints=resource_constraints,
        )
    broadcast, deliveries = create_broadcast_from_turn(
        db,
        event=event,
        broadcast_draft=broadcast_draft,
        action_tag=shared_action_tag,
        relevance_tags=relevance_tags,
    )
    if broadcast is not None:
        event.payload = {
            **dict(event.payload or {}),
            "world_broadcast_event": {
                "id": broadcast.id,
                "semantic_key": broadcast.semantic_key,
                "status": broadcast.status,
                "affected_location_ids": list(broadcast.affected_location_ids or []),
                "delivery_session_ids": [delivery.session_id for delivery in deliveries],
            },
        }
        create_timeline_entry(
            db,
            world_id=event.world_id,
            entry_kind="world_broadcast_event",
            source_event_id=event.id,
            scope_kind=broadcast.scope_kind,
            location_id=event.location_id,
            affected_location_ids=list(broadcast.affected_location_ids or []),
            status=broadcast.status,
            narrative_constraint=broadcast.constraint_text,
            payload={"broadcast_event_id": broadcast.id, "semantic_key": broadcast.semantic_key},
        )
    db.flush()


def _resolve_narrative_turn_for_session(
    db: Session,
    container: AppContainer,
    prepared: PreparedTurnContext,
    *,
    input_mode: str,
    input_text: str,
    selected_choice: dict[str, Any] | None = None,
) -> TurnResolutionResult:
    game_session = prepared.session
    player_actor = prepared.player_actor
    guide_npc = prepared.guide_npc

    turn = Turn(
        id=prepared.turn_id,
        world_id=game_session.world_id,
        session_id=game_session.id,
        actor_id=player_actor.id,
        input_text=input_text,
        resolved_output={"status": "pending"},
        model_lane="pending",
        action_type="narrative",
        resolution_mode="gm_council",
    )
    db.add(turn)
    db.flush()

    session_state = _session_state_with_latest_choices(
        db,
        session_id=game_session.id,
        world_id=game_session.world_id,
        actor_id=player_actor.id,
        location_id=prepared.location_id,
    )
    if input_mode == "free_text" and _is_read_world_state_query(input_text):
        return _resolve_read_world_state_query_turn(
            db,
            prepared,
            turn=turn,
            input_text=input_text,
            session_state=session_state,
        )
    intent_phase = container.council_service.resolve_intent(
        CouncilRequest(
            world_id=game_session.world_id,
            turn_id=turn.id,
            player_name=player_actor.display_name,
            npc_name=guide_npc.display_name,
            input_text=input_text,
            input_mode=input_mode if input_mode in {"choice", "free_text"} else "choice",
            selected_choice=selected_choice,
            relevant_memories=[],
            relation_context=[],
            graph_context_status="intent_phase",
            session_state=session_state,
        )
    )
    if not intent_phase.succeeded:
        _persist_role_runs(
            db,
            world_id=game_session.world_id,
            turn_id=turn.id,
            workflow_name="gm_council",
            role_runs=[intent_phase.role_run],
            graph_context_status="intent_phase",
        )
        failed_result = _build_failed_turn_result(
            db,
            container,
            prepared,
            turn=turn,
            action_type="narrative",
            resolution_mode="gm_council",
            action_label=input_text,
            graph_context_status="intent_phase",
            failure_reason=intent_phase.failure_reason or "Intent interpretation failed",
            model_lane=intent_phase.final_lane,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            input_mode=input_mode,
            interpreted_intent={},
            next_choices=session_state.get("next_choices") or [],
            consequence_summary="The attempted line cannot be made coherent enough to enter the world.",
            progress_phases=["intent_interpreter"],
            failure_payload={
                "failure_reason": intent_phase.failure_reason,
                "council_trace": [
                    {
                        "role": intent_phase.role_run.council_role,
                        "approval_status": intent_phase.role_run.approval_status,
                        "final_lane": intent_phase.role_run.final_lane,
                    }
                ],
            },
        )
        _finalize_event_timeline_and_broadcast(db, event=failed_result.event)
        return failed_result
    intent_payload = intent_phase.payload
    assert intent_payload is not None
    reservation_intent = intent_payload.model_dump()
    if input_mode == "choice" and selected_choice:
        selected_action_kind = str(selected_choice.get("action_kind") or "").strip()
        if selected_action_kind == "use_reward_item":
            resolved_item_id = _resolve_usable_reward_item_id(session_state)
            if resolved_item_id is not None:
                return _resolve_reward_item_turn_for_session(
                    db,
                    container,
                    prepared,
                    item_id=resolved_item_id,
                    input_mode=input_mode,
                    interpreted_intent={
                        "input_mode": input_mode,
                        "canonical_action_kind": "use_reward_item",
                        "intent_summary": str(
                            selected_choice.get("canonical_input_text") or selected_choice.get("label") or input_text
                        ).strip(),
                        "requested_choice_posture": str(selected_choice.get("posture") or "none"),
                        "fail_forward": False,
                        "consequence_flags": [],
                        "consequence_tags": ["reward_item_respect", "kept_promise"],
                        "consequence_summary": "The selected choice invokes an important reward-item affordance.",
                    },
                    progress_phases=["item_use"],
                    existing_turn=turn,
                    action_label=input_text,
                    model_lane="choice_short_circuit",
                    resolution_mode="choice_reward_item",
                    graph_context_status="ready",
                )
        if selected_action_kind == "travel":
            travel_target_key = str(selected_choice.get("travel_target_key") or "").strip()
            if travel_target_key and travel_target_key in _available_travel_target_keys(session_state):
                return _resolve_travel_turn_for_session(
                    db,
                    container,
                    prepared,
                    destination_key=travel_target_key,
                    input_mode=input_mode,
                    interpreted_intent={
                        "input_mode": input_mode,
                        "canonical_action_kind": "travel",
                        "travel_target_key": travel_target_key,
                        "intent_summary": str(
                            selected_choice.get("canonical_input_text") or selected_choice.get("label") or input_text
                        ).strip(),
                        "requested_choice_posture": str(selected_choice.get("posture") or "none"),
                        "fail_forward": False,
                        "consequence_flags": [],
                        "consequence_tags": ["careful_observation"],
                        "consequence_summary": "The player follows a route the current scene actually affords.",
                    },
                    progress_phases=["travel_resolution"],
                    existing_turn=turn,
                    action_label=input_text,
                    model_lane="choice_short_circuit",
                    resolution_mode="choice_travel",
                    graph_context_status="ready",
                )
    resource_refs, held_locks, resource_constraints = _reserve_turn_resources(
        db,
        prepared=prepared,
        session_state=session_state,
        selected_choice=selected_choice,
        input_mode=input_mode,
        input_text=input_text,
        interpreted_intent=reservation_intent,
    )
    graph_context = container.projection_service.resolve_relation_context(
        db,
        world_id=game_session.world_id,
        primary_actor_id=guide_npc.id,
        counterpart_actor_id=player_actor.id,
        location_id=prepared.location_id,
    )
    retrieval = container.memory_service.search(
        db,
        world_id=game_session.world_id,
        query_text=build_retrieval_query_text(
            input_text,
            session_state=session_state,
            relation_context=graph_context.context.prompt_lines(),
        ),
        actor_id=guide_npc.id,
        location_id=prepared.location_id,
    )
    resolution = container.council_service.resolve_turn(
        CouncilRequest(
            world_id=game_session.world_id,
            turn_id=turn.id,
            player_name=player_actor.display_name,
            npc_name=guide_npc.display_name,
            input_text=input_text,
            input_mode=input_mode if input_mode in {"choice", "free_text"} else "choice",
            selected_choice=selected_choice,
            relevant_memories=[item.text for item in retrieval.memories],
            relation_context=graph_context.context.prompt_lines(),
            graph_context_status=graph_context.status,
            session_state=session_state,
            prepared_intent_payload=intent_payload,
            prepared_intent_role_run=intent_phase.role_run,
        )
    )

    _persist_role_runs(
        db,
        world_id=game_session.world_id,
        turn_id=turn.id,
        workflow_name="gm_council",
        role_runs=resolution.role_runs,
        graph_context_status=graph_context.status,
    )

    if not resolution.succeeded:
        progress_phases = _progress_phases_from_role_runs(resolution.role_runs)
        failed_result = _build_failed_turn_result(
            db,
            container,
            prepared,
            turn=turn,
            action_type="narrative",
            resolution_mode="gm_council",
            action_label=input_text,
            graph_context_status=graph_context.status,
            failure_reason=(
                "council_rejected"
                if resolution.rejection_role in {"rules_arbiter", "safety_guard"}
                else resolution.failure_reason or "Turn resolution failed"
            ),
            model_lane=resolution.final_lane,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            input_mode=input_mode,
            interpreted_intent={},
            next_choices=session_state.get("next_choices") or [],
            consequence_summary="The world rejects the attempted line and keeps the scene moving elsewhere.",
            progress_phases=progress_phases,
            failure_payload={
                "used_fallback": resolution.used_fallback,
                "retrieval_trace": retrieval_trace_to_dict(retrieval.trace),
                "failure_reason": resolution.failure_reason,
                "rejection_role": resolution.rejection_role,
                "council_trace": [
                    {
                        "role": item.council_role,
                        "approval_status": item.approval_status,
                        "final_lane": item.final_lane,
                    }
                    for item in resolution.role_runs
                ],
            },
        )
        _finalize_event_timeline_and_broadcast(
            db,
            event=failed_result.event,
            resource_constraints=resource_constraints,
        )
        release_resources(db, held_locks)
        return failed_result

    payload = resolution.final_payload
    assert payload is not None
    progress_phases = _progress_phases_from_role_runs(resolution.role_runs)

    interpreted_intent = dict(payload.interpreted_intent or {})
    if input_mode == "choice" and selected_choice:
        forced_action_kind = str(selected_choice.get("action_kind") or "").strip()
        if forced_action_kind in {"narrative", "use_reward_item", "travel"}:
            interpreted_intent["canonical_action_kind"] = forced_action_kind
        forced_travel_target = str(selected_choice.get("travel_target_key") or "").strip()
        if forced_action_kind == "travel" and forced_travel_target:
            interpreted_intent["travel_target_key"] = forced_travel_target
        if not interpreted_intent.get("intent_summary"):
            interpreted_intent["intent_summary"] = str(
                selected_choice.get("canonical_input_text") or selected_choice.get("label") or input_text
            ).strip()
    if interpreted_intent.get("canonical_action_kind") == "use_reward_item":
        resolved_item_id = _resolve_usable_reward_item_id(session_state)
        if resolved_item_id is not None:
            redirected = _resolve_reward_item_turn_for_session(
                db,
                container,
                prepared,
                item_id=resolved_item_id,
                input_mode=input_mode,
                interpreted_intent=interpreted_intent,
                progress_phases=[*progress_phases, "item_use"],
                existing_turn=turn,
                action_label=input_text,
                model_lane=resolution.final_lane,
                resolution_mode="gm_council_item_use",
                graph_context_status=graph_context.status,
                extra_resolved_output={
                    "used_fallback": resolution.used_fallback,
                    "retrieval_trace": retrieval_trace_to_dict(retrieval.trace),
                    "graph_context_status": graph_context.status,
                    "council_trace": [
                        {
                            "role": item.council_role,
                            "approval_status": item.approval_status,
                            "final_lane": item.final_lane,
                        }
                        for item in resolution.role_runs
                    ],
                },
            )
            release_resources(db, held_locks)
            return redirected
    if interpreted_intent.get("canonical_action_kind") == "travel":
        travel_target_key = _resolve_travel_target_key(
            interpreted_intent,
            selected_choice,
            session_state=session_state,
        )
        if travel_target_key is not None:
            redirected = _resolve_travel_turn_for_session(
                db,
                container,
                prepared,
                destination_key=travel_target_key,
                input_mode=input_mode,
                interpreted_intent=interpreted_intent,
                progress_phases=[*progress_phases, "travel_resolution"],
                existing_turn=turn,
                action_label=input_text,
                model_lane=resolution.final_lane,
                resolution_mode="gm_council_travel",
                graph_context_status=graph_context.status,
                extra_resolved_output={
                    "used_fallback": resolution.used_fallback,
                    "retrieval_trace": retrieval_trace_to_dict(retrieval.trace),
                    "graph_context_status": graph_context.status,
                    "council_trace": [
                        {
                            "role": item.council_role,
                            "approval_status": item.approval_status,
                            "final_lane": item.final_lane,
                        }
                        for item in resolution.role_runs
                    ],
                },
            )
            release_resources(db, held_locks)
            return redirected

    with _turn_progress_span("world_tag_updates"):
        resolved_world_tags = _coerce_choice_world_tags(
            session_state=session_state,
            selected_choice=selected_choice,
            world_tags=payload.world_tags,
        )
        state_updates = apply_world_tag_updates(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            world_tags=resolved_world_tags,
        )

    event = Event(
        world_id=game_session.world_id,
        session_id=game_session.id,
        turn_id=turn.id,
        event_type=payload.event_type,
        source_actor_id=player_actor.id,
        location_id=prepared.location_id,
        payload={
            **payload.event_payload,
            "action_type": "narrative",
            "location_id": prepared.location_id,
            "graph_context_status": graph_context.status,
            "world_tags": resolved_world_tags,
            "quest_updates": state_updates["quest_updates"],
            "faction_updates": state_updates["faction_updates"],
            "inventory_updates": state_updates["inventory_updates"],
        },
        narrative=payload.narrative,
    )
    db.add(event)
    db.flush()
    with _turn_progress_span("entity_materialization"):
        entity_updates = [
            item.payload()
            for item in materialize_entity_drafts(
                db,
                world_id=game_session.world_id,
                actor_id=player_actor.id,
                session_id=game_session.id,
                source_event_id=event.id,
                current_location_id=prepared.location_id,
                drafts=getattr(payload, "entity_drafts", []),
            )
        ]
    if entity_updates:
        event.payload = {
            **event.payload,
            "entity_updates": entity_updates,
        }
    with _turn_progress_span("dynamic_quest_offer"):
        resolution_summary = str(getattr(payload, "resolution_summary", "") or "")
        suppress_primary_offer = _session_has_live_quest(session_state, statuses={"active", "paused"})
        quest_offer = _filter_dynamic_quest_offer_for_turn(
            getattr(payload, "quest_offer", None),
            resolution_summary=resolution_summary,
            suppress_for_active_focus=suppress_primary_offer,
        )
        followup_quest_offer = _filter_dynamic_quest_offer_for_turn(
            getattr(payload, "followup_quest_offer", None),
            resolution_summary=resolution_summary,
        )
        dynamic_quest_updates = [
            *create_dynamic_quest_offer(
                db,
                world_id=game_session.world_id,
                actor_id=player_actor.id,
                source_event_id=event.id,
                offer=quest_offer,
            ),
            *create_dynamic_quest_offer(
                db,
                world_id=game_session.world_id,
                actor_id=player_actor.id,
                source_event_id=event.id,
                offer=followup_quest_offer,
                followup_of_assignment_id=str((session_state.get("chapter") or {}).get("quest_assignment_id") or "") or None,
            ),
        ]
    if dynamic_quest_updates:
        state_updates["quest_updates"] = [*state_updates["quest_updates"], *dynamic_quest_updates]
        event.payload = {
            **event.payload,
            "quest_updates": state_updates["quest_updates"],
        }
    with _turn_progress_span("quest_resolution_hint"):
        deferred_quest_updates = record_quest_resolution_hint(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            source_event_id=event.id,
            hint=getattr(payload, "quest_resolution_hint", None),
        )
    if deferred_quest_updates:
        state_updates["quest_updates"] = [*state_updates["quest_updates"], *deferred_quest_updates]
        event.payload = {
            **event.payload,
            "quest_updates": state_updates["quest_updates"],
        }

    with _turn_progress_span("consequence_resolution"):
        consequence_result = apply_consequence_updates(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            counterpart_actor_id=guide_npc.id,
            counterpart_name=guide_npc.display_name,
            location_id=prepared.location_id,
            source_event_id=event.id,
            world_tags=resolved_world_tags,
            consequence_tags=payload.consequence_tags
            or fallback_consequence_tags(
                world_tags=resolved_world_tags,
                action_kind="narrative",
                fail_forward=bool(interpreted_intent.get("fail_forward")),
            ),
            action_kind="narrative",
            fail_forward=bool(interpreted_intent.get("fail_forward")),
        )
        branch_result = BranchPressureEngine.apply_player_turn(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            source_event_id=event.id,
            location_id=prepared.location_id,
            session_state=session_state,
            outcome_band=consequence_result.outcome_band,
            world_tags=resolved_world_tags,
            consequence_tags=payload.consequence_tags
            or fallback_consequence_tags(
                world_tags=resolved_world_tags,
                action_kind="narrative",
                fail_forward=bool(interpreted_intent.get("fail_forward")),
            ),
            branch_signals=list(getattr(payload, "branch_signals", []) or []),
        )
        branch_event_memories: list[Any] = []
        if branch_result.commit is not None:
            _, branch_event_memories = _persist_branch_commit(
                db,
                container,
                game_session=game_session,
                turn=turn,
                player_actor=player_actor,
                location_id=prepared.location_id,
                commit=branch_result.commit,
            )
        dynamic_chapter_updates = apply_dynamic_chapter_progression(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            source_event_id=event.id,
            chapter_directive=getattr(payload, "chapter_directive", None),
        )

    with _turn_progress_span("scene_framing"):
        pre_scene_state = build_session_state(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            location_id=prepared.location_id,
            include_internal=True,
        )
        scene_result = apply_scene_updates(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            location_id=prepared.location_id,
            focus_actor_id=guide_npc.id,
            source_event_id=event.id,
            action_kind="narrative",
            session_state=pre_scene_state,
            outcome_band=consequence_result.outcome_band,
            scene_move=branch_result.commit.forced_scene_move if branch_result.commit is not None else getattr(payload, "scene_move", None),
            scene_pressure=getattr(payload, "scene_pressure", None),
        )
    combined_faction_updates = [*state_updates["faction_updates"], *consequence_result.faction_updates]
    skipped_resources = skipped_resource_constraints(resource_refs, held_locks, resource_constraints)

    turn.model_lane = resolution.final_lane
    turn.resolved_output = {
        "status": "resolved",
        "action_type": "narrative",
        "resolution_mode": "gm_council",
        "input_mode": input_mode,
        "selected_choice_id": selected_choice.get("choice_id") if selected_choice else None,
        "used_fallback": resolution.used_fallback,
        "retrieval_trace": retrieval_trace_to_dict(retrieval.trace),
        "narrative": payload.narrative,
        "npc_reaction": payload.npc_reaction,
        "graph_context_status": graph_context.status,
        "world_tags": resolved_world_tags,
        "interpreted_intent": interpreted_intent,
        "consequence_tags": payload.consequence_tags,
        "outcome_band": consequence_result.outcome_band,
        "scene_tone": consequence_result.scene_tone,
        "consequence_summary": consequence_result.consequence_summary,
        "scene_summary": scene_result["scene_summary"],
        "scene_updates": scene_result["scene_updates"],
        "chapter_updates": [*dynamic_chapter_updates, *scene_result["chapter_updates"]],
        "branch_updates": branch_result.updates,
        "crossroads_summary": branch_result.crossroads_summary,
        "ambient_updates": [],
        "recent_world_beats": [],
        "next_choices": [],
        "quest_updates": state_updates["quest_updates"],
        "faction_updates": combined_faction_updates,
        "inventory_updates": state_updates["inventory_updates"],
        "relationship_updates": consequence_result.relationship_updates,
        "consequence_updates": consequence_result.consequence_updates,
        "entity_updates": entity_updates,
        "resource_constraints": resource_constraints,
        "skipped_shared_resources": skipped_resources,
        "scene_move": getattr(payload, "scene_move", None),
        "scene_pressure": getattr(payload, "scene_pressure", None),
        "council_trace": [
            {
                "role": item.council_role,
                "approval_status": item.approval_status,
                "final_lane": item.final_lane,
            }
            for item in resolution.role_runs
        ],
    }
    event.payload = {
        **event.payload,
        "consequence_tags": payload.consequence_tags,
        "outcome_band": consequence_result.outcome_band,
        "scene_tone": consequence_result.scene_tone,
        "consequence_summary": consequence_result.consequence_summary,
        "scene_summary": scene_result["scene_summary"],
        "scene_updates": scene_result["scene_updates"],
        "chapter_updates": [*dynamic_chapter_updates, *scene_result["chapter_updates"]],
        "branch_updates": branch_result.updates,
        "crossroads_summary": branch_result.crossroads_summary,
        "ambient_updates": [],
        "recent_world_beats": [],
        "faction_updates": combined_faction_updates,
        "relationship_updates": consequence_result.relationship_updates,
        "consequence_updates": consequence_result.consequence_updates,
        "entity_updates": entity_updates,
        "resource_constraints": resource_constraints,
        "skipped_shared_resources": skipped_resources,
    }

    with _turn_progress_span("memory_materialization"):
        memories = container.memory_service.materialize_memories(
            db,
            world_id=game_session.world_id,
            source_event_id=event.id,
            location_id=prepared.location_id,
            drafts=[
                {
                    **draft.model_dump(),
                    "actor_id": guide_npc.id if draft.scope == "actor" else None,
                }
                for draft in payload.memories
            ]
            + consequence_result.additional_memory_drafts,
        )
    shared_consequence_tags = payload.consequence_tags or fallback_consequence_tags(
        world_tags=resolved_world_tags,
        action_kind="narrative",
        fail_forward=bool(interpreted_intent.get("fail_forward")),
    )
    with _turn_progress_span("shared_consequence"):
        if skipped_resources:
            shared_result = SharedConsequenceResult(action_tag="none")
        else:
            shared_result = apply_shared_consequence_rules(
                db,
                memory_service=container.memory_service,
                world_id=game_session.world_id,
                actor_id=player_actor.id,
                location_id=prepared.location_id,
                source_event_id=event.id,
                world_tags=resolved_world_tags,
                consequence_tags=shared_consequence_tags,
                action_kind="narrative",
                explicit_action_tag=getattr(payload, "shared_action_tag", "none"),
                interpreted_intent=interpreted_intent,
                fail_forward=bool(interpreted_intent.get("fail_forward")),
            )
    shared_payload = shared_result.payload()
    turn.resolved_output = {
        **turn.resolved_output,
        "shared_action_tag": shared_result.action_tag,
        "shared_consequence_updates": shared_payload,
    }
    event.payload = {
        **event.payload,
        "shared_action_tag": shared_result.action_tag,
        "shared_consequence_updates": shared_payload,
        "resource_constraints": resource_constraints,
        "skipped_shared_resources": skipped_resources,
    }
    db.add(
        OutboxEvent(
            world_id=game_session.world_id,
            event_id=event.id,
            projection_type="world_graph.upsert",
            payload={
                "turn_id": turn.id,
                "outcome": "resolved",
                "location_id": prepared.location_id,
                "graph_context_status": graph_context.status,
            },
        )
    )
    db.flush()

    with _turn_progress_span("ambient_world_pass"):
        ambient_input_state = build_session_state(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            location_id=prepared.location_id,
            include_internal=True,
        )
        ambient_result = _run_ambient_world_pass(
            db,
            container,
            game_session=game_session,
            player_actor=player_actor,
            turn=turn,
            location_id=prepared.location_id,
            session_state=ambient_input_state,
        )
    with _turn_progress_span("post_state_build"):
        post_state = build_session_state(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            location_id=prepared.location_id,
            include_internal=True,
        )
        public_branch_updates, crossroads_summary = _branch_response_from_state(post_state)
    with _turn_progress_span("choice_generation"):
        post_state_choices = post_state.get("next_choices") or []
        payload_choices = [item.model_dump() if hasattr(item, "model_dump") else dict(item) for item in payload.next_choices]
        previous_choices = session_state.get("next_choices") or []
        if _choices_are_effectively_same(payload_choices, previous_choices):
            next_choices = _canonicalize_next_choices(post_state_choices, post_state_choices)
        else:
            next_choices = _canonicalize_next_choices(payload_choices, post_state_choices)
        if _choices_are_effectively_same(next_choices, previous_choices):
            next_choices = _contextualize_repeated_choices(
                next_choices,
                input_text=input_text,
                consequence_summary=str(payload.consequence_summary or scene_result["scene_summary"] or ""),
            )
    turn.resolved_output = {
        **turn.resolved_output,
        "scene_summary": ambient_result["scene_summary"] or scene_result["scene_summary"],
        "scene_updates": [*scene_result["scene_updates"], *ambient_result["scene_updates"]],
        "chapter_updates": [*dynamic_chapter_updates, *scene_result["chapter_updates"], *ambient_result["chapter_updates"]],
        "branch_updates": public_branch_updates or branch_result.updates,
        "crossroads_summary": crossroads_summary or branch_result.crossroads_summary,
        "ambient_updates": ambient_result["ambient_updates"],
        "recent_world_beats": ambient_result["recent_world_beats"],
        "next_choices": next_choices,
    }
    event.payload = {
        **event.payload,
        "scene_summary": ambient_result["scene_summary"] or scene_result["scene_summary"],
        "scene_updates": [*scene_result["scene_updates"], *ambient_result["scene_updates"]],
        "chapter_updates": [*dynamic_chapter_updates, *scene_result["chapter_updates"], *ambient_result["chapter_updates"]],
        "branch_updates": public_branch_updates or branch_result.updates,
        "crossroads_summary": crossroads_summary or branch_result.crossroads_summary,
        "ambient_updates": ambient_result["ambient_updates"],
        "recent_world_beats": ambient_result["recent_world_beats"],
    }
    with _turn_progress_span("timeline_broadcast"):
        _finalize_event_timeline_and_broadcast(
            db,
            event=event,
            resource_constraints=resource_constraints,
            broadcast_draft=getattr(payload, "broadcast_draft", None),
            shared_action_tag=shared_result.action_tag,
            relevance_tags=list(payload.consequence_tags or []),
        )
    with _turn_progress_span("resource_release"):
        release_resources(db, held_locks)
        consume_broadcast_constraints(db, world_id=game_session.world_id, session_id=game_session.id)

    return TurnResolutionResult(
        turn=turn,
        event=event,
        memory_ids=[memory.id for memory in [*memories, *branch_event_memories, *shared_result.memories]],
        event_payload=_event_payload(event),
        memories_payload=[_memory_payload(memory) for memory in [*memories, *branch_event_memories, *shared_result.memories]],
        graph_context_status=graph_context.status,
        sp_delta=prepared.debit.delta,
        sp_balance=prepared.debit.balance_after,
        paid_sp=prepared.debit.paid_balance_after,
        bonus_sp=prepared.debit.bonus_balance_after,
        sp_ledger_id=prepared.debit.ledger_entry.id,
        quest_updates=state_updates["quest_updates"],
        faction_updates=combined_faction_updates,
        inventory_updates=state_updates["inventory_updates"],
        relationship_updates=consequence_result.relationship_updates,
        consequence_updates=consequence_result.consequence_updates,
        scene_updates=[*scene_result["scene_updates"], *ambient_result["scene_updates"]],
        chapter_updates=[*dynamic_chapter_updates, *scene_result["chapter_updates"], *ambient_result["chapter_updates"]],
        branch_updates=public_branch_updates or branch_result.updates,
        ambient_updates=ambient_result["ambient_updates"],
        location_updates=[],
        action_type="narrative",
        input_mode=input_mode,
        interpreted_intent=interpreted_intent,
        next_choices=next_choices,
        consequence_summary=consequence_result.consequence_summary,
        scene_tone=consequence_result.scene_tone,
        scene_summary=ambient_result["scene_summary"] or scene_result["scene_summary"],
        crossroads_summary=crossroads_summary or branch_result.crossroads_summary,
        current_location=post_state.get("current_location"),
        travel_summary=None,
        recent_world_beats=ambient_result["recent_world_beats"],
        recent_offstage_beats=post_state.get("recent_offstage_beats") or [],
        idle_updates=[],
        progress_phases=[
            *progress_phases,
            "dynamic_quest_offer",
            "quest_resolution_hint",
            "consequence_resolution",
            "scene_framing",
            "ambient_world_pass",
            "choice_generation",
        ],
    )


def _quest_lifecycle_title(quest_updates: list[dict[str, Any]], fallback_summary: str) -> str:
    if quest_updates:
        title = str(quest_updates[0].get("title") or "").strip()
        if title:
            return title
    summary = fallback_summary.strip()
    if " " in summary:
        return summary.split(" ", 1)[0].strip("\"'「」") or summary
    return summary or "the quest"


def _quest_lifecycle_action_text(
    *,
    action_type: str,
    quest_updates: list[dict[str, Any]],
    fallback_summary: str,
    session_state: dict[str, Any],
) -> str:
    english = _profile_prefers_english((session_state.get("player_profile") or {}) if isinstance(session_state, dict) else {})
    title = _quest_lifecycle_title(quest_updates, fallback_summary)
    if english:
        if action_type == "accept_quest":
            return f'Accept "{title}" and take the first concrete step into the responsibility it creates.'
        if action_type == "decline_quest":
            return f'Discard "{title}" and make clear that this thread will not be pursued.'
        if action_type == "leave_quest":
            return f'Step away from "{title}" for now, leaving it paused while the scene settles around that choice.'
        if action_type == "resume_quest":
            return f'Resume "{title}" and return attention to the responsibility already accepted.'
        return fallback_summary
    if action_type == "accept_quest":
        return f"「{title}」を受諾し、その責務へ最初の具体的な一歩を踏み出す。"
    if action_type == "decline_quest":
        return f"「{title}」を破棄し、この糸口を追わないと明確に決める。"
    if action_type == "leave_quest":
        return f"「{title}」からいったん離れ、その判断が場に残す揺れを受け止める。"
    if action_type == "resume_quest":
        return f"「{title}」を再開し、引き受けた責務へ意識を戻す。"
    return fallback_summary


def _quest_lifecycle_choice_summary(*, action_type: str, fallback_summary: str, english: bool) -> str:
    if english:
        if action_type == "accept_quest":
            return "The acceptance itself changes the scene and must open a concrete next beat."
        if action_type == "decline_quest":
            return "Discarding the quest closes this offered thread and leaves a visible consequence in the scene."
        if action_type == "leave_quest":
            return "Leaving the quest pauses the active responsibility and shifts attention back to the surrounding scene."
        if action_type == "resume_quest":
            return "Resuming the quest restores the accepted responsibility as the active thread."
        return fallback_summary
    if action_type == "accept_quest":
        return "受諾そのものが場を動かし、具体的な次の局面を開く。"
    if action_type == "decline_quest":
        return "破棄によって提示された糸口を閉じ、その判断が場に結果を残す。"
    if action_type == "leave_quest":
        return "離脱によって進行中の責務を保留し、周囲の場へ意識を戻す。"
    if action_type == "resume_quest":
        return "再開によって引き受けた責務を再び中心に戻す。"
    return fallback_summary


def _quest_lifecycle_selected_choice(
    *,
    action_type: str,
    action_text: str,
    quest_updates: list[dict[str, Any]],
    fallback_summary: str,
    session_state: dict[str, Any],
) -> dict[str, Any]:
    english = _profile_prefers_english((session_state.get("player_profile") or {}) if isinstance(session_state, dict) else {})
    posture = "progress" if action_type in {"accept_quest", "resume_quest"} else "safe"
    return {
        "choice_id": posture,
        "posture": posture,
        "label": action_text,
        "summary": _quest_lifecycle_choice_summary(
            action_type=action_type,
            fallback_summary=fallback_summary,
            english=english,
        ),
        "canonical_input_text": action_text,
        "action_kind": "narrative",
        "quest_assignment_id": str((quest_updates[0] if quest_updates else {}).get("assignment_id") or ""),
        "lifecycle_action_kind": action_type,
    }


def _quest_lifecycle_fallback_narrative(
    *,
    action_type: str,
    action_text: str,
    summary: str,
    session_state: dict[str, Any],
) -> str:
    english = _profile_prefers_english((session_state.get("player_profile") or {}) if isinstance(session_state, dict) else {})
    if english:
        verb = "acceptance" if action_type == "accept_quest" else "discarding" if action_type == "decline_quest" else "choice"
        return f"{action_text} The {verb} is registered as a player action, and the scene shifts around it. {summary}"
    label = "受諾" if action_type == "accept_quest" else "破棄" if action_type == "decline_quest" else "判断"
    return f"{action_text} その{label}はプレイヤーの行動として場に刻まれ、状況が動く。{summary}"


def _resolve_quest_lifecycle_turn_for_session(
    db: Session,
    container: AppContainer,
    prepared: PreparedTurnContext,
    *,
    action_type: str,
    quest_assignment_id: str,
    input_mode: str,
) -> TurnResolutionResult:
    game_session = prepared.session
    player_actor = prepared.player_actor
    guide_npc = prepared.guide_npc
    pre_state = _session_state_with_latest_choices(
        db,
        session_id=game_session.id,
        world_id=game_session.world_id,
        actor_id=player_actor.id,
        location_id=prepared.location_id,
    )
    turn = Turn(
        id=prepared.turn_id,
        world_id=game_session.world_id,
        session_id=game_session.id,
        actor_id=player_actor.id,
        input_text=f"[{action_type}:{quest_assignment_id}]",
        resolved_output={"status": "pending"},
        model_lane="system",
        action_type=action_type,
        resolution_mode="quest_lifecycle",
    )
    db.add(turn)
    db.flush()

    event = Event(
        world_id=game_session.world_id,
        session_id=game_session.id,
        turn_id=turn.id,
        event_type=f"quest.{action_type}",
        source_actor_id=player_actor.id,
        location_id=prepared.location_id,
        payload={
            "action_type": action_type,
            "quest_assignment_id": quest_assignment_id,
        },
        narrative="",
    )
    db.add(event)
    db.flush()

    try:
        with _turn_progress_span("quest_lifecycle"):
            quest_updates, chapter_updates, summary = apply_quest_lifecycle_action(
                db,
                world_id=game_session.world_id,
                actor_id=player_actor.id,
                quest_assignment_id=quest_assignment_id,
                action_type=action_type,
                source_event_id=event.id,
            )
    except (LookupError, ValueError) as exc:
        return _build_failed_turn_result(
            db,
            container,
            prepared,
            turn=turn,
            action_type=action_type,
            resolution_mode="quest_lifecycle",
            action_label=action_type,
            graph_context_status="quest_lifecycle",
            failure_reason=str(exc),
            model_lane="system",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            input_mode=input_mode,
            interpreted_intent={"canonical_action_kind": action_type, "quest_assignment_id": quest_assignment_id},
            next_choices=_session_state_with_latest_choices(
                db,
                session_id=game_session.id,
                world_id=game_session.world_id,
                actor_id=player_actor.id,
                location_id=prepared.location_id,
            ).get("next_choices")
            or [],
            consequence_summary=str(exc),
            progress_phases=["quest_lifecycle"],
            failure_payload={"quest_assignment_id": quest_assignment_id, "action_type": action_type},
        )

    with _turn_progress_span("post_lifecycle_state_build"):
        post_lifecycle_state = _session_state_with_latest_choices(
            db,
            session_id=game_session.id,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            location_id=prepared.location_id,
        )

    action_text = _quest_lifecycle_action_text(
        action_type=action_type,
        quest_updates=quest_updates,
        fallback_summary=summary,
        session_state=post_lifecycle_state,
    )
    selected_choice = _quest_lifecycle_selected_choice(
        action_type=action_type,
        action_text=action_text,
        quest_updates=quest_updates,
        fallback_summary=summary,
        session_state=post_lifecycle_state,
    )
    graph_context = container.projection_service.resolve_relation_context(
        db,
        world_id=game_session.world_id,
        primary_actor_id=guide_npc.id,
        counterpart_actor_id=player_actor.id,
        location_id=prepared.location_id,
    )
    retrieval = container.memory_service.search(
        db,
        world_id=game_session.world_id,
        query_text=build_retrieval_query_text(
            action_text,
            session_state=post_lifecycle_state,
            relation_context=graph_context.context.prompt_lines(),
        ),
        actor_id=guide_npc.id,
        location_id=prepared.location_id,
    )
    resolution = container.council_service.resolve_turn(
        CouncilRequest(
            world_id=game_session.world_id,
            turn_id=turn.id,
            player_name=player_actor.display_name,
            npc_name=guide_npc.display_name,
            input_text=action_text,
            input_mode="choice",
            selected_choice=selected_choice,
            relevant_memories=[item.text for item in retrieval.memories],
            relation_context=graph_context.context.prompt_lines(),
            graph_context_status=graph_context.status,
            session_state=post_lifecycle_state,
        )
    )
    _persist_role_runs(
        db,
        world_id=game_session.world_id,
        turn_id=turn.id,
        workflow_name="gm_council",
        role_runs=resolution.role_runs,
        graph_context_status=graph_context.status,
    )

    payload = resolution.final_payload
    council_trace = [
        {
            "role": item.council_role,
            "approval_status": item.approval_status,
            "final_lane": item.final_lane,
        }
        for item in resolution.role_runs
    ]
    progress_phases = ["quest_lifecycle", *_progress_phases_from_role_runs(resolution.role_runs)]
    if payload is not None:
        narrative = payload.narrative
        npc_reaction = payload.npc_reaction
        consequence_summary = payload.consequence_summary
        world_tags = list(payload.world_tags or [])
        consequence_tags = list(payload.consequence_tags or [])
        interpreted_intent = {
            **dict(payload.interpreted_intent or {}),
            "canonical_action_kind": action_type,
            "lifecycle_action_kind": action_type,
            "quest_assignment_id": quest_assignment_id,
            "intent_summary": action_text,
        }
        with _turn_progress_span("chapter_progression"):
            dynamic_chapter_updates = apply_dynamic_chapter_progression(
                db,
                world_id=game_session.world_id,
                actor_id=player_actor.id,
                source_event_id=event.id,
                chapter_directive=getattr(payload, "chapter_directive", None),
            )
        chapter_updates = [*chapter_updates, *dynamic_chapter_updates]
        with _turn_progress_span("memory_materialization"):
            memories = container.memory_service.materialize_memories(
                db,
                world_id=game_session.world_id,
                source_event_id=event.id,
                location_id=prepared.location_id,
                drafts=[
                    {
                        **draft.model_dump(),
                        "actor_id": guide_npc.id if draft.scope == "actor" else None,
                    }
                    for draft in payload.memories
                ],
            )
        with _turn_progress_span("scene_framing"):
            scene_input_state = build_session_state(
                db,
                world_id=game_session.world_id,
                actor_id=player_actor.id,
                location_id=prepared.location_id,
                include_internal=True,
            )
            scene_result = apply_scene_updates(
                db,
                world_id=game_session.world_id,
                actor_id=player_actor.id,
                location_id=prepared.location_id,
                focus_actor_id=guide_npc.id,
                source_event_id=event.id,
                action_kind="narrative",
                session_state=scene_input_state,
                outcome_band=payload.outcome_band,
                scene_move=getattr(payload, "scene_move", None),
                scene_pressure=getattr(payload, "scene_pressure", None),
            )
        chapter_updates = [*chapter_updates, *scene_result["chapter_updates"]]
        scene_updates = scene_result["scene_updates"]
        scene_summary = scene_result["scene_summary"]
        scene_tone = scene_tone_for_band(payload.outcome_band)
        model_lane = resolution.final_lane
    else:
        narrative = _quest_lifecycle_fallback_narrative(
            action_type=action_type,
            action_text=action_text,
            summary=summary,
            session_state=post_lifecycle_state,
        )
        npc_reaction = ""
        consequence_summary = summary
        world_tags = ["none"]
        consequence_tags = []
        interpreted_intent = {
            "canonical_action_kind": action_type,
            "lifecycle_action_kind": action_type,
            "quest_assignment_id": quest_assignment_id,
            "intent_summary": action_text,
        }
        memories = []
        scene_updates = []
        scene_summary = ""
        scene_tone = "steady"
        model_lane = resolution.final_lane or "system"

    event.narrative = narrative
    event.payload = {
        **event.payload,
        "player_action_text": action_text,
        "world_tags": world_tags,
        "consequence_tags": consequence_tags,
        "quest_updates": quest_updates,
        "chapter_updates": chapter_updates,
        "consequence_summary": consequence_summary,
        "scene_summary": scene_summary,
        "scene_updates": scene_updates,
        "council_trace": council_trace,
    }
    with _turn_progress_span("post_state_build"):
        post_state = build_session_state(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            location_id=prepared.location_id,
            include_internal=True,
        )
    with _turn_progress_span("choice_generation"):
        post_state_choices = post_state.get("next_choices") or []
        payload_choices = (
            [item.model_dump() if hasattr(item, "model_dump") else dict(item) for item in payload.next_choices]
            if payload is not None
            else post_state_choices
        )
        next_choices = _canonicalize_next_choices(payload_choices, post_state_choices)
        previous_choices = pre_state.get("next_choices") or []
        if _choices_are_effectively_same(next_choices, previous_choices):
            next_choices = _contextualize_repeated_choices(
                next_choices,
                input_text=action_text,
                consequence_summary=consequence_summary,
            )
    turn.resolved_output = {
        "status": "resolved",
        "action_type": action_type,
        "resolution_mode": "quest_lifecycle",
        "input_mode": input_mode,
        "narrative": narrative,
        "npc_reaction": npc_reaction,
        "graph_context_status": graph_context.status,
        "used_fallback": resolution.used_fallback,
        "retrieval_trace": retrieval_trace_to_dict(retrieval.trace),
        "interpreted_intent": interpreted_intent,
        "world_tags": world_tags,
        "consequence_tags": consequence_tags,
        "quest_updates": quest_updates,
        "chapter_updates": chapter_updates,
        "scene_updates": scene_updates,
        "branch_updates": [],
        "ambient_updates": [],
        "recent_world_beats": [],
        "next_choices": next_choices,
        "consequence_summary": consequence_summary,
        "scene_tone": scene_tone,
        "scene_summary": scene_summary,
        "crossroads_summary": "",
        "council_trace": council_trace,
    }
    db.add(
        OutboxEvent(
            world_id=game_session.world_id,
            event_id=event.id,
            projection_type="world_graph.upsert",
            payload={
                "turn_id": turn.id,
                "outcome": "quest_lifecycle",
                "location_id": prepared.location_id,
                "graph_context_status": graph_context.status,
            },
        )
    )
    db.flush()
    with _turn_progress_span("timeline_broadcast"):
        _finalize_event_timeline_and_broadcast(db, event=event)
    return TurnResolutionResult(
        turn=turn,
        event=event,
        memory_ids=[memory.id for memory in memories],
        event_payload=_event_payload(event),
        memories_payload=[_memory_payload(memory) for memory in memories],
        graph_context_status=graph_context.status,
        sp_delta=prepared.debit.delta,
        sp_balance=prepared.debit.balance_after,
        paid_sp=prepared.debit.paid_balance_after,
        bonus_sp=prepared.debit.bonus_balance_after,
        sp_ledger_id=prepared.debit.ledger_entry.id,
        quest_updates=quest_updates,
        faction_updates=[],
        inventory_updates=[],
        relationship_updates=[],
        consequence_updates=[],
        scene_updates=scene_updates,
        chapter_updates=chapter_updates,
        branch_updates=[],
        ambient_updates=[],
        location_updates=[],
        action_type=action_type,
        input_mode=input_mode,
        interpreted_intent=interpreted_intent,
        next_choices=next_choices,
        consequence_summary=consequence_summary,
        scene_tone=scene_tone,
        scene_summary=scene_summary,
        crossroads_summary="",
        current_location=post_state.get("current_location"),
        travel_summary=None,
        recent_world_beats=post_state.get("recent_world_beats") or [],
        recent_offstage_beats=post_state.get("recent_offstage_beats") or [],
        idle_updates=[],
        progress_phases=[*progress_phases, "chapter_progression", "scene_framing", "choice_generation"],
    )


def _is_read_world_state_query(input_text: str) -> bool:
    normalized = input_text.lower()
    read_markers = (
        "どの直近行動",
        "直近行動",
        "地域状況",
        "現在の門",
        "門の報告",
        "旅人たちの発言",
        "照合",
        "原因",
        "変えた",
        "broadcast",
        "recent history",
    )
    mutation_markers = ("攻撃", "脅す", "盗む", "壊す", "移動", "向かう", "選ぶ", "コミット")
    return any(marker in normalized for marker in read_markers) and not any(
        marker in normalized for marker in mutation_markers
    )


def _resolve_read_world_state_query_turn(
    db: Session,
    prepared: PreparedTurnContext,
    *,
    turn: Turn,
    input_text: str,
    session_state: dict[str, Any],
) -> TurnResolutionResult:
    game_session = prepared.session
    player_actor = prepared.player_actor
    current_location = session_state.get("current_location") or session_state.get("location") or {}
    location_name = str(current_location.get("name") or current_location.get("key") or prepared.location_id)
    broadcast_constraints = session_state.get("world_broadcast_constraints") or []
    shared_context = session_state.get("shared_world_context") or {}
    recent_consequence_history = session_state.get("recent_consequence_history") or []
    recent_scene_history = session_state.get("recent_scene_history") or []
    recent_world_beats = session_state.get("recent_world_beats") or []
    next_choices = _canonicalize_next_choices(session_state.get("next_choices") or [], session_state.get("next_choices") or [])
    observed_constraint = ""
    if broadcast_constraints:
        first_constraint = broadcast_constraints[0]
        if isinstance(first_constraint, dict):
            observed_constraint = str(
                first_constraint.get("constraint_text")
                or first_constraint.get("semantic_key")
                or first_constraint.get("status")
                or ""
            )
    if not observed_constraint and recent_consequence_history:
        observed_constraint = str(recent_consequence_history[0])
    if not observed_constraint:
        observed_constraint = "直近の行動記録と共有世界の報告に、現在地へ残った変化の痕跡があります。"

    narrative = (
        f"{player_actor.display_name}は{location_name}で、門の報告と旅人たちの発言を照合する。"
        "これは新しい行動ではなく、共有世界に残っている記録の確認として扱われる。"
    )
    npc_reaction = (
        "記録を確認すると、直近の変化は共有された出来事として残っています。"
        f"観測できる手がかりは「{observed_constraint}」です。"
        "必要なら、この痕跡を踏まえて次の行動を選べます。"
    )
    consequence_summary = "The player reads the shared-world record without changing canonical state."
    scene_summary = str((session_state.get("current_scene") or {}).get("summary") or consequence_summary)
    event_payload = {
        "action_type": "read_world_state_query",
        "input_mode": "free_text",
        "location_id": prepared.location_id,
        "query_text": input_text,
        "world_tags": ["investigate"],
        "consequence_tags": ["careful_observation"],
        "outcome_band": "steady",
        "scene_tone": scene_tone_for_band("steady"),
        "consequence_summary": consequence_summary,
        "scene_summary": scene_summary,
        "recent_scene_history": recent_scene_history[:3],
        "recent_consequence_history": recent_consequence_history[:3],
        "recent_world_beats": recent_world_beats[:3],
        "world_broadcast_constraints": broadcast_constraints,
        "shared_world_context": shared_context,
        "shared_action_tag": "none",
        "shared_consequence_updates": {
            "shared_action_tag": "none",
            "applied_rule_ids": [],
            "axis_updates": [],
            "faction_updates": [],
            "location_updates": [],
            "relationship_updates": [],
            "history_records": [],
            "title_progress": [],
            "memory_ids": [],
        },
    }
    event = Event(
        world_id=game_session.world_id,
        session_id=game_session.id,
        turn_id=turn.id,
        event_type="player.turn.resolved",
        source_actor_id=player_actor.id,
        location_id=prepared.location_id,
        payload=event_payload,
        narrative=narrative,
    )
    db.add(event)
    db.flush()
    with _turn_progress_span("timeline_broadcast"):
        _finalize_event_timeline_and_broadcast(
            db,
            event=event,
            shared_action_tag="none",
            relevance_tags=["careful_observation"],
        )
    db.add(
        OutboxEvent(
            world_id=game_session.world_id,
            event_id=event.id,
            projection_type="world_graph.upsert",
            payload={
                "turn_id": turn.id,
                "outcome": "read_only",
                "location_id": prepared.location_id,
                "graph_context_status": "read_world_state_query",
            },
        )
    )
    turn.model_lane = "read_world_state_query"
    turn.resolution_mode = "read_world_state_query"
    turn.resolved_output = {
        "status": "resolved",
        "action_type": "narrative",
        "resolution_mode": "read_world_state_query",
        "input_mode": "free_text",
        "narrative": narrative,
        "npc_reaction": npc_reaction,
        "graph_context_status": "read_world_state_query",
        "world_tags": ["investigate"],
        "interpreted_intent": {
            "input_mode": "free_text",
            "canonical_action_kind": "read_world_state_query",
            "intent_summary": input_text,
            "requested_choice_posture": "none",
            "fail_forward": False,
            "consequence_flags": [],
            "consequence_tags": ["careful_observation"],
            "consequence_summary": consequence_summary,
        },
        "consequence_tags": ["careful_observation"],
        "outcome_band": "steady",
        "scene_tone": scene_tone_for_band("steady"),
        "consequence_summary": consequence_summary,
        "scene_summary": scene_summary,
        "scene_updates": [],
        "chapter_updates": [],
        "branch_updates": [],
        "crossroads_summary": "",
        "ambient_updates": [],
        "recent_world_beats": recent_world_beats,
        "next_choices": next_choices,
        "quest_updates": [],
        "faction_updates": [],
        "inventory_updates": [],
        "relationship_updates": [],
        "consequence_updates": [],
        "resource_constraints": [],
        "skipped_shared_resources": [],
        "shared_action_tag": "none",
        "shared_consequence_updates": event_payload["shared_consequence_updates"],
    }
    db.flush()
    return TurnResolutionResult(
        turn=turn,
        event=event,
        memory_ids=[],
        event_payload=_event_payload(event),
        memories_payload=[],
        graph_context_status="read_world_state_query",
        sp_delta=prepared.debit.delta,
        sp_balance=prepared.debit.balance_after,
        paid_sp=prepared.debit.paid_balance_after,
        bonus_sp=prepared.debit.bonus_balance_after,
        sp_ledger_id=prepared.debit.ledger_entry.id,
        quest_updates=[],
        faction_updates=[],
        inventory_updates=[],
        relationship_updates=[],
        consequence_updates=[],
        scene_updates=[],
        chapter_updates=[],
        branch_updates=[],
        ambient_updates=[],
        location_updates=[],
        action_type="narrative",
        input_mode="free_text",
        interpreted_intent=turn.resolved_output["interpreted_intent"],
        next_choices=next_choices,
        consequence_summary=consequence_summary,
        scene_tone=scene_tone_for_band("steady"),
        scene_summary=scene_summary,
        crossroads_summary="",
        current_location=session_state.get("current_location"),
        travel_summary=None,
        recent_world_beats=recent_world_beats,
        recent_offstage_beats=session_state.get("recent_offstage_beats") or [],
        idle_updates=[],
        progress_phases=["read_world_state_query"],
    )


def _resolve_reward_item_turn_for_session(
    db: Session,
    container: AppContainer,
    prepared: PreparedTurnContext,
    *,
    item_id: str,
    input_mode: str = "choice",
    interpreted_intent: dict[str, Any] | None = None,
    progress_phases: list[str] | None = None,
    existing_turn: Turn | None = None,
    action_label: str | None = None,
    model_lane: str = "deterministic",
    resolution_mode: str = "item_use_rule",
    graph_context_status: str = "deterministic",
    extra_resolved_output: dict[str, Any] | None = None,
) -> TurnResolutionResult:
    game_session = prepared.session
    player_actor = prepared.player_actor
    guide_npc = prepared.guide_npc
    resolved_action_label = action_label or f"[use_reward_item:{item_id}]"
    turn = existing_turn
    if turn is None:
        turn = Turn(
            id=prepared.turn_id,
            world_id=game_session.world_id,
            session_id=game_session.id,
            actor_id=player_actor.id,
            input_text=resolved_action_label,
            resolved_output={"status": "pending"},
            model_lane=model_lane,
            action_type="use_reward_item",
            resolution_mode=resolution_mode,
        )
        db.add(turn)
        db.flush()
    else:
        turn.input_text = resolved_action_label
        turn.model_lane = model_lane
        turn.action_type = "use_reward_item"
        turn.resolution_mode = resolution_mode
        turn.resolved_output = {"status": "pending"}
        db.flush()

    try:
        outcome = use_reward_item(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            actor_name=player_actor.display_name,
            location_id=prepared.location_id,
            item_id=item_id,
        )
    except LookupError as exc:
        return _build_failed_turn_result(
            db,
            container,
            prepared,
            turn=turn,
            action_type="use_reward_item",
            resolution_mode=resolution_mode,
            action_label=resolved_action_label,
            graph_context_status=graph_context_status,
            failure_reason=str(exc),
            model_lane=model_lane,
            status_code=status.HTTP_404_NOT_FOUND,
            input_mode=input_mode,
            interpreted_intent=interpreted_intent or {"canonical_action_kind": "use_reward_item"},
            next_choices=_session_state_with_latest_choices(
                db,
                session_id=game_session.id,
                world_id=game_session.world_id,
                actor_id=player_actor.id,
                location_id=prepared.location_id,
            ).get("next_choices")
            or [],
            consequence_summary="The reward item cannot take effect in the scene's current state.",
            progress_phases=progress_phases or ["item_use"],
            failure_payload={"item_id": item_id},
        )
    except ValueError as exc:
        return _build_failed_turn_result(
            db,
            container,
            prepared,
            turn=turn,
            action_type="use_reward_item",
            resolution_mode=resolution_mode,
            action_label=resolved_action_label,
            graph_context_status=graph_context_status,
            failure_reason=str(exc),
            model_lane=model_lane,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            input_mode=input_mode,
            interpreted_intent=interpreted_intent or {"canonical_action_kind": "use_reward_item"},
            next_choices=_session_state_with_latest_choices(
                db,
                session_id=game_session.id,
                world_id=game_session.world_id,
                actor_id=player_actor.id,
                location_id=prepared.location_id,
            ).get("next_choices")
            or [],
            consequence_summary="The reward item's path is not yet open, so the world holds the scene in place.",
            progress_phases=progress_phases or ["item_use"],
            failure_payload={"item_id": item_id},
        )

    _, template = resolve_world_pack(db, game_session.world_id)
    reward_name = str((template.quest.reward_name if template.quest is not None else "") or outcome.item.name)
    followup_location_name = str(
        template.locations[template.roles.followup_location_key].name
        if template.roles.followup_location_key in template.locations
        else "the next route"
    )
    npc_reaction = (
        f"{guide_npc.display_name}は{reward_name}を確かめ、{followup_location_name}への道が正式に開いたと告げた。"
    )
    resolved_interpreted_intent = interpreted_intent or {
        "input_mode": input_mode,
        "canonical_action_kind": "use_reward_item",
        "intent_summary": f"{reward_name}を掲げて{followup_location_name}への道を開く",
    }
    resolved_consequence_summary = (
        str(resolved_interpreted_intent.get("consequence_summary") or "").strip()
        or "The reward item changes what the world will now allow."
    )

    turn.model_lane = model_lane
    turn.resolved_output = {
        "status": "resolved",
        "action_type": "use_reward_item",
        "resolution_mode": resolution_mode,
        "input_mode": input_mode,
        "narrative": outcome.event_narrative,
        "npc_reaction": npc_reaction,
        "graph_context_status": graph_context_status,
        "interpreted_intent": resolved_interpreted_intent,
        "consequence_summary": resolved_consequence_summary,
        "next_choices": [],
        "quest_updates": outcome.quest_updates,
        "faction_updates": outcome.faction_updates,
        "inventory_updates": outcome.inventory_updates,
        **(extra_resolved_output or {}),
    }

    event = Event(
        world_id=game_session.world_id,
        session_id=game_session.id,
        turn_id=turn.id,
        event_type=outcome.event_type,
        source_actor_id=player_actor.id,
        location_id=prepared.location_id,
        payload={
            **outcome.event_payload,
            "action_type": "use_reward_item",
            "input_mode": input_mode,
            "quest_updates": outcome.quest_updates,
            "faction_updates": outcome.faction_updates,
            "inventory_updates": outcome.inventory_updates,
        },
        narrative=outcome.event_narrative,
    )
    db.add(event)
    db.flush()

    consequence_result = apply_consequence_updates(
        db,
        world_id=game_session.world_id,
        actor_id=player_actor.id,
        counterpart_actor_id=guide_npc.id,
        counterpart_name=guide_npc.display_name,
        location_id=prepared.location_id,
        source_event_id=event.id,
        world_tags=["collect_reward"],
        consequence_tags=(resolved_interpreted_intent.get("consequence_tags") if isinstance(resolved_interpreted_intent, dict) else None)
        or ["reward_item_respect", "kept_promise"],
        action_kind="use_reward_item",
        fail_forward=False,
    )
    combined_faction_updates = [*outcome.faction_updates, *consequence_result.faction_updates]
    _, template = resolve_world_pack(db, game_session.world_id)
    followup_stage_key = str(template.roles.followup_stage_key or "followup_stage")
    if any(str(item.get("stage_key") or "") == followup_stage_key for item in outcome.quest_updates):
        ensure_route_pressures(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            chapter_key=str(template.roles.followup_chapter_key or followup_stage_key),
        )
    pre_scene_state = build_session_state(
        db,
        world_id=game_session.world_id,
        actor_id=player_actor.id,
        location_id=prepared.location_id,
        include_internal=True,
    )
    scene_result = apply_scene_updates(
        db,
        world_id=game_session.world_id,
        actor_id=player_actor.id,
        location_id=prepared.location_id,
        focus_actor_id=guide_npc.id,
        source_event_id=event.id,
        action_kind="use_reward_item",
        session_state=pre_scene_state,
        outcome_band=consequence_result.outcome_band,
        scene_move="pivot",
        scene_pressure="medium",
    )

    memories = container.memory_service.materialize_memories(
        db,
        world_id=game_session.world_id,
        source_event_id=event.id,
        location_id=prepared.location_id,
        drafts=outcome.memory_drafts + consequence_result.additional_memory_drafts,
    )
    reward_consequence_tags = (
        resolved_interpreted_intent.get("consequence_tags") if isinstance(resolved_interpreted_intent, dict) else None
    ) or ["reward_item_respect", "kept_promise"]
    shared_result = apply_shared_consequence_rules(
        db,
        memory_service=container.memory_service,
        world_id=game_session.world_id,
        actor_id=player_actor.id,
        location_id=prepared.location_id,
        source_event_id=event.id,
        world_tags=["collect_reward"],
        consequence_tags=reward_consequence_tags,
        action_kind="use_reward_item",
        explicit_action_tag=(
            str(resolved_interpreted_intent.get("shared_action_tag") or "none")
            if isinstance(resolved_interpreted_intent, dict)
            else "none"
        ),
        interpreted_intent=resolved_interpreted_intent,
        fail_forward=False,
    )
    shared_payload = shared_result.payload()
    outcome.item.used_event_id = event.id
    db.add(
        OutboxEvent(
            world_id=game_session.world_id,
            event_id=event.id,
            projection_type="world_graph.upsert",
            payload={
                "turn_id": turn.id,
                "outcome": "resolved",
                "location_id": prepared.location_id,
                "graph_context_status": "deterministic",
            },
        )
    )
    db.flush()

    turn.resolved_output = {
        **turn.resolved_output,
        "relationship_updates": consequence_result.relationship_updates,
        "consequence_updates": consequence_result.consequence_updates,
        "shared_action_tag": shared_result.action_tag,
        "shared_consequence_updates": shared_payload,
        "outcome_band": consequence_result.outcome_band,
        "scene_tone": consequence_result.scene_tone,
        "consequence_summary": consequence_result.consequence_summary,
        "scene_summary": scene_result["scene_summary"],
        "scene_updates": scene_result["scene_updates"],
        "chapter_updates": scene_result["chapter_updates"],
        "branch_updates": [],
        "crossroads_summary": "",
        "ambient_updates": [],
        "recent_world_beats": [],
        "faction_updates": combined_faction_updates,
    }
    event.payload = {
        **event.payload,
        "relationship_updates": consequence_result.relationship_updates,
        "consequence_updates": consequence_result.consequence_updates,
        "shared_action_tag": shared_result.action_tag,
        "shared_consequence_updates": shared_payload,
        "outcome_band": consequence_result.outcome_band,
        "scene_tone": consequence_result.scene_tone,
        "consequence_summary": consequence_result.consequence_summary,
        "scene_summary": scene_result["scene_summary"],
        "scene_updates": scene_result["scene_updates"],
        "chapter_updates": scene_result["chapter_updates"],
        "branch_updates": [],
        "crossroads_summary": "",
        "ambient_updates": [],
        "recent_world_beats": [],
        "faction_updates": combined_faction_updates,
    }

    ambient_input_state = build_session_state(
        db,
        world_id=game_session.world_id,
        actor_id=player_actor.id,
        location_id=prepared.location_id,
        include_internal=True,
    )
    ambient_result = _run_ambient_world_pass(
        db,
        container,
        game_session=game_session,
        player_actor=player_actor,
        turn=turn,
        location_id=prepared.location_id,
        session_state=ambient_input_state,
    )
    post_state = build_session_state(
        db,
        world_id=game_session.world_id,
        actor_id=player_actor.id,
        location_id=prepared.location_id,
        include_internal=True,
    )
    branch_updates, crossroads_summary = _branch_response_from_state(post_state)
    next_choices = _canonicalize_next_choices(post_state.get("next_choices") or [], post_state.get("next_choices") or [])
    turn.resolved_output = {
        **turn.resolved_output,
        "scene_summary": ambient_result["scene_summary"] or scene_result["scene_summary"],
        "scene_updates": [*scene_result["scene_updates"], *ambient_result["scene_updates"]],
        "chapter_updates": [*scene_result["chapter_updates"], *ambient_result["chapter_updates"]],
        "branch_updates": branch_updates,
        "crossroads_summary": crossroads_summary,
        "ambient_updates": ambient_result["ambient_updates"],
        "recent_world_beats": ambient_result["recent_world_beats"],
        "next_choices": next_choices,
    }
    event.payload = {
        **event.payload,
        "scene_summary": ambient_result["scene_summary"] or scene_result["scene_summary"],
        "scene_updates": [*scene_result["scene_updates"], *ambient_result["scene_updates"]],
        "chapter_updates": [*scene_result["chapter_updates"], *ambient_result["chapter_updates"]],
        "branch_updates": branch_updates,
        "crossroads_summary": crossroads_summary,
        "ambient_updates": ambient_result["ambient_updates"],
        "recent_world_beats": ambient_result["recent_world_beats"],
    }
    _finalize_event_timeline_and_broadcast(
        db,
        event=event,
        broadcast_draft={
            "summary": outcome.travel_summary if hasattr(outcome, "travel_summary") else outcome.event_narrative,
            "constraint_text": outcome.event_narrative,
            "scope_kind": "location",
            "lifecycle_kind": "scene",
            "relevance_tags": ["reward_item_respect", "kept_promise"],
        },
        shared_action_tag=shared_result.action_tag,
        relevance_tags=reward_consequence_tags,
    )
    consume_broadcast_constraints(db, world_id=game_session.world_id, session_id=game_session.id)

    return TurnResolutionResult(
        turn=turn,
        event=event,
        memory_ids=[memory.id for memory in [*memories, *shared_result.memories]],
        event_payload=_event_payload(event),
        memories_payload=[_memory_payload(memory) for memory in [*memories, *shared_result.memories]],
        graph_context_status=graph_context_status,
        sp_delta=prepared.debit.delta,
        sp_balance=prepared.debit.balance_after,
        paid_sp=prepared.debit.paid_balance_after,
        bonus_sp=prepared.debit.bonus_balance_after,
        sp_ledger_id=prepared.debit.ledger_entry.id,
        quest_updates=outcome.quest_updates,
        faction_updates=combined_faction_updates,
        inventory_updates=outcome.inventory_updates,
        relationship_updates=consequence_result.relationship_updates,
        consequence_updates=consequence_result.consequence_updates,
        scene_updates=[*scene_result["scene_updates"], *ambient_result["scene_updates"]],
        chapter_updates=[*scene_result["chapter_updates"], *ambient_result["chapter_updates"]],
        branch_updates=branch_updates,
        ambient_updates=ambient_result["ambient_updates"],
        location_updates=[],
        action_type="use_reward_item",
        input_mode=input_mode,
        interpreted_intent=resolved_interpreted_intent,
        next_choices=next_choices,
        consequence_summary=consequence_result.consequence_summary,
        scene_tone=consequence_result.scene_tone,
        scene_summary=ambient_result["scene_summary"] or scene_result["scene_summary"],
        crossroads_summary=crossroads_summary,
        current_location=post_state.get("current_location"),
        travel_summary=None,
        recent_world_beats=ambient_result["recent_world_beats"],
        recent_offstage_beats=post_state.get("recent_offstage_beats") or [],
        idle_updates=[],
        progress_phases=[
            *(progress_phases or ["item_use"]),
            *([] if "consequence_resolution" in (progress_phases or []) else ["consequence_resolution"]),
            *([] if "scene_framing" in (progress_phases or []) else ["scene_framing"]),
            *([] if "ambient_world_pass" in (progress_phases or []) else ["ambient_world_pass"]),
            *([] if "choice_generation" in (progress_phases or []) else ["choice_generation"]),
        ],
    )


def _resolve_travel_turn_for_session(
    db: Session,
    container: AppContainer,
    prepared: PreparedTurnContext,
    *,
    destination_key: str,
    input_mode: str,
    interpreted_intent: dict[str, Any],
    progress_phases: list[str] | None = None,
    existing_turn: Turn | None = None,
    action_label: str | None = None,
    model_lane: str = "deterministic",
    resolution_mode: str = "travel_rule",
    graph_context_status: str = "deterministic",
    extra_resolved_output: dict[str, Any] | None = None,
) -> TurnResolutionResult:
    game_session = prepared.session
    player_actor = prepared.player_actor
    current_location = get_location_summary(db, game_session.world_id, prepared.location_id)
    destination = get_location_by_key(db, game_session.world_id, destination_key)
    if destination is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Travel destination not found")

    resolved_action_label = action_label or f"[travel:{destination_key}]"
    turn = existing_turn
    if turn is None:
        turn = Turn(
            id=prepared.turn_id,
            world_id=game_session.world_id,
            session_id=game_session.id,
            actor_id=player_actor.id,
            input_text=resolved_action_label,
            resolved_output={"status": "pending"},
            model_lane=model_lane,
            action_type="travel",
            resolution_mode=resolution_mode,
        )
        db.add(turn)
        db.flush()
    else:
        turn.input_text = resolved_action_label
        turn.model_lane = model_lane
        turn.action_type = "travel"
        turn.resolution_mode = resolution_mode
        turn.resolved_output = {"status": "pending"}
        db.flush()

    try:
        outcome = travel_to_location(
            db,
            world_id=game_session.world_id,
            actor=player_actor,
            destination_location_id=destination.id,
        )
        destination_guide = get_guide_npc_for_location(db, game_session.world_id, location_id=destination.id) or prepared.guide_npc

        event = Event(
            world_id=game_session.world_id,
            session_id=game_session.id,
            turn_id=turn.id,
            event_type=outcome.event_type,
            source_actor_id=player_actor.id,
            location_id=destination.id,
            payload={
                **outcome.event_payload,
                "action_type": "travel",
                "input_mode": input_mode,
                "location_updates": outcome.location_updates,
                "relationship_updates": [],
                "consequence_updates": [],
            },
            narrative=outcome.event_narrative,
        )
        db.add(event)
        db.flush()
        consequence_result = apply_consequence_updates(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            counterpart_actor_id=None,
            counterpart_name=destination_guide.display_name if destination_guide is not None else None,
            location_id=destination.id,
            source_event_id=event.id,
            world_tags=["none"],
            consequence_tags=(interpreted_intent.get("consequence_tags") if isinstance(interpreted_intent, dict) else None)
            or ["careful_observation"],
            action_kind="travel",
            fail_forward=False,
        )

        pre_scene_state = build_session_state(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            location_id=destination.id,
            include_internal=True,
        )
        scene_result = apply_scene_updates(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            location_id=destination.id,
            focus_actor_id=destination_guide.id if destination_guide is not None else None,
            source_event_id=event.id,
            action_kind="travel",
            session_state=pre_scene_state,
            outcome_band="steady",
            scene_move="pivot",
            scene_pressure="medium",
        )
        memories = container.memory_service.materialize_memories(
            db,
            world_id=game_session.world_id,
            source_event_id=event.id,
            location_id=destination.id,
            drafts=outcome.memory_drafts + consequence_result.additional_memory_drafts,
        )
        travel_consequence_tags = (
            interpreted_intent.get("consequence_tags") if isinstance(interpreted_intent, dict) else None
        ) or ["careful_observation"]
        shared_result = apply_shared_consequence_rules(
            db,
            memory_service=container.memory_service,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            location_id=destination.id,
            source_event_id=event.id,
            world_tags=["none"],
            consequence_tags=travel_consequence_tags,
            action_kind="travel",
            explicit_action_tag=(
                str(interpreted_intent.get("shared_action_tag") or "none")
                if isinstance(interpreted_intent, dict)
                else "none"
            ),
            interpreted_intent=interpreted_intent,
            fail_forward=False,
        )
        shared_payload = shared_result.payload()
        db.add(
            OutboxEvent(
                world_id=game_session.world_id,
                event_id=event.id,
                projection_type="world_graph.upsert",
                payload={
                    "turn_id": turn.id,
                    "outcome": "resolved",
                    "location_id": destination.id,
                    "graph_context_status": graph_context_status,
                },
            )
        )
        db.flush()

        turn.resolved_output = {
            "status": "resolved",
            "action_type": "travel",
            "resolution_mode": resolution_mode,
            "input_mode": input_mode,
            "narrative": outcome.event_narrative,
            "npc_reaction": (
                f"{destination_guide.display_name if destination_guide is not None else 'The place'}"
                " reads your arrival and answers from the place you have just entered."
            ),
            "graph_context_status": graph_context_status,
            "interpreted_intent": interpreted_intent,
            "consequence_summary": outcome.travel_summary,
            "relationship_updates": consequence_result.relationship_updates,
            "consequence_updates": consequence_result.consequence_updates,
            "shared_action_tag": shared_result.action_tag,
            "shared_consequence_updates": shared_payload,
            "scene_tone": "measured",
            "outcome_band": "steady",
            "scene_summary": scene_result["scene_summary"],
            "scene_updates": scene_result["scene_updates"],
            "chapter_updates": scene_result["chapter_updates"],
            "branch_updates": [],
            "crossroads_summary": "",
            "location_updates": outcome.location_updates,
            "current_location": get_location_summary(db, game_session.world_id, destination.id),
            "travel_summary": outcome.travel_summary,
            "ambient_updates": [],
            "recent_world_beats": [],
            "next_choices": [],
            **(extra_resolved_output or {}),
        }
        event.payload = {
            **event.payload,
            "relationship_updates": consequence_result.relationship_updates,
            "consequence_updates": consequence_result.consequence_updates,
            "shared_action_tag": shared_result.action_tag,
            "shared_consequence_updates": shared_payload,
            "scene_summary": scene_result["scene_summary"],
            "scene_updates": scene_result["scene_updates"],
            "chapter_updates": scene_result["chapter_updates"],
            "travel_summary": outcome.travel_summary,
        }

        ambient_input_state = build_session_state(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            location_id=destination.id,
            include_internal=True,
        )
        ambient_result = _run_ambient_world_pass(
            db,
            container,
            game_session=game_session,
            player_actor=player_actor,
            turn=turn,
            location_id=destination.id,
            session_state=ambient_input_state,
        )
        post_state = build_session_state(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            location_id=destination.id,
            include_internal=True,
        )
        branch_updates, crossroads_summary = _branch_response_from_state(post_state)
        next_choices = _canonicalize_next_choices(post_state.get("next_choices") or [], post_state.get("next_choices") or [])
        turn.resolved_output = {
            **turn.resolved_output,
            "scene_summary": ambient_result["scene_summary"] or scene_result["scene_summary"],
            "scene_updates": [*scene_result["scene_updates"], *ambient_result["scene_updates"]],
            "chapter_updates": [*scene_result["chapter_updates"], *ambient_result["chapter_updates"]],
            "branch_updates": branch_updates,
            "crossroads_summary": crossroads_summary,
            "ambient_updates": ambient_result["ambient_updates"],
            "recent_world_beats": ambient_result["recent_world_beats"],
            "next_choices": next_choices,
        }
        event.payload = {
            **event.payload,
            "scene_summary": ambient_result["scene_summary"] or scene_result["scene_summary"],
            "scene_updates": [*scene_result["scene_updates"], *ambient_result["scene_updates"]],
            "chapter_updates": [*scene_result["chapter_updates"], *ambient_result["chapter_updates"]],
            "branch_updates": branch_updates,
            "crossroads_summary": crossroads_summary,
            "ambient_updates": ambient_result["ambient_updates"],
            "recent_world_beats": ambient_result["recent_world_beats"],
        }
        _finalize_event_timeline_and_broadcast(
            db,
            event=event,
            broadcast_draft={
                "summary": outcome.travel_summary,
                "constraint_text": outcome.travel_summary,
                "scope_kind": "location",
                "lifecycle_kind": "scene",
                "relevance_tags": travel_consequence_tags,
            },
            shared_action_tag=shared_result.action_tag,
            relevance_tags=travel_consequence_tags,
        )
        consume_broadcast_constraints(db, world_id=game_session.world_id, session_id=game_session.id)
        return TurnResolutionResult(
            turn=turn,
            event=event,
            memory_ids=[memory.id for memory in [*memories, *shared_result.memories]],
            event_payload=_event_payload(event),
            memories_payload=[_memory_payload(memory) for memory in [*memories, *shared_result.memories]],
            graph_context_status=graph_context_status,
            sp_delta=prepared.debit.delta,
            sp_balance=prepared.debit.balance_after,
            paid_sp=prepared.debit.paid_balance_after,
            bonus_sp=prepared.debit.bonus_balance_after,
            sp_ledger_id=prepared.debit.ledger_entry.id,
            quest_updates=[],
            faction_updates=[],
            inventory_updates=[],
            relationship_updates=consequence_result.relationship_updates,
            consequence_updates=consequence_result.consequence_updates,
            scene_updates=[*scene_result["scene_updates"], *ambient_result["scene_updates"]],
            chapter_updates=[*scene_result["chapter_updates"], *ambient_result["chapter_updates"]],
            branch_updates=branch_updates,
            ambient_updates=ambient_result["ambient_updates"],
            location_updates=outcome.location_updates,
            action_type="travel",
            input_mode=input_mode,
            interpreted_intent=interpreted_intent,
            next_choices=next_choices,
            consequence_summary=outcome.travel_summary,
            scene_tone="measured",
            scene_summary=ambient_result["scene_summary"] or scene_result["scene_summary"],
            crossroads_summary=crossroads_summary,
            current_location=post_state.get("current_location"),
            travel_summary=outcome.travel_summary,
            recent_world_beats=ambient_result["recent_world_beats"],
            recent_offstage_beats=post_state.get("recent_offstage_beats") or [],
            idle_updates=[],
            progress_phases=[
                *(progress_phases or ["travel_resolution"]),
                *([] if "scene_framing" in (progress_phases or []) else ["scene_framing"]),
                *([] if "ambient_world_pass" in (progress_phases or []) else ["ambient_world_pass"]),
                *([] if "choice_generation" in (progress_phases or []) else ["choice_generation"]),
            ],
        )
    except ValueError:
        local_guide = prepared.guide_npc
        event = Event(
            world_id=game_session.world_id,
            session_id=game_session.id,
            turn_id=turn.id,
            event_type="travel.hesitated",
            source_actor_id=player_actor.id,
            location_id=prepared.location_id,
            payload={
                "action_type": "travel",
                "input_mode": input_mode,
                "from_location_id": prepared.location_id,
                "to_location_id": destination.id,
                "travel_summary": f"{destination.name}への道はまだ素直には開かず、足取りだけが場に残った。",
            },
            narrative=f"{player_actor.display_name}は{destination.name}へ向かおうとしたが、場の圧力に押し返されるように歩みを止めた。",
        )
        db.add(event)
        db.flush()
        consequence_result = apply_consequence_updates(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            counterpart_actor_id=local_guide.id if local_guide is not None else None,
            counterpart_name=local_guide.display_name if local_guide is not None else None,
            location_id=prepared.location_id,
            source_event_id=event.id,
            world_tags=["none"],
            consequence_tags=(interpreted_intent.get("consequence_tags") if isinstance(interpreted_intent, dict) else None)
            or ["public_attention", "overreach"],
            action_kind="travel",
            fail_forward=True,
        )
        pre_scene_state = build_session_state(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            location_id=prepared.location_id,
            include_internal=True,
        )
        scene_result = apply_scene_updates(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            location_id=prepared.location_id,
            focus_actor_id=local_guide.id if local_guide is not None else None,
            source_event_id=event.id,
            action_kind="travel",
            session_state=pre_scene_state,
            outcome_band=consequence_result.outcome_band,
            scene_move="deepen",
            scene_pressure="high",
        )
        memories = container.memory_service.materialize_memories(
            db,
            world_id=game_session.world_id,
            source_event_id=event.id,
            location_id=prepared.location_id,
            drafts=[
                {
                    "scope": "location",
                    "text": f"{destination.name}へ向かおうとした迷いが、まだその場の空気に残っている。",
                    "salience": 0.86,
                    "location_id": prepared.location_id,
                    "actor_id": None,
                },
                *consequence_result.additional_memory_drafts,
            ],
        )
        db.add(
            OutboxEvent(
                world_id=game_session.world_id,
                event_id=event.id,
                projection_type="world_graph.upsert",
                payload={
                    "turn_id": turn.id,
                    "outcome": "resolved",
                    "location_id": prepared.location_id,
                    "graph_context_status": graph_context_status,
                },
            )
        )
        db.flush()
        ambient_input_state = build_session_state(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            location_id=prepared.location_id,
            include_internal=True,
        )
        ambient_result = _run_ambient_world_pass(
            db,
            container,
            game_session=game_session,
            player_actor=player_actor,
            turn=turn,
            location_id=prepared.location_id,
            session_state=ambient_input_state,
        )
        post_state = build_session_state(
            db,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            location_id=prepared.location_id,
            include_internal=True,
        )
        travel_summary = str(event.payload.get("travel_summary") or event.narrative)
        branch_updates, crossroads_summary = _branch_response_from_state(post_state)
        next_choices = _canonicalize_next_choices(post_state.get("next_choices") or [], post_state.get("next_choices") or [])
        turn.resolved_output = {
            "status": "resolved",
            "action_type": "travel",
            "resolution_mode": resolution_mode,
            "input_mode": input_mode,
            "narrative": event.narrative,
            "npc_reaction": (
                f"{local_guide.display_name if local_guide is not None else 'The scene'} keeps the failed approach in view "
                "and answers with a little more caution."
            ),
            "graph_context_status": graph_context_status,
            "interpreted_intent": interpreted_intent,
            "consequence_summary": consequence_result.consequence_summary,
            "relationship_updates": consequence_result.relationship_updates,
            "consequence_updates": consequence_result.consequence_updates,
            "scene_tone": consequence_result.scene_tone,
            "outcome_band": consequence_result.outcome_band,
            "scene_summary": ambient_result["scene_summary"] or scene_result["scene_summary"],
            "scene_updates": [*scene_result["scene_updates"], *ambient_result["scene_updates"]],
            "chapter_updates": [*scene_result["chapter_updates"], *ambient_result["chapter_updates"]],
            "branch_updates": branch_updates,
            "crossroads_summary": crossroads_summary,
            "location_updates": [],
            "current_location": post_state.get("current_location"),
            "travel_summary": travel_summary,
            "ambient_updates": ambient_result["ambient_updates"],
            "recent_world_beats": ambient_result["recent_world_beats"],
            "next_choices": next_choices,
            **(extra_resolved_output or {}),
        }
        event.payload = {
            **event.payload,
            "relationship_updates": consequence_result.relationship_updates,
            "consequence_updates": consequence_result.consequence_updates,
            "scene_summary": ambient_result["scene_summary"] or scene_result["scene_summary"],
            "scene_updates": [*scene_result["scene_updates"], *ambient_result["scene_updates"]],
            "chapter_updates": [*scene_result["chapter_updates"], *ambient_result["chapter_updates"]],
            "branch_updates": branch_updates,
            "crossroads_summary": crossroads_summary,
            "ambient_updates": ambient_result["ambient_updates"],
            "recent_world_beats": ambient_result["recent_world_beats"],
        }
        _finalize_event_timeline_and_broadcast(
            db,
            event=event,
            broadcast_draft={
                "summary": travel_summary,
                "constraint_text": consequence_result.consequence_summary,
                "scope_kind": "location",
                "lifecycle_kind": "scene",
                "relevance_tags": ["public_attention", "overreach"],
            },
            shared_action_tag="destabilize",
            relevance_tags=["public_attention", "overreach"],
        )
        consume_broadcast_constraints(db, world_id=game_session.world_id, session_id=game_session.id)
        return TurnResolutionResult(
            turn=turn,
            event=event,
            memory_ids=[memory.id for memory in memories],
            event_payload=_event_payload(event),
            memories_payload=[_memory_payload(memory) for memory in memories],
            graph_context_status=graph_context_status,
            sp_delta=prepared.debit.delta,
            sp_balance=prepared.debit.balance_after,
            paid_sp=prepared.debit.paid_balance_after,
            bonus_sp=prepared.debit.bonus_balance_after,
            sp_ledger_id=prepared.debit.ledger_entry.id,
            quest_updates=[],
            faction_updates=[],
            inventory_updates=[],
            relationship_updates=consequence_result.relationship_updates,
            consequence_updates=consequence_result.consequence_updates,
            scene_updates=[*scene_result["scene_updates"], *ambient_result["scene_updates"]],
            chapter_updates=[*scene_result["chapter_updates"], *ambient_result["chapter_updates"]],
            branch_updates=branch_updates,
            ambient_updates=ambient_result["ambient_updates"],
            location_updates=[],
            action_type="travel",
            input_mode=input_mode,
            interpreted_intent=interpreted_intent,
            next_choices=next_choices,
            consequence_summary=consequence_result.consequence_summary,
            scene_tone=consequence_result.scene_tone,
            scene_summary=ambient_result["scene_summary"] or scene_result["scene_summary"],
            crossroads_summary=crossroads_summary,
            current_location=post_state.get("current_location"),
            travel_summary=travel_summary,
            recent_world_beats=ambient_result["recent_world_beats"],
            recent_offstage_beats=post_state.get("recent_offstage_beats") or [],
            idle_updates=[],
            progress_phases=[
                *(progress_phases or ["travel_resolution"]),
                "consequence_resolution",
                "scene_framing",
                "ambient_world_pass",
                "choice_generation",
            ],
        )


def _build_failed_turn_result(
    db: Session,
    container: AppContainer,
    prepared: PreparedTurnContext,
    *,
    turn: Turn,
    action_type: str,
    resolution_mode: str,
    action_label: str,
    graph_context_status: str,
    failure_reason: str,
    model_lane: str,
    status_code: int,
    input_mode: str,
    interpreted_intent: dict[str, Any],
    next_choices: list[dict[str, Any]],
    consequence_summary: str,
    progress_phases: list[str],
    failure_payload: dict | None = None,
) -> TurnResolutionResult:
    game_session = prepared.session
    player_actor = prepared.player_actor

    failure = {
        "reason": failure_reason,
        "rejection_role": (failure_payload or {}).get("rejection_role"),
        "final_lane": model_lane,
        "used_fallback": bool((failure_payload or {}).get("used_fallback", False)),
        "council_trace": (failure_payload or {}).get("council_trace", []),
        "retryable_choice_id": next(
            (
                str(item.get("choice_id"))
                for item in next_choices
                if isinstance(item, dict) and item.get("choice_id")
            ),
            None,
        ),
    }
    turn.model_lane = model_lane
    turn.resolved_output = {
        "status": "failed",
        "action_type": action_type,
        "resolution_mode": resolution_mode,
        "error_detail": failure_reason,
        "failure": failure,
        "graph_context_status": graph_context_status,
        "input_mode": input_mode,
        "interpreted_intent": interpreted_intent,
        "next_choices": next_choices,
        "consequence_summary": consequence_summary,
        "scene_summary": consequence_summary,
        "relationship_updates": [],
        "consequence_updates": [],
        "scene_updates": [],
        "chapter_updates": [],
        "branch_updates": [],
        "crossroads_summary": "",
        "ambient_updates": [],
        "recent_world_beats": [],
        "shared_action_tag": "none",
        "shared_consequence_updates": {
            "shared_action_tag": "none",
            "applied_rule_ids": [],
            "axis_updates": [],
            "faction_updates": [],
            "location_updates": [],
            "relationship_updates": [],
            "history_records": [],
            "title_progress": [],
            "memory_ids": [],
        },
        "scene_tone": scene_tone_for_band("setback"),
        "outcome_band": "setback",
        **(failure_payload or {}),
    }
    failure_event = Event(
        world_id=game_session.world_id,
        session_id=game_session.id,
        turn_id=turn.id,
        event_type="player.turn.failed",
        source_actor_id=player_actor.id,
        location_id=prepared.location_id,
        payload={
            "action": action_label,
            "action_type": action_type,
            "failure_reason": failure_reason,
            "world_id": game_session.world_id,
            "location_id": prepared.location_id,
            "graph_context_status": graph_context_status,
            **(failure_payload or {}),
        },
        narrative=f"{player_actor.display_name}の行動『{action_label}』は監査対象として記録された。",
    )
    db.add(failure_event)
    db.flush()
    db.add(
        OutboxEvent(
            world_id=game_session.world_id,
            event_id=failure_event.id,
            projection_type="world_graph.audit",
            payload={"turn_id": turn.id, "outcome": "failed", "graph_context_status": graph_context_status},
        )
    )
    refund = container.economy_service.refund_turn_cost(
        db,
        user_sub=prepared.debit.ledger_entry.user_sub,
        world_id=game_session.world_id,
        actor_id=player_actor.id,
        reference_id=turn.id,
        note=failure_reason,
        cost=abs(prepared.debit.delta),
    )
    db.flush()
    _finalize_event_timeline_and_broadcast(db, event=failure_event)
    return TurnResolutionResult(
        turn=turn,
        event=failure_event,
        memory_ids=[],
        event_payload=_event_payload(failure_event),
        memories_payload=[],
        graph_context_status=graph_context_status,
        sp_delta=0,
        sp_balance=refund.balance_after,
        paid_sp=refund.paid_balance_after,
        bonus_sp=refund.bonus_balance_after,
        sp_ledger_id=prepared.debit.ledger_entry.id,
        quest_updates=[],
        faction_updates=[],
        inventory_updates=[],
        relationship_updates=[],
        consequence_updates=[],
        scene_updates=[],
        chapter_updates=[],
        branch_updates=[],
        ambient_updates=[],
        location_updates=[],
        action_type=action_type,
        input_mode=input_mode,
        interpreted_intent=interpreted_intent,
        next_choices=next_choices,
        consequence_summary=consequence_summary,
        scene_tone=scene_tone_for_band("setback"),
        scene_summary=consequence_summary,
        crossroads_summary="",
        current_location=get_location_summary(db, game_session.world_id, prepared.location_id),
        travel_summary=None,
        recent_world_beats=[],
        recent_offstage_beats=_session_state_with_latest_choices(
            db,
            session_id=game_session.id,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            location_id=prepared.location_id,
        ).get("recent_offstage_beats")
        or [],
        idle_updates=[],
        progress_phases=progress_phases,
        failure=failure,
        error_detail=failure_reason,
        status_code=status_code,
    )


def prepare_turn_for_session(
    db: Session,
    container: AppContainer,
    user: UserIdentity,
    session_id: str,
    input_mode: str = "choice",
) -> PreparedTurnContext:
    stmt = select(GameSession).where(GameSession.id == session_id)
    game_session = db.execute(stmt).scalar_one_or_none()
    if game_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    player_row = get_player_profile_for_user(db, game_session.world_id, user.sub, game_session.player_actor_id)
    if player_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found for current user")
    player_actor, _ = player_row

    current_location = ensure_starter_location(db, game_session.world_id)
    if player_actor.current_location_id is None:
        player_actor.current_location_id = current_location.id
        db.flush()
    ensure_world_slice_seed(
        db,
        world_id=game_session.world_id,
        player_actor_id=player_actor.id,
    )
    guide_npc = get_or_create_guide_npc(db, game_session.world_id, location_id=player_actor.current_location_id)
    planned_turn_id = new_id()
    turn_cost = _turn_cost_for_mode(container.settings, input_mode)
    try:
        debit = container.economy_service.debit_turn_cost(
            db,
            user_sub=user.sub,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            reference_id=planned_turn_id,
            cost=turn_cost,
        )
    except InsufficientSPError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "detail": exc.detail,
                "balance": exc.balance,
                "paid_sp": exc.paid_sp,
                "bonus_sp": exc.bonus_sp,
                "required": exc.required,
                "turn_cost": turn_cost,
                "choice_turn_cost": container.settings.choice_turn_sp_cost,
                "free_text_turn_cost": container.settings.free_text_turn_sp_cost,
            },
        ) from exc

    return PreparedTurnContext(
        session=game_session,
        player_actor=player_actor,
        guide_npc=guide_npc,
        location_id=player_actor.current_location_id or current_location.id,
        turn_id=planned_turn_id,
        debit=debit,
        input_mode=input_mode,
    )


def load_prepared_turn_context_for_job(
    db: Session,
    container: AppContainer,
    *,
    session_id: str,
    user_sub: str,
    turn_id: str,
    input_mode: str,
) -> PreparedTurnContext:
    game_session = db.execute(select(GameSession).where(GameSession.id == session_id)).scalar_one_or_none()
    if game_session is None:
        raise LookupError(f"Session not found for turn job: {session_id}")

    player_row = get_player_profile_for_user(db, game_session.world_id, user_sub, game_session.player_actor_id)
    if player_row is None:
        raise LookupError(f"Session does not belong to turn job user: {session_id}")
    player_actor, _ = player_row

    current_location = ensure_starter_location(db, game_session.world_id)
    if player_actor.current_location_id is None:
        player_actor.current_location_id = current_location.id
        db.flush()
    ensure_world_slice_seed(
        db,
        world_id=game_session.world_id,
        player_actor_id=player_actor.id,
    )
    guide_npc = get_or_create_guide_npc(db, game_session.world_id, location_id=player_actor.current_location_id)
    ledger_entry = db.execute(
        select(SPLedgerEntry).where(
            SPLedgerEntry.user_sub == user_sub,
            SPLedgerEntry.reference_type == "turn",
            SPLedgerEntry.reference_id == turn_id,
            SPLedgerEntry.reason_code == "turn_cost",
        )
    ).scalar_one_or_none()
    if ledger_entry is None:
        raise LookupError(f"Turn job is missing committed SP debit: {turn_id}")
    debit = SPMutationResult(
        ledger_entry=ledger_entry,
        balance_after=ledger_entry.balance_after,
        paid_balance_after=ledger_entry.paid_balance_after,
        bonus_balance_after=ledger_entry.bonus_balance_after,
        delta=ledger_entry.delta,
        paid_delta=ledger_entry.paid_delta,
        bonus_delta=ledger_entry.bonus_delta,
    )
    return PreparedTurnContext(
        session=game_session,
        player_actor=player_actor,
        guide_npc=guide_npc,
        location_id=player_actor.current_location_id or current_location.id,
        turn_id=turn_id,
        debit=debit,
        input_mode=input_mode,
    )


def get_session_state_for_user(
    db: Session,
    *,
    user: UserIdentity,
    session_id: str,
) -> dict:
    game_session = db.execute(select(GameSession).where(GameSession.id == session_id)).scalar_one_or_none()
    if game_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    player_row = get_player_profile_for_user(db, game_session.world_id, user.sub, game_session.player_actor_id)
    if player_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found for current user")
    player_actor, _ = player_row

    current_location = ensure_starter_location(db, game_session.world_id)
    if player_actor.current_location_id is None:
        player_actor.current_location_id = current_location.id
        db.flush()
    ensure_world_slice_seed(
        db,
        world_id=game_session.world_id,
        player_actor_id=player_actor.id,
    )
    return _session_state_with_latest_choices(
        db,
        session_id=game_session.id,
        world_id=game_session.world_id,
        actor_id=player_actor.id,
        location_id=player_actor.current_location_id or current_location.id,
    )


def _event_payload(event: Event) -> dict:
    return {
        "id": event.id,
        "world_id": event.world_id,
        "event_type": event.event_type,
        "canonical_sequence": event.canonical_sequence,
        "canonical_status": event.canonical_status,
        "timeline_entry_id": event.timeline_entry_id,
        "narrative": event.narrative,
        "location_id": event.location_id,
        "payload": event.payload,
    }


def _memory_payload(memory) -> dict:
    return {
        "id": memory.id,
        "world_id": memory.world_id,
        "scope": memory.scope,
        "text": memory.text,
        "salience": memory.salience,
        "actor_id": memory.actor_id,
        "location_id": memory.location_id,
    }


def _turn_cost_for_mode(settings, input_mode: str) -> int:
    if input_mode == "free_text":
        return settings.free_text_turn_sp_cost
    return settings.choice_turn_sp_cost


def _session_state_with_latest_choices(
    db: Session,
    *,
    session_id: str,
    world_id: str,
    actor_id: str,
    location_id: str | None,
) -> dict[str, Any]:
    sync_active_broadcast_deliveries(
        db,
        world_id=world_id,
        session_id=session_id,
        actor_id=actor_id,
        location_id=location_id,
    )
    state = build_session_state(
        db,
        world_id=world_id,
        actor_id=actor_id,
        location_id=location_id,
        include_internal=True,
    )
    fallback_choices = state.get("next_choices") or []
    state["next_choices"] = _latest_session_choices(db, session_id=session_id, fallback_choices=fallback_choices)
    broadcast_constraints = pending_broadcast_constraints(db, world_id=world_id, session_id=session_id)
    state["world_broadcast_constraints"] = broadcast_constraints
    shared_context = dict(state.get("shared_world_context") or {})
    shared_context["active_broadcast_constraints"] = broadcast_constraints
    state["shared_world_context"] = shared_context
    return state


def _latest_session_choices(
    db: Session,
    *,
    session_id: str,
    fallback_choices: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    turns = list(
        db.execute(
            select(Turn)
            .where(Turn.session_id == session_id)
            .order_by(Turn.created_at.desc(), Turn.id.desc())
            .limit(16)
        ).scalars()
    )
    for turn in turns:
        resolved_output = turn.resolved_output or {}
        raw_choices = resolved_output.get("next_choices")
        if isinstance(raw_choices, list) and raw_choices:
            return _canonicalize_next_choices(raw_choices, fallback_choices)
    return _canonicalize_next_choices(fallback_choices, fallback_choices)


def _canonicalize_next_choices(
    raw_choices: list[dict[str, Any]] | list[Any],
    fallback_choices: list[dict[str, Any]] | list[Any],
) -> list[dict[str, Any]]:
    fallback_by_posture: dict[str, dict[str, Any]] = {}
    for raw_choice in fallback_choices:
        if not isinstance(raw_choice, dict):
            continue
        posture = str(raw_choice.get("posture") or "")
        if posture in CHOICE_ORDER:
            fallback_by_posture[posture] = dict(raw_choice)

    raw_by_posture: dict[str, dict[str, Any]] = {}
    for raw_choice in raw_choices:
        if not isinstance(raw_choice, dict):
            continue
        posture = str(raw_choice.get("posture") or "")
        if posture in CHOICE_ORDER:
            raw_by_posture[posture] = dict(raw_choice)

    normalized: list[dict[str, Any]] = []
    for posture in CHOICE_ORDER:
        fallback = fallback_by_posture.get(posture, {})
        has_current = posture in raw_by_posture
        current = raw_by_posture.get(posture, fallback)
        fallback_action_kind = str(fallback.get("action_kind") or "narrative")
        requested_action_kind = str(current.get("action_kind") or ("narrative" if has_current else fallback_action_kind))
        action_kind = requested_action_kind if requested_action_kind in {"narrative", "use_reward_item", "travel"} else "narrative"
        label = str(
            current.get("label")
            or (fallback.get("label") if not has_current else "")
            or (fallback.get("canonical_input_text") if not has_current else "")
            or posture
        ).strip()
        canonical_input_text = str(
            current.get("canonical_input_text")
            or current.get("intent_summary")
            or (fallback.get("canonical_input_text") if not has_current else "")
            or label
        ).strip()
        summary = str(
            current.get("summary")
            or current.get("intent_summary")
            or (fallback.get("summary") if not has_current else "")
            or label
        ).strip()
        travel_target_key = None
        if action_kind == "travel":
            travel_target_key = str(
                current.get("travel_target_key") or (fallback.get("travel_target_key") if not has_current else "")
            ).strip() or None
        label = _sanitize_non_progress_choice_promise(posture=posture, text=label)
        summary = _sanitize_non_progress_choice_promise(posture=posture, text=summary)
        canonical_input_text = _sanitize_non_progress_choice_promise(posture=posture, text=canonical_input_text)
        normalized.append(
            {
                "choice_id": str(current.get("choice_id") or fallback.get("choice_id") or posture),
                "posture": posture,
                "label": label,
                "summary": summary,
                "canonical_input_text": canonical_input_text,
                "action_kind": action_kind,
                "travel_target_key": travel_target_key,
            }
        )
    return normalized


def _sanitize_non_progress_choice_promise(*, posture: str, text: str) -> str:
    if posture == "progress" or not text:
        return text
    replacements = {
        "次のクエスト段階へ進む": "次の判断材料が増える",
        "次の段階へ進む": "次の判断材料が増える",
        "登録が完了する": "登録内容の問題点が見える",
        "登録を完了する": "登録内容を確認する",
        "registration completes": "registration can be checked",
        "complete the registration": "check the registration",
        "advance to the next quest stage": "reveal the next decision point",
        "move to the next quest stage": "reveal the next decision point",
    }
    sanitized = text
    for source, replacement in replacements.items():
        sanitized = sanitized.replace(source, replacement)
    return sanitized


def _choice_signature(choice: dict[str, Any]) -> tuple[str, str, str, str]:
    return (
        str(choice.get("posture") or choice.get("choice_id") or "").strip(),
        str(choice.get("label") or "").strip(),
        str(choice.get("travel_target_key") or "").strip(),
        str(choice.get("action_kind") or "narrative").strip(),
    )


def _choices_are_effectively_same(left: list[dict[str, Any]] | list[Any], right: list[dict[str, Any]] | list[Any]) -> bool:
    left_choices = [item for item in left if isinstance(item, dict)]
    right_choices = [item for item in right if isinstance(item, dict)]
    if len(left_choices) != len(right_choices) or not left_choices:
        return False
    return {_choice_signature(item) for item in left_choices} == {_choice_signature(item) for item in right_choices}


def _choices_look_english(choices: list[dict[str, Any]]) -> bool:
    text = " ".join(str(item.get("label") or "") for item in choices)
    if not text:
        return False
    ascii_letters = sum(1 for char in text if char.isascii() and char.isalpha())
    non_ascii = sum(1 for char in text if not char.isascii())
    return ascii_letters > non_ascii


def _contextualize_repeated_choices(
    choices: list[dict[str, Any]],
    *,
    input_text: str,
    consequence_summary: str,
) -> list[dict[str, Any]]:
    context = " ".join((consequence_summary or input_text).split()).strip()
    if len(context) > 120:
        context = f"{context[:117]}..."
    if not context:
        context = "直前の結果"
    english = _choices_look_english(choices)
    refreshed: list[dict[str, Any]] = []
    for choice in choices:
        item = dict(choice)
        if str(item.get("action_kind") or "narrative") != "narrative":
            refreshed.append(item)
            continue
        posture = str(item.get("posture") or item.get("choice_id") or "")
        if english:
            if posture == "safe":
                item["label"] = "Ask the local witness what changed"
                item["summary"] = f"Confirm the visible result before committing further: {context}"
                item["canonical_input_text"] = f"Ask the local witness what changed after: {context}"
            elif posture == "progress":
                item["label"] = "Settle one unfinished task in front of you"
                item["summary"] = f"Turn the visible result into a concrete state change: {context}"
                item["canonical_input_text"] = f"Settle one unfinished task opened by: {context}"
            else:
                item["label"] = "Trace where the new reaction spreads"
                item["summary"] = f"Check who or what now reacts differently: {context}"
                item["canonical_input_text"] = f"Trace where the new reaction spreads after: {context}"
        elif posture == "safe":
            item["label"] = "近くの証人に何が変わったか確認する"
            item["summary"] = f"次へ踏み込む前に、見えている結果を確かめる: {context}"
            item["canonical_input_text"] = f"近くの証人に何が変わったか確認する: {context}"
        elif posture == "progress":
            item["label"] = "目の前の未処理項目を一つ確定する"
            item["summary"] = f"見えている結果を、状態が変わる具体行動へ移す: {context}"
            item["canonical_input_text"] = f"目の前の未処理項目を一つ確定する: {context}"
        else:
            item["label"] = "新しい反応がどこへ広がったか調べる"
            item["summary"] = f"誰や何が反応を変えたかを追う: {context}"
            item["canonical_input_text"] = f"新しい反応がどこへ広がったか調べる: {context}"
        refreshed.append(item)
    return refreshed


def _select_choice(choices: list[dict[str, Any]], choice_id: str) -> dict[str, Any] | None:
    for choice in choices:
        if str(choice.get("choice_id") or "") == choice_id:
            return dict(choice)
    return None


def _reward_effect_kind_from_state(session_state: dict[str, Any]) -> str:
    return str((session_state.get("world_pack") or {}).get("reward_effect_kind") or "unlock_followup_route")


def _available_travel_target_keys(session_state: dict[str, Any]) -> set[str]:
    targets: set[str] = set()
    for route in session_state.get("nearby_routes") or []:
        if not isinstance(route, dict) or not bool(route.get("available")):
            continue
        destination_key = str(route.get("destination_key") or "").strip()
        if destination_key:
            targets.add(destination_key)
    return targets


def _resolve_usable_reward_item_id(session_state: dict[str, Any]) -> str | None:
    reward_effect_kind = _reward_effect_kind_from_state(session_state)
    for affordance in session_state.get("important_inventory_affordances") or []:
        if not isinstance(affordance, dict):
            continue
        if affordance.get("usable") and affordance.get("effect_kind") == reward_effect_kind:
            item_id = str(affordance.get("item_id") or "").strip()
            if item_id:
                return item_id
    for item in session_state.get("inventory") or []:
        if not isinstance(item, dict):
            continue
        if item.get("usable") and item.get("effect_kind") == reward_effect_kind:
            item_id = str(item.get("id") or "").strip()
            if item_id:
                return item_id
    return None


def _resolve_travel_target_key(
    interpreted_intent: dict[str, Any],
    selected_choice: dict[str, Any] | None,
    *,
    session_state: dict[str, Any],
) -> str | None:
    allowed = _available_travel_target_keys(session_state)
    selected_target = str((selected_choice or {}).get("travel_target_key") or "").strip()
    if selected_target in allowed:
        return selected_target
    interpreted_target = str(interpreted_intent.get("travel_target_key") or "").strip()
    if interpreted_target in allowed:
        return interpreted_target
    return None


def _coerce_choice_world_tags(
    *,
    session_state: dict[str, Any],
    selected_choice: dict[str, Any] | None,
    world_tags: list[str] | None,
) -> list[str]:
    normalized = normalize_world_tags(world_tags)
    if not selected_choice:
        return normalized
    if str(selected_choice.get("posture") or "").strip() != "progress":
        return normalized
    if any(tag in {"aid_local", "promise_followup", "collect_reward"} for tag in normalized):
        return normalized

    active_quest = next((item for item in session_state.get("quests") or [] if item.get("status") == "active"), None)
    if not isinstance(active_quest, dict):
        return normalized
    stage_key = str(active_quest.get("stage_key") or "").strip()
    progress = int(active_quest.get("progress") or 0)
    progress_target = int(active_quest.get("progress_target") or 0)
    if progress_target and progress >= progress_target:
        return normalized
    world_pack = session_state.get("world_pack") or {}
    starter_stage_key = str(world_pack.get("starter_stage_key") or "starter_stage")
    followup_stage_key = str(world_pack.get("followup_stage_key") or "followup_stage")
    if "threaten_local" in normalized:
        return normalized
    if stage_key == starter_stage_key:
        progress_tag = "aid_local" if progress < 1 else "promise_followup"
    else:
        progress_tag = "promise_followup"
    if stage_key in {starter_stage_key, followup_stage_key} or str(active_quest.get("status") or "") == "active":
        return normalize_world_tags([*(tag for tag in normalized if tag != "none"), progress_tag])
    return normalized


def _progress_phases_from_role_runs(role_runs: list[Any]) -> list[str]:
    phase_map = {
        "intent_interpreter": "intent_interpretation",
        "memory_manager": "memory_council",
        "npc_manager": "npc_council",
        "situation_mapper": "situation_mapping",
        "world_progress": "world_progress",
        "rules_arbiter": "rules_arbiter",
        "safety_guard": "safety_guard",
        "narrative": "narrative",
    }
    phases: list[str] = []
    for role_run in role_runs:
        phase = phase_map.get(getattr(role_run, "council_role", ""))
        if phase and phase not in phases:
            phases.append(phase)
    return phases
