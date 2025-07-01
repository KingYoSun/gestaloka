"""
ログフラグメント関連のスキーマ定義
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.models import EmotionalValence, LogFragmentRarity


class LogFragmentBase(BaseModel):
    """ログフラグメントの基本スキーマ"""

    keyword: str = Field(description="メインキーワード")
    keywords: list[str] = Field(description="関連キーワードリスト")
    emotional_valence: EmotionalValence = Field(description="感情価")
    rarity: LogFragmentRarity = Field(description="レアリティ")
    backstory: str = Field(description="フラグメントの背景ストーリー")


class LogFragmentDetail(LogFragmentBase):
    """ログフラグメントの詳細スキーマ"""

    id: str
    character_id: str
    action_description: str = Field(description="行動の詳細な記述")
    discovered_at: Optional[str] = Field(None, description="発見場所")
    source_action: Optional[str] = Field(None, description="発生源となった行動")
    importance_score: float = Field(description="重要度スコア（0.0-1.0）")
    context_data: dict[str, Any] = Field(description="文脈情報")
    created_at: datetime

    class Config:
        from_attributes = True


class LogFragmentStatistics(BaseModel):
    """ログフラグメントの統計情報"""

    total_fragments: int = Field(description="総フラグメント数")
    by_rarity: dict[LogFragmentRarity, int] = Field(description="レアリティ別の数")
    unique_keywords: int = Field(description="ユニークキーワード数")


class LogFragmentListResponse(BaseModel):
    """ログフラグメント一覧のレスポンス"""

    fragments: list[LogFragmentDetail]
    total: int = Field(description="総数")
    statistics: LogFragmentStatistics = Field(description="統計情報")
