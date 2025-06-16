"""
WebSocketエンドポイント
"""

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)


# アクティブな接続を管理
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
        self.user_connections: dict[str, list[str]] = {}

    async def connect(self, websocket: WebSocket, connection_id: str, user_id: str | None = None):
        await websocket.accept()
        self.active_connections[connection_id] = websocket

        if user_id:
            if user_id not in self.user_connections:
                self.user_connections[user_id] = []
            self.user_connections[user_id].append(connection_id)

        logger.info("WebSocket connected", connection_id=connection_id, user_id=user_id)

    def disconnect(self, connection_id: str, user_id: str | None = None):
        if connection_id in self.active_connections:
            del self.active_connections[connection_id]

        if user_id and user_id in self.user_connections:
            if connection_id in self.user_connections[user_id]:
                self.user_connections[user_id].remove(connection_id)
            if not self.user_connections[user_id]:
                del self.user_connections[user_id]

        logger.info("WebSocket disconnected", connection_id=connection_id, user_id=user_id)

    async def send_personal_message(self, message: str, connection_id: str):
        if connection_id in self.active_connections:
            websocket = self.active_connections[connection_id]
            await websocket.send_text(message)

    async def send_user_message(self, message: str, user_id: str):
        if user_id in self.user_connections:
            for connection_id in self.user_connections[user_id]:
                await self.send_personal_message(message, connection_id)

    async def broadcast(self, message: str):
        for websocket in self.active_connections.values():
            await websocket.send_text(message)


manager = ConnectionManager()


@router.websocket("/game/{session_id}")
async def websocket_game_endpoint(websocket: WebSocket, session_id: str):
    """ゲーム用WebSocket接続"""
    connection_id = f"game_{session_id}_{id(websocket)}"

    try:
        await manager.connect(websocket, connection_id)

        # 接続確認メッセージ
        await websocket.send_text(
            json.dumps(
                {
                    "type": "connection_established",
                    "session_id": session_id,
                    "message": "ゲームセッションに接続しました",
                }
            )
        )

        while True:
            # クライアントからのメッセージを受信
            data = await websocket.receive_text()
            message_data = json.loads(data)

            # メッセージタイプに応じて処理
            if message_data.get("type") == "player_action":
                # TODO: プレイヤーアクション処理
                response = {
                    "type": "action_response",
                    "session_id": session_id,
                    "message": "アクション処理 - 実装予定",
                    "action": message_data.get("action"),
                }
                await websocket.send_text(json.dumps(response))

            logger.info("WebSocket message received", session_id=session_id, message_type=message_data.get("type"))

    except WebSocketDisconnect:
        manager.disconnect(connection_id)
        logger.info("WebSocket disconnected", session_id=session_id)
    except Exception as e:
        logger.error("WebSocket error", session_id=session_id, error=str(e))
        manager.disconnect(connection_id)


@router.websocket("/general/{user_id}")
async def websocket_general_endpoint(websocket: WebSocket, user_id: str):
    """一般通知用WebSocket接続"""
    connection_id = f"general_{user_id}_{id(websocket)}"

    try:
        await manager.connect(websocket, connection_id, user_id)

        # 接続確認メッセージ
        await websocket.send_text(
            json.dumps({"type": "connection_established", "user_id": user_id, "message": "一般通知に接続しました"})
        )

        while True:
            # ハートビート的な処理
            data = await websocket.receive_text()
            message_data = json.loads(data)

            if message_data.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong", "timestamp": message_data.get("timestamp")}))

    except WebSocketDisconnect:
        manager.disconnect(connection_id, user_id)
        logger.info("General WebSocket disconnected", user_id=user_id)
    except Exception as e:
        logger.error("General WebSocket error", user_id=user_id, error=str(e))
        manager.disconnect(connection_id, user_id)
