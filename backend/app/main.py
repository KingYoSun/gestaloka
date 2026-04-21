from __future__ import annotations

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.api import router as api_router
from app.core.container import AppContainer, build_container
from app.core.realtime import realtime_hub


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
            resolved_container.oidc_adapter.resolve_token(token)
        except Exception:
            await websocket.close(code=4401)
            return

        await realtime_hub.connect(session_id, websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            realtime_hub.disconnect(session_id, websocket)

    return app


app = create_app()
