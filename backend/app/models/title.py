"""称号モデル"""

from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import JSON
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.character import Character


class CharacterTitle(SQLModel, table=True):
    """キャラクターの称号"""

    __tablename__ = "character_titles"

    id: str = Field(primary_key=True)
    character_id: str = Field(foreign_key="characters.id", index=True)
    title: str = Field(..., description="称号名")
    description: str = Field(..., description="称号の説明")
    acquired_at: str = Field(..., description="獲得方法")
    effects: dict[str, Any] = Field(default_factory=dict, sa_type=JSON, description="称号の効果")
    is_equipped: bool = Field(default=False, description="装備中かどうか")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # リレーション
    character: Optional["Character"] = Relationship(back_populates="titles")
