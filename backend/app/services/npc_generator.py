"""
ログNPC生成サービス

CompletedLogからNPCエンティティへの変換とNeo4jへの保存を担当
"""

import uuid
from typing import Optional

import structlog
from sqlmodel import Session, select

from app.core.database import get_neo4j_session
from app.db.neo4j_models import NPC, Location, create_npc_from_log
from app.models.log import CompletedLog, CompletedLogStatus
from app.schemas.npc_schemas import NPCProfile
from app.services.ai.agents.npc_manager import NPCManagerAgent

logger = structlog.get_logger(__name__)


class NPCGenerator:
    """ログNPC生成サービス"""

    def __init__(self, session: Session):
        self.session = session
        self._neo4j = None
        self._npc_manager = None

    @property
    def neo4j(self):
        """Neo4jセッションの遅延初期化"""
        if self._neo4j is None:
            self._neo4j = get_neo4j_session()
        return self._neo4j

    @property
    def npc_manager(self):
        """NPCManagerAgentの遅延初期化"""
        if self._npc_manager is None:
            self._npc_manager = NPCManagerAgent()
        return self._npc_manager

    def generate_npc_from_log(
        self,
        completed_log_id: uuid.UUID,
        target_location_name: Optional[str] = None,
    ) -> NPCProfile:
        """
        CompletedLogからNPCを生成

        Args:
            completed_log_id: 変換元のCompletedLogのID
            target_location_name: NPCを配置する場所の名前

        Returns:
            生成されたNPCのプロファイル
        """
        # CompletedLogを取得
        stmt = select(CompletedLog).where(CompletedLog.id == completed_log_id)
        completed_log = self.session.exec(stmt).first()

        if not completed_log:
            raise ValueError(f"CompletedLog not found: {completed_log_id}")

        if completed_log.status != CompletedLogStatus.ACTIVE:
            raise ValueError(f"CompletedLog is not active: {completed_log.status}")

        logger.info("Generating NPC from completed log", log_id=str(completed_log_id), log_name=completed_log.name)

        # 配置場所を決定
        location = None
        if target_location_name:
            location = Location.nodes.get_or_none(name=target_location_name)
            if not location:
                # デフォルトの場所を作成
                location = Location(
                    name=target_location_name,
                    layer=0,  # 第0階層をデフォルトとする
                    description="NPCが配置された場所",
                ).save()

        # Neo4jにNPCノードを作成
        npc_data = {
            "id": completed_log.id,
            "name": completed_log.name,
            "title": completed_log.title,
            "description": completed_log.description,
            "personality_traits": completed_log.personality_traits or [],
            "behavior_patterns": completed_log.behavior_patterns or [],
            "skills": completed_log.skills or [],
            "contamination_level": completed_log.contamination_level,
            "player_id": completed_log.creator_id,
        }

        npc_node = create_npc_from_log(npc_data, location)

        # NPC Manager AIにプロファイルを登録
        npc_profile = NPCProfile(
            npc_id=npc_node.npc_id,
            name=npc_node.name,
            title=npc_node.title,
            personality_traits=npc_node.personality_traits,
            behavior_patterns=npc_node.behavior_patterns,
            skills=npc_node.skills,
            appearance=npc_node.appearance,
            backstory=npc_node.backstory,
            npc_type="LOG_NPC",
            persistence_level=npc_node.persistence_level,
            contamination_level=npc_node.contamination_level,
            original_player=npc_node.original_player,
            log_source=npc_node.log_source,
            current_location=target_location_name,
            is_active=True,
        )

        # NPC Manager AIに登録 (統合版NPCマネージャーでは処理が異なるため、ここではスキップ)
        # TODO: NPCマネージャーの統合版APIに合わせて修正が必要
        logger.info("NPC profile created", npc_profile=npc_profile)

        logger.info(
            "NPC generated successfully", npc_id=npc_node.npc_id, npc_name=npc_node.name, location=target_location_name
        )

        return npc_profile

    def get_npc_by_id(self, npc_id: str) -> Optional[NPC]:
        """NPCをIDで取得"""
        return NPC.nodes.get_or_none(npc_id=npc_id)  # type: ignore[no-any-return]

    def get_npcs_in_location(self, location_name: str) -> list[NPC]:
        """特定の場所にいるNPCを取得"""
        location = Location.nodes.get_or_none(name=location_name)
        if not location:
            return []

        # 現在その場所にいるNPCを取得
        # neomodelでは関係性を通じて直接ノードが返される
        npcs = list(location.npcs.all())

        # アクティブなNPCのみフィルタリング
        active_npcs = [npc for npc in npcs if npc.is_active]

        return active_npcs

    def move_npc(self, npc_id: str, new_location_name: str) -> bool:
        """NPCを別の場所に移動"""
        npc = self.get_npc_by_id(npc_id)
        if not npc:
            return False

        # 新しい場所を取得または作成
        new_location = Location.nodes.get_or_none(name=new_location_name)
        if not new_location:
            new_location = Location(name=new_location_name, layer=0, description="NPCが移動した場所").save()

        # 現在の場所との関係を削除
        npc.current_location.disconnect_all()

        # 新しい場所との関係を作成
        npc.current_location.connect(new_location, {"is_current": True})

        return True
