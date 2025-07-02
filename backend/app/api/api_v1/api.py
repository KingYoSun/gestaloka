"""
APIルーター v1
"""

from fastapi import APIRouter

from app.api.api_v1.endpoints import (
    auth,
    characters,
    config,
    dispatch,
    exploration,
    game,
    log_fragments,
    logs,
    narrative,
    npcs,
    sp,
    sp_subscription,
    stripe_webhook,
    users,
    websocket,
)
from app.api.v1.admin.router import router as admin_router

api_router = APIRouter()

# 各エンドポイントを登録
api_router.include_router(auth.router, prefix="/auth", tags=["authentication"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(characters.router, prefix="/characters", tags=["characters"])
api_router.include_router(game.router, prefix="/game", tags=["game"])
api_router.include_router(logs.router, prefix="/logs", tags=["logs"])
api_router.include_router(log_fragments.router, prefix="/log-fragments", tags=["log-fragments"])
api_router.include_router(dispatch.router, prefix="/dispatch", tags=["dispatch"])
api_router.include_router(exploration.router, prefix="/exploration", tags=["exploration"])
api_router.include_router(narrative.router, prefix="/narrative", tags=["narrative"])
api_router.include_router(npcs.router, prefix="/npcs", tags=["npcs"])
api_router.include_router(sp.router, prefix="/sp", tags=["sp"])
api_router.include_router(sp_subscription.router, prefix="/sp/subscriptions", tags=["sp-subscriptions"])
api_router.include_router(admin_router, prefix="/admin", tags=["admin"])
api_router.include_router(websocket.router, prefix="/ws", tags=["websocket"])
api_router.include_router(config.router, prefix="/config", tags=["config"])

# Stripe Webhookは認証不要なので別途追加
api_router.include_router(stripe_webhook.router, tags=["stripe"])
