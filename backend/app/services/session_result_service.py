"""
セッションリザルト処理サービス
"""

import asyncio
import logging
from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlmodel import select

from app.ai.coordinator import CoordinatorAI

# from app.services.skill_service import SkillService  # TODO: スキルサービス実装後に有効化
from app.db.neo4j_models import NPC, Location, Player
from app.models.character import Character, CharacterStats, GameSession
from app.models.game_message import GameMessage
from app.models.session_result import SessionResult
from app.schemas.character import Character as CharacterSchema
from app.schemas.character import CharacterStats as CharacterStatsSchema
from app.services.ai.agents.historian import HistorianAgent
from app.services.ai.agents.npc_manager import NPCManagerAgent
from app.services.ai.agents.state_manager import StateManagerAgent
from app.services.ai.prompt_manager import PromptContext
from app.services.story_arc_service import StoryArcService

logger = logging.getLogger(__name__)


class SessionResultService:
    """セッションリザルト処理サービス"""

    def __init__(
        self,
        db_session: AsyncSession,
        historian: HistorianAgent,
        state_manager: StateManagerAgent,
        npc_manager: NPCManagerAgent,
        coordinator: CoordinatorAI,
    ):
        self.db = db_session
        self.historian = historian
        self.state_manager = state_manager
        self.npc_manager = npc_manager
        self.coordinator = coordinator
        # self.skill_service = SkillService(db_session)  # TODO: スキルサービス実装後に有効化
        # SessionResultServiceは非同期セッションを使用しているが、StoryArcServiceは同期セッション用
        # ここでは一時的な対応として、呼び出し時に同期セッションを作成する

    async def process_session_result(self, session_id: str) -> SessionResult:
        """セッションリザルトを処理する"""
        logger.info(f"セッションリザルト処理開始: session_id={session_id}")

        # セッション情報を取得
        session = await self._get_session_with_messages(session_id)
        if not session:
            raise ValueError(f"セッションが見つかりません: {session_id}")

        # キャラクター情報を取得
        character = await self._get_character_with_stats(session.character_id)
        if not character:
            raise ValueError(f"キャラクターが見つかりません: {session.character_id}")

        # メッセージ履歴を取得
        messages = await self._get_session_messages(session_id)

        # プロンプトコンテキストを構築
        context = self._build_prompt_context(session, character, messages)

        # 各AIによる処理
        story_summary, key_events = await self._generate_story_summary(context, messages)
        experience, skills = await self._calculate_growth(context, messages)
        neo4j_updates = await self._update_knowledge_graph(context, messages)
        continuation_context, unresolved_plots = await self._generate_continuation(context, messages)

        # ストーリーアークの進行を評価
        story_arc_progress = await self._evaluate_story_arc_progress(session, character, messages)

        # リザルトを作成
        result = SessionResult(
            id=str(uuid4()),
            session_id=session_id,
            story_summary=story_summary,
            key_events=key_events,
            experience_gained=experience,
            skills_improved=skills,
            items_acquired=[],  # TODO: アイテム獲得システム実装後に対応
            neo4j_updates=neo4j_updates,
            continuation_context=continuation_context,
            unresolved_plots=unresolved_plots,
            story_arc_progress=story_arc_progress,
            created_at=datetime.utcnow(),
        )

        # データベースに保存
        self.db.add(result)
        await self.db.commit()

        logger.info(f"セッションリザルト処理完了: result_id={result.id}")
        return result

    async def _get_session_with_messages(self, session_id: str) -> Optional[GameSession]:
        """セッション情報を取得"""
        result = await self.db.execute(
            select(GameSession).where(GameSession.id == session_id).options(selectinload(GameSession.messages))  # type: ignore
        )
        return result.scalar_one_or_none()

    async def _get_character_with_stats(self, character_id: str) -> Optional[Character]:
        """キャラクター情報を取得"""
        result = await self.db.execute(
            select(Character).where(Character.id == character_id).options(selectinload(Character.stats))  # type: ignore
        )
        return result.scalar_one_or_none()

    async def _get_session_messages(self, session_id: str) -> list[GameMessage]:
        """セッションのメッセージ履歴を取得"""
        result = await self.db.execute(
            select(GameMessage).where(GameMessage.session_id == session_id).order_by(GameMessage.turn_number)  # type: ignore
        )
        return list(result.scalars().all())

    def _build_prompt_context(
        self, session: GameSession, character: Character, messages: list[GameMessage]
    ) -> PromptContext:
        """プロンプトコンテキストを構築"""
        # CharacterStatsから統計情報を取得
        stats = character.stats if character.stats else CharacterStats(character_id=character.id)

        # CharacterStatsスキーマを構築
        stats_schema = CharacterStatsSchema(
            id=stats.id if stats.id else "",
            character_id=stats.character_id,
            level=stats.level,
            experience=stats.experience,
            health=stats.health,
            max_health=stats.max_health,
            mp=stats.mp,
            max_mp=stats.max_mp,
        )

        # CharacterSchemaスキーマを構築
        character_schema = CharacterSchema(
            id=character.id,
            user_id=character.user_id,
            name=character.name,
            description=character.description,
            appearance=character.appearance,
            personality=character.personality,
            location=character.location,
            stats=stats_schema,
            skills=[],  # TODO: スキル情報の追加
            is_active=character.is_active,
            created_at=character.created_at,
            updated_at=character.updated_at,
        )

        # メッセージ履歴をフォーマット
        history = []
        for msg in messages[-20:]:  # 最新20件のメッセージ
            if msg.message_type == "PLAYER_ACTION":
                history.append(f"プレイヤー: {msg.content}")
            elif msg.message_type == "GM_NARRATIVE":
                history.append(f"GM: {msg.content}")

        return PromptContext(
            character_name=character_schema.name,
            character_id=character_schema.id,
            character_stats={
                "level": stats.level,
                "experience": stats.experience,
                "health": stats.health,
                "max_health": stats.max_health,
                "mp": stats.mp,
                "max_mp": stats.max_mp,
                "attack": stats.attack,
                "defense": stats.defense,
                "agility": stats.agility,
            },
            location=character.location,
            recent_actions=history,
            session_id=session.id,
            additional_context={
                "play_duration_minutes": session.play_duration_minutes,
            },
        )

    async def _generate_story_summary(
        self, context: PromptContext, messages: list[GameMessage]
    ) -> tuple[str, list[str]]:
        """ストーリーサマリーを生成"""
        # 歴史家AIによるサマリー生成
        summary = await self.historian.generate_session_summary(context, messages)

        # 重要イベントの抽出
        key_events = await self.historian.extract_key_events(context, messages)

        return summary, key_events

    async def _calculate_growth(
        self, context: PromptContext, messages: list[GameMessage]
    ) -> tuple[int, dict[str, int]]:
        """キャラクター成長を計算"""
        # 状態管理AIによる成長計算
        experience = await self.state_manager.calculate_experience(context, messages)

        # スキル経験値の計算
        skill_improvements = await self.state_manager.calculate_skill_improvements(context, messages)

        return experience, skill_improvements

    async def _update_knowledge_graph(self, context: PromptContext, messages: list[GameMessage]) -> dict:
        """知識グラフを更新"""
        updates: dict[str, Any] = {}

        # NPC管理AIによるNPC関係性の抽出
        npc_updates = await self.npc_manager.update_npc_relationships(context, messages)
        updates["npc_relationships"] = npc_updates

        # Neo4jに実際に書き込み
        try:
            await self._write_to_neo4j(context, npc_updates)
            updates["neo4j_write_status"] = "success"
        except Exception as e:
            logger.error(f"Neo4j書き込みエラー: {e}")
            updates["neo4j_write_status"] = "failed"
            updates["neo4j_error"] = str(e)

        # TODO: 世界の意識AIによる世界状態の更新（WorldConsciousnessAI実装後）
        world_state: dict[str, Any] = {}
        updates["world_state"] = world_state

        return updates

    async def _write_to_neo4j(self, context: PromptContext, npc_updates: dict) -> None:
        """Neo4jに関係性を書き込む"""

        # 同期的なNeo4j操作を非同期で実行
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._write_to_neo4j_sync, context, npc_updates)

    def _write_to_neo4j_sync(self, context: PromptContext, npc_updates: dict) -> None:
        """Neo4jに関係性を書き込む（同期版）"""

        # プレイヤーノードを取得または作成
        player_node = Player.nodes.get_or_none(user_id=context.character_id)
        if not player_node:
            player_node = Player(
                user_id=context.character_id,
                character_name=context.character_name,
                current_session_id=str(context.character_id),  # セッション固有のキャラクターID
            ).save()

        # NPC遭遇情報を処理
        for npc_met in npc_updates.get("npcs_met", []):
            npc_name = npc_met.get("name")
            # location = npc_met.get("location")  # TODO: 将来的に使用予定
            interaction_type = npc_met.get("interaction_type", "dialogue")

            # 関係性情報から感情的影響を推定
            emotional_impact = 0
            for rel in npc_updates.get("relationships", []):
                if rel.get("type") == "friendly":
                    emotional_impact = 1
                elif rel.get("type") == "hostile":
                    emotional_impact = -1
                elif rel.get("type") == "intimate":
                    emotional_impact = 2
                break

            # NPCのIDを生成（名前ベース）
            npc_id = f"npc_{npc_name.replace(' ', '_').lower()}"

            # NPCノードを取得または作成
            npc_node = NPC.nodes.get_or_none(npc_id=npc_id)
            if not npc_node and npc_name:
                # 基本的なNPCノードを作成
                npc_node = NPC(
                    npc_id=npc_id,
                    name=npc_name,
                    title="",
                    npc_type="TEMPORARY_NPC",  # セッション中に出会った一時的なNPC
                    description=f"{npc_name}との遭遇",
                    personality_traits=[],
                    behavior_patterns=[],
                    skills=[],
                    contamination_level=0,
                ).save()

            if npc_node:
                # 既存の関係を確認
                existing_relations = player_node.interactions.all()
                existing_npc_ids = [rel.npc_id for rel in existing_relations]

                if npc_node.npc_id not in existing_npc_ids:
                    # 新しい相互作用関係を作成
                    player_node.interactions.connect(
                        npc_node,
                        {
                            "interaction_type": interaction_type,
                            "emotional_impact": emotional_impact,
                            "last_interaction": datetime.utcnow(),
                            "interaction_count": 1,
                        },
                    )
                else:
                    # 既存の関係を更新
                    rel = player_node.interactions.relationship(npc_node)
                    if rel:
                        rel.interaction_count = (rel.interaction_count or 0) + 1
                        rel.last_interaction = datetime.utcnow()
                        rel.save()

        # 場所情報の更新
        current_location = context.location
        if current_location:
            location_node = Location.nodes.get_or_none(name=current_location)
            if not location_node:
                location_node = Location(
                    name=current_location,
                    layer=0,
                    description=f"{current_location}エリア",
                ).save()

            # プレイヤーの現在位置を更新
            player_node.current_location.disconnect_all()
            player_node.current_location.connect(location_node)

        logger.info(
            f"Neo4j更新完了: player={context.character_name}, npcs_met={len(npc_updates.get('npcs_met', []))}, relationships={len(npc_updates.get('relationships', []))}"
        )

    async def _generate_continuation(
        self, context: PromptContext, messages: list[GameMessage]
    ) -> tuple[str, list[str]]:
        """次回への引き継ぎ情報を生成"""
        # 協調AIによる継続コンテキストの生成
        continuation = await self.coordinator.generate_continuation_context(context, messages)

        # 未解決プロットの抽出
        unresolved = await self.coordinator.extract_unresolved_plots(context, messages)

        return continuation, unresolved

    async def _evaluate_story_arc_progress(
        self, session: GameSession, character: Character, messages: list[GameMessage]
    ) -> dict:
        """ストーリーアークの進行を評価"""
        # 同期的なDBアクセスのため、別スレッドで実行
        from sqlmodel import Session as SyncSession

        from app.core.database import get_session

        progress_info = {}

        # 同期セッションを使用してストーリーアーク処理を実行
        def _update_arc_sync() -> dict[str, Any]:
            db_gen = get_session()
            db: SyncSession = next(db_gen)
            try:
                arc_service = StoryArcService(db)
                active_arc = arc_service.get_active_story_arc(character)

                if active_arc:
                    # キャラクターアクションを抽出
                    character_actions = [msg.content for msg in messages if msg.message_type == "PLAYER_ACTION"][
                        :10
                    ]  # 最新10個まで

                    # アーク情報を辞書形式に変換
                    arc_dict = {
                        "id": active_arc.id,
                        "title": active_arc.title,
                        "progress_percentage": active_arc.progress_percentage,
                        "current_phase": active_arc.current_phase,
                        "total_phases": active_arc.total_phases,
                    }

                    # CoordinatorAIで評価
                    loop = asyncio.new_event_loop()
                    evaluation = loop.run_until_complete(
                        self.coordinator.evaluate_story_arc_progress(messages, arc_dict, character_actions)
                    )

                    # 進行状況を更新
                    updated_arc = arc_service.update_arc_progress(
                        active_arc,
                        progress_delta=evaluation["progress_delta"],
                        phase_completed=evaluation["phase_completed"],
                    )

                    return {
                        "arc_id": updated_arc.id,
                        "arc_title": updated_arc.title,
                        "new_progress": updated_arc.progress_percentage,
                        "phase": f"{updated_arc.current_phase}/{updated_arc.total_phases}",
                        "status": updated_arc.status,
                        "evaluation": evaluation,
                    }

                return {"status": "no_active_arc"}

            finally:
                db_gen.close()

        # 非同期で同期処理を実行
        loop = asyncio.get_event_loop()
        progress_info = await loop.run_in_executor(None, _update_arc_sync)

        return progress_info
