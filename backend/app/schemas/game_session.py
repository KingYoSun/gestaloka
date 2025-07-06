"""
ゲームセッション関連スキーマ
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


class GameSessionCreate(BaseModel):
    """ゲームセッション作成リクエスト"""

    character_id: str


class GameSessionUpdate(BaseModel):
    """ゲームセッション更新リクエスト"""

    current_scene: Optional[str] = None
    session_data: Optional[dict[str, Any]] = None


class GameSessionResponse(BaseModel):
    """ゲームセッションレスポンス"""

    id: str
    character_id: str
    character_name: str
    is_active: bool
    current_scene: Optional[str] = None
    session_data: Optional[dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime
    turn_number: Optional[int] = 0

    class Config:
        from_attributes = True


class GameSessionListResponse(BaseModel):
    """ゲームセッション一覧レスポンス"""

    sessions: list[GameSessionResponse]
    total: int


class GameActionRequest(BaseModel):
    """ゲーム行動リクエスト"""

    action_text: str = Field(max_length=500, description="アクションテキスト（最大500文字）")
    action_type: str = "custom"  # "choice" or "custom"
    choice_index: Optional[int] = None

    @field_validator("action_text")
    @classmethod
    def validate_action_text(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("アクションテキストは必須です")
        if len(v) > 500:
            raise ValueError("アクションテキストは500文字以内で入力してください")
        return v.strip()


class GameActionResponse(BaseModel):
    """ゲーム行動レスポンス"""

    session_id: str
    action_result: str
    new_scene: Optional[str] = None
    choices: Optional[list[str]] = None
    character_status: Optional[dict[str, Any]] = None


class ActionChoice(BaseModel):
    """行動選択肢"""

    id: str = Field(description="選択肢ID")
    text: str = Field(description="選択肢のテキスト")
    difficulty: Optional[str] = Field(default=None, description="難易度（easy/medium/hard）")
    requirements: Optional[dict[str, Any]] = Field(default_factory=lambda: {}, description="必要条件")


class ActionExecuteRequest(BaseModel):
    """アクション実行リクエスト"""

    action_text: str = Field(max_length=500, description="実行するアクションのテキスト（最大500文字）")
    action_type: str = Field(default="custom", description="アクションタイプ（choice/custom）")
    choice_id: Optional[str] = Field(default=None, description="選択した選択肢のID")

    @field_validator("action_text")
    @classmethod
    def validate_action_text(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("アクションテキストは必須です")
        if len(v) > 500:
            raise ValueError("アクションテキストは500文字以内で入力してください")
        return v.strip()


class ActionExecuteResponse(BaseModel):
    """アクション実行レスポンス"""

    success: bool = Field(description="アクション実行の成否")
    turn_number: int = Field(description="現在のターン数")
    narrative: str = Field(description="物語的な描写")
    choices: Optional[list[ActionChoice]] = Field(default=None, description="次の行動選択肢")
    character_state: dict[str, Any] = Field(description="キャラクターの現在状態")
    metadata: Optional[dict[str, Any]] = Field(default_factory=lambda: {}, description="追加メタデータ")
