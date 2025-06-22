"""
ログ派遣システムのデータモデル

完成ログを他のプレイヤーの世界に派遣するためのモデル群
"""

from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional
from uuid import uuid4

from sqlalchemy import JSON, Column
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.character import Character
    from app.models.log import CompletedLog


class DispatchObjectiveType(str, Enum):
    """派遣目的タイプ"""
    
    EXPLORE = "explore"  # 探索型：新しい場所や情報を発見
    INTERACT = "interact"  # 交流型：他のキャラクターとの出会いを求める
    COLLECT = "collect"  # 収集型：特定のアイテムや情報を収集
    GUARD = "guard"  # 護衛型：特定の場所や人物を守る
    FREE = "free"  # 自由型：ログの性格に任せて行動


class DispatchStatus(str, Enum):
    """派遣ステータス"""
    
    PREPARING = "preparing"  # 準備中
    DISPATCHED = "dispatched"  # 派遣中
    RETURNING = "returning"  # 帰還中
    COMPLETED = "completed"  # 完了
    RECALLED = "recalled"  # 緊急召還


class LogDispatch(SQLModel, table=True):
    """
    ログ派遣記録
    
    完成ログを他のプレイヤーの世界に独立NPCとして送り出す記録
    """
    
    __tablename__ = "log_dispatches"
    
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    completed_log_id: str = Field(foreign_key="completed_logs.id", index=True)
    dispatcher_id: str = Field(foreign_key="characters.id", index=True)
    
    # 派遣設定
    objective_type: DispatchObjectiveType = Field(description="派遣目的")
    objective_detail: str = Field(description="具体的な目的の説明")
    initial_location: str = Field(description="初期スポーン地点")
    dispatch_duration_days: int = Field(ge=1, le=30, description="派遣期間（日）")
    
    # SP消費
    sp_cost: int = Field(ge=10, le=300, description="消費SP")
    
    # ステータス
    status: DispatchStatus = Field(default=DispatchStatus.PREPARING)
    
    # 活動記録
    travel_log: list[dict] = Field(
        default_factory=list, 
        sa_column=Column(JSON), 
        description="時系列の活動記録"
    )
    
    # 成果
    encounters: list["DispatchEncounter"] = Relationship(back_populates="dispatch")
    collected_items: list[dict] = Field(
        default_factory=list,
        sa_column=Column(JSON),
        description="収集したアイテム"
    )
    discovered_locations: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON),
        description="発見した場所"
    )
    
    # 派遣成果によるSP還元
    sp_refund_amount: int = Field(default=0, description="SP還元量")
    achievement_score: float = Field(default=0.0, description="達成度スコア（0.0-1.0）")
    
    # タイムスタンプ
    created_at: datetime = Field(default_factory=datetime.utcnow)
    dispatched_at: Optional[datetime] = Field(default=None)
    expected_return_at: Optional[datetime] = Field(default=None)
    actual_return_at: Optional[datetime] = Field(default=None)
    
    # リレーションシップ
    completed_log: Optional["CompletedLog"] = Relationship(back_populates="dispatches")
    dispatcher: Optional["Character"] = Relationship(back_populates="dispatched_logs")
    report: Optional["DispatchReport"] = Relationship(back_populates="dispatch", sa_relationship_kwargs={"uselist": False})


class DispatchEncounter(SQLModel, table=True):
    """
    派遣中の遭遇記録
    
    派遣されたログが他のプレイヤーやNPCと出会った記録
    """
    
    __tablename__ = "dispatch_encounters"
    
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    dispatch_id: str = Field(foreign_key="log_dispatches.id", index=True)
    
    # 遭遇相手
    encountered_character_id: Optional[str] = Field(default=None, foreign_key="characters.id")
    encountered_npc_name: Optional[str] = Field(default=None, description="NPC名（プレイヤーでない場合）")
    
    # 遭遇内容
    location: str = Field(description="遭遇場所")
    interaction_type: str = Field(description="交流の種類（会話、戦闘、協力など）")
    interaction_summary: str = Field(description="交流の概要")
    outcome: str = Field(description="結果（友好的、敵対的、中立など）")
    
    # 影響
    relationship_change: float = Field(default=0.0, description="関係性の変化（-1.0〜1.0）")
    items_exchanged: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON),
        description="交換したアイテム"
    )
    
    # タイムスタンプ
    occurred_at: datetime = Field(default_factory=datetime.utcnow)
    
    # リレーションシップ
    dispatch: Optional[LogDispatch] = Relationship(back_populates="encounters")
    encountered_character: Optional["Character"] = Relationship(back_populates="log_encounters")


class DispatchReport(SQLModel, table=True):
    """
    派遣報告書
    
    派遣完了後に生成される詳細な活動報告
    """
    
    __tablename__ = "dispatch_reports"
    
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    dispatch_id: str = Field(foreign_key="log_dispatches.id", unique=True, index=True)
    
    # 活動概要
    total_distance_traveled: int = Field(default=0, description="総移動距離")
    total_encounters: int = Field(default=0, description="総遭遇回数")
    total_items_collected: int = Field(default=0, description="総収集アイテム数")
    total_locations_discovered: int = Field(default=0, description="総発見場所数")
    
    # 評価
    objective_completion_rate: float = Field(default=0.0, description="目的達成率（0.0-1.0）")
    memorable_moments: list[dict] = Field(
        default_factory=list,
        sa_column=Column(JSON),
        description="印象的な出来事"
    )
    
    # ログの成長
    personality_changes: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON),
        description="性格の変化"
    )
    new_skills_learned: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON),
        description="習得した新スキル"
    )
    
    # 物語
    narrative_summary: str = Field(description="物語の要約")
    epilogue: Optional[str] = Field(default=None, description="エピローグ")
    
    # タイムスタンプ
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    # リレーションシップ
    dispatch: Optional[LogDispatch] = Relationship(back_populates="report")