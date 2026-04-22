from __future__ import annotations

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api import router as api_router
from app.api.deps import resolve_current_user_from_token
from app.core.container import AppContainer, build_container
from app.core.realtime import realtime_hub
from app.models.entities import Session as GameSession
from app.modules.actor.service import get_player_actor_for_user


def create_app(container: AppContainer | None = None) -> FastAPI:
    resolved_container = container or build_container()
    app = FastAPI(title="GESTALOKA v2 API", version="0.1.0")
    app.state.container = resolved_container

    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_container.settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=True,
    )

    @app.middleware("http")
    async def trace_http(request: Request, call_next):
        started_at = resolved_container.observability_service.timer()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            resolved_container.observability_service.trace_http_request(
                request.method,
                request.url.path,
                status_code,
                resolved_container.observability_service.elapsed(started_at),
            )

    app.include_router(api_router)

    @app.websocket("/ws/sessions/{session_id}")
    async def session_socket(websocket: WebSocket, session_id: str) -> None:
        world_id: str | None = None
        close_code: int | None = None
        outcome = "closed"
        connected = False
        token = websocket.query_params.get("token")
        if token is None:
            close_code = 4401
            outcome = "missing_token"
            await websocket.close(code=close_code)
            resolved_container.observability_service.trace_websocket_session(
                session_id=session_id,
                world_id=None,
                close_code=close_code,
                outcome=outcome,
            )
            return

        try:
            user = resolve_current_user_from_token(resolved_container, token)
        except Exception:
            close_code = 4401
            outcome = "invalid_token"
            await websocket.close(code=close_code)
            resolved_container.observability_service.trace_websocket_session(
                session_id=session_id,
                world_id=None,
                close_code=close_code,
                outcome=outcome,
            )
            return

        with resolved_container.session_factory() as db:
            game_session = db.execute(select(GameSession).where(GameSession.id == session_id)).scalar_one_or_none()
            if game_session is None:
                close_code = 4404
                outcome = "session_not_found"
                await websocket.close(code=close_code)
                resolved_container.observability_service.trace_websocket_session(
                    session_id=session_id,
                    world_id=None,
                    close_code=close_code,
                    outcome=outcome,
                )
                return
            world_id = game_session.world_id
            player_actor = get_player_actor_for_user(db, game_session.world_id, user.sub)
            if player_actor is None or player_actor.id != game_session.player_actor_id:
                close_code = 4403
                outcome = "forbidden"
                await websocket.close(code=close_code)
                resolved_container.observability_service.trace_websocket_session(
                    session_id=session_id,
                    world_id=world_id,
                    close_code=close_code,
                    outcome=outcome,
                )
                return

        await realtime_hub.connect(session_id, websocket)
        connected = True
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect as exc:
            close_code = exc.code
            outcome = "disconnected"
        finally:
            if connected:
                realtime_hub.disconnect(session_id, websocket)
            resolved_container.observability_service.trace_websocket_session(
                session_id=session_id,
                world_id=world_id,
                close_code=close_code,
                outcome=outcome,
            )

    return app


app = create_app()
