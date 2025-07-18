"""
ログシステムのデータモデル

プレイヤーの行動履歴を「ログ」として記録し、
他プレイヤーの世界でNPCとして活用するためのモデル群
"""

from datetime import UTC, datetime
from enum import Enum
from typing import TYPE_CHECKING, Any, Optional
from uuid import uuid4

from sqlalchemy import JSON, Column
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.character import Character
    from app.models.game_session import GameSession
    from app.models.log_dispatch import LogDispatch


class LogFragmentRarity(str, Enum):
    """ログの欠片のレアリティ"""

    COMMON = "common"
    UNCOMMON = "uncommon"
    RARE = "rare"
    EPIC = "epic"
    LEGENDARY = "legendary"
    UNIQUE = "unique"  # プレイヤー固有の特別な記憶
    ARCHITECT = "architect"  # 世界の真実に関する記憶


class EmotionalValence(str, Enum):
    """感情価"""

    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"
    MIXED = "mixed"


class MemoryType(str, Enum):
    """記憶のタイプ"""

    COURAGE = "courage"  # 勇気
    FRIENDSHIP = "friendship"  # 友情
    WISDOM = "wisdom"  # 知恵
    SACRIFICE = "sacrifice"  # 犠牲
    VICTORY = "victory"  # 勝利
    TRUTH = "truth"  # 真実
    BETRAYAL = "betrayal"  # 裏切り
    LOVE = "love"  # 愛
    FEAR = "fear"  # 恐怖
    HOPE = "hope"  # 希望
    MYSTERY = "mystery"  # 謎


class LogFragment(SQLModel, table=True):
    """
    ログの欠片（LogFragment）

    プレイヤーの重要な行動や決断から生成される記録の断片。
    これらを組み合わせて完成ログ（CompletedLog）を作成する。
    """

    __tablename__ = "log_fragments"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    character_id: str = Field(foreign_key="characters.id", index=True)
    session_id: Optional[str] = Field(default=None, foreign_key="game_sessions.id", index=True)

    # 基本情報
    action_description: str = Field(description="行動の詳細な記述")
    keywords: list[str] = Field(
        default_factory=list, sa_column=Column(JSON), description="キーワード（例: [勇敢], [裏切り], [探索]）"
    )
    keyword: Optional[str] = Field(default=None, description="メインキーワード（探索で発見されたフラグメント用）")
    emotional_valence: EmotionalValence = Field(default=EmotionalValence.NEUTRAL, description="感情価")
    rarity: LogFragmentRarity = Field(default=LogFragmentRarity.COMMON, description="レアリティ")
    backstory: Optional[str] = Field(default=None, description="フラグメントの背景ストーリー")
    discovered_at: Optional[str] = Field(default=None, description="発見場所")
    source_action: Optional[str] = Field(default=None, description="フラグメントの発生源となった行動")

    # メタデータ
    importance_score: float = Field(default=0.0, description="重要度スコア（0.0-1.0）")
    context_data: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSON), description="行動時の文脈情報（場所、関係者、状況など）"
    )

    # 記憶継承システム用フィールド
    memory_type: Optional[str] = Field(default=None, description="記憶のタイプ（勇気/友情/知恵/犠牲/勝利/真実など）")
    combination_tags: list[str] = Field(default_factory=list, sa_column=Column(JSON), description="組み合わせ用のタグ")
    world_truth: Optional[str] = Field(default=None, description="世界の真実（アーキテクトレアリティ限定）")
    acquisition_context: Optional[str] = Field(default=None, description="獲得時の詳細な状況")
    is_consumed: bool = Field(default=False, description="消費されたかどうか（常にFalseで永続性を保証）")

    # タイムスタンプ
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    acquisition_date: Optional[datetime] = Field(default=None, description="記憶として獲得された日時")

    # リレーションシップ
    character: Optional["Character"] = Relationship(back_populates="log_fragments")
    session: Optional["GameSession"] = Relationship(back_populates="log_fragments")

    # 逆参照用
    completed_log_cores: list["CompletedLog"] = Relationship(
        back_populates="core_fragment", sa_relationship_kwargs={"foreign_keys": "[CompletedLog.core_fragment_id]"}
    )
    completed_log_subs: list["CompletedLogSubFragment"] = Relationship(back_populates="fragment")


class CompletedLogStatus(str, Enum):
    """完成ログのステータス"""

    DRAFT = "draft"  # 編纂中
    COMPLETED = "completed"  # 編纂完了
    CONTRACTED = "contracted"  # 契約済み
    ACTIVE = "active"  # 他世界で活動中
    EXPIRED = "expired"  # 契約期限切れ
    RECALLED = "recalled"  # 召還済み


class CompletedLog(SQLModel, table=True):
    """
    完成ログ（CompletedLog）

    複数のLogFragmentを編纂して作成された、
    他プレイヤーの世界でNPCとして活動可能な完全な記録。
    """

    __tablename__ = "completed_logs"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    creator_id: str = Field(foreign_key="characters.id", index=True)
    core_fragment_id: str = Field(foreign_key="log_fragments.id")

    # 基本情報
    name: str = Field(description="ログの名前")
    title: Optional[str] = Field(default=None, description="称号（例: [英雄]）")
    description: str = Field(description="ログの説明文")

    # 能力・特性
    skills: list[str] = Field(default_factory=list, sa_column=Column(JSON), description="獲得したスキル")
    personality_traits: list[str] = Field(default_factory=list, sa_column=Column(JSON), description="性格特性")
    behavior_patterns: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON), description="行動パターン")

    # 汚染度
    contamination_level: float = Field(default=0.0, ge=0.0, le=1.0, description="汚染度（0.0-1.0）")

    # ステータス
    status: CompletedLogStatus = Field(default=CompletedLogStatus.DRAFT)

    # 編纂メタデータ（コンボボーナス情報等）
    compilation_metadata: Optional[dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON), description="編纂時のメタデータ"
    )

    # タイムスタンプ
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    completed_at: Optional[datetime] = Field(default=None)

    # リレーションシップ
    creator: Optional["Character"] = Relationship(back_populates="created_logs")
    core_fragment: Optional[LogFragment] = Relationship(
        back_populates="completed_log_cores", sa_relationship_kwargs={"foreign_keys": "[CompletedLog.core_fragment_id]"}
    )
    sub_fragments: list["CompletedLogSubFragment"] = Relationship(back_populates="completed_log")
    dispatches: list["LogDispatch"] = Relationship(back_populates="completed_log")


class CompletedLogSubFragment(SQLModel, table=True):
    """
    完成ログとサブフラグメントの中間テーブル
    """

    __tablename__ = "completed_log_sub_fragments"

    completed_log_id: str = Field(foreign_key="completed_logs.id", primary_key=True)
    fragment_id: str = Field(foreign_key="log_fragments.id", primary_key=True)
    order: int = Field(default=0, description="フラグメントの順序")

    # リレーションシップ
    completed_log: Optional[CompletedLog] = Relationship(back_populates="sub_fragments")
    fragment: Optional[LogFragment] = Relationship(back_populates="completed_log_subs")


# 既存モデルへの追加が必要なリレーションシップ
# Character モデルに以下を追加:
# log_fragments: list[LogFragment] = Relationship(back_populates="character")
# created_logs: list[CompletedLog] = Relationship(back_populates="creator")
# created_contracts: list[LogContract] = Relationship(
#     back_populates="creator",
#     sa_relationship_kwargs={"foreign_keys": "[LogContract.creator_id]"}
# )
# hosted_contracts: list[LogContract] = Relationship(
#     back_populates="host_character",
#     sa_relationship_kwargs={"foreign_keys": "[LogContract.host_character_id]"}
# )

# GameSession モデルに以下を追加:
# log_fragments: list[LogFragment] = Relationship(back_populates="session")


class ActionLog(SQLModel, table=True):
    """
    アクションログ（ActionLog）
    プレイヤーのアクションとAIの応答を記録し、
    パフォーマンスメトリクスを追跡するためのモデル。
    """

    __tablename__ = "action_logs"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    session_id: str = Field(foreign_key="game_sessions.id", index=True)
    character_id: str = Field(foreign_key="characters.id", index=True)

    # アクション情報
    action_type: str = Field(description="アクションのタイプ（explore, combat, dialogue等）")
    action_content: str = Field(description="アクションの内容")
    response_content: str = Field(description="AIの応答内容")

    # パフォーマンスデータ
    performance_data: Optional[dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON), description="パフォーマンスメトリクス（実行時間、エージェント情報等）"
    )

    # タイムスタンプ
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    # リレーションシップ
    session: Optional["GameSession"] = Relationship(back_populates="action_logs")
    character: Optional["Character"] = Relationship(back_populates="action_logs")
