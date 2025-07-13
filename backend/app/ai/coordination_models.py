"""
AI協調動作のためのデータモデル定義
"""

from dataclasses import dataclass, field
from datetime import datetime, UTC
from typing import Any, Optional

from app.ai.shared_context import GameEvent
from app.ai.task_generator import CoordinationTask


@dataclass
class ActionContext:
    """プレイヤーアクションのコンテキスト"""

    action_id: str
    action_type: str
    action_text: str
    session_id: str
    character_id: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class Choice:
    """プレイヤーに提示する選択肢"""

    id: str
    text: str
    description: Optional[str] = None
    requirements: Optional[dict[str, Any]] = None
    consequences: Optional[dict[str, Any]] = None


@dataclass
class AIResponse:
    """AIエージェントからの応答"""

    agent_name: str
    task_id: str
    narrative: Optional[str] = None
    choices: Optional[list[Choice]] = None
    state_changes: Optional[dict[str, Any]] = None
    events: list[GameEvent] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    success: bool = True
    error_message: Optional[str] = None
    processing_time: float = 0.0


@dataclass
class FinalResponse:
    """統合された最終レスポンス"""

    narrative: str
    choices: list[Choice]
    state_changes: dict[str, Any] = field(default_factory=dict)
    events: list[GameEvent] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProgressUpdate:
    """進捗更新情報"""

    percentage: int
    message: str
    current_task: Optional[str] = None
    estimated_time_remaining: Optional[float] = None
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class TaskExecutionResult:
    """タスク実行結果"""

    task: CoordinationTask
    responses: list[AIResponse]
    success: bool
    error_message: Optional[str] = None
    execution_time: float = 0.0
