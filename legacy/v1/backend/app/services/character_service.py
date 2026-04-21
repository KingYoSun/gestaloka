"""
キャラクターサービス
"""

from typing import Optional

from sqlmodel import Session, select

from app.core.config import settings
from app.core.logging import get_logger
from app.models.character import Character as CharacterModel
from app.models.character import CharacterStats as CharacterStatsModel
from app.schemas.character import Character, CharacterCreate, CharacterUpdate
from app.utils.security import generate_uuid

logger = get_logger(__name__)


class CharacterService:
    """キャラクター関連サービス"""

    def __init__(self, db: Session):
        self.db = db

    async def get_by_id(self, character_id: str) -> Optional[Character]:
        """IDでキャラクターを取得"""
        try:
            statement = select(CharacterModel).where(CharacterModel.id == character_id)
            result = self.db.exec(statement)
            character = result.first()
            return Character.model_validate(character) if character else None
        except Exception as e:
            logger.error("Failed to get character by ID", character_id=character_id, error=str(e))
            raise

    async def get_by_user(self, user_id: str) -> list[Character]:
        """ユーザーのキャラクター一覧を取得"""
        try:
            # 各キャラクターの最終セッション時間を取得するサブクエリ
            from app.models.game_session import GameSession

            statement = select(CharacterModel).where(
                CharacterModel.user_id == user_id,
                CharacterModel.is_active == True,  # noqa: E712
            )
            result = self.db.exec(statement)
            characters = result.all()

            # 各キャラクターに最終プレイ時間を設定
            character_list = []
            for char in characters:
                # 最終セッションを取得
                last_session_stmt = (
                    select(GameSession.updated_at)
                    .where(GameSession.character_id == char.id)
                    .order_by(GameSession.updated_at.desc())  # type: ignore
                    .limit(1)
                )
                last_session_result = self.db.exec(last_session_stmt)
                last_played_at = last_session_result.first()

                char_dict = Character.model_validate(char)
                if last_played_at:
                    char_dict.last_played_at = last_played_at
                character_list.append(char_dict)

            return character_list
        except Exception as e:
            logger.error("Failed to get characters by user", user_id=user_id, error=str(e))
            raise

    async def create(self, user_id: str, character_create: CharacterCreate) -> Character:
        """新しいキャラクターを作成"""
        try:
            # キャラクターモデルを作成
            character_id = generate_uuid()
            character_model = CharacterModel(
                id=character_id,
                user_id=user_id,
                name=character_create.name,
                description=character_create.description,
                appearance=character_create.appearance,
                personality=character_create.personality,
                location=character_create.location,
                is_active=True,
            )

            self.db.add(character_model)

            # 初期ステータスを作成
            stats_model = CharacterStatsModel(
                id=generate_uuid(),
                character_id=character_id,
                level=1,
                experience=0,
                health=settings.DEFAULT_CHARACTER_HP,
                max_health=settings.DEFAULT_CHARACTER_HP,
                mp=settings.DEFAULT_CHARACTER_ENERGY,
                max_mp=settings.DEFAULT_CHARACTER_ENERGY,
            )

            self.db.add(stats_model)
            self.db.commit()
            self.db.refresh(character_model)

            logger.info(
                "Character created", user_id=user_id, character_id=character_id, character_name=character_create.name
            )

            return Character.model_validate(character_model)

        except Exception as e:
            self.db.rollback()
            logger.error(
                "Failed to create character", user_id=user_id, character_name=character_create.name, error=str(e)
            )
            raise

    async def update(self, character_id: str, character_update: CharacterUpdate) -> Optional[Character]:
        """キャラクター情報を更新"""
        try:
            statement = select(CharacterModel).where(CharacterModel.id == character_id)
            result = self.db.exec(statement)
            character = result.first()

            if not character:
                return None

            # 更新データを適用
            if character_update.name is not None:
                character.name = character_update.name
            if character_update.description is not None:
                character.description = character_update.description
            if character_update.appearance is not None:
                character.appearance = character_update.appearance
            if character_update.personality is not None:
                character.personality = character_update.personality
            if character_update.location is not None:
                character.location = character_update.location

            self.db.add(character)
            self.db.commit()
            self.db.refresh(character)

            logger.info("Character updated", character_id=character_id)
            return Character.model_validate(character)

        except Exception as e:
            self.db.rollback()
            logger.error("Failed to update character", character_id=character_id, error=str(e))
            raise

    async def delete(self, character_id: str) -> bool:
        """キャラクターを削除"""
        try:
            statement = select(CharacterModel).where(CharacterModel.id == character_id)
            result = self.db.exec(statement)
            character = result.first()

            if not character:
                return False

            # ソフトデリート（is_activeをFalseにする）
            character.is_active = False
            self.db.add(character)
            self.db.commit()

            logger.info("Character deleted", character_id=character_id)
            return True

        except Exception as e:
            self.db.rollback()
            logger.error("Failed to delete character", character_id=character_id, error=str(e))
            raise

    async def clear_active_character(self, user_id: str) -> None:
        """ユーザーのアクティブキャラクターをクリア"""
        try:
            # 現在実装では何もしない（将来的にアクティブキャラクター管理を実装する場合はここに処理を追加）
            # 例: ユーザーテーブルにactive_character_idフィールドを追加して管理する
            pass
        except Exception as e:
            logger.error("Failed to clear active character", user_id=user_id, error=str(e))
            raise
