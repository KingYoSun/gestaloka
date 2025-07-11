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

    def __init__(self) -> None:
        self.active_connections: dict[str, dict[str, Any]] = {}
        self.user_sessions: dict[str, list[str]] = {}
        self.game_sessions: dict[str, list[str]] = {}

    def add_connection(self, sid: str, user_id: Optional[str] = None, game_session_id: Optional[str] = None) -> None:
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


# 全イベントをキャッチするハンドラー（デバッグ用）
@sio.on("*")
async def catch_all(event, sid, data):
    """全イベントをログに記録（デバッグ用）"""
    logger.debug(f"[DEBUG] Received event '{event}' from {sid} with data: {data}")


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

        # 既に同じセッションに参加している場合でも処理を継続（選択肢送信のため）
        existing_conn = connection_manager.active_connections.get(sid, {})
        is_already_joined = existing_conn.get("game_session_id") == game_session_id
        if is_already_joined:
            logger.info("Already joined game session", sid=sid, game_session_id=game_session_id)

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

        # セッション情報を取得して初回セッションかチェック
        from sqlmodel import Session as SQLSession
        from sqlmodel import select

        from app.core.database import SessionLocal
        from app.models.character import GameSession
        from app.models.game_message import (
            MESSAGE_TYPE_GM_NARRATIVE,
            MESSAGE_TYPE_SYSTEM_EVENT,
            SENDER_TYPE_GM,
            GameMessage,
        )
        from app.services.first_session_initializer import FirstSessionInitializer
        from app.websocket.events import GameEventEmitter

        db: SQLSession = SessionLocal()
        try:
            # セッション情報を取得
            session = db.exec(select(GameSession).where(GameSession.id == game_session_id)).first()
            if not session:
                await sio.emit("error", {"message": "セッションが見つかりません"}, to=sid)
                return

            logger.info(
                "[FirstSession] Session info",
                session_id=session.id,
                is_first_session=session.is_first_session,
                session_number=session.session_number,
                is_already_joined=is_already_joined
            )

            # 既存メッセージをチェック
            existing_messages = db.exec(
                select(GameMessage)
                .where(GameMessage.session_id == game_session_id)
                .order_by(GameMessage.turn_number)
            ).all()

            logger.info(
                "[FirstSession] Existing messages check",
                message_count=len(existing_messages),
                has_messages=bool(existing_messages)
            )

            # 初回セッションでメッセージがまだない場合のみ初期化を実行（既に参加済みの場合はスキップ）
            if session.is_first_session and not existing_messages and not is_already_joined:
                from app.models.character import Character

                character = db.exec(select(Character).where(Character.id == session.character_id)).first()
                if character:
                    logger.info("[FirstSession] Initializing first session", character_name=character.name)
                    
                    initializer = FirstSessionInitializer(db)

                    # 初期クエストを付与
                    initializer._assign_initial_quests(character)

                    # 導入テキストと選択肢を生成
                    intro_narrative = initializer.generate_introduction(character)
                    initial_choices = initializer.generate_initial_choices()
                    
                    logger.info(
                        "[FirstSession] Generated content",
                        narrative_length=len(intro_narrative),
                        choices_count=len(initial_choices)
                    )

                    # GMナラティブとして保存
                    from app.services.game_session import GameSessionService

                    game_service = GameSessionService(db)
                    saved_message = game_service.save_message(
                        session_id=session.id,
                        message_type=MESSAGE_TYPE_GM_NARRATIVE,
                        sender_type=SENDER_TYPE_GM,
                        content=intro_narrative,
                        turn_number=1,
                        metadata={
                            "is_introduction": True,
                            "choices": initial_choices,
                        },
                    )
                    db.commit()
                    
                    logger.info("[FirstSession] Message saved", message_id=saved_message.id)

                    # message_addedイベントを送信（IDを含む）
                    await GameEventEmitter.emit_custom_event(
                        game_session_id,
                        "message_added",
                        {
                            "message": {
                                "id": saved_message.id,
                                "content": saved_message.content,
                                "message_type": saved_message.message_type,
                                "sender_type": saved_message.sender_type,
                                "turn_number": saved_message.turn_number,
                                "metadata": saved_message.message_metadata,
                                "created_at": saved_message.created_at.isoformat(),
                            },
                            "choices": initial_choices,
                        }
                    )
                    
                    logger.info("[FirstSession] Emitted message_added event")
                    
                    # 初回メッセージを新規として送信（narrative_updateも送る）
                    await GameEventEmitter.emit_narrative_update(
                        game_session_id,
                        intro_narrative,
                        "introduction"
                    )
                    
                    logger.info("[FirstSession] First session initialization completed")
            # 既存メッセージがある場合（初回セッションの新規生成後でない場合）のみ選択肢を送信
            elif existing_messages:
                # 最新の選択肢のみを探す（ナラティブは送信しない）
                latest_choices = None
                
                for message in reversed(existing_messages):
                    if message.message_metadata and "choices" in message.message_metadata:
                        latest_choices = message.message_metadata["choices"]
                        break
                
                # 選択肢のみ送信（ナラティブはフロントエンドのストアから読み込まれる）
                if latest_choices:
                    await GameEventEmitter.emit_custom_event(
                        game_session_id,
                        "choices_update",
                        {
                            "choices": latest_choices,
                            "turn_number": existing_messages[-1].turn_number if existing_messages else 1
                        }
                    )

        finally:
            db.close()

        # 同じゲームセッションの他のユーザーに通知（既に参加済みの場合はスキップ）
        if not is_already_joined:
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

        logger.debug(f"[DEBUG] game_action event received - sid: {sid}, data: {data}")

        if not all([game_session_id, user_id, action]):
            logger.error(f"[ERROR] Missing parameters - game_session_id: {game_session_id}, user_id: {user_id}, action: {action}")
            await sio.emit("error", {"message": "必要なパラメータが不足しています"}, to=sid)
            return

        logger.info("Game action received", game_session_id=game_session_id, user_id=user_id, action=action)

        # アクション受信確認
        await sio.emit(
            "action_received",
            {"message": "アクションを受信しました", "action": action, "timestamp": datetime.utcnow().isoformat()},
            to=sid,
        )

        # ゲームサービスと連携してアクションを処理
        from sqlmodel import Session as SQLSession, select
        from app.core.database import SessionLocal
        from app.models.character import GameSession
        from app.models.game_message import GameMessage
        from app.services.game_session import GameSessionService
        from app.schemas.game_session import ActionExecuteRequest
        from app.websocket.events import GameEventEmitter

        db: SQLSession = SessionLocal()
        try:
            # セッション情報を取得
            session = db.exec(select(GameSession).where(GameSession.id == game_session_id)).first()
            if not session:
                await sio.emit("error", {"message": "セッションが見つかりません"}, to=sid)
                return

            # ゲームサービスを初期化
            game_service = GameSessionService(db, websocket_manager=connection_manager)
            
            # セッションデータをパース
            import json
            session_data = json.loads(session.session_data) if session.session_data else {}
            
            # 最新の選択肢を取得
            last_choices = []
            messages = db.exec(
                select(GameMessage)
                .where(GameMessage.session_id == game_session_id)
                .order_by(GameMessage.turn_number.desc())
            ).all()
            
            for message in messages:
                if message.message_metadata and "choices" in message.message_metadata:
                    last_choices = message.message_metadata["choices"]
                    break
            
            # アクションリクエストを作成
            is_choice = any(choice.get("text") == action for choice in last_choices)
            action_request = ActionExecuteRequest(
                action_text=action,
                action_type="choice" if is_choice else "custom"
            )
            
            # アクションを実行
            logger.debug(f"[DEBUG] Executing action - session_id: {session.id}, action_request: {action_request}")
            result = await game_service.execute_action(session, action_request)
            logger.debug(f"[DEBUG] Action executed successfully - result: {result}")
            
            # 成功レスポンスは GameSessionService 内部で WebSocket 経由で送信される
            # ここでは追加の処理は不要
            
            db.commit()
            
        except Exception as service_error:
            logger.error("Error executing game action", error=str(service_error), game_session_id=game_session_id)
            logger.exception("Full traceback for game action error:")  # スタックトレースも出力
            await sio.emit(
                "error", 
                {
                    "message": "アクション実行中にエラーが発生しました", 
                    "error": str(service_error),
                    "details": str(service_error.__class__.__name__)
                }, 
                to=sid
            )
            db.rollback()
        finally:
            db.close()

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
