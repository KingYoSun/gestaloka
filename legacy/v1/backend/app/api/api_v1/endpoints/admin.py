"""
管理者エンドポイント
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.api_v1.endpoints.auth import get_current_user
from app.core.logging import get_logger
from app.schemas.user import User

router = APIRouter()
logger = get_logger(__name__)


@router.get("/health")
async def admin_health_check(current_user: User = Depends(get_current_user)) -> Any:
    """管理者向けヘルスチェック"""
    try:
        # TODO: 管理者権限チェック
        logger.info("Admin health check", user_id=current_user.id)
        return {
            "status": "healthy",
            "message": "管理者ヘルスチェック - 実装予定",
            "services": {"database": "connected", "redis": "connected", "neo4j": "connected"},
        }

    except Exception as e:
        logger.error("Admin health check failed", user_id=current_user.id, error=str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="ヘルスチェックに失敗しました")
