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


class SessionHistoryItem(BaseModel):
    """セッション履歴アイテム"""

    id: str
    session_number: int
    session_status: str  # active, ending_proposed, completed
    play_duration_minutes: int
    turn_count: int
    word_count: int
    result_summary: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    result_processed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SessionHistoryResponse(BaseModel):
    """セッション履歴レスポンス"""

    sessions: list[SessionHistoryItem]
    total: int
    page: int = Field(ge=1, description="現在のページ番号")
    per_page: int = Field(ge=1, le=100, description="1ページあたりのアイテム数")
    has_next: bool = Field(description="次のページが存在するか")
    has_prev: bool = Field(description="前のページが存在するか")


class SessionContinueRequest(BaseModel):
    """セッション継続リクエスト"""

    character_id: str = Field(description="キャラクターID")
    previous_session_id: str = Field(description="前回のセッションID")


class SessionEndingProposal(BaseModel):
    """セッション終了提案"""

    reason: str = Field(description="終了を提案する理由")
    summary_preview: str = Field(description="これまでの冒険の簡単なまとめ")
    continuation_hint: str = Field(description="次回への引き")
    rewards_preview: dict[str, Any] = Field(description="獲得予定の報酬")
    proposal_count: int = Field(ge=1, le=3, description="提案回数（1-3）")
    is_mandatory: bool = Field(description="強制終了かどうか（3回目はTrue）")
    can_continue: bool = Field(description="継続可能かどうか")


class SessionEndingAcceptResponse(BaseModel):
    """セッション終了承認レスポンス"""

    result_id: str = Field(description="セッション結果ID")
    processing_status: str = Field(description="処理状態（processing/completed）")


class SessionEndingRejectResponse(BaseModel):
    """セッション終了拒否レスポンス"""

    proposal_count: int = Field(ge=1, le=3, description="現在の提案回数")
    can_reject_next: bool = Field(description="次回も拒否可能か")
    message: str = Field(description="ユーザーへのメッセージ")


class SessionResultResponse(BaseModel):
    """セッション結果レスポンス"""

    id: str
    session_id: str
    story_summary: str = Field(description="GM AIが生成する物語の要約")
    key_events: list[str] = Field(description="重要イベントのリスト")
    experience_gained: int = Field(description="獲得経験値")
    skills_improved: dict[str, int] = Field(description="向上したスキル（スキル名: 上昇値）")
    items_acquired: list[str] = Field(description="獲得アイテム")
    continuation_context: str = Field(description="次セッションへ渡すコンテキスト")
    unresolved_plots: list[str] = Field(description="未解決のプロット")
    created_at: datetime

    class Config:
        from_attributes = True
