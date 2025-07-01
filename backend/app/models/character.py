"""
キャラクター関連モデル
"""

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.location import Location
    from app.models.log import ActionLog, CompletedLog, LogContract, LogFragment
    from app.models.log_dispatch import DispatchEncounter, LogDispatch
    from app.models.user import User
    from app.models.exploration_progress import CharacterExplorationProgress


class Character(SQLModel, table=True):
    """キャラクターモデル"""

    __tablename__ = "characters"

    id: str = Field(primary_key=True, index=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    name: str = Field(max_length=50, index=True)
    description: Optional[str] = Field(default=None, max_length=1000)
    appearance: Optional[str] = Field(default=None, max_length=1000)
    personality: Optional[str] = Field(default=None, max_length=1000)
    location: str = Field(default="starting_village", max_length=100)  # 後方互換性のため残す
    location_id: Optional[int] = Field(default=None, foreign_key="locations.id")
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # リレーション
    user: "User" = Relationship(back_populates="characters")
    stats: Optional["CharacterStats"] = Relationship(
        back_populates="character", sa_relationship_kwargs={"uselist": False}
    )
    skills: list["Skill"] = Relationship(back_populates="character")
    game_sessions: list["GameSession"] = Relationship(back_populates="character")

    # ログシステム関連
    log_fragments: list["LogFragment"] = Relationship(back_populates="character")
    created_logs: list["CompletedLog"] = Relationship(back_populates="creator")
    created_contracts: list["LogContract"] = Relationship(
        back_populates="creator", sa_relationship_kwargs={"foreign_keys": "[LogContract.creator_id]"}
    )
    hosted_contracts: list["LogContract"] = Relationship(
        back_populates="host_character", sa_relationship_kwargs={"foreign_keys": "[LogContract.host_character_id]"}
    )

    # 派遣システム関連
    dispatched_logs: list["LogDispatch"] = Relationship(back_populates="dispatcher")
    log_encounters: list["DispatchEncounter"] = Relationship(back_populates="encountered_character")

    # 場所関連
    current_location: Optional["Location"] = Relationship(back_populates="characters")

    # アクションログ関連
    action_logs: list["ActionLog"] = Relationship(back_populates="character")

    # 探索進捗関連
    exploration_progress: list["CharacterExplorationProgress"] = Relationship(back_populates="character")

    def __repr__(self) -> str:
        return f"<Character(id={self.id}, name={self.name})>"


class CharacterStats(SQLModel, table=True):
    """キャラクターステータスモデル"""

    __tablename__ = "character_stats"

    id: str = Field(primary_key=True, index=True)
    character_id: str = Field(foreign_key="characters.id", unique=True, index=True)
    level: int = Field(default=1, ge=1, le=100)
    experience: int = Field(default=0, ge=0)
    health: int = Field(default=100, ge=0)
    max_health: int = Field(default=100, ge=1)
    energy: int = Field(default=100, ge=0)
    max_energy: int = Field(default=100, ge=1)
    attack: int = Field(default=10, ge=1)
    defense: int = Field(default=5, ge=0)
    agility: int = Field(default=10, ge=1)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # リレーション
    character: Character = Relationship(back_populates="stats")

    def __repr__(self) -> str:
        return f"<CharacterStats(character_id={self.character_id}, level={self.level})>"


class Skill(SQLModel, table=True):
    """スキルモデル"""

    __tablename__ = "skills"

    id: str = Field(primary_key=True, index=True)
    character_id: str = Field(foreign_key="characters.id", index=True)
    name: str = Field(max_length=100, index=True)
    level: int = Field(default=1, ge=1, le=100)
    experience: int = Field(default=0, ge=0)
    description: Optional[str] = Field(default=None, max_length=500)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # リレーション
    character: Character = Relationship(back_populates="skills")

    def __repr__(self) -> str:
        return f"<Skill(id={self.id}, name={self.name}, level={self.level})>"


class GameSession(SQLModel, table=True):
    """ゲームセッションモデル"""

    __tablename__ = "game_sessions"

    id: str = Field(primary_key=True, index=True)
    character_id: str = Field(foreign_key="characters.id", index=True)
    is_active: bool = Field(default=True)
    current_scene: Optional[str] = Field(default=None, max_length=500)
    session_data: Optional[str] = Field(default=None)  # JSON文字列
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # リレーション
    character: Character = Relationship(back_populates="game_sessions")

    # ログシステム関連
    log_fragments: list["LogFragment"] = Relationship(back_populates="session")
    action_logs: list["ActionLog"] = Relationship(back_populates="session")

    def __repr__(self) -> str:
        return f"<GameSession(id={self.id}, character_id={self.character_id})>"
