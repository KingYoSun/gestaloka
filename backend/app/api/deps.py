"""API依存関係と権限チェック"""

from typing import Optional

from fastapi import Depends, HTTPException, status
from sqlmodel import Session, select

from app.api.api_v1.endpoints.auth import get_current_user
from app.core.database import get_session as get_db
from app.models.character import Character, GameSession
from app.schemas.user import User


async def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    """アクティブなユーザーを取得"""
    if not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")
    return current_user


async def get_user_character(
    character_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)
) -> Character:
    """
    指定されたキャラクターを取得し、所有権を確認

    Args:
        character_id: キャラクターID
        db: データベースセッション
        current_user: 現在のユーザー

    Returns:
        Character: キャラクターオブジェクト

    Raises:
        HTTPException: キャラクターが見つからない、または権限がない場合
    """
    character = db.exec(
        select(Character).where(Character.id == character_id, Character.user_id == current_user.id)
    ).first()

    if not character:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Character not found")

    return character


async def get_character_session(
    session_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)
) -> GameSession:
    """
    指定されたゲームセッションを取得し、アクセス権を確認

    Args:
        session_id: セッションID
        db: データベースセッション
        current_user: 現在のユーザー

    Returns:
        GameSession: ゲームセッションオブジェクト

    Raises:
        HTTPException: セッションが見つからない、または権限がない場合
    """
    session = db.exec(
        select(GameSession).join(Character).where(GameSession.id == session_id, Character.user_id == current_user.id)
    ).first()

    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Game session not found")

    return session


async def check_character_limit(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)
) -> None:
    """
    ユーザーのキャラクター作成制限をチェック

    Raises:
        HTTPException: 制限に達している場合
    """
    from app.core.config import settings

    character_count = db.exec(
        select(Character).where(Character.user_id == current_user.id, Character.is_active)
    ).all()

    if len(character_count) >= settings.MAX_CHARACTERS_PER_USER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum character limit ({settings.MAX_CHARACTERS_PER_USER}) reached",
        )


async def get_optional_user(current_user: Optional[User] = Depends(get_current_user)) -> Optional[User]:
    """オプショナルな認証（公開エンドポイント用）"""
    return current_user


class PermissionChecker:
    """
    権限チェッカークラス

    特定のリソースへのアクセス権限を確認するための再利用可能なクラス
    """

    def __init__(self, resource_type: str):
        self.resource_type = resource_type

    async def __call__(
        self, resource_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)
    ):
        """
        リソースへのアクセス権限を確認

        Args:
            resource_id: リソースID
            db: データベースセッション
            current_user: 現在のユーザー

        Returns:
            リソースオブジェクト

        Raises:
            HTTPException: リソースが見つからない、または権限がない場合
        """
        if self.resource_type == "character":
            return await get_user_character(resource_id, db, current_user)
        elif self.resource_type == "session":
            return await get_character_session(resource_id, db, current_user)
        else:
            raise ValueError(f"Unknown resource type: {self.resource_type}")


# 使用例
check_character_permission = PermissionChecker("character")
check_session_permission = PermissionChecker("session")
