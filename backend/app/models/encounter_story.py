"""
遭遇ストーリーシステムのデータモデル
ログとの遭遇をクエストや継続的な物語に発展させる
"""

import uuid
from datetime import UTC, datetime
from enum import Enum
from typing import Any, ClassVar, Optional

from sqlalchemy import Text
from sqlmodel import JSON, Column, Field, SQLModel

from app.models.story_arc import StoryArcType


class EncounterType(str, Enum):
    """遭遇の種類"""

    LOG_NPC = "log_npc"  # 派遣ログNPC
    PERSISTENT_NPC = "persistent_npc"  # 永続的NPC
    OTHER_PLAYER = "other_player"  # 他のプレイヤー
    LOG_ENCOUNTER = "log_encounter"  # 派遣ログ同士の遭遇


# StoryArcTypeはstory_arc.pyからインポート


class RelationshipStatus(str, Enum):
    """関係性の状態"""

    INITIAL = "initial"  # 初対面
    DEVELOPING = "developing"  # 発展中
    ESTABLISHED = "established"  # 確立された
    DEEPENING = "deepening"  # 深化中
    TRANSFORMED = "transformed"  # 変容した
    CONCLUDED = "concluded"  # 終結した


class EncounterStory(SQLModel, table=True):
    """遭遇から発展するストーリーモデル"""

    __tablename__ = "encounter_stories"

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()), primary_key=True, index=True, description="ストーリーの一意識別子"
    )

    # 基本情報
    character_id: str = Field(foreign_key="characters.id", index=True, description="主人公となるキャラクターID")
    encounter_entity_id: str = Field(index=True, description="遭遇した相手のID（NPC ID、ログID、キャラクターIDなど）")
    encounter_type: EncounterType = Field(description="遭遇の種類")

    # ストーリー情報
    story_arc_type: StoryArcType = Field(description="ストーリーアークの種類")
    title: str = Field(description="ストーリーのタイトル")
    current_chapter: int = Field(default=1, description="現在の章")
    total_chapters: Optional[int] = Field(default=None, description="予定される総章数（動的に変化可能）")

    # 関係性管理
    relationship_status: RelationshipStatus = Field(default=RelationshipStatus.INITIAL, description="関係性の状態")
    relationship_depth: float = Field(default=0.0, ge=0.0, le=1.0, description="関係の深さ（0-1）")
    trust_level: float = Field(default=0.5, ge=0.0, le=1.0, description="信頼度（0-1）")
    conflict_level: float = Field(default=0.0, ge=0.0, le=1.0, description="対立度（0-1）")

    # ストーリー進行
    story_beats: list[dict[str, Any]] = Field(
        default_factory=list,
        sa_column=Column(JSON),
        description="ストーリーのビート（重要な転換点）",
    )
    shared_memories: list[dict[str, Any]] = Field(
        default_factory=list,
        sa_column=Column(JSON),
        description="共有された記憶・経験",
    )
    pending_plot_threads: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON),
        description="未解決のプロットスレッド",
    )

    # クエスト関連
    active_quest_ids: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON),
        description="このストーリーに関連するアクティブなクエストID",
    )
    completed_quest_ids: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON),
        description="完了したクエストID",
    )

    # 影響と結果
    world_impact: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON),
        description="世界への影響（場所の変化、NPCの態度変化など）",
    )
    character_growth: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON),
        description="キャラクターの成長（新しいスキル、洞察、変化など）",
    )

    # メタデータ
    narrative_tension: float = Field(default=0.5, ge=0.0, le=1.0, description="物語の緊張度（0-1）")
    emotional_resonance: float = Field(default=0.5, ge=0.0, le=1.0, description="感情的な共鳴度（0-1）")
    story_momentum: float = Field(default=0.5, ge=0.0, le=1.0, description="ストーリーの勢い（0-1）")

    # タイムスタンプ
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC), description="ストーリー開始日時")
    last_interaction_at: datetime = Field(default_factory=lambda: datetime.now(UTC), description="最後の相互作用日時")
    next_expected_beat: Optional[datetime] = Field(default=None, description="次の重要な展開の予想時期")

    class Config:
        json_schema_extra: ClassVar[dict] = {
            "example": {
                "id": "story_123",
                "character_id": "char_456",
                "encounter_entity_id": "log_npc_789",
                "encounter_type": "log_npc",
                "story_arc_type": "quest_chain",
                "title": "失われた記憶の継承者",
                "current_chapter": 3,
                "relationship_status": "developing",
                "relationship_depth": 0.6,
                "story_beats": [
                    {
                        "chapter": 1,
                        "beat": "初めての出会い",
                        "description": "古い記憶を持つログNPCとの遭遇",
                        "timestamp": "2025-01-01T10:00:00Z",
                    },
                    {
                        "chapter": 2,
                        "beat": "共通の目的",
                        "description": "失われた都市の手がかりを共に追う",
                        "timestamp": "2025-01-02T15:00:00Z",
                    },
                ],
                "active_quest_ids": ["quest_001", "quest_002"],
            }
        }


class EncounterChoice(SQLModel, table=True):
    """遭遇時の選択肢と結果"""

    __tablename__ = "encounter_choices"

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()), primary_key=True, index=True, description="選択肢の一意識別子"
    )

    story_id: str = Field(foreign_key="encounter_stories.id", index=True, description="関連するストーリーID")
    session_id: str = Field(foreign_key="game_sessions.id", index=True, description="セッションID")

    # 選択肢情報
    situation_context: str = Field(sa_column=Column(Text), description="選択が必要な状況の説明")
    available_choices: list[dict[str, Any]] = Field(
        sa_column=Column(JSON),
        description="利用可能な選択肢",
    )
    player_choice: Optional[str] = Field(default=None, description="プレイヤーが選んだ選択肢")
    choice_reasoning: Optional[str] = Field(default=None, sa_column=Column(Text), description="選択の理由（AI推測）")

    # 結果と影響
    immediate_consequence: Optional[str] = Field(default=None, sa_column=Column(Text), description="即座の結果")
    long_term_impact: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON),
        description="長期的な影響",
    )
    relationship_change: dict[str, float] = Field(
        default_factory=dict,
        sa_column=Column(JSON),
        description="関係性の変化",
    )

    # タイムスタンプ
    presented_at: datetime = Field(default_factory=lambda: datetime.now(UTC), description="選択肢が提示された日時")
    decided_at: Optional[datetime] = Field(default=None, description="決定された日時")


class SharedQuest(SQLModel, table=True):
    """共同クエストモデル"""

    __tablename__ = "shared_quests"

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()), primary_key=True, index=True, description="共同クエストID"
    )

    # 関連情報
    quest_id: str = Field(foreign_key="quests.id", index=True, description="ベースとなるクエストID")
    story_id: str = Field(foreign_key="encounter_stories.id", index=True, description="関連するストーリーID")

    # 参加者
    participants: list[dict[str, Any]] = Field(
        sa_column=Column(JSON),
        description="参加者情報（ID、タイプ、役割）",
    )
    leader_id: Optional[str] = Field(default=None, description="リーダーのID")

    # 協力状態
    cooperation_level: float = Field(default=0.5, ge=0.0, le=1.0, description="協力度（0-1）")
    sync_level: float = Field(default=0.5, ge=0.0, le=1.0, description="同期度（0-1）")
    contribution_balance: dict[str, float] = Field(
        default_factory=dict,
        sa_column=Column(JSON),
        description="各参加者の貢献度",
    )

    # 共同進行管理
    shared_objectives: list[dict[str, Any]] = Field(
        sa_column=Column(JSON),
        description="共有された目標",
    )
    synchronized_actions: list[dict[str, Any]] = Field(
        default_factory=list,
        sa_column=Column(JSON),
        description="同期された行動",
    )
    conflict_points: list[dict[str, Any]] = Field(
        default_factory=list,
        sa_column=Column(JSON),
        description="対立点",
    )

    # 報酬分配
    reward_distribution: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON),
        description="報酬の分配方法",
    )

    # タイムスタンプ
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC), description="共同クエスト開始日時")
    last_sync_at: datetime = Field(default_factory=lambda: datetime.now(UTC), description="最後の同期日時")
    completed_at: Optional[datetime] = Field(default=None, description="完了日時")
