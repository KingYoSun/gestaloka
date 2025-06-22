"""
ログシステムのデータモデル

プレイヤーの行動履歴を「ログ」として記録し、
他プレイヤーの世界でNPCとして活用するためのモデル群
"""

from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Any, Optional
from uuid import uuid4

from sqlalchemy import JSON, Column
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.character import Character, GameSession
    from app.models.log_dispatch import LogDispatch


class LogFragmentRarity(str, Enum):
    """ログの欠片のレアリティ"""

    COMMON = "common"
    UNCOMMON = "uncommon"
    RARE = "rare"
    EPIC = "epic"
    LEGENDARY = "legendary"


class EmotionalValence(str, Enum):
    """感情価"""

    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"
    MIXED = "mixed"


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

    # タイムスタンプ
    created_at: datetime = Field(default_factory=datetime.utcnow)

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

    # タイムスタンプ
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = Field(default=None)

    # リレーションシップ
    creator: Optional["Character"] = Relationship(back_populates="created_logs")
    core_fragment: Optional[LogFragment] = Relationship(
        back_populates="completed_log_cores", sa_relationship_kwargs={"foreign_keys": "[CompletedLog.core_fragment_id]"}
    )
    sub_fragments: list["CompletedLogSubFragment"] = Relationship(back_populates="completed_log")
    contracts: list["LogContract"] = Relationship(back_populates="completed_log")
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


class LogContractStatus(str, Enum):
    """ログ契約のステータス"""

    PENDING = "pending"  # 契約待ち
    ACCEPTED = "accepted"  # 契約受諾
    ACTIVE = "active"  # 活動中
    DEPLOYED = "deployed"  # NPC配置済み
    COMPLETED = "completed"  # 契約完了
    EXPIRED = "expired"  # 期限切れ
    CANCELLED = "cancelled"  # キャンセル


class LogContract(SQLModel, table=True):
    """
    ログ契約（LogContract）

    完成ログを他プレイヤーの世界に送り出す際の契約。
    活動期間、報酬、行動指針などを定義する。
    """

    __tablename__ = "log_contracts"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    completed_log_id: str = Field(foreign_key="completed_logs.id", index=True)
    creator_id: str = Field(foreign_key="characters.id", index=True)
    host_character_id: Optional[str] = Field(default=None, foreign_key="characters.id", index=True)

    # 契約内容
    activity_duration_hours: int = Field(default=24, description="活動期間（時間）")
    behavior_guidelines: str = Field(description="行動指針")
    reward_conditions: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON), description="報酬条件")
    rewards: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON), description="報酬内容")

    # マーケット情報
    is_public: bool = Field(default=False, description="マーケットに公開するか")
    price: Optional[int] = Field(default=None, description="マーケット価格")

    # ステータス
    status: LogContractStatus = Field(default=LogContractStatus.PENDING)

    # 活動記録
    activity_logs: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON), description="活動記録")
    performance_score: float = Field(default=0.0, description="パフォーマンススコア")

    # タイムスタンプ
    created_at: datetime = Field(default_factory=datetime.utcnow)
    activated_at: Optional[datetime] = Field(default=None)
    completed_at: Optional[datetime] = Field(default=None)
    expires_at: Optional[datetime] = Field(default=None)

    # リレーションシップ
    completed_log: Optional[CompletedLog] = Relationship(back_populates="contracts")
    creator: Optional["Character"] = Relationship(
        back_populates="created_contracts", sa_relationship_kwargs={"foreign_keys": "[LogContract.creator_id]"}
    )
    host_character: Optional["Character"] = Relationship(
        back_populates="hosted_contracts", sa_relationship_kwargs={"foreign_keys": "[LogContract.host_character_id]"}
    )


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
