"""
セッション結果モデル
"""

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import JSON, Column, Text
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.character import GameSession


class SessionResult(SQLModel, table=True):
    """セッション結果"""

    __tablename__ = "session_results"

    id: str = Field(primary_key=True)
    session_id: str = Field(foreign_key="game_sessions.id", unique=True)

    # ストーリーサマリー
    story_summary: str = Field(sa_column=Column(Text, nullable=False))
    key_events: list[str] = Field(default_factory=list, sa_column=Column(JSON))

    # キャラクター成長
    experience_gained: int = Field(default=0)
    skills_improved: dict[str, int] = Field(default_factory=dict, sa_column=Column(JSON))
    items_acquired: list[str] = Field(default_factory=list, sa_column=Column(JSON))

    # ナレッジグラフ更新
    neo4j_updates: dict = Field(default_factory=dict, sa_column=Column(JSON))

    # 次回への引き継ぎ
    continuation_context: str = Field(sa_column=Column(Text, nullable=False))
    unresolved_plots: list[str] = Field(default_factory=list, sa_column=Column(JSON))

    created_at: datetime = Field(default_factory=datetime.utcnow)

    # リレーション
    session: Optional["GameSession"] = Relationship(back_populates="result")

    class Config:
        arbitrary_types_allowed = True
