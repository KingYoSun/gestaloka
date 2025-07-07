"""
ゲームメッセージモデル
"""

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import JSON
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.character import GameSession


# Constants for message types
MESSAGE_TYPE_PLAYER_ACTION = "player_action"
MESSAGE_TYPE_GM_NARRATIVE = "gm_narrative"
MESSAGE_TYPE_SYSTEM_EVENT = "system_event"

# Constants for sender types
SENDER_TYPE_PLAYER = "player"
SENDER_TYPE_GM = "gm"
SENDER_TYPE_SYSTEM = "system"


class GameMessage(SQLModel, table=True):
    """ゲームメッセージモデル"""
    
    __tablename__ = "game_messages"
    
    id: str = Field(primary_key=True, index=True)
    session_id: str = Field(foreign_key="game_sessions.id", index=True)
    message_type: str = Field(...)  # "player_action", "gm_narrative", "system_event"
    sender_type: str = Field(...)  # "player", "gm", "system"
    content: str = Field(...)
    message_metadata: Optional[dict] = Field(default=None, sa_type=JSON)  # choices, character_status等
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    # インデックス
    turn_number: int = Field(..., index=True)  # セッション内のターン番号
    
    # リレーション
    session: "GameSession" = Relationship(back_populates="messages")
    
    def __repr__(self) -> str:
        return f"<GameMessage(id={self.id}, session_id={self.session_id}, turn={self.turn_number})>"