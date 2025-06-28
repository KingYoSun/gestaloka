"""
WebSocketイベントエミッター
ゲームロジックからWebSocket経由でクライアントに通知を送るためのユーティリティ
"""

from datetime import datetime
from typing import Any, Optional

from app.core.logging import get_logger
from app.websocket.server import broadcast_to_game, broadcast_to_user, send_notification

logger = get_logger(__name__)


class GameEventEmitter:
    """ゲームイベントエミッター"""

    @staticmethod
    async def emit_game_started(game_session_id: str, initial_state: dict[str, Any]):
        """ゲーム開始イベント"""
        try:
            await broadcast_to_game(
                game_session_id,
                "game_started",
                {
                    "type": "game_started",
                    "game_session_id": game_session_id,
                    "initial_state": initial_state,
                    "timestamp": datetime.utcnow().isoformat(),
                },
            )
            logger.info("Game started event emitted", game_session_id=game_session_id)
        except Exception as e:
            logger.error("Error emitting game started event", error=str(e))

    @staticmethod
    async def emit_narrative_update(game_session_id: str, narrative: str, narrative_type: str = "general"):
        """物語更新イベント"""
        try:
            await broadcast_to_game(
                game_session_id,
                "narrative_update",
                {
                    "type": "narrative_update",
                    "narrative_type": narrative_type,
                    "narrative": narrative,
                    "timestamp": datetime.utcnow().isoformat(),
                },
            )
            logger.info("Narrative update emitted", game_session_id=game_session_id, narrative_type=narrative_type)
        except Exception as e:
            logger.error("Error emitting narrative update", error=str(e))

    @staticmethod
    async def emit_action_result(game_session_id: str, user_id: str, action: str, result: dict[str, Any]):
        """アクション結果イベント"""
        try:
            await broadcast_to_game(
                game_session_id,
                "action_result",
                {
                    "type": "action_result",
                    "user_id": user_id,
                    "action": action,
                    "result": result,
                    "timestamp": datetime.utcnow().isoformat(),
                },
            )
            logger.info("Action result emitted", game_session_id=game_session_id, user_id=user_id, action=action)
        except Exception as e:
            logger.error("Error emitting action result", error=str(e))

    @staticmethod
    async def emit_state_update(game_session_id: str, state_update: dict[str, Any]):
        """状態更新イベント"""
        try:
            await broadcast_to_game(
                game_session_id,
                "state_update",
                {"type": "state_update", "update": state_update, "timestamp": datetime.utcnow().isoformat()},
            )
            logger.info("State update emitted", game_session_id=game_session_id)
        except Exception as e:
            logger.error("Error emitting state update", error=str(e))

    @staticmethod
    async def emit_player_status_update(game_session_id: str, user_id: str, status: dict[str, Any]):
        """プレイヤーステータス更新イベント"""
        try:
            await broadcast_to_game(
                game_session_id,
                "player_status_update",
                {
                    "type": "player_status_update",
                    "user_id": user_id,
                    "status": status,
                    "timestamp": datetime.utcnow().isoformat(),
                },
            )
            logger.info("Player status update emitted", game_session_id=game_session_id, user_id=user_id)
        except Exception as e:
            logger.error("Error emitting player status update", error=str(e))

    @staticmethod
    async def emit_game_ended(game_session_id: str, reason: str, final_state: Optional[dict[str, Any]] = None):
        """ゲーム終了イベント"""
        try:
            await broadcast_to_game(
                game_session_id,
                "game_ended",
                {
                    "type": "game_ended",
                    "reason": reason,
                    "final_state": final_state,
                    "timestamp": datetime.utcnow().isoformat(),
                },
            )
            logger.info("Game ended event emitted", game_session_id=game_session_id, reason=reason)
        except Exception as e:
            logger.error("Error emitting game ended event", error=str(e))

    @staticmethod
    async def emit_error(game_session_id: str, error_message: str, error_type: str = "general"):
        """エラーイベント"""
        try:
            await broadcast_to_game(
                game_session_id,
                "game_error",
                {
                    "type": "game_error",
                    "error_type": error_type,
                    "message": error_message,
                    "timestamp": datetime.utcnow().isoformat(),
                },
            )
            logger.error(
                "Game error emitted", game_session_id=game_session_id, error_type=error_type, message=error_message
            )
        except Exception as e:
            logger.error("Error emitting game error", error=str(e))

    @staticmethod
    async def emit_custom_event(game_session_id: str, event_type: str, data: dict[str, Any]):
        """カスタムイベント"""
        try:
            await broadcast_to_game(
                game_session_id,
                event_type,
                {
                    "type": event_type,
                    **data,
                    "timestamp": datetime.utcnow().isoformat(),
                },
            )
            logger.info("Custom event emitted", game_session_id=game_session_id, event_type=event_type)
        except Exception as e:
            logger.error("Error emitting custom event", error=str(e))


class SPEventEmitter:
    """SPイベントエミッター"""

    @staticmethod
    async def emit_sp_update(
        user_id: str,
        current_sp: int,
        amount_changed: int,
        transaction_type: str,
        description: str,
        balance_before: int,
        metadata: Optional[dict[str, Any]] = None,
    ):
        """SP残高更新イベント"""
        try:
            await broadcast_to_user(
                user_id,
                "sp_update",
                {
                    "type": "sp_update",
                    "current_sp": current_sp,
                    "amount_changed": amount_changed,
                    "transaction_type": transaction_type,
                    "description": description,
                    "balance_before": balance_before,
                    "balance_after": current_sp,
                    "metadata": metadata or {},
                    "timestamp": datetime.utcnow().isoformat(),
                },
            )
            logger.info(
                "SP update event emitted",
                user_id=user_id,
                current_sp=current_sp,
                amount_changed=amount_changed,
                transaction_type=transaction_type,
            )
        except Exception as e:
            logger.error("Error emitting SP update event", error=str(e))

    @staticmethod
    async def emit_sp_insufficient(
        user_id: str,
        required_amount: int,
        current_sp: int,
        action: str,
    ):
        """SP不足イベント"""
        try:
            await broadcast_to_user(
                user_id,
                "sp_insufficient",
                {
                    "type": "sp_insufficient",
                    "required_amount": required_amount,
                    "current_sp": current_sp,
                    "action": action,
                    "message": f"SP残高が不足しています。必要: {required_amount}, 現在: {current_sp}",
                    "timestamp": datetime.utcnow().isoformat(),
                },
            )
            logger.info(
                "SP insufficient event emitted",
                user_id=user_id,
                required_amount=required_amount,
                current_sp=current_sp,
            )
        except Exception as e:
            logger.error("Error emitting SP insufficient event", error=str(e))

    @staticmethod
    async def emit_daily_recovery_completed(
        user_id: str,
        recovery_details: dict[str, Any],
    ):
        """日次回復完了イベント"""
        try:
            await broadcast_to_user(
                user_id,
                "sp_daily_recovery",
                {
                    "type": "sp_daily_recovery",
                    **recovery_details,
                    "timestamp": datetime.utcnow().isoformat(),
                },
            )
            logger.info(
                "Daily recovery event emitted",
                user_id=user_id,
                total_amount=recovery_details.get("total_amount"),
            )
        except Exception as e:
            logger.error("Error emitting daily recovery event", error=str(e))


class NotificationEmitter:
    """通知エミッター"""

    @staticmethod
    async def send_system_notification(user_id: str, title: str, message: str, notification_type: str = "info"):
        """システム通知を送信"""
        try:
            await send_notification(
                user_id,
                {
                    "type": "system_notification",
                    "notification_type": notification_type,
                    "title": title,
                    "message": message,
                },
            )
            logger.info("System notification sent", user_id=user_id, notification_type=notification_type)
        except Exception as e:
            logger.error("Error sending system notification", error=str(e))

    @staticmethod
    async def send_achievement_notification(user_id: str, achievement: dict[str, Any]):
        """実績通知を送信"""
        try:
            await send_notification(user_id, {"type": "achievement", "achievement": achievement})
            logger.info("Achievement notification sent", user_id=user_id, achievement_id=achievement.get("id"))
        except Exception as e:
            logger.error("Error sending achievement notification", error=str(e))

    @staticmethod
    async def send_friend_request_notification(user_id: str, from_user: dict[str, Any]):
        """フレンドリクエスト通知を送信"""
        try:
            await send_notification(user_id, {"type": "friend_request", "from_user": from_user})
            logger.info("Friend request notification sent", user_id=user_id, from_user_id=from_user.get("id"))
        except Exception as e:
            logger.error("Error sending friend request notification", error=str(e))
