"""
Socket.IOサーバー実装
"""

from datetime import datetime
from typing import Any, Optional

import socketio

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# Socket.IOサーバーインスタンス作成
# CORSオリジンの末尾スラッシュを削除
cors_origins = [str(origin).rstrip("/") for origin in settings.BACKEND_CORS_ORIGINS]

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=cors_origins,
    cors_credentials=True,
    logger=True,
    engineio_logger=True if settings.LOG_LEVEL == "DEBUG" else False,
)

# ASGIアプリケーション作成
socket_app = socketio.ASGIApp(sio)


class ConnectionManager:
    """接続管理クラス"""

    def __init__(self):
        self.active_connections: dict[str, dict[str, Any]] = {}
        self.user_sessions: dict[str, list[str]] = {}
        self.game_sessions: dict[str, list[str]] = {}

    def add_connection(self, sid: str, user_id: Optional[str] = None, game_session_id: Optional[str] = None):
        """接続を追加"""
        self.active_connections[sid] = {
            "user_id": user_id,
            "game_session_id": game_session_id,
            "connected_at": datetime.utcnow().isoformat(),
        }

        if user_id:
            if user_id not in self.user_sessions:
                self.user_sessions[user_id] = []
            self.user_sessions[user_id].append(sid)

        if game_session_id:
            if game_session_id not in self.game_sessions:
                self.game_sessions[game_session_id] = []
            self.game_sessions[game_session_id].append(sid)

        logger.info("Connection added", sid=sid, user_id=user_id, game_session_id=game_session_id)

    def remove_connection(self, sid: str):
        """接続を削除"""
        if sid not in self.active_connections:
            return

        conn_info = self.active_connections[sid]
        user_id = conn_info.get("user_id")
        game_session_id = conn_info.get("game_session_id")

        # ユーザーセッションから削除
        if user_id and user_id in self.user_sessions:
            self.user_sessions[user_id].remove(sid)
            if not self.user_sessions[user_id]:
                del self.user_sessions[user_id]

        # ゲームセッションから削除
        if game_session_id and game_session_id in self.game_sessions:
            self.game_sessions[game_session_id].remove(sid)
            if not self.game_sessions[game_session_id]:
                del self.game_sessions[game_session_id]

        del self.active_connections[sid]
        logger.info("Connection removed", sid=sid, user_id=user_id, game_session_id=game_session_id)

    def get_user_connections(self, user_id: str) -> list[str]:
        """ユーザーの全接続を取得"""
        return self.user_sessions.get(user_id, [])

    def get_game_connections(self, game_session_id: str) -> list[str]:
        """ゲームセッションの全接続を取得"""
        return self.game_sessions.get(game_session_id, [])


# 接続マネージャーインスタンス
connection_manager = ConnectionManager()


@sio.event
async def connect(sid, environ, auth):
    """クライアント接続時の処理"""
    logger.info("Client connecting", sid=sid)

    # 認証情報から接続を管理
    if auth:
        user_id = auth.get("user_id")
        game_session_id = auth.get("game_session_id")
        connection_manager.add_connection(sid, user_id, game_session_id)

        await sio.emit(
            "connected",
            {"message": "正常に接続されました", "sid": sid, "timestamp": datetime.utcnow().isoformat()},
            to=sid,
        )
    else:
        # 認証なしの場合は一時的に接続を許可
        connection_manager.add_connection(sid)
        await sio.emit(
            "connected",
            {"message": "接続されました（未認証）", "sid": sid, "timestamp": datetime.utcnow().isoformat()},
            to=sid,
        )


@sio.event
async def disconnect(sid):
    """クライアント切断時の処理"""
    logger.info("Client disconnected", sid=sid)
    connection_manager.remove_connection(sid)


@sio.event
async def join_game(sid, data):
    """ゲームセッションに参加"""
    try:
        game_session_id = data.get("game_session_id")
        user_id = data.get("user_id")

        if not game_session_id or not user_id:
            await sio.emit("error", {"message": "ゲームセッションIDとユーザーIDが必要です"}, to=sid)
            return

        # 接続情報を更新
        connection_manager.add_connection(sid, user_id, game_session_id)

        # Socket.IOのroomに参加
        await sio.enter_room(sid, f"game_{game_session_id}")
        await sio.enter_room(sid, f"user_{user_id}")

        await sio.emit(
            "joined_game",
            {
                "message": "ゲームセッションに参加しました",
                "game_session_id": game_session_id,
                "timestamp": datetime.utcnow().isoformat(),
            },
            to=sid,
        )

        # 同じゲームセッションの他のユーザーに通知
        await sio.emit(
            "player_joined",
            {"user_id": user_id, "timestamp": datetime.utcnow().isoformat()},
            room=f"game_{game_session_id}",
            skip_sid=sid,
        )

    except Exception as e:
        logger.error("Error joining game", error=str(e), sid=sid)
        await sio.emit("error", {"message": "ゲーム参加中にエラーが発生しました", "error": str(e)}, to=sid)


@sio.event
async def leave_game(sid, data):
    """ゲームセッションから退出"""
    try:
        game_session_id = data.get("game_session_id")
        user_id = data.get("user_id")

        if game_session_id:
            await sio.leave_room(sid, f"game_{game_session_id}")
        if user_id:
            await sio.leave_room(sid, f"user_{user_id}")

        # 接続情報を更新（ユーザーIDは保持）
        connection_manager.add_connection(sid, user_id, None)

        await sio.emit(
            "left_game",
            {"message": "ゲームセッションから退出しました", "timestamp": datetime.utcnow().isoformat()},
            to=sid,
        )

        # 同じゲームセッションの他のユーザーに通知
        if game_session_id:
            await sio.emit(
                "player_left",
                {"user_id": user_id, "timestamp": datetime.utcnow().isoformat()},
                room=f"game_{game_session_id}",
                skip_sid=sid,
            )

    except Exception as e:
        logger.error("Error leaving game", error=str(e), sid=sid)
        await sio.emit("error", {"message": "ゲーム退出中にエラーが発生しました", "error": str(e)}, to=sid)


@sio.event
async def game_action(sid, data):
    """ゲームアクションの処理"""
    try:
        game_session_id = data.get("game_session_id")
        user_id = data.get("user_id")
        action = data.get("action")

        if not all([game_session_id, user_id, action]):
            await sio.emit("error", {"message": "必要なパラメータが不足しています"}, to=sid)
            return

        logger.info("Game action received", game_session_id=game_session_id, user_id=user_id, action=action)

        # アクション受信確認
        await sio.emit(
            "action_received",
            {"message": "アクションを受信しました", "action": action, "timestamp": datetime.utcnow().isoformat()},
            to=sid,
        )

        # TODO: ゲームサービスと連携してアクションを処理
        # 現在は仮の応答を返す
        await sio.emit(
            "game_update",
            {
                "type": "action_result",
                "action": action,
                "result": {
                    "success": True,
                    "message": f"アクション '{action}' を処理しました",
                    "narrative": "GM: アクションの結果がここに表示されます。",
                },
                "timestamp": datetime.utcnow().isoformat(),
            },
            room=f"game_{game_session_id}",
        )

    except Exception as e:
        logger.error("Error processing game action", error=str(e), sid=sid)
        await sio.emit("error", {"message": "アクション処理中にエラーが発生しました", "error": str(e)}, to=sid)


@sio.event
async def chat_message(sid, data):
    """チャットメッセージの処理"""
    try:
        game_session_id = data.get("game_session_id")
        user_id = data.get("user_id")
        message = data.get("message")

        if not all([game_session_id, user_id, message]):
            await sio.emit("error", {"message": "必要なパラメータが不足しています"}, to=sid)
            return

        # チャットメッセージを同じゲームセッションの全員に配信
        await sio.emit(
            "chat_message",
            {"user_id": user_id, "message": message, "timestamp": datetime.utcnow().isoformat()},
            room=f"game_{game_session_id}",
        )

    except Exception as e:
        logger.error("Error processing chat message", error=str(e), sid=sid)
        await sio.emit("error", {"message": "チャットメッセージ処理中にエラーが発生しました", "error": str(e)}, to=sid)


@sio.event
async def ping(sid, data):
    """Ping/Pong (ハートビート)"""
    await sio.emit("pong", {"timestamp": data.get("timestamp", datetime.utcnow().isoformat())}, to=sid)


async def broadcast_to_user(user_id: str, event: str, data: dict):
    """特定のユーザーの全接続にブロードキャスト"""
    await sio.emit(event, data, room=f"user_{user_id}")


async def broadcast_to_game(game_session_id: str, event: str, data: dict):
    """特定のゲームセッションの全接続にブロードキャスト"""
    await sio.emit(event, data, room=f"game_{game_session_id}")


async def send_notification(user_id: str, notification: dict):
    """ユーザーに通知を送信"""
    await broadcast_to_user(user_id, "notification", {**notification, "timestamp": datetime.utcnow().isoformat()})
