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


@dataclass
class TurnResolutionResult:
    turn: Turn
    event_payload: dict
    memories_payload: list[dict]


def create_session_for_user(
    db: Session,
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
    return SessionCreationResult(session=session, world=world, player_actor=player_actor, guide_npc=guide_npc)


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
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Session does not belong to current user")

    guide_npc = get_or_create_guide_npc(db, game_session.world_id)
    relevant_memories = search_memories(db, world_id=game_session.world_id, query=input_text, actor_id=guide_npc.id)
    resolution = container.model_router.resolve_turn(
        world_id=game_session.world_id,
        player_name=player_actor.display_name,
        npc_name=guide_npc.display_name,
        input_text=input_text,
        relevant_memories=[item.text for item in relevant_memories],
    )

    turn = Turn(
        world_id=game_session.world_id,
        session_id=game_session.id,
        actor_id=player_actor.id,
        input_text=input_text,
        resolved_output={"narrative": resolution.narrative, "npc_reaction": resolution.npc_reaction},
        model_lane=resolution.model_lane,
    )
    db.add(turn)
    db.flush()

    event = Event(
        world_id=game_session.world_id,
        session_id=game_session.id,
        turn_id=turn.id,
        event_type=resolution.event_type,
        source_actor_id=player_actor.id,
        payload=resolution.event_payload,
        narrative=resolution.narrative,
    )
    db.add(event)
    db.flush()

    memories = materialize_memories(
        db,
        world_id=game_session.world_id,
        source_event_id=event.id,
        drafts=[
            {
                **draft,
                "actor_id": guide_npc.id if draft["scope"] == "actor" else None,
            }
            for draft in resolution.memories
        ],
    )

    db.add(
        LLMRun(
            world_id=game_session.world_id,
            turn_id=turn.id,
            prompt_id=resolution.prompt_id,
            model_id=resolution.model_id,
            model_lane=resolution.model_lane,
            input_hash=resolution.input_hash,
            schema_version=resolution.schema_version,
            output_schema_status="valid",
            output_payload={
                "narrative": resolution.narrative,
                "npc_reaction": resolution.npc_reaction,
                "event_payload": resolution.event_payload,
            },
        )
    )
    db.add(
        OutboxEvent(
            world_id=game_session.world_id,
            event_id=event.id,
            projection_type="world_graph.upsert",
            payload={"turn_id": turn.id},
        )
    )
    db.flush()

    return TurnResolutionResult(
        turn=turn,
        event_payload={
            "id": event.id,
            "world_id": event.world_id,
            "event_type": event.event_type,
            "narrative": event.narrative,
            "payload": event.payload,
        },
        memories_payload=[
            {
                "id": memory.id,
                "world_id": memory.world_id,
                "scope": memory.scope,
                "text": memory.text,
                "salience": memory.salience,
                "actor_id": memory.actor_id,
            }
            for memory in memories
        ],
    )
