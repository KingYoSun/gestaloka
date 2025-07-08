"""
セッションリザルト処理サービス
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlmodel import select

from app.ai.coordinator import CoordinatorAI
from app.models.character import Character, CharacterStats, GameSession
from app.models.game_message import GameMessage
from app.models.session_result import SessionResult
from app.schemas.character import Character as CharacterSchema
from app.services.ai.prompt_manager import PromptContext
from app.services.ai.agents.historian import HistorianAgent
from app.services.ai.agents.npc_manager import NPCManagerAgent
from app.services.ai.agents.state_manager import StateManagerAgent
from app.services.skill_service import SkillService

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
        self.skill_service = SkillService(db_session)

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
            select(GameSession)
            .where(GameSession.id == session_id)
            .options(selectinload(GameSession.messages))
        )
        return result.scalar_one_or_none()

    async def _get_character_with_stats(self, character_id: str) -> Optional[Character]:
        """キャラクター情報を取得"""
        result = await self.db.execute(
            select(Character)
            .where(Character.id == character_id)
            .options(selectinload(Character.stats))
        )
        return result.scalar_one_or_none()

    async def _get_session_messages(self, session_id: str) -> list[GameMessage]:
        """セッションのメッセージ履歴を取得"""
        result = await self.db.execute(
            select(GameMessage)
            .where(GameMessage.session_id == session_id)
            .order_by(GameMessage.turn_number)
        )
        return result.scalars().all()

    def _build_prompt_context(
        self, session: GameSession, character: Character, messages: list[GameMessage]
    ) -> PromptContext:
        """プロンプトコンテキストを構築"""
        # CharacterStatsから統計情報を取得
        stats = character.stats if character.stats else CharacterStats(character_id=character.id)

        # CharacterSchemaスキーマを構築
        character_schema = CharacterSchema(
            id=character.id,
            user_id=character.user_id,
            name=character.name,
            origin=character.origin,
            appearance=character.appearance,
            personality=character.personality,
            stats={
                "hp": stats.hp,
                "mp": stats.mp,
                "strength": stats.strength,
                "intelligence": stats.intelligence,
                "agility": stats.agility,
                "defense": stats.defense,
                "wisdom": stats.wisdom,
                "magic_power": stats.magic_power,
                "charisma": stats.charisma,
                "luck": stats.luck,
            },
            skills={},  # TODO: スキル情報の追加
            level=character.level,
            experience=character.experience,
            game_money=character.game_money,
            premium_currency=character.premium_currency,
            creation_finished=character.creation_finished,
            current_location=character.current_location,
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
            character=character_schema,
            current_session=session.session_data or {},
            conversation_history=history,
            location=character.current_location,
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

    async def _update_knowledge_graph(
        self, context: PromptContext, messages: list[GameMessage]
    ) -> dict:
        """知識グラフを更新"""
        updates = {}

        # NPC管理AIによるNPC関係性の更新
        npc_updates = await self.npc_manager.update_npc_relationships(context, messages)
        updates["npc_relationships"] = npc_updates

        # TODO: 世界の意識AIによる世界状態の更新（WorldConsciousnessAI実装後）
        updates["world_state"] = {}

        return updates

    async def _generate_continuation(
        self, context: PromptContext, messages: list[GameMessage]
    ) -> tuple[str, list[str]]:
        """次回への引き継ぎ情報を生成"""
        # 協調AIによる継続コンテキストの生成
        continuation = await self.coordinator.generate_continuation_context(context, messages)

        # 未解決プロットの抽出
        unresolved = await self.coordinator.extract_unresolved_plots(context, messages)

        return continuation, unresolved
