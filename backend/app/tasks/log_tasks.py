"""
ログ関連タスク
"""

import asyncio
import uuid
from datetime import datetime

from sqlmodel import Session

from app.celery import celery_app
from app.core.database import engine
from app.core.logging import get_logger
from app.services.npc_generator import NPCGenerator

logger = get_logger(__name__)


@celery_app.task(bind=True)
def process_player_log(self, character_id: str, action_data: dict):
    """プレイヤーの行動ログを処理"""
    try:
        logger.info("Processing player log", task_id=self.request.id, character_id=character_id)

        # TODO: ログフラグメントの生成と保存
        log_fragment = {
            "character_id": character_id,
            "timestamp": datetime.utcnow().isoformat(),
            "action": action_data.get("action"),
            "context": action_data.get("context", {}),
            "importance": calculate_log_importance(action_data),
            "tags": extract_log_tags(action_data),
        }

        # TODO: Neo4jへの関係性データ保存

        logger.info(
            "Player log processed",
            task_id=self.request.id,
            character_id=character_id,
            fragment_id=log_fragment.get("id"),
        )

        return log_fragment

    except Exception as e:
        logger.error("Failed to process player log", task_id=self.request.id, character_id=character_id, error=str(e))
        raise


@celery_app.task(bind=True)
def compile_log_fragments(self, character_id: str, fragment_ids: list[str]):
    """ログフラグメントを編纂してログを作成"""
    try:
        logger.info(
            "Compiling log fragments",
            task_id=self.request.id,
            character_id=character_id,
            fragments_count=len(fragment_ids),
        )

        # TODO: フラグメントを取得して編纂
        compiled_log = {
            "character_id": character_id,
            "fragment_ids": fragment_ids,
            "compiled_at": datetime.utcnow().isoformat(),
            "title": "編纂されたログ",
            "summary": "フラグメントから生成されたログの要約",
            "quality": "normal",
            "contamination_level": 0,
        }

        logger.info("Log fragments compiled", task_id=self.request.id, character_id=character_id)

        return compiled_log

    except Exception as e:
        logger.error(
            "Failed to compile log fragments", task_id=self.request.id, character_id=character_id, error=str(e)
        )
        raise


@celery_app.task(bind=True)
def distribute_log_to_worlds(self, log_id: str, target_world_ids: list[str]):
    """ログを他の世界に配布"""
    try:
        logger.info(
            "Distributing log to worlds", task_id=self.request.id, log_id=log_id, worlds_count=len(target_world_ids)
        )

        # TODO: ログNPCの生成と配置
        distribution_results = []
        for world_id in target_world_ids:
            result = {
                "world_id": world_id,
                "log_id": log_id,
                "npc_id": f"npc_{log_id}_{world_id}",
                "placement_location": "initial_location",
                "status": "distributed",
            }
            distribution_results.append(result)

        logger.info(
            "Log distributed successfully",
            task_id=self.request.id,
            log_id=log_id,
            distributions=len(distribution_results),
        )

        return distribution_results

    except Exception as e:
        logger.error("Failed to distribute log", task_id=self.request.id, log_id=log_id, error=str(e))
        raise


@celery_app.task(bind=True)
def process_accepted_contracts(self):
    """受け入れられたログ契約を処理してNPCを生成"""
    try:
        logger.info("Processing accepted log contracts", task_id=self.request.id)

        # 同期コンテキストで非同期関数を実行
        with Session(engine) as session:
            npc_generator = NPCGenerator(session)

            # asyncioを使って非同期メソッドを実行
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(npc_generator.process_accepted_contracts())
            finally:
                loop.close()

        logger.info("Accepted contracts processed successfully", task_id=self.request.id)

    except Exception as e:
        logger.error("Failed to process accepted contracts", task_id=self.request.id, error=str(e))
        raise


@celery_app.task(bind=True)
def generate_npc_from_completed_log(self, completed_log_id: str, location: str = "共通広場"):
    """CompletedLogから直接NPCを生成"""
    try:
        logger.info(
            "Generating NPC from completed log", task_id=self.request.id, log_id=completed_log_id, location=location
        )

        with Session(engine) as session:
            npc_generator = NPCGenerator(session)

            # 同期メソッドを直接呼び出し
            npc_profile = npc_generator.generate_npc_from_log(
                completed_log_id=uuid.UUID(completed_log_id), target_location_name=location
            )

        logger.info(
            "NPC generated successfully", task_id=self.request.id, npc_id=npc_profile.npc_id, npc_name=npc_profile.name
        )

        return {
            "npc_id": npc_profile.npc_id,
            "name": npc_profile.name,
            "location": npc_profile.current_location,
        }

    except Exception as e:
        logger.error("Failed to generate NPC from log", task_id=self.request.id, log_id=completed_log_id, error=str(e))
        raise


@celery_app.task(bind=True)
def purify_contaminated_log(self, log_id: str, purification_method: str):
    """汚染されたログを浄化"""
    try:
        logger.info("Purifying contaminated log", task_id=self.request.id, log_id=log_id, method=purification_method)

        # TODO: ログ浄化プロセスの実装
        purification_result = {
            "log_id": log_id,
            "original_contamination": 75,
            "final_contamination": 15,
            "method_used": purification_method,
            "success": True,
            "side_effects": [],
        }

        logger.info("Log purified successfully", task_id=self.request.id, log_id=log_id, contamination_reduced=60)

        return purification_result

    except Exception as e:
        logger.error("Failed to purify log", task_id=self.request.id, log_id=log_id, error=str(e))
        raise


def calculate_log_importance(action_data: dict) -> int:
    """行動の重要度を計算"""
    # TODO: 実際の重要度計算ロジック
    base_importance = 50

    # 戦闘行動は重要度高
    if "combat" in action_data.get("tags", []):
        base_importance += 20

    # 重要NPCとの交流は重要度高
    if action_data.get("target_type") == "important_npc":
        base_importance += 30

    # 世界イベントへの参加は重要度高
    if action_data.get("event_type") == "world_event":
        base_importance += 25

    return min(base_importance, 100)


def extract_log_tags(action_data: dict) -> list[str]:
    """行動データからタグを抽出"""
    tags = []

    # アクションタイプからタグ生成
    action_type = action_data.get("action_type", "")
    if action_type:
        tags.append(action_type)

    # 場所情報からタグ生成
    location = action_data.get("location", "")
    if location:
        tags.append(f"location:{location}")

    # 対象からタグ生成
    target = action_data.get("target", "")
    if target:
        tags.append(f"target:{target}")

    # 感情からタグ生成
    emotion = action_data.get("emotion", "")
    if emotion:
        tags.append(f"emotion:{emotion}")

    return tags
