"""
ログシステムのスキーマ定義

APIリクエスト/レスポンスのデータ構造を定義
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.models.log import (
    CompletedLogStatus,
    EmotionalValence,
    LogContractStatus,
    LogFragmentRarity,
)


# LogFragment スキーマ
class LogFragmentBase(BaseModel):
    """ログフラグメントの基本スキーマ"""

    action_description: str = Field(description="行動の詳細な記述")
    keywords: list[str] = Field(default_factory=list, description="キーワード")
    emotional_valence: EmotionalValence = Field(
        default=EmotionalValence.NEUTRAL,
        description="感情価"
    )
    rarity: LogFragmentRarity = Field(
        default=LogFragmentRarity.COMMON,
        description="レアリティ"
    )
    importance_score: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="重要度スコア"
    )
    context_data: dict[str, Any] = Field(
        default_factory=dict,
        description="行動時の文脈情報"
    )


class LogFragmentCreate(LogFragmentBase):
    """ログフラグメント作成スキーマ"""

    character_id: str
    session_id: str


class LogFragmentRead(LogFragmentBase):
    """ログフラグメント読み取りスキーマ"""

    id: str
    character_id: str
    session_id: str
    created_at: datetime

    model_config = {"from_attributes": True}


# CompletedLog スキーマ
class CompletedLogBase(BaseModel):
    """完成ログの基本スキーマ"""

    name: str = Field(description="ログの名前")
    title: Optional[str] = Field(default=None, description="称号")
    description: str = Field(description="ログの説明文")
    skills: list[str] = Field(default_factory=list, description="獲得したスキル")
    personality_traits: list[str] = Field(
        default_factory=list,
        description="性格特性"
    )
    behavior_patterns: dict[str, Any] = Field(
        default_factory=dict,
        description="行動パターン"
    )


class CompletedLogCreate(CompletedLogBase):
    """完成ログ作成スキーマ"""

    creator_id: str
    core_fragment_id: str
    sub_fragment_ids: list[str] = Field(
        default_factory=list,
        description="サブフラグメントのIDリスト"
    )


class CompletedLogUpdate(BaseModel):
    """完成ログ更新スキーマ"""

    name: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    skills: Optional[list[str]] = None
    personality_traits: Optional[list[str]] = None
    behavior_patterns: Optional[dict[str, Any]] = None
    status: Optional[CompletedLogStatus] = None


class CompletedLogRead(CompletedLogBase):
    """完成ログ読み取りスキーマ"""

    id: str
    creator_id: str
    core_fragment_id: str
    contamination_level: float
    status: CompletedLogStatus
    created_at: datetime
    completed_at: Optional[datetime]

    model_config = {"from_attributes": True}


# LogContract スキーマ
class LogContractBase(BaseModel):
    """ログ契約の基本スキーマ"""

    activity_duration_hours: int = Field(
        default=24,
        gt=0,
        description="活動期間（時間）"
    )
    behavior_guidelines: str = Field(description="行動指針")
    reward_conditions: dict[str, Any] = Field(
        default_factory=dict,
        description="報酬条件"
    )
    rewards: dict[str, Any] = Field(
        default_factory=dict,
        description="報酬内容"
    )
    is_public: bool = Field(
        default=False,
        description="マーケットに公開するか"
    )
    price: Optional[int] = Field(
        default=None,
        ge=0,
        description="マーケット価格"
    )


class LogContractCreate(LogContractBase):
    """ログ契約作成スキーマ"""

    completed_log_id: str


class LogContractUpdate(BaseModel):
    """ログ契約更新スキーマ"""

    activity_logs: Optional[list[dict[str, Any]]] = None
    performance_score: Optional[float] = None
    status: Optional[LogContractStatus] = None


class LogContractRead(LogContractBase):
    """ログ契約読み取りスキーマ"""

    id: str
    completed_log_id: str
    creator_id: str
    host_character_id: Optional[str]
    status: LogContractStatus
    activity_logs: list[dict[str, Any]]
    performance_score: float
    created_at: datetime
    activated_at: Optional[datetime]
    completed_at: Optional[datetime]
    expires_at: Optional[datetime]

    model_config = {"from_attributes": True}


# 活動記録スキーマ
class LogActivityEntry(BaseModel):
    """ログの活動記録エントリー"""

    timestamp: datetime
    action: str
    details: dict[str, Any]
    impact_score: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="行動の影響度"
    )
