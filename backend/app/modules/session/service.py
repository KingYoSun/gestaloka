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
from app.modules.identity.oidc import UserIdentity
from app.modules.world_memory.service import materialize_memories, search_memories
from app.modules.world_state.service import ensure_starter_location, ensure_world


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
    sp_delta: int
    sp_balance: int
    sp_ledger_id: str
    error_detail: str | None = None

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
        },
        narrative=f"{player_actor.display_name}は{starter_location.name}でセッションを開始し、{guide_npc.display_name}と接続した。",
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
    )
    db.add(turn)
    db.flush()

    relevant_memories = search_memories(
        db,
        world_id=game_session.world_id,
        query=input_text,
        actor_id=guide_npc.id,
    )
    graph_context = container.projection_service.resolve_relation_context(
        db,
        world_id=game_session.world_id,
        primary_actor_id=guide_npc.id,
        counterpart_actor_id=player_actor.id,
        location_id=prepared.location_id,
    )
    resolution = container.model_router.resolve_turn(
        world_id=game_session.world_id,
        player_name=player_actor.display_name,
        npc_name=guide_npc.display_name,
        input_text=input_text,
        relevant_memories=[item.text for item in relevant_memories],
        relation_context=graph_context.context.prompt_lines(),
    )

    for attempt in resolution.attempts:
        db.add(
            LLMRun(
                world_id=game_session.world_id,
                turn_id=turn.id,
                prompt_id=attempt.prompt_id,
                model_id=attempt.model_id,
                model_lane=attempt.model_lane,
                input_hash=attempt.input_hash,
                schema_version=attempt.schema_version,
                graph_context_status=graph_context.status,
                output_schema_status=attempt.output_schema_status,
                output_payload=attempt.output_payload,
            )
        )

    if not resolution.succeeded:
        turn.model_lane = resolution.final_lane
        turn.resolved_output = {
            "status": "failed",
            "error_detail": resolution.failure_reason,
        }
        failure_event = Event(
            world_id=game_session.world_id,
            session_id=game_session.id,
            turn_id=turn.id,
            event_type="player.turn.failed",
            source_actor_id=player_actor.id,
            location_id=prepared.location_id,
            payload={
                "action": input_text,
                "failure_reason": resolution.failure_reason,
                "world_id": game_session.world_id,
                "location_id": prepared.location_id,
                "graph_context_status": graph_context.status,
            },
            narrative=f"{player_actor.display_name}の行動『{input_text}』は監査対象として記録された。",
        )
        db.add(failure_event)
        db.flush()
        db.add(
            OutboxEvent(
                world_id=game_session.world_id,
                event_id=failure_event.id,
                projection_type="world_graph.audit",
                payload={"turn_id": turn.id, "outcome": "failed", "graph_context_status": graph_context.status},
            )
        )
        refund = container.economy_service.refund_turn_cost(
            db,
            user_sub=prepared.debit.ledger_entry.user_sub,
            world_id=game_session.world_id,
            actor_id=player_actor.id,
            reference_id=turn.id,
            note=resolution.failure_reason,
        )
        db.flush()
        return TurnResolutionResult(
            turn=turn,
            event=failure_event,
            memory_ids=[],
            event_payload=_event_payload(failure_event),
            memories_payload=[],
            sp_delta=0,
            sp_balance=refund.balance_after,
            sp_ledger_id=prepared.debit.ledger_entry.id,
            error_detail=resolution.failure_reason or "Turn resolution failed",
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

    turn.model_lane = resolution.final_lane
    turn.resolved_output = {
        "status": "resolved",
        "narrative": payload.narrative,
        "npc_reaction": payload.npc_reaction,
        "graph_context_status": graph_context.status,
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
            "location_id": prepared.location_id,
            "graph_context_status": graph_context.status,
        },
        narrative=payload.narrative,
    )
    db.add(event)
    db.flush()

    memories = materialize_memories(
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
        sp_delta=prepared.debit.delta,
        sp_balance=prepared.debit.balance_after,
        sp_ledger_id=prepared.debit.ledger_entry.id,
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
