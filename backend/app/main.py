"""
ゲスタロカ API メインアプリケーション
"""

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.api_v1.api import api_router
from app.core.config import settings
from app.core.database import cleanup_db, init_db
from app.core.error_handler import (
    generic_exception_handler,
    http_exception_handler,
    logverse_error_handler,
    validation_exception_handler,
)
from app.core.exceptions import LogverseError
from app.core.logging import get_logger, setup_logging
from app.websocket.server import socket_app


@asynccontextmanager
async def lifespan(app: FastAPI):
    """アプリケーションライフサイクル管理"""
    logger = get_logger("startup")

    try:
        # 起動処理
        logger.info("Starting GESTALOKA API", version=settings.VERSION)

        # ログ設定
        setup_logging()

        # データベース初期化
        await init_db()

        logger.info("GESTALOKA API startup completed")
        yield

    except Exception as e:
        logger.error("Startup failed", error=str(e))
        raise
    finally:
        # 終了処理
        logger.info("Shutting down GESTALOKA API")
        await cleanup_db()
        logger.info("GESTALOKA API shutdown completed")


# FastAPIアプリケーション作成
app = FastAPI(
    title=settings.PROJECT_NAME,
    description=settings.DESCRIPTION,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=[str(origin) for origin in settings.BACKEND_CORS_ORIGINS],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# セキュリティミドルウェア
if settings.ENVIRONMENT == "production":
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "*.gestaloka.com"])

# エラーハンドラー登録
app.add_exception_handler(LogverseError, logverse_error_handler)  # type: ignore
app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore
app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore
app.add_exception_handler(Exception, generic_exception_handler)

# APIルーター登録
app.include_router(api_router, prefix=settings.API_V1_STR)

# Socket.IOアプリケーションをマウント
app.mount("/socket.io", socket_app)


@app.get("/")
async def root():
    """ルートエンドポイント"""
    return {
        "message": "Welcome to GESTALOKA API",
        "version": settings.VERSION,
        "docs": "/docs",
        "redoc": "/redoc",
        "environment": settings.ENVIRONMENT,
    }


@app.get("/health")
async def health_check():
    """ヘルスチェックエンドポイント"""
    return {
        "status": "healthy",
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
    }


@app.get("/metrics")
async def metrics():
    """メトリクスエンドポイント（Prometheus形式）"""
    if not settings.ENABLE_METRICS:
        return {"error": "Metrics disabled"}

    # TODO: Prometheusメトリクスを実装
    return {"message": "Metrics endpoint - TODO: implement Prometheus metrics"}


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.RELOAD_ON_CHANGE,
        log_level=settings.LOG_LEVEL.lower(),
    )
