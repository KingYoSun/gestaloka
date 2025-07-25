"""
キャラクターエンドポイント
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.deps import check_character_limit, get_current_active_user, get_user_character
from app.core.database import get_session
from app.core.exceptions import DatabaseError
from app.core.logging import get_logger
from app.schemas.character import Character, CharacterCreate, CharacterUpdate
from app.schemas.user import User
from app.services.character_service import CharacterService

router = APIRouter()
logger = get_logger(__name__)


@router.get("/", response_model=list[Character])
async def get_user_characters(
    current_user: User = Depends(get_current_active_user), db: Session = Depends(get_session)
) -> Any:
    """ユーザーのキャラクター一覧取得"""
    try:
        character_service = CharacterService(db)
        characters = await character_service.get_by_user(current_user.id)
        return characters

    except Exception as e:
        logger.error("Failed to get characters", user_id=current_user.id, error=str(e))
        raise DatabaseError("キャラクター取得に失敗しました", operation="get_characters")


@router.post(
    "/", response_model=Character, status_code=status.HTTP_201_CREATED, dependencies=[Depends(check_character_limit)]
)
async def create_character(
    character_data: CharacterCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session),
) -> Any:
    """新しいキャラクター作成"""
    try:
        character_service = CharacterService(db)
        character = await character_service.create(current_user.id, character_data)

        logger.info(
            "Character created", user_id=current_user.id, character_id=character.id, character_name=character.name
        )
        return character

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Character creation failed", user_id=current_user.id, error=str(e))
        raise DatabaseError("キャラクター作成に失敗しました", operation="create_character")


@router.get("/{character_id}", response_model=Character)
async def get_character(character: Character = Depends(get_user_character)) -> Any:
    """特定のキャラクター取得"""
    return character


@router.put("/{character_id}", response_model=Character)
async def update_character(
    character_update: CharacterUpdate,
    character: Character = Depends(get_user_character),
    db: Session = Depends(get_session),
) -> Any:
    """キャラクター更新"""
    try:
        character_service = CharacterService(db)
        updated_character = await character_service.update(character.id, character_update)

        logger.info("Character updated", user_id=character.user_id, character_id=character.id)
        return updated_character

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Character update failed", user_id=character.user_id, character_id=character.id, error=str(e))
        raise DatabaseError("キャラクター更新に失敗しました", operation="update_character")


@router.delete("/{character_id}")
async def delete_character(
    character: Character = Depends(get_user_character), db: Session = Depends(get_session)
) -> Any:
    """キャラクター削除"""
    try:
        character_service = CharacterService(db)
        await character_service.delete(character.id)

        logger.info("Character deleted", user_id=character.user_id, character_id=character.id)
        return {"message": "キャラクターが削除されました"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Character deletion failed", user_id=character.user_id, character_id=character.id, error=str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="キャラクター削除に失敗しました")


@router.post("/{character_id}/activate", response_model=Character)
async def activate_character(
    character: Character = Depends(get_user_character),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session),
) -> Any:
    """キャラクターをアクティブにする"""
    try:
        # 同じユーザーのキャラクターかチェック（get_user_characterで既にチェック済みだが念のため）
        if character.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="このキャラクターを選択する権限がありません"
            )

        # 現在のアクティブキャラクターをクリア
        character_service = CharacterService(db)
        await character_service.clear_active_character(current_user.id)

        # キャラクターが削除されていないことを確認
        if not character.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="削除されたキャラクターは選択できません"
            )

        logger.info(
            "Character activated", user_id=current_user.id, character_id=character.id, character_name=character.name
        )

        # 現在の実装では、フロントエンドでアクティブキャラクターを管理
        # 将来的にはユーザーテーブルやセッションでサーバー側管理を実装
        return character

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Character activation failed", user_id=current_user.id, character_id=character.id, error=str(e))
        raise DatabaseError("キャラクターの選択に失敗しました", operation="activate_character")
