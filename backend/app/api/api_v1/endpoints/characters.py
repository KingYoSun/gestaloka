"""
キャラクターエンドポイント
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.api_v1.endpoints.auth import get_current_user
from app.core.database import get_session
from app.core.logging import get_logger
from app.schemas.character import Character, CharacterCreate, CharacterUpdate
from app.schemas.user import User
from app.services.character_service import CharacterService

router = APIRouter()
logger = get_logger(__name__)


@router.get("/", response_model=list[Character])
async def get_user_characters(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_session)
) -> Any:
    """ユーザーのキャラクター一覧取得"""
    try:
        character_service = CharacterService(db)
        characters = await character_service.get_by_user(current_user.id)
        return characters

    except Exception as e:
        logger.error("Failed to get characters", user_id=current_user.id, error=str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="キャラクター取得に失敗しました")


@router.post("/", response_model=Character, status_code=status.HTTP_201_CREATED)
async def create_character(
    character_data: CharacterCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)
) -> Any:
    """新しいキャラクター作成"""
    try:
        character_service = CharacterService(db)

        # キャラクター数制限チェック
        existing_characters = await character_service.get_by_user(current_user.id)
        if len(existing_characters) >= 5:  # 設定から取得すべき
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="キャラクター数の上限に達しています")

        character = await character_service.create(current_user.id, character_data)

        logger.info(
            "Character created", user_id=current_user.id, character_id=character.id, character_name=character.name
        )
        return character

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Character creation failed", user_id=current_user.id, error=str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="キャラクター作成に失敗しました")


@router.get("/{character_id}", response_model=Character)
async def get_character(
    character_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)
) -> Any:
    """特定のキャラクター取得"""
    try:
        character_service = CharacterService(db)
        character = await character_service.get_by_id(character_id)

        if not character:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="キャラクターが見つかりません")

        # 所有者チェック
        if character.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="このキャラクターにアクセスする権限がありません"
            )

        return character

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get character", user_id=current_user.id, character_id=character_id, error=str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="キャラクター取得に失敗しました")


@router.put("/{character_id}", response_model=Character)
async def update_character(
    character_id: str,
    character_update: CharacterUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> Any:
    """キャラクター更新"""
    try:
        character_service = CharacterService(db)

        # 所有者チェック
        character = await character_service.get_by_id(character_id)
        if not character or character.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="キャラクターが見つかりません")

        updated_character = await character_service.update(character_id, character_update)

        logger.info("Character updated", user_id=current_user.id, character_id=character_id)
        return updated_character

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Character update failed", user_id=current_user.id, character_id=character_id, error=str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="キャラクター更新に失敗しました")


@router.delete("/{character_id}")
async def delete_character(
    character_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)
) -> Any:
    """キャラクター削除"""
    try:
        character_service = CharacterService(db)

        # 所有者チェック
        character = await character_service.get_by_id(character_id)
        if not character or character.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="キャラクターが見つかりません")

        await character_service.delete(character_id)

        logger.info("Character deleted", user_id=current_user.id, character_id=character_id)
        return {"message": "キャラクターが削除されました"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Character deletion failed", user_id=current_user.id, character_id=character_id, error=str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="キャラクター削除に失敗しました")
