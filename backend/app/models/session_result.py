"""
セッションリザルトモデル
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.game_session import GameSession


class SessionResult(SQLModel, table=True):
    """セッションリザルトモデル"""

    __tablename__ = "session_results"

    id: str = Field(primary_key=True, index=True)
    session_id: str = Field(foreign_key="game_sessions.id", unique=True, index=True)

    # ストーリーサマリー
    story_summary: str = Field(...)  # GM AIが生成する物語の要約
    key_events: list[str] = Field(default_factory=list, sa_type=JSON)  # 重要イベントのリスト

    # キャラクター成長
    experience_gained: int = Field(default=0)
    skills_improved: dict[str, int] = Field(default_factory=dict, sa_type=JSON)  # スキル名: 上昇値
    items_acquired: list[str] = Field(default_factory=list, sa_type=JSON)

    # ナレッジグラフ更新
    neo4j_updates: dict = Field(default_factory=dict, sa_type=JSON)  # Neo4jに反映した内容

    # 次回への引き継ぎ
    continuation_context: str = Field(...)  # 次セッションへ渡すコンテキスト
    unresolved_plots: list[str] = Field(default_factory=list, sa_type=JSON)  # 未解決のプロット

    # ストーリーアーク進行
    story_arc_progress: dict = Field(default_factory=dict, sa_type=JSON)  # アークの進行状況

    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    # リレーション
    session: "GameSession" = Relationship(back_populates="result")

    def __repr__(self) -> str:
        return f"<SessionResult(id={self.id}, session_id={self.session_id})>"
