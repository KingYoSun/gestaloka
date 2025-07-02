"""
キャラクター関連モデル
"""

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlmodel import Field, Relationship, SQLModel
from sqlalchemy import JSON

if TYPE_CHECKING:
    from app.models.exploration_progress import CharacterExplorationProgress
    from app.models.location import Location
    from app.models.log import ActionLog, CompletedLog, LogFragment
    from app.models.log_dispatch import DispatchEncounter, LogDispatch
    from app.models.user import User
    from app.models.title import CharacterTitle
    from app.models.item import CharacterItem


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
    character_metadata: Optional[dict] = Field(default_factory=dict, sa_type=JSON)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # リレーション
    user: "User" = Relationship(back_populates="characters")
    stats: Optional["CharacterStats"] = Relationship(
        back_populates="character", sa_relationship_kwargs={"uselist": False}
    )
    character_skills: list["CharacterSkill"] = Relationship(back_populates="character")
    game_sessions: list["GameSession"] = Relationship(back_populates="character")
    titles: list["CharacterTitle"] = Relationship(back_populates="character")
    items: list["CharacterItem"] = Relationship(back_populates="character")

    # ログシステム関連
    log_fragments: list["LogFragment"] = Relationship(back_populates="character")
    created_logs: list["CompletedLog"] = Relationship(back_populates="creator")

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
    """スキルマスタ"""

    __tablename__ = "skills"

    id: str = Field(primary_key=True, index=True)
    name: str = Field(max_length=100, index=True, unique=True)
    description: str = Field(max_length=500)
    skill_type: str = Field(max_length=50)  # attack, defense, support, special
    base_power: int = Field(default=10, ge=1)
    sp_cost: int = Field(default=5, ge=0)
    cooldown_turns: int = Field(default=0, ge=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # リレーション
    character_skills: list["CharacterSkill"] = Relationship(back_populates="skill")

    def __repr__(self) -> str:
        return f"<Skill(id={self.id}, name={self.name})>"


class CharacterSkill(SQLModel, table=True):
    """キャラクターの所持スキル"""

    __tablename__ = "character_skills"

    id: str = Field(primary_key=True, index=True)
    character_id: str = Field(foreign_key="characters.id", index=True)
    skill_id: str = Field(foreign_key="skills.id", index=True)
    level: int = Field(default=1, ge=1, le=100)
    experience: int = Field(default=0, ge=0)
    unlocked_at: str = Field(...)  # 取得方法
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # リレーション
    character: Character = Relationship(back_populates="character_skills")
    skill: Skill = Relationship(back_populates="character_skills")

    def __repr__(self) -> str:
        return f"<CharacterSkill(character_id={self.character_id}, skill_id={self.skill_id}, level={self.level})>"


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
