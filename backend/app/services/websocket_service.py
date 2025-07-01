"""
WebSocketサービス
"""

from typing import Any, Optional


class WebSocketService:
    """WebSocket通信サービス"""

    async def broadcast_to_user(
        self,
        user_id: str,
        event_type: str,
        data: dict[str, Any],
    ) -> None:
        """特定のユーザーにイベントを配信"""
        # TODO: 実際のWebSocket実装を追加
        # 現在は仮実装
        print(f"Broadcasting to user {user_id}: {event_type} - {data}")