"""アイテムモデル"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import JSON
from sqlmodel import Field, Relationship, SQLModel

from app.models.enums import ItemRarity, ItemType

if TYPE_CHECKING:
    from app.models.character import Character


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
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

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
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    # リレーション
    character: Optional["Character"] = Relationship(back_populates="items")
    item: Optional[Item] = Relationship(back_populates="character_items")
