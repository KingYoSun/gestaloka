"""Character title schemas."""
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict


class CharacterTitleBase(BaseModel):
    """Base schema for character titles."""

    title: str
    description: str
    effects: Optional[dict[str, Any]] = None
    is_equipped: bool = False


class CharacterTitleCreate(CharacterTitleBase):
    """Schema for creating a character title."""

    pass


class CharacterTitleUpdate(BaseModel):
    """Schema for updating a character title."""

    is_equipped: Optional[bool] = None


class CharacterTitleRead(CharacterTitleBase):
    """Schema for reading a character title."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    character_id: str
    acquired_at: str
    created_at: datetime
    updated_at: datetime
