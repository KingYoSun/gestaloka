"""
セッションリザルト処理のCeleryタスク
"""

import logging
from contextlib import asynccontextmanager

import redis.asyncio as redis

from app.ai.coordinator import CoordinatorAI
from app.celery import celery_app
from app.core.config import settings
from app.core.database import SessionLocal, get_neo4j_session
from app.services.ai.agents.historian import HistorianAgent
from app.services.ai.agents.npc_manager import NPCManagerAgent
from app.services.ai.agents.state_manager import StateManagerAgent
from app.services.ai.gemini_factory import get_gemini_client
from app.services.session_result_service import SessionResultService

logger = logging.getLogger(__name__)


@asynccontextmanager
async def get_ai_agents():
    """AIエージェントを取得"""
    # Redis接続
    redis_client = await redis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=True,
    )

    # Geminiクライアント
    gemini = get_gemini_client()

    try:
        historian = HistorianAgent(gemini)
        state_manager = StateManagerAgent(redis_client)
        npc_manager = NPCManagerAgent(get_neo4j_session(), gemini)
        coordinator = CoordinatorAI(
            gemini=gemini,
            historian=historian,
            state_manager=state_manager,
            npc_manager=npc_manager,
        )

        yield {
            "historian": historian,
            "state_manager": state_manager,
            "npc_manager": npc_manager,
            "coordinator": coordinator,
        }
    finally:
        if hasattr(redis_client, "aclose"):
            await redis_client.aclose()


@celery_app.task(name="process_session_result")
def process_session_result(session_id: str) -> dict:
    """セッションリザルトを非同期で処理する"""
    import asyncio

    async def _process():
        with SessionLocal() as db:
            async with get_ai_agents() as agents:
                service = SessionResultService(
                    db_session=db,
                    historian=agents["historian"],
                    state_manager=agents["state_manager"],
                    npc_manager=agents["npc_manager"],
                    coordinator=agents["coordinator"],
                )

                try:
                    result = await service.process_session_result(session_id)
                    logger.info(f"セッションリザルト処理完了: session_id={session_id}, result_id={result.id}")

                    # WebSocketで完了通知を送信
                    await _send_result_ready_notification(session_id, result.id)

                    return {
                        "status": "success",
                        "session_id": session_id,
                        "result_id": result.id,
                    }
                except Exception as e:
                    logger.error(f"セッションリザルト処理エラー: session_id={session_id}, error={e}")
                    return {
                        "status": "error",
                        "session_id": session_id,
                        "error": str(e),
                    }

    # 非同期関数を実行
    return asyncio.run(_process())


async def _send_result_ready_notification(session_id: str, result_id: str):
    """WebSocketで結果準備完了を通知"""
    # TODO: WebSocketManagerの実装後に有効化
    # from app.core.websocket_manager import WebSocketManager
    #
    # manager = WebSocketManager()
    #
    # # セッションに関連するキャラクターIDを取得
    # with SessionLocal() as db:
    #     from sqlmodel import select
    #
    #     from app.models.character import GameSession
    #
    #     result = db.exec(
    #         select(GameSession.character_id).where(GameSession.id == session_id)
    #     )
    #     character_id = result.first()
    #
    #     if character_id:
    #         # WebSocketイベントを送信
    #         await manager.send_to_character(
    #             character_id,
    #             {
    #                 "type": "session:result_ready",
    #                 "data": {
    #                     "sessionId": session_id,
    #                     "resultId": result_id,
    #                 },
    #             },
    #         )
    pass


# Celeryワーカー起動時にタスクを登録
__all__ = ["process_session_result"]
