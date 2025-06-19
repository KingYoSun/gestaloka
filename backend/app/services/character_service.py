"""
キャラクターサービス
"""

from typing import Optional

from sqlmodel import Session, select

from app.core.config import settings
from app.core.logging import LoggerMixin
from app.models.character import Character as CharacterModel
from app.models.character import CharacterStats as CharacterStatsModel
from app.schemas.character import Character, CharacterCreate, CharacterUpdate
from app.utils.security import generate_uuid


class CharacterService(LoggerMixin):
    """キャラクター関連サービス"""

    def __init__(self, db: Session):
        super().__init__()
        self.db = db

    async def get_by_id(self, character_id: str) -> Optional[Character]:
        """IDでキャラクターを取得"""
        try:
            statement = select(CharacterModel).where(CharacterModel.id == character_id)
            result = self.db.exec(statement)
            character = result.first()
            return Character.from_orm(character) if character else None
        except Exception as e:
            self.log_error("Failed to get character by ID", character_id=character_id, error=str(e))
            raise

    async def get_by_user(self, user_id: str) -> list[Character]:
        """ユーザーのキャラクター一覧を取得"""
        try:
            statement = select(CharacterModel).where(
                CharacterModel.user_id == user_id, CharacterModel.is_active is True
            )
            result = self.db.exec(statement)
            characters = result.all()
            return [Character.from_orm(char) for char in characters]
        except Exception as e:
            self.log_error("Failed to get characters by user", user_id=user_id, error=str(e))
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
                energy=settings.DEFAULT_CHARACTER_ENERGY,
                max_energy=settings.DEFAULT_CHARACTER_ENERGY,
            )

            self.db.add(stats_model)
            self.db.commit()
            self.db.refresh(character_model)

            self.log_info(
                "Character created", user_id=user_id, character_id=character_id, character_name=character_create.name
            )

            return Character.from_orm(character_model)

        except Exception as e:
            self.db.rollback()
            self.log_error(
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

            self.log_info("Character updated", character_id=character_id)
            return Character.from_orm(character)

        except Exception as e:
            self.db.rollback()
            self.log_error("Failed to update character", character_id=character_id, error=str(e))
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

            self.log_info("Character deleted", character_id=character_id)
            return True

        except Exception as e:
            self.db.rollback()
            self.log_error("Failed to delete character", character_id=character_id, error=str(e))
            raise
