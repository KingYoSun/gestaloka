"""
WebSocketサーバーのモック実装

ゲームセッション再実装までの一時的な実装
"""

from typing import Any


async def broadcast_to_game(game_session_id: str, event_type: str, data: dict[str, Any]):
    """ゲームセッションへのブロードキャスト（モック）"""
    # TODO: 実際のWebSocket実装に置き換える
    pass


async def broadcast_to_user(user_id: str, event_type: str, data: dict[str, Any]):
    """ユーザーへのブロードキャスト（モック）"""
    # TODO: 実際のWebSocket実装に置き換える
    pass


async def send_notification(user_id: str, notification: dict[str, Any]):
    """通知送信（モック）"""
    # TODO: 実際のWebSocket実装に置き換える
    pass