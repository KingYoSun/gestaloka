"""
キャラクター関連スキーマ
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class SkillBase(BaseModel):
    """スキルベーススキーマ"""

    name: str = Field(..., max_length=100, description="スキル名")
    level: int = Field(default=1, ge=1, le=100, description="スキルレベル")
    experience: int = Field(default=0, ge=0, description="スキル経験値")
    description: Optional[str] = Field(None, max_length=500, description="スキル説明")


class CharacterStatsBase(BaseModel):
    """キャラクターステータスベーススキーマ"""

    level: int = Field(default=1, ge=1, le=100, description="レベル")
    experience: int = Field(default=0, ge=0, description="経験値")
    health: int = Field(default=100, ge=0, description="現在HP")
    max_health: int = Field(default=100, ge=1, description="最大HP")
    mp: int = Field(default=100, ge=0, description="現在MP")
    max_mp: int = Field(default=100, ge=1, description="最大MP")


class CharacterBase(BaseModel):
    """キャラクターベーススキーマ"""

    name: str = Field(..., min_length=1, max_length=50, description="キャラクター名")
    description: Optional[str] = Field(None, max_length=1000, description="キャラクター説明")
    appearance: Optional[str] = Field(None, max_length=1000, description="外見")
    personality: Optional[str] = Field(None, max_length=1000, description="性格")
    location: str = Field(default="starting_village", max_length=100, description="現在地")


class CharacterCreate(CharacterBase):
    """キャラクター作成スキーマ"""

    pass


class CharacterUpdate(BaseModel):
    """キャラクター更新スキーマ"""

    name: Optional[str] = Field(None, min_length=1, max_length=50)
    description: Optional[str] = Field(None, max_length=1000)
    appearance: Optional[str] = Field(None, max_length=1000)
    personality: Optional[str] = Field(None, max_length=1000)
    location: Optional[str] = Field(None, max_length=100)


class CharacterStats(CharacterStatsBase):
    """キャラクターステータススキーマ"""

    id: str
    character_id: str

    class Config:
        from_attributes = True


class Skill(SkillBase):
    """スキルスキーマ"""

    id: str
    character_id: str

    class Config:
        from_attributes = True


class Character(CharacterBase):
    """キャラクタースキーマ（レスポンス用）"""

    id: str
    user_id: str
    stats: Optional[CharacterStats] = None
    skills: list[Skill] = Field(default_factory=list)
    is_active: bool = True
    created_at: datetime
    updated_at: datetime
    last_played_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CharacterInDB(Character):
    """DB内キャラクタースキーマ"""

    pass
