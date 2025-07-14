"""
動的クエストシステムのデータモデル
"""

import uuid
from datetime import UTC, datetime
from enum import Enum
from typing import Any, ClassVar, Optional

from sqlalchemy import String, Text
from sqlmodel import JSON, Column, Field, SQLModel


class QuestStatus(str, Enum):
    """クエストの状態"""

    PROPOSED = "proposed"  # GM AIによって提案された
    ACTIVE = "active"  # プレイヤーが受諾/開始
    PROGRESSING = "progressing"  # 進行中
    NEAR_COMPLETION = "near_completion"  # 完了間近
    COMPLETED = "completed"  # 完了
    ABANDONED = "abandoned"  # 放棄/自然消滅
    FAILED = "failed"  # 失敗


class QuestOrigin(str, Enum):
    """クエストの発生源"""

    GM_PROPOSED = "gm_proposed"  # GM AIの提案
    PLAYER_DECLARED = "player_declared"  # プレイヤーの明示的宣言
    BEHAVIOR_INFERRED = "behavior_inferred"  # 行動パターンから推測
    NPC_GIVEN = "npc_given"  # NPCから与えられた
    WORLD_EVENT = "world_event"  # 世界イベント由来


class Quest(SQLModel, table=True):
    """動的クエストモデル"""

    __tablename__ = "quests"

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()), primary_key=True, index=True, description="クエストの一意識別子"
    )

    # 基本情報
    character_id: str = Field(foreign_key="characters.id", index=True, description="クエストを保持するキャラクターID")
    session_id: Optional[str] = Field(
        default=None, foreign_key="game_sessions.id", index=True, description="クエストが発生したセッションID"
    )

    # クエスト内容
    title: str = Field(
        sa_column=Column(String(100)), max_length=100, description="クエストのタイトル（動的に更新可能、最大100文字）"
    )
    description: str = Field(
        sa_column=Column(String(2500)), max_length=2500, description="クエストの説明（動的に更新される、最大2500文字）"
    )

    # 状態管理
    status: QuestStatus = Field(default=QuestStatus.PROPOSED, description="クエストの現在の状態")
    origin: QuestOrigin = Field(description="クエストがどのように発生したか")

    # 進行管理
    progress_percentage: float = Field(default=0.0, ge=0.0, le=100.0, description="進行度（0-100%）")
    narrative_completeness: float = Field(default=0.0, ge=0.0, le=1.0, description="物語的完結度（0-1）")
    emotional_satisfaction: float = Field(default=0.5, ge=0.0, le=1.0, description="感情的満足度（0-1）")

    # クエストデータ
    key_events: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=Column(JSON), description="関連する重要イベントのリスト"
    )
    progress_indicators: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSON), description="進行度を示す各種指標"
    )
    emotional_arc: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=Column(JSON), description="物語の感情的な流れ"
    )
    involved_entities: dict[str, list[str]] = Field(
        default_factory=lambda: {"npcs": [], "locations": [], "items": []},
        sa_column=Column(JSON),
        description="関わったエンティティ（NPC、場所、アイテム）",
    )

    # メタデータ
    context_summary: Optional[str] = Field(
        default=None, sa_column=Column(Text), description="クエスト発生時のコンテキストサマリー"
    )
    completion_summary: Optional[str] = Field(
        default=None, sa_column=Column(Text), description="クエスト完了時のサマリー"
    )

    # タイムスタンプ
    proposed_at: datetime = Field(default_factory=lambda: datetime.now(UTC), description="クエストが提案された日時")
    started_at: Optional[datetime] = Field(default=None, description="クエストが開始された日時")
    completed_at: Optional[datetime] = Field(default=None, description="クエストが完了した日時")
    last_progress_at: datetime = Field(default_factory=lambda: datetime.now(UTC), description="最後に進行があった日時")

    class Config:
        json_schema_extra: ClassVar[dict] = {
            "example": {
                "id": "quest_123",
                "character_id": "char_456",
                "title": "古代遺跡の謎を解明する",
                "description": "森の奥深くにある古代遺跡の秘密を探る",
                "status": "active",
                "origin": "behavior_inferred",
                "progress_percentage": 65.0,
                "key_events": [{"timestamp": "2025-01-01T10:00:00Z", "event": "遺跡の入口を発見", "importance": 0.8}],
                "involved_entities": {
                    "npcs": ["scholar_789"],
                    "locations": ["ancient_ruins_001"],
                    "items": ["ancient_key_456"],
                },
            }
        }


class QuestProposal(SQLModel):
    """GM AIからのクエスト提案"""

    title: str = Field(max_length=100, description="提案するクエストのタイトル（最大100文字）")
    description: str = Field(max_length=2500, description="クエストの説明（最大2500文字）")
    reasoning: str = Field(description="なぜこのクエストを提案するか")
    difficulty_estimate: float = Field(ge=0.0, le=1.0, description="推定難易度（0-1）")
    relevance_score: float = Field(ge=0.0, le=1.0, description="現在の文脈との関連性スコア")
    suggested_rewards: list[str] = Field(default_factory=list, description="完了時の推奨報酬")


class QuestUpdate(SQLModel):
    """クエスト更新データ"""

    description: Optional[str] = Field(default=None, max_length=2500, description="更新された説明（最大2500文字）")
    progress_percentage: Optional[float] = Field(default=None, ge=0.0, le=100.0, description="進行度")
    narrative_completeness: Optional[float] = Field(default=None, ge=0.0, le=1.0, description="物語的完結度")
    emotional_satisfaction: Optional[float] = Field(default=None, ge=0.0, le=1.0, description="感情的満足度")
    new_event: Optional[dict[str, Any]] = Field(default=None, description="追加する新しいイベント")
    status: Optional[QuestStatus] = Field(default=None, description="新しいステータス")
