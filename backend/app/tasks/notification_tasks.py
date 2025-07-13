"""
通知関連タスク
"""

from datetime import UTC, datetime

from app.celery import celery_app
from app.core.logging import get_logger

# from app.core.database import get_session  # データベースアクセスが必要になった場合に使用

logger = get_logger(__name__)


@celery_app.task(bind=True)
def send_player_notification(self, player_id: str, notification_data: dict):
    """プレイヤーに通知を送信"""
    try:
        logger.info(
            "Sending player notification",
            task_id=self.request.id,
            player_id=player_id,
            notification_type=notification_data.get("type"),
        )

        notification = {
            "id": f"notif_{self.request.id}",
            "player_id": player_id,
            "type": notification_data.get("type", "info"),
            "title": notification_data.get("title"),
            "message": notification_data.get("message"),
            "priority": notification_data.get("priority", "normal"),
            "timestamp": datetime.now(UTC).isoformat(),
            "read": False,
            "data": notification_data.get("data", {}),
        }

        # TODO: WebSocketまたはプッシュ通知での送信

        logger.info(
            "Notification sent successfully",
            task_id=self.request.id,
            player_id=player_id,
            notification_id=notification["id"],
        )

        return notification

    except Exception as e:
        logger.error("Failed to send notification", task_id=self.request.id, player_id=player_id, error=str(e))
        raise


@celery_app.task(bind=True)
def broadcast_world_event(self, world_id: str, event_data: dict):
    """世界イベントをブロードキャスト"""
    try:
        logger.info(
            "Broadcasting world event", task_id=self.request.id, world_id=world_id, event_type=event_data.get("type")
        )

        # TODO: 該当世界の全プレイヤーを取得
        affected_players: list[str] = []  # 仮のリスト

        broadcast_results = []
        for player_id in affected_players:
            notification_data = {
                "type": "world_event",
                "title": event_data.get("title"),
                "message": event_data.get("description"),
                "priority": "high",
                "data": {
                    "event_id": event_data.get("id"),
                    "event_type": event_data.get("type"),
                    "impact": event_data.get("impact"),
                },
            }

            # 各プレイヤーに通知を送信
            send_player_notification.delay(player_id, notification_data)
            broadcast_results.append({"player_id": player_id, "status": "queued"})

        logger.info(
            "World event broadcast completed",
            task_id=self.request.id,
            world_id=world_id,
            players_notified=len(broadcast_results),
        )

        return broadcast_results

    except Exception as e:
        logger.error("Failed to broadcast world event", task_id=self.request.id, world_id=world_id, error=str(e))
        raise


@celery_app.task(bind=True)
def send_log_contract_notification(self, sender_id: str, recipient_id: str, contract_data: dict):
    """ログ契約通知を送信"""
    try:
        logger.info(
            "Sending log contract notification", task_id=self.request.id, sender_id=sender_id, recipient_id=recipient_id
        )

        notification_data = {
            "type": "log_contract",
            "title": "新しいログ契約の提案",
            "message": f"{contract_data.get('sender_name')}からログ契約の提案が届いています",
            "priority": "high",
            "data": {
                "contract_id": contract_data.get("id"),
                "sender_id": sender_id,
                "log_id": contract_data.get("log_id"),
                "terms": contract_data.get("terms", {}),
                "expires_at": contract_data.get("expires_at"),
            },
        }

        result = send_player_notification.apply_async(
            args=[recipient_id, notification_data],
            priority=9,  # 高優先度
        )

        logger.info("Log contract notification sent", task_id=self.request.id, contract_id=contract_data.get("id"))

        return {"contract_id": contract_data.get("id"), "notification_task_id": result.id, "status": "sent"}

    except Exception as e:
        logger.error(
            "Failed to send log contract notification",
            task_id=self.request.id,
            sender_id=sender_id,
            recipient_id=recipient_id,
            error=str(e),
        )
        raise


@celery_app.task(bind=True)
def cleanup_old_notifications(self, days_to_keep: int = 30):
    """古い通知をクリーンアップ"""
    try:
        logger.info("Cleaning up old notifications", task_id=self.request.id, days_to_keep=days_to_keep)

        # TODO: 指定日数より古い既読通知を削除
        cleanup_count = 0

        logger.info("Notification cleanup completed", task_id=self.request.id, notifications_removed=cleanup_count)

        return {"removed_count": cleanup_count, "cleanup_date": datetime.now(UTC).isoformat()}

    except Exception as e:
        logger.error("Failed to cleanup notifications", task_id=self.request.id, error=str(e))
        raise
