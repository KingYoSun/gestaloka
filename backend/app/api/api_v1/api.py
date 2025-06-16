"""
APIルーター v1
"""

from fastapi import APIRouter

from app.api.api_v1.endpoints import (
    admin,
    auth,
    characters,
    game,
    logs,
    users,
    websocket,
)

api_router = APIRouter()

# 各エンドポイントを登録
api_router.include_router(auth.router, prefix="/auth", tags=["authentication"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(characters.router, prefix="/characters", tags=["characters"])
api_router.include_router(game.router, prefix="/game", tags=["game"])
api_router.include_router(logs.router, prefix="/logs", tags=["logs"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(websocket.router, prefix="/ws", tags=["websocket"])
