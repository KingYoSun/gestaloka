from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.container import AppContainer
from app.models.entities import Actor, Event, LLMRun, OutboxEvent, Session as GameSession, Turn, new_id
from app.modules.actor.service import (
    ensure_player_actor,
    ensure_relationship,
    get_or_create_guide_npc,
    get_player_actor_for_user,
    increment_relationship_strength,
)
from app.modules.economy_sp.service import InsufficientSPError, SPMutationResult
from app.modules.gm_council.service import CouncilRequest
from app.modules.identity.oidc import UserIdentity
from app.modules.world_memory.service import build_retrieval_query_text, retrieval_trace_to_dict
from app.modules.world_state.service import (
    apply_world_tag_updates,
    build_session_state,
    ensure_starter_location,
    ensure_world,
    ensure_world_slice_seed,
    use_reward_item,
)


@dataclass
class SessionCreationResult:
    session: GameSession
    world: object
    player_actor: object
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
    sp_ledger_id: str
    quest_updates: list[dict]
    faction_updates: list[dict]
    inventory_updates: list[dict]
    action_type: str
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


def create_session_for_user(
    db: Session,
    container: AppContainer,
    user: UserIdentity,
    world_id: str,
    world_name: str,
    player_display_name: str | None,
) -> SessionCreationResult:
    world = ensure_world(db, world_id, world_name)
    starter_location = ensure_starter_location(db, world_id)
    player_actor = ensure_player_actor(
        db,
        world_id,
        user.sub,
        player_display_name or user.name,
        location_id=starter_location.id,
    )
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
    seeded = ensure_world_slice_seed(
        db,
        world_id=world_id,
        player_actor_id=player_actor.id,
        guide_actor_id=guide_npc.id,
    )

    session = GameSession(world_id=world.id, player_actor_id=player_actor.id, status="active")
    db.add(session)
    db.flush()
    bootstrap_turn = Turn(
        world_id=world.id,
        session_id=session.id,
        actor_id=player_actor.id,
        input_text="[session started]",
        resolved_output={"status": "system"},
        model_lane="system",
        action_type="system",
        resolution_mode="system",
    )
    db.add(bootstrap_turn)
    db.flush()

    bootstrap_event = Event(
        world_id=world.id,
        session_id=session.id,
        turn_id=bootstrap_turn.id,
        event_type="session.started",
        source_actor_id=player_actor.id,
        location_id=starter_location.id,
        payload={
            "session_id": session.id,
            "world_id": world.id,
            "npc_actor_id": guide_npc.id,
            "location_id": starter_location.id,
            "faction_id": seeded.faction.id,
            "quest_assignment_id": seeded.quest_assignment.id,
        },
        narrative=(
            f"{player_actor.display_name}は{starter_location.name}でセッションを開始し、"
            f"{guide_npc.display_name}から{seeded.faction.name}の最初の依頼を受けた。"
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

    websocket_url = f"{container.settings.public_ws_base_url.rstrip('/')}/ws/sessions/{session.id}"
    return SessionCreationResult(
        session=session,
        world=world,
        player_actor=player_actor,
        guide_npc=guide_npc,
        starter_location=starter_location,
        websocket_url=websocket_url,
    )


def resolve_turn_for_session(
    db: Session,
    container: AppContainer,
    prepared: PreparedTurnContext,
    *,
    action_type: str,
    input_text: str | None = None,
    item_id: str | None = None,
) -> TurnResolutionResult:
    if action_type == "use_reward_item":
        if item_id is None:
            raise ValueError("item_id is required for use_reward_item")
        return _resolve_reward_item_turn_for_session(
            db,
            container,
            prepared,
            item_id=item_id,
        )
    if input_text is None:
        raise ValueError("input_text is required for narrative turns")
    return _resolve_narrative_turn_for_session(
        db,
        container,
        prepared,
        input_text=input_text,
    )


def _resolve_narrative_turn_for_session(
    db: Session,
    container: AppContainer,
    prepared: PreparedTurnContext,
    *,
    input_text: str,
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

    session_state = build_session_state(
        db,
        world_id=game_session.world_id,
        actor_id=player_actor.id,
        location_id=prepared.location_id,
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
            relevant_memories=[item.text for item in retrieval.memories],
            relation_context=graph_context.context.prompt_lines(),
            graph_context_status=graph_context.status,
            session_state=session_state,
        )
    )

    for role_run in resolution.role_runs:
        for attempt in role_run.attempts:
            db.add(
                LLMRun(
                    world_id=game_session.world_id,
                    turn_id=turn.id,
                    prompt_id=attempt.prompt_id,
                    workflow_name="gm_council",
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
                    input_hash=attempt.input_hash,
                    input_context_hash=attempt.input_context_hash,
                    schema_version=attempt.schema_version,
                    graph_context_status=graph_context.status,
                    output_schema_status=attempt.output_schema_status,
                    output_payload=attempt.output_payload,
                )
            )

    if not resolution.succeeded:
        return _build_failed_turn_result(
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

    payload = resolution.final_payload
    assert payload is not None

    increment_relationship_strength(
        db,
        world_id=game_session.world_id,
        from_actor_id=guide_npc.id,
        to_actor_id=player_actor.id,
    )
    increment_relationship_strength(
        db,
        world_id=game_session.world_id,
        from_actor_id=player_actor.id,
        to_actor_id=guide_npc.id,
    )
    state_updates = apply_world_tag_updates(
        db,
        world_id=game_session.world_id,
        actor_id=player_actor.id,
        world_tags=payload.world_tags,
    )

    turn.model_lane = resolution.final_lane
    turn.resolved_output = {
        "status": "resolved",
        "action_type": "narrative",
        "resolution_mode": "gm_council",
        "used_fallback": resolution.used_fallback,
        "retrieval_trace": retrieval_trace_to_dict(retrieval.trace),
        "narrative": payload.narrative,
        "npc_reaction": payload.npc_reaction,
        "graph_context_status": graph_context.status,
        "world_tags": payload.world_tags,
        "quest_updates": state_updates["quest_updates"],
        "faction_updates": state_updates["faction_updates"],
        "inventory_updates": state_updates["inventory_updates"],
        "council_trace": [
            {
                "role": item.council_role,
                "approval_status": item.approval_status,
                "final_lane": item.final_lane,
            }
            for item in resolution.role_runs
        ],
    }

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
            "world_tags": payload.world_tags,
            "quest_updates": state_updates["quest_updates"],
            "faction_updates": state_updates["faction_updates"],
            "inventory_updates": state_updates["inventory_updates"],
        },
        narrative=payload.narrative,
    )
    db.add(event)
    db.flush()

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

    return TurnResolutionResult(
        turn=turn,
        event=event,
        memory_ids=[memory.id for memory in memories],
        event_payload=_event_payload(event),
        memories_payload=[_memory_payload(memory) for memory in memories],
        graph_context_status=graph_context.status,
        sp_delta=prepared.debit.delta,
        sp_balance=prepared.debit.balance_after,
        sp_ledger_id=prepared.debit.ledger_entry.id,
        quest_updates=state_updates["quest_updates"],
        faction_updates=state_updates["faction_updates"],
        inventory_updates=state_updates["inventory_updates"],
        action_type="narrative",
    )


def _resolve_reward_item_turn_for_session(
    db: Session,
    container: AppContainer,
    prepared: PreparedTurnContext,
    *,
    item_id: str,
) -> TurnResolutionResult:
    game_session = prepared.session
    player_actor = prepared.player_actor
    guide_npc = prepared.guide_npc
    action_label = f"[use_reward_item:{item_id}]"

    turn = Turn(
        id=prepared.turn_id,
        world_id=game_session.world_id,
        session_id=game_session.id,
        actor_id=player_actor.id,
        input_text=action_label,
        resolved_output={"status": "pending"},
        model_lane="deterministic",
        action_type="use_reward_item",
        resolution_mode="item_use_rule",
    )
    db.add(turn)
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
            resolution_mode="item_use_rule",
            action_label=action_label,
            graph_context_status="deterministic",
            failure_reason=str(exc),
            model_lane="deterministic",
            status_code=status.HTTP_404_NOT_FOUND,
            failure_payload={"item_id": item_id},
        )
    except ValueError as exc:
        return _build_failed_turn_result(
            db,
            container,
            prepared,
            turn=turn,
            action_type="use_reward_item",
            resolution_mode="item_use_rule",
            action_label=action_label,
            graph_context_status="deterministic",
            failure_reason=str(exc),
            model_lane="deterministic",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            failure_payload={"item_id": item_id},
        )

    npc_reaction = (
        f"{guide_npc.display_name}はLantern Sigilを確かめ、次の watch path が正式に開いたと告げた。"
    )
    turn.model_lane = "deterministic"
    turn.resolved_output = {
        "status": "resolved",
        "action_type": "use_reward_item",
        "resolution_mode": "item_use_rule",
        "narrative": outcome.event_narrative,
        "npc_reaction": npc_reaction,
        "graph_context_status": "deterministic",
        "quest_updates": outcome.quest_updates,
        "faction_updates": outcome.faction_updates,
        "inventory_updates": outcome.inventory_updates,
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
            "quest_updates": outcome.quest_updates,
            "faction_updates": outcome.faction_updates,
            "inventory_updates": outcome.inventory_updates,
        },
        narrative=outcome.event_narrative,
    )
    db.add(event)
    db.flush()

    memories = container.memory_service.materialize_memories(
        db,
        world_id=game_session.world_id,
        source_event_id=event.id,
        location_id=prepared.location_id,
        drafts=outcome.memory_drafts,
    )
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

    return TurnResolutionResult(
        turn=turn,
        event=event,
        memory_ids=[memory.id for memory in memories],
        event_payload=_event_payload(event),
        memories_payload=[_memory_payload(memory) for memory in memories],
        graph_context_status="deterministic",
        sp_delta=prepared.debit.delta,
        sp_balance=prepared.debit.balance_after,
        sp_ledger_id=prepared.debit.ledger_entry.id,
        quest_updates=outcome.quest_updates,
        faction_updates=outcome.faction_updates,
        inventory_updates=outcome.inventory_updates,
        action_type="use_reward_item",
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
    failure_payload: dict | None = None,
) -> TurnResolutionResult:
    game_session = prepared.session
    player_actor = prepared.player_actor

    turn.model_lane = model_lane
    turn.resolved_output = {
        "status": "failed",
        "action_type": action_type,
        "resolution_mode": resolution_mode,
        "error_detail": failure_reason,
        "graph_context_status": graph_context_status,
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
    )
    db.flush()
    return TurnResolutionResult(
        turn=turn,
        event=failure_event,
        memory_ids=[],
        event_payload=_event_payload(failure_event),
        memories_payload=[],
        graph_context_status=graph_context_status,
        sp_delta=0,
        sp_balance=refund.balance_after,
        sp_ledger_id=prepared.debit.ledger_entry.id,
        quest_updates=[],
        faction_updates=[],
        inventory_updates=[],
        action_type=action_type,
        error_detail=failure_reason,
        status_code=status_code,
    )


def prepare_turn_for_session(
    db: Session,
    container: AppContainer,
    user: UserIdentity,
    session_id: str,
) -> PreparedTurnContext:
    stmt = select(GameSession).where(GameSession.id == session_id)
    game_session = db.execute(stmt).scalar_one_or_none()
    if game_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    player_actor = get_player_actor_for_user(db, game_session.world_id, user.sub)
    if player_actor is None or player_actor.id != game_session.player_actor_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found for current user")

    current_location = ensure_starter_location(db, game_session.world_id)
    if player_actor.current_location_id is None:
        player_actor.current_location_id = current_location.id
        db.flush()
    guide_npc = get_or_create_guide_npc(db, game_session.world_id, location_id=player_actor.current_location_id)
    planned_turn_id = new_id()
    try:
        debit = container.economy_service.debit_turn_cost(
            db,
            user_sub=user.sub,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            reference_id=planned_turn_id,
        )
    except InsufficientSPError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "detail": exc.detail,
                "balance": exc.balance,
                "required": exc.required,
                "turn_cost": container.settings.turn_sp_cost,
            },
        ) from exc

    return PreparedTurnContext(
        session=game_session,
        player_actor=player_actor,
        guide_npc=guide_npc,
        location_id=player_actor.current_location_id or current_location.id,
        turn_id=planned_turn_id,
        debit=debit,
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

    player_actor = get_player_actor_for_user(db, game_session.world_id, user.sub)
    if player_actor is None or player_actor.id != game_session.player_actor_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found for current user")

    current_location = ensure_starter_location(db, game_session.world_id)
    if player_actor.current_location_id is None:
        player_actor.current_location_id = current_location.id
        db.flush()
    guide_npc = get_or_create_guide_npc(db, game_session.world_id, location_id=player_actor.current_location_id)
    ensure_world_slice_seed(
        db,
        world_id=game_session.world_id,
        player_actor_id=player_actor.id,
        guide_actor_id=guide_npc.id,
    )
    return build_session_state(
        db,
        world_id=game_session.world_id,
        actor_id=player_actor.id,
        location_id=player_actor.current_location_id or current_location.id,
    )


def _event_payload(event: Event) -> dict:
    return {
        "id": event.id,
        "world_id": event.world_id,
        "event_type": event.event_type,
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
