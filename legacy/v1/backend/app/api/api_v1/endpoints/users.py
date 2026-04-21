"""
ユーザーエンドポイント
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.api_v1.endpoints.auth import get_current_user
from app.core.database import get_session
from app.core.logging import get_logger
from app.schemas.user import User, UserUpdate
from app.services.user_service import UserService

router = APIRouter()
logger = get_logger(__name__)


@router.get("/profile", response_model=User)
async def get_user_profile(current_user: User = Depends(get_current_user)) -> Any:
    """ユーザープロフィール取得"""
    return current_user


@router.put("/profile", response_model=User)
async def update_user_profile(
    user_update: UserUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)
) -> Any:
    """ユーザープロフィール更新"""
    try:
        user_service = UserService(db)
        user = await user_service.update(current_user.id, user_update)

        logger.info("User profile updated", user_id=current_user.id)
        return user

    except Exception as e:
        logger.error("Profile update failed", user_id=current_user.id, error=str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="プロフィール更新に失敗しました")


@router.delete("/profile")
async def delete_user_account(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_session)
) -> Any:
    """ユーザーアカウント削除"""
    try:
        user_service = UserService(db)
        await user_service.delete(current_user.id)

        logger.info("User account deleted", user_id=current_user.id)
        return {"message": "アカウントが削除されました"}

    except Exception as e:
        logger.error("Account deletion failed", user_id=current_user.id, error=str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="アカウント削除に失敗しました")
