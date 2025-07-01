"""
探索進捗管理モデル

キャラクターごとの探索進捗を記録し、ミニマップの霧効果に使用する
"""

from datetime import datetime
from typing import Optional, List
from uuid import UUID

from sqlalchemy import Column, String, Integer, ForeignKey, TIMESTAMP, text, ARRAY
from sqlmodel import Field, SQLModel, Relationship

from app.models.character import Character
from app.models.location import Location


class CharacterExplorationProgress(SQLModel, table=True):
    """キャラクターの探索進捗"""

    __tablename__ = "character_exploration_progress"

    id: UUID = Field(
        sa_column=Column(
            "id",
            String(36),
            primary_key=True,
            server_default=text("gen_random_uuid()"),
        )
    )

    character_id: UUID = Field(
        sa_column=Column(
            "character_id",
            String(36),
            ForeignKey("characters.id", ondelete="CASCADE"),
            nullable=False,
        )
    )

    location_id: int = Field(
        sa_column=Column(
            "location_id",
            Integer,
            ForeignKey("locations.id", ondelete="CASCADE"),
            nullable=False,
        )
    )

    exploration_percentage: int = Field(
        default=0,
        sa_column=Column(
            "exploration_percentage",
            Integer,
            nullable=False,
            default=0,
        ),
        ge=0,
        le=100,
    )

    fog_revealed_at: Optional[datetime] = Field(
        sa_column=Column("fog_revealed_at", TIMESTAMP(timezone=True), nullable=True)
    )

    fully_explored_at: Optional[datetime] = Field(
        sa_column=Column("fully_explored_at", TIMESTAMP(timezone=True), nullable=True)
    )

    areas_explored: List[str] = Field(
        default=[], sa_column=Column("areas_explored", ARRAY(String), nullable=False, default=text("'{}'::text[]"))
    )

    created_at: datetime = Field(
        sa_column=Column(
            "created_at", TIMESTAMP(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")
        )
    )

    updated_at: datetime = Field(
        sa_column=Column(
            "updated_at",
            TIMESTAMP(timezone=True),
            nullable=False,
            server_default=text("CURRENT_TIMESTAMP"),
            onupdate=text("CURRENT_TIMESTAMP"),
        )
    )

    # Relationships
    character: Character = Relationship(back_populates="exploration_progress")
    location: Location = Relationship(back_populates="exploration_progress")

    class Config:
        arbitrary_types_allowed = True
