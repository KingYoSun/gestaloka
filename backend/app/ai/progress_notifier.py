"""
AI処理の進捗通知システム

WebSocketを通じてリアルタイムで処理状況を通知し、
プレイヤーの待ち時間に対する不安を軽減します。
"""

from datetime import datetime, UTC
from typing import Any, Optional

import structlog

from app.ai.coordination_models import ProgressUpdate

logger = structlog.get_logger()


class ProgressNotifier:
    """進捗通知クラス"""

    def __init__(self, websocket_manager: Optional[Any] = None):
        self.websocket_manager = websocket_manager
        self.current_progress = 0
        self.current_task = ""
        self.session_id: Optional[str] = None
        self.start_time = datetime.now(UTC)
        self.progress_history: list[ProgressUpdate] = []

    def set_session(self, session_id: str) -> None:
        """セッションIDを設定"""
        self.session_id = session_id
        self.start_time = datetime.now(UTC)

    async def notify_progress(
        self,
        message: str,
        percentage: int,
        current_task: Optional[str] = None,
        estimated_time_remaining: Optional[float] = None,
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        """プレイヤーに進捗を通知"""

        # 進捗データを作成
        progress_update = ProgressUpdate(
            percentage=percentage,
            message=message,
            current_task=current_task,
            estimated_time_remaining=estimated_time_remaining,
            details=details or {},
        )

        # 履歴に追加
        self.progress_history.append(progress_update)

        # 現在の進捗を更新
        self.current_progress = percentage
        if current_task:
            self.current_task = current_task

        # WebSocket経由で通知（利用可能な場合）
        if self.websocket_manager and self.session_id:
            progress_data = {
                "type": "ai_processing_progress",
                "percentage": percentage,
                "message": message,
                "timestamp": datetime.now(UTC).isoformat(),
                "current_task": current_task,
                "estimated_time_remaining": estimated_time_remaining,
                "details": details or {},
                "elapsed_time": (datetime.now(UTC) - self.start_time).total_seconds(),
            }

            try:
                # WebSocket経由でゲームセッションに通知
                from app.websocket.server import broadcast_to_game
                await broadcast_to_game(self.session_id, "game_progress", progress_data)
            except Exception as e:
                logger.error("Failed to send progress notification", error=str(e), session_id=self.session_id)

        # ログ記録
        logger.info(
            f"Progress: {percentage}% - {message}",
            session_id=self.session_id,
            current_task=current_task,
            estimated_time=estimated_time_remaining,
        )

    async def notify_task_start(self, task_name: str, task_count: int) -> None:
        """タスク開始を通知"""
        await self.notify_progress(
            f"タスク開始: {task_name}",
            self.current_progress,
            current_task=task_name,
            details={"task_count": task_count},
        )

    async def notify_task_complete(self, task_name: str) -> None:
        """タスク完了を通知"""
        await self.notify_progress(f"タスク完了: {task_name}", self.current_progress, current_task=task_name)

    async def notify_ai_call(self, agent_name: str) -> None:
        """AI呼び出しを通知"""
        await self.notify_progress(
            f"{agent_name}を呼び出し中...", self.current_progress, current_task=f"AI: {agent_name}"
        )

    async def notify_completion(self) -> None:
        """処理完了を通知"""
        total_time = (datetime.now(UTC) - self.start_time).total_seconds()
        await self.notify_progress("処理完了", 100, details={"total_time": total_time})

    async def notify_error(self, error_message: str) -> None:
        """エラーを通知"""
        await self.notify_progress(
            f"エラー: {error_message}", self.current_progress, details={"error": True, "error_message": error_message}
        )

    def calculate_progress(self, completed_tasks: int, total_tasks: int, base_progress: int = 10) -> int:
        """進捗率を計算"""
        if total_tasks == 0:
            return base_progress

        # 基本進捗 + タスク完了率
        task_progress = (completed_tasks / total_tasks) * 80
        return min(base_progress + int(task_progress), 95)

    def estimate_remaining_time(self, completed_tasks: int, total_tasks: int, average_task_time: float) -> float:
        """残り時間を推定"""
        remaining_tasks = total_tasks - completed_tasks
        if remaining_tasks <= 0:
            return 0.0

        return remaining_tasks * average_task_time

    def get_progress_summary(self) -> dict[str, Any]:
        """進捗サマリーを取得"""
        total_time = (datetime.now(UTC) - self.start_time).total_seconds()

        return {
            "current_progress": self.current_progress,
            "current_task": self.current_task,
            "elapsed_time": total_time,
            "update_count": len(self.progress_history),
            "session_id": self.session_id,
        }
