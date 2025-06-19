"""
NPCスキーマ定義
"""

from datetime import datetime
from typing import ClassVar, Literal, Optional

from pydantic import BaseModel, Field


class NPCProfile(BaseModel):
    """NPCプロファイル"""

    npc_id: str = Field(..., description="NPCの一意識別子")
    name: str = Field(..., description="NPCの名前")
    title: Optional[str] = Field(None, description="NPCの称号")

    # タイプ
    npc_type: Literal["LOG_NPC", "PERMANENT_NPC", "TEMPORARY_NPC"] = Field(..., description="NPCのタイプ")

    # 基本属性
    personality_traits: list[str] = Field(default_factory=list, description="性格特性のリスト")
    behavior_patterns: list[str] = Field(default_factory=list, description="行動パターンのリスト")
    skills: list[str] = Field(default_factory=list, description="スキルのリスト")
    appearance: Optional[str] = Field(None, description="外見の説明")
    backstory: Optional[str] = Field(None, description="背景ストーリー")

    # ログNPC固有
    original_player: Optional[str] = Field(None, description="元のプレイヤーID")
    log_source: Optional[str] = Field(None, description="元のログID")
    contamination_level: int = Field(0, ge=0, le=100, description="汚染度")

    # ステータス
    persistence_level: int = Field(5, ge=1, le=10, description="永続性レベル（1-10）")
    current_location: Optional[str] = Field(None, description="現在の場所")
    is_active: bool = Field(True, description="アクティブかどうか")

    class Config:
        json_schema_extra: ClassVar[dict] = {
            "example": {
                "npc_id": "log_npc_123e4567-e89b-12d3-a456-426614174000",
                "name": "影の商人ザイン",
                "title": "第三階層の密売人",
                "npc_type": "LOG_NPC",
                "personality_traits": ["狡猾", "用心深い", "商売熱心"],
                "behavior_patterns": ["夜間のみ活動", "高額商品を扱う", "情報を売買"],
                "skills": ["交渉術", "鑑定", "隠密"],
                "appearance": "フードで顔を隠した痩せ型の人物",
                "backstory": "かつては冒険者だったが、ある事件をきっかけに商人となった",
                "contamination_level": 45,
                "persistence_level": 6,
                "current_location": "第三階層・裏通り",
            }
        }


class NPCInteraction(BaseModel):
    """NPC相互作用記録"""

    npc_id: str
    player_id: str
    interaction_type: str  # "conversation", "battle", "trade", etc.
    timestamp: datetime
    emotional_impact: float = Field(0.0, ge=-1.0, le=1.0)
    details: Optional[dict] = None


class NPCLocationUpdate(BaseModel):
    """NPC位置更新"""

    npc_id: str
    new_location: str
    reason: Optional[str] = None


class NPCSearchFilter(BaseModel):
    """NPC検索フィルター"""

    location: Optional[str] = None
    npc_type: Optional[Literal["LOG_NPC", "PERMANENT_NPC", "TEMPORARY_NPC"]] = None
    is_active: Optional[bool] = True
    min_persistence_level: Optional[int] = None
    max_contamination_level: Optional[int] = None
