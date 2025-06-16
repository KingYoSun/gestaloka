"""
ログエンドポイント
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.api_v1.endpoints.auth import get_current_user
from app.core.database import get_session
from app.core.logging import get_logger
from app.schemas.user import User

router = APIRouter()
logger = get_logger(__name__)


@router.get("/fragments")
async def get_log_fragments(current_user: User = Depends(get_current_user), db: Session = Depends(get_session)) -> Any:
    """ログの欠片一覧取得"""
    try:
        # TODO: ログフラグメントサービスの実装
        logger.info("Get log fragments", user_id=current_user.id)
        return {"message": "ログの欠片一覧 - 実装予定"}

    except Exception as e:
        logger.error("Failed to get log fragments", user_id=current_user.id, error=str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="ログの欠片取得に失敗しました")


@router.get("/completed")
async def get_completed_logs(current_user: User = Depends(get_current_user), db: Session = Depends(get_session)) -> Any:
    """完成ログ一覧取得"""
    try:
        # TODO: 完成ログサービスの実装
        logger.info("Get completed logs", user_id=current_user.id)
        return {"message": "完成ログ一覧 - 実装予定"}

    except Exception as e:
        logger.error("Failed to get completed logs", user_id=current_user.id, error=str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="完成ログ取得に失敗しました")
