from __future__ import annotations

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
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
    app.include_router(api_router)

    @app.websocket("/ws/sessions/{session_id}")
    async def session_socket(websocket: WebSocket, session_id: str) -> None:
        token = websocket.query_params.get("token")
        if token is None:
            await websocket.close(code=4401)
            return

        try:
            user = resolve_current_user_from_token(resolved_container, token)
        except Exception:
            await websocket.close(code=4401)
            return

        with resolved_container.session_factory() as db:
            game_session = db.execute(select(GameSession).where(GameSession.id == session_id)).scalar_one_or_none()
            if game_session is None:
                await websocket.close(code=4404)
                return
            player_actor = get_player_actor_for_user(db, game_session.world_id, user.sub)
            if player_actor is None or player_actor.id != game_session.player_actor_id:
                await websocket.close(code=4403)
                return

        await realtime_hub.connect(session_id, websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            realtime_hub.disconnect(session_id, websocket)

    return app


app = create_app()
