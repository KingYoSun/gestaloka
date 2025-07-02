"""アイテムモデル"""

from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import JSON
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.character import Character


class ItemType(str, Enum):
    """アイテムタイプ"""
    WEAPON = "weapon"
    ARMOR = "armor"
    ACCESSORY = "accessory"
    CONSUMABLE = "consumable"
    SPECIAL = "special"
    MATERIAL = "material"


class ItemRarity(str, Enum):
    """アイテムレアリティ"""
    COMMON = "COMMON"
    UNCOMMON = "UNCOMMON"
    RARE = "RARE"
    EPIC = "EPIC"
    LEGENDARY = "LEGENDARY"


class Item(SQLModel, table=True):
    """アイテムマスタ"""
    __tablename__ = "items"

    id: str = Field(primary_key=True)
    name: str = Field(..., index=True)
    description: str = Field(...)
    item_type: ItemType = Field(...)
    rarity: ItemRarity = Field(default=ItemRarity.COMMON)
    effects: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    tradeable: bool = Field(default=True)
    stackable: bool = Field(default=True)
    max_stack: int = Field(default=99)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # リレーション
    character_items: list["CharacterItem"] = Relationship(back_populates="item")


class CharacterItem(SQLModel, table=True):
    """キャラクターの所持アイテム"""
    __tablename__ = "character_items"

    id: str = Field(primary_key=True)
    character_id: str = Field(foreign_key="characters.id", index=True)
    item_id: str = Field(foreign_key="items.id", index=True)
    quantity: int = Field(default=1)
    obtained_at: str = Field(..., description="入手方法")
    is_equipped: bool = Field(default=False)
    slot: Optional[str] = Field(None, description="装備スロット")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # リレーション
    character: Optional["Character"] = Relationship(back_populates="items")
    item: Optional[Item] = Relationship(back_populates="character_items")

