from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.container import AppContainer
from app.models.entities import Event, LLMRun, OutboxEvent, Session as GameSession, Turn
from app.modules.actor.service import ensure_player_actor, get_or_create_guide_npc, get_player_actor_for_user
from app.modules.identity.oidc import UserIdentity
from app.modules.world_memory.service import materialize_memories, search_memories
from app.modules.world_state.service import ensure_world


@dataclass
class SessionCreationResult:
    session: GameSession
    world: object
    player_actor: object
    guide_npc: object
    websocket_url: str


@dataclass
class TurnResolutionResult:
    turn: Turn
    event: Event
    memory_ids: list[str]
    event_payload: dict
    memories_payload: list[dict]
    error_detail: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.error_detail is None


def create_session_for_user(
    db: Session,
    container: AppContainer,
    user: UserIdentity,
    world_id: str,
    world_name: str,
    player_display_name: str | None,
) -> SessionCreationResult:
    world = ensure_world(db, world_id, world_name)
    player_actor = ensure_player_actor(db, world_id, user.sub, player_display_name or user.name)
    guide_npc = get_or_create_guide_npc(db, world_id)

    session = GameSession(world_id=world.id, player_actor_id=player_actor.id, status="active")
    db.add(session)
    db.flush()
    websocket_url = f"{container.settings.public_ws_base_url.rstrip('/')}/ws/sessions/{session.id}"
    return SessionCreationResult(
        session=session,
        world=world,
        player_actor=player_actor,
        guide_npc=guide_npc,
        websocket_url=websocket_url,
    )


def resolve_turn_for_session(
    db: Session,
    container: AppContainer,
    user: UserIdentity,
    session_id: str,
    input_text: str,
) -> TurnResolutionResult:
    stmt = select(GameSession).where(GameSession.id == session_id)
    game_session = db.execute(stmt).scalar_one_or_none()
    if game_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    player_actor = get_player_actor_for_user(db, game_session.world_id, user.sub)
    if player_actor is None or player_actor.id != game_session.player_actor_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found for current user")

    guide_npc = get_or_create_guide_npc(db, game_session.world_id)
    turn = Turn(
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
    resolution = container.model_router.resolve_turn(
        world_id=game_session.world_id,
        player_name=player_actor.display_name,
        npc_name=guide_npc.display_name,
        input_text=input_text,
        relevant_memories=[item.text for item in relevant_memories],
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
            payload={
                "action": input_text,
                "failure_reason": resolution.failure_reason,
                "world_id": game_session.world_id,
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
                payload={"turn_id": turn.id, "outcome": "failed"},
            )
        )
        db.flush()
        return TurnResolutionResult(
            turn=turn,
            event=failure_event,
            memory_ids=[],
            event_payload=_event_payload(failure_event),
            memories_payload=[],
            error_detail=resolution.failure_reason or "Turn resolution failed",
        )

    payload = resolution.final_payload
    assert payload is not None

    turn.model_lane = resolution.final_lane
    turn.resolved_output = {
        "status": "resolved",
        "narrative": payload.narrative,
        "npc_reaction": payload.npc_reaction,
    }

    event = Event(
        world_id=game_session.world_id,
        session_id=game_session.id,
        turn_id=turn.id,
        event_type=payload.event_type,
        source_actor_id=player_actor.id,
        payload=payload.event_payload,
        narrative=payload.narrative,
    )
    db.add(event)
    db.flush()

    memories = materialize_memories(
        db,
        world_id=game_session.world_id,
        source_event_id=event.id,
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
            payload={"turn_id": turn.id, "outcome": "resolved"},
        )
    )
    db.flush()

    return TurnResolutionResult(
        turn=turn,
        event=event,
        memory_ids=[memory.id for memory in memories],
        event_payload=_event_payload(event),
        memories_payload=[_memory_payload(memory) for memory in memories],
    )


def _event_payload(event: Event) -> dict:
    return {
        "id": event.id,
        "world_id": event.world_id,
        "event_type": event.event_type,
        "narrative": event.narrative,
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
    }
