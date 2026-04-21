"""
ゲームセッションモデル
"""

from datetime import UTC, datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.character import Character
    from app.models.game_message import GameMessage
    from app.models.log import ActionLog, LogFragment
    from app.models.session_result import SessionResult
    from app.models.story_arc import StoryArc


class SessionStatus(str, Enum):
    """セッション状態"""

    ACTIVE = "active"
    ENDING_PROPOSED = "ending_proposed"
    COMPLETED = "completed"


class GameSession(SQLModel, table=True):
    """ゲームセッションモデル"""

    __tablename__ = "game_sessions"

    id: str = Field(primary_key=True, index=True)
    character_id: str = Field(foreign_key="characters.id", index=True)
    is_active: bool = Field(default=True)
    current_scene: Optional[str] = Field(default=None, max_length=500)
    session_data: Optional[str] = Field(default=None)  # JSON文字列
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    # 新規フィールド
    session_status: str = Field(default=SessionStatus.ACTIVE.value)
    session_number: int = Field(default=1)  # キャラクターの何回目のセッションか
    previous_session_id: Optional[str] = Field(default=None, foreign_key="game_sessions.id")
    story_arc_id: Optional[str] = Field(
        default=None, foreign_key="story_arcs.id"
    )  # ストーリーアークID（複数セッション跨ぎ）
    is_first_session: bool = Field(default=False)  # 初回セッションかどうか

    # リザルト関連
    result_summary: Optional[str] = Field(default=None)  # セッションのサマリー
    result_processed_at: Optional[datetime] = Field(default=None)

    # メトリクス
    turn_count: int = Field(default=0)
    word_count: int = Field(default=0)
    play_duration_minutes: int = Field(default=0)

    # 終了提案追跡
    ending_proposal_count: int = Field(default=0)  # 終了提案された回数（0-3）
    last_proposal_at: Optional[datetime] = Field(default=None)  # 最後に提案した時刻

    # リレーション
    character: "Character" = Relationship(back_populates="game_sessions")
    messages: list["GameMessage"] = Relationship(back_populates="session")
    result: Optional["SessionResult"] = Relationship(
        back_populates="session", sa_relationship_kwargs={"uselist": False}
    )
    log_fragments: list["LogFragment"] = Relationship(back_populates="session")
    action_logs: list["ActionLog"] = Relationship(back_populates="session")
    story_arc: Optional["StoryArc"] = Relationship(back_populates="sessions")

    def __repr__(self) -> str:
        return f"<GameSession(id={self.id}, character_id={self.character_id}, status={self.session_status})>"
