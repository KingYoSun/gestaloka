"""
探索進捗管理モデル

キャラクターごとの探索進捗を記録し、ミニマップの霧効果に使用する
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Optional
from uuid import uuid4

from sqlalchemy import JSON, Column
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.character import Character
    from app.models.location import Location


class CharacterExplorationProgress(SQLModel, table=True):
    """キャラクターの探索進捗"""

    __tablename__ = "character_exploration_progress"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, index=True)
    character_id: str = Field(foreign_key="characters.id", index=True)
    location_id: str = Field(foreign_key="locations.id", index=True)

    exploration_percentage: int = Field(default=0, ge=0, le=100)
    fog_revealed_at: Optional[datetime] = Field(default=None)
    fully_explored_at: Optional[datetime] = Field(default=None)

    # エリア探索記録（JSON配列として保存）
    areas_explored: list[str] = Field(
        default_factory=list,
        sa_column=Column("areas_explored", JSON, default=[])
    )

    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    # Relationships
    character: "Character" = Relationship(back_populates="exploration_progress")
    location: "Location" = Relationship(back_populates="exploration_progress")
