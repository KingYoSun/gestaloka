"""
ストーリーアーク管理モデル

複数セッションに跨る大きな物語の流れを管理
"""

from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import JSON
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.character import Character, GameSession


class StoryArcStatus(str, Enum):
    """ストーリーアークの状態"""
    ACTIVE = "active"  # 進行中
    COMPLETED = "completed"  # 完了
    ABANDONED = "abandoned"  # 放棄
    SUSPENDED = "suspended"  # 一時中断


class StoryArcType(str, Enum):
    """ストーリーアークのタイプ"""
    MAIN_QUEST = "main_quest"  # メインクエスト
    SIDE_QUEST = "side_quest"  # サイドクエスト
    CHARACTER_ARC = "character_arc"  # キャラクターアーク
    WORLD_EVENT = "world_event"  # ワールドイベント
    PERSONAL_STORY = "personal_story"  # 個人の物語


class StoryArc(SQLModel, table=True):
    """ストーリーアークモデル"""

    __tablename__ = "story_arcs"

    id: str = Field(primary_key=True, index=True)
    character_id: str = Field(foreign_key="characters.id", index=True)

    # 基本情報
    title: str = Field(max_length=200)
    description: str = Field(max_length=1000)
    arc_type: str = Field(default="personal_story", max_length=50)
    status: str = Field(default="active", max_length=50)

    # 進行状況
    progress_percentage: float = Field(default=0.0, ge=0.0, le=100.0)
    current_phase: int = Field(default=1, ge=1)  # 現在のフェーズ
    total_phases: int = Field(default=1, ge=1)  # 総フェーズ数

    # ストーリー情報
    key_npcs: list[str] = Field(default_factory=list, sa_type=JSON)  # 関連NPC ID
    key_locations: list[str] = Field(default_factory=list, sa_type=JSON)  # 関連場所ID
    key_items: list[str] = Field(default_factory=list, sa_type=JSON)  # 関連アイテムID

    # 物語要素
    central_conflict: Optional[str] = Field(default=None, max_length=500)  # 中心的な対立
    themes: list[str] = Field(default_factory=list, sa_type=JSON)  # テーマ（友情、裏切り、成長など）
    plot_points: list[dict] = Field(default_factory=list, sa_type=JSON)  # プロットポイント

    # メタデータ
    arc_metadata: dict = Field(default_factory=dict, sa_type=JSON)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = Field(default=None)
    completed_at: Optional[datetime] = Field(default=None)

    # 関連セッション
    session_count: int = Field(default=0)  # このアークに関連するセッション数

    # リレーション
    character: "Character" = Relationship(back_populates="story_arcs")
    sessions: list["GameSession"] = Relationship(back_populates="story_arc")
    milestones: list["StoryArcMilestone"] = Relationship(back_populates="story_arc")

    def __repr__(self) -> str:
        return f"<StoryArc(id={self.id}, title={self.title}, status={self.status})>"


class StoryArcMilestone(SQLModel, table=True):
    """ストーリーアークのマイルストーン"""

    __tablename__ = "story_arc_milestones"

    id: str = Field(primary_key=True, index=True)
    story_arc_id: str = Field(foreign_key="story_arcs.id", index=True)

    # マイルストーン情報
    title: str = Field(max_length=200)
    description: str = Field(max_length=1000)
    phase_number: int = Field(ge=1)  # どのフェーズのマイルストーンか

    # 達成条件
    achievement_criteria: dict = Field(default_factory=dict, sa_type=JSON)  # 達成条件
    is_completed: bool = Field(default=False)
    completed_at: Optional[datetime] = Field(default=None)

    # 報酬やトリガー
    rewards: dict = Field(default_factory=dict, sa_type=JSON)  # マイルストーン達成報酬
    triggers_next_phase: bool = Field(default=False)  # 次フェーズへの移行トリガーか

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # リレーション
    story_arc: StoryArc = Relationship(back_populates="milestones")

    def __repr__(self) -> str:
        return f"<StoryArcMilestone(id={self.id}, title={self.title}, completed={self.is_completed})>"
