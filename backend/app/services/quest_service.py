"""
動的クエストサービス
"""

import json
from datetime import datetime
from typing import Optional

from sqlmodel import Session, and_, desc, select

from app.core.logging import get_logger
from app.models.log import ActionLog
from app.models.quest import Quest, QuestOrigin, QuestProposal, QuestStatus
from app.services.gm_ai_service import GMAIService
from app.services.log_fragment_service import LogFragmentService

logger = get_logger(__name__)


class QuestService:
    """動的クエストの管理サービス"""

    def __init__(self, db: Session):
        self.db = db
        self.gm_ai_service = GMAIService(db)
        self.log_fragment_service = LogFragmentService(db)

    async def analyze_and_propose_quests(
        self, character_id: str, session_id: str, recent_actions_count: int = 10
    ) -> list[QuestProposal]:
        """
        最近の行動を分析してクエストを提案する

        Args:
            character_id: キャラクターID
            session_id: 現在のセッションID
            recent_actions_count: 分析する直近の行動数

        Returns:
            提案されたクエストのリスト
        """
        try:
            # 最近の行動履歴を取得
            recent_actions = self.db.exec(
                select(ActionLog)
                .where(ActionLog.character_id == character_id)
                .order_by(desc(ActionLog.created_at))
                .limit(recent_actions_count)
            ).all()

            if not recent_actions:
                logger.info(f"No recent actions for character {character_id}")
                return []

            # 現在のアクティブなクエストを取得
            active_quests = self.db.exec(
                select(Quest).where(
                    and_(
                        Quest.character_id == character_id,
                        Quest.status.in_([QuestStatus.ACTIVE, QuestStatus.PROGRESSING]),  # type: ignore
                    )
                )
            ).all()

            # GM AIに分析を依頼
            action_summaries = [
                {
                    "action": action.action_type,
                    "description": action.action_content,
                    "result": action.response_content,
                    "timestamp": action.created_at.isoformat(),
                }
                for action in reversed(recent_actions)
            ]

            active_quest_summaries = [
                {"title": quest.title, "description": quest.description, "progress": quest.progress_percentage}
                for quest in active_quests
            ]

            # AIプロンプトの構築
            prompt = f"""
最近のプレイヤー行動を分析し、自然な流れで生まれるクエストを提案してください。

最近の行動履歴:
{json.dumps(action_summaries, ensure_ascii=False, indent=2)}

現在進行中のクエスト:
{json.dumps(active_quest_summaries, ensure_ascii=False, indent=2)}

以下の点を考慮してください：
1. プレイヤーの行動パターンから読み取れる興味や目的
2. 物語の自然な流れ
3. 既存のクエストとの関連性や発展性
4. プレイヤーが暗黙的に追求している目標

1-3個の自然なクエストを提案してください。
各クエストには以下を含めてください：
- title: 簡潔なタイトル
- description: 詳細な説明
- reasoning: なぜこのクエストが自然に生まれるか
- difficulty_estimate: 0-1の難易度
- relevance_score: 現在の文脈との関連性（0-1）
- suggested_rewards: 完了時の報酬案

JSON形式で回答してください。
"""

            # AI応答を取得
            response = await self.gm_ai_service.generate_narrative(  # type: ignore
                prompt=prompt, context_type="quest_proposal"
            )

            # レスポンスをパース
            try:
                proposals_data = json.loads(response)
                if not isinstance(proposals_data, list):
                    proposals_data = [proposals_data]

                proposals = []
                for prop_data in proposals_data:
                    proposal = QuestProposal(
                        title=prop_data.get("title", ""),
                        description=prop_data.get("description", ""),
                        reasoning=prop_data.get("reasoning", ""),
                        difficulty_estimate=float(prop_data.get("difficulty_estimate", 0.5)),
                        relevance_score=float(prop_data.get("relevance_score", 0.5)),
                        suggested_rewards=prop_data.get("suggested_rewards", []),
                    )
                    proposals.append(proposal)

                return proposals

            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse AI response: {e}")
                return []

        except Exception as e:
            logger.error(f"Error analyzing and proposing quests: {e}")
            return []

    def create_quest(
        self,
        character_id: str,
        title: str,
        description: str,
        origin: QuestOrigin,
        session_id: Optional[str] = None,
        context_summary: Optional[str] = None,
    ) -> Quest:
        """
        新しいクエストを作成する

        Args:
            character_id: キャラクターID
            title: クエストタイトル
            description: クエストの説明
            origin: クエストの発生源
            session_id: セッションID（オプション）
            context_summary: コンテキストサマリー（オプション）

        Returns:
            作成されたクエスト
        """
        quest = Quest(
            character_id=character_id,
            session_id=session_id,
            title=title,
            description=description,
            origin=origin,
            context_summary=context_summary,
        )

        self.db.add(quest)
        self.db.commit()
        self.db.refresh(quest)

        logger.info(f"Created quest {quest.id} for character {character_id}")
        return quest

    def accept_quest(self, quest_id: str) -> Optional[Quest]:
        """
        提案されたクエストを受諾する

        Args:
            quest_id: クエストID

        Returns:
            更新されたクエスト
        """
        quest = self.db.get(Quest, quest_id)
        if not quest:
            return None

        if quest.status != QuestStatus.PROPOSED:
            logger.warning(f"Quest {quest_id} is not in PROPOSED status")
            return None

        quest.status = QuestStatus.ACTIVE
        quest.started_at = datetime.utcnow()

        self.db.add(quest)
        self.db.commit()
        self.db.refresh(quest)

        logger.info(f"Quest {quest_id} accepted")
        return quest

    async def update_quest_progress(
        self, quest_id: str, character_id: str, recent_action: Optional[ActionLog] = None
    ) -> Optional[Quest]:
        """
        クエストの進行状況を更新する

        Args:
            quest_id: クエストID
            character_id: キャラクターID
            recent_action: 最近の行動（オプション）

        Returns:
            更新されたクエスト
        """
        quest = self.db.get(Quest, quest_id)
        if not quest or quest.character_id != character_id:
            return None

        if quest.status not in [QuestStatus.ACTIVE, QuestStatus.PROGRESSING]:
            return None

        # 関連するイベントを追加
        if recent_action:
            event = {
                "timestamp": datetime.utcnow().isoformat(),
                "action_id": recent_action.id,
                "description": recent_action.response_content,
                "importance": 0.5,  # AIで後で評価
            }
            quest.key_events.append(event)

        # GM AIに進行状況の評価を依頼
        prompt = f"""
以下のクエストの進行状況を評価してください。

クエスト情報:
- タイトル: {quest.title}
- 説明: {quest.description}
- 現在の進行度: {quest.progress_percentage}%

関連イベント:
{json.dumps(quest.key_events[-5:], ensure_ascii=False, indent=2)}

以下を評価してください：
1. progress_percentage: 新しい進行度（0-100）
2. narrative_completeness: 物語的完結度（0-1）
3. emotional_satisfaction: 感情的満足度（0-1）
4. status: 現在の状態（active/progressing/near_completion/completed）
5. summary: 現在の状況サマリー

JSON形式で回答してください。
"""

        response = await self.gm_ai_service.generate_narrative(  # type: ignore
            prompt=prompt, context_type="quest_progress"
        )

        try:
            progress_data = json.loads(response)

            # 進行状況を更新
            quest.progress_percentage = float(progress_data.get("progress_percentage", quest.progress_percentage))
            quest.narrative_completeness = float(
                progress_data.get("narrative_completeness", quest.narrative_completeness)
            )
            quest.emotional_satisfaction = float(
                progress_data.get("emotional_satisfaction", quest.emotional_satisfaction)
            )
            quest.last_progress_at = datetime.utcnow()

            # ステータスの更新
            new_status = progress_data.get("status")
            if new_status and new_status in [s.value for s in QuestStatus]:
                quest.status = QuestStatus(new_status)

            # 完了判定
            if quest.status == QuestStatus.COMPLETED:
                await self._complete_quest(quest)

            self.db.add(quest)
            self.db.commit()
            self.db.refresh(quest)

            return quest

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response: {e}")
            return quest

    async def _complete_quest(self, quest: Quest):
        """
        クエスト完了時の処理

        Args:
            quest: 完了したクエスト
        """
        quest.completed_at = datetime.utcnow()

        # 物語のサマライズを生成
        prompt = f"""
以下のクエストが完了しました。物語をサマライズしてください。

クエスト: {quest.title}
説明: {quest.description}

関連イベント:
{json.dumps(quest.key_events, ensure_ascii=False, indent=2)}

以下を含めてサマライズしてください：
1. main_theme: 中心的なテーマ
2. story_summary: 200-300文字の物語サマリー
3. emotional_keywords: 感情的なキーワード（3-5個）
4. uniqueness_score: 物語の独自性（0-1）
5. difficulty_score: 実際の困難さ（0-1）

JSON形式で回答してください。
"""

        response = await self.gm_ai_service.generate_narrative(  # type: ignore
            prompt=prompt, context_type="quest_completion"
        )

        try:
            completion_data = json.loads(response)
            quest.completion_summary = completion_data.get("story_summary", "")

            # 記憶フラグメントを生成
            await self.log_fragment_service.generate_quest_memory(
                character_id=quest.character_id,
                quest=quest,
                theme=completion_data.get("main_theme", ""),
                summary=completion_data.get("story_summary", ""),
                emotional_keywords=completion_data.get("emotional_keywords", []),
                uniqueness_score=float(completion_data.get("uniqueness_score", 0.5)),
                difficulty_score=float(completion_data.get("difficulty_score", 0.5)),
            )

            logger.info(f"Quest {quest.id} completed and memory fragment generated")

        except Exception as e:
            logger.error(f"Error completing quest: {e}")

    def get_character_quests(
        self, character_id: str, status: Optional[QuestStatus] = None, limit: int = 20, offset: int = 0
    ) -> list[Quest]:
        """
        キャラクターのクエストを取得する

        Args:
            character_id: キャラクターID
            status: フィルタリングするステータス（オプション）
            limit: 取得数制限
            offset: オフセット

        Returns:
            クエストのリスト
        """
        query = select(Quest).where(Quest.character_id == character_id)

        if status:
            query = query.where(Quest.status == status)

        query = query.order_by(Quest.last_progress_at.desc()).limit(limit).offset(offset)  # type: ignore

        return list(self.db.exec(query).all())

    async def infer_implicit_quest(self, character_id: str, session_id: str) -> Optional[Quest]:
        """
        プレイヤーの行動から暗黙的なクエストを推測する

        Args:
            character_id: キャラクターID
            session_id: セッションID

        Returns:
            推測されたクエスト（作成された場合）
        """
        # 最近の行動を分析
        recent_actions = self.db.exec(
            select(ActionLog)
            .where(and_(ActionLog.character_id == character_id, ActionLog.session_id == session_id))
            .order_by(desc(ActionLog.created_at))
            .limit(20)
        ).all()

        if len(recent_actions) < 5:
            return None  # 十分な行動データがない

        # パターン分析
        action_patterns: dict[str, int] = {}
        for action in recent_actions:
            action_type = action.action_type
            if action_type in action_patterns:
                action_patterns[action_type] += 1
            else:
                action_patterns[action_type] = 1

        # 特定のパターンが見られる場合、暗黙的クエストを生成
        dominant_pattern = max(action_patterns.items(), key=lambda x: x[1])

        if dominant_pattern[1] >= 3:  # 同じ種類の行動が3回以上
            # GM AIに暗黙的クエストの生成を依頼
            prompt = f"""
プレイヤーの行動パターンから、暗黙的に追求している目標を推測してください。

行動パターン:
{json.dumps(action_patterns, ensure_ascii=False)}

最近の行動:
{[{"action": a.action_type, "description": a.action_content} for a in recent_actions[:5]]}

プレイヤーが明示的に宣言していないが、行動から読み取れる目標を1つ提案してください。

以下の形式で回答してください：
- title: 推測される目標
- description: 詳細な説明
- confidence: 推測の確信度（0-1）

JSON形式で回答してください。
"""

            response = await self.gm_ai_service.generate_narrative(  # type: ignore
                prompt=prompt, context_type="implicit_quest"
            )

            try:
                quest_data = json.loads(response)
                confidence = float(quest_data.get("confidence", 0))

                if confidence >= 0.7:  # 高い確信度の場合のみ
                    quest = self.create_quest(
                        character_id=character_id,
                        title=quest_data.get("title", ""),
                        description=quest_data.get("description", ""),
                        origin=QuestOrigin.BEHAVIOR_INFERRED,
                        session_id=session_id,
                        context_summary=f"行動パターンから推測: {dominant_pattern[0]}が{dominant_pattern[1]}回",
                    )

                    # 自動的にアクティブ化
                    quest.status = QuestStatus.ACTIVE
                    quest.started_at = datetime.utcnow()

                    self.db.add(quest)
                    self.db.commit()
                    self.db.refresh(quest)

                    return quest

            except Exception as e:
                logger.error(f"Error creating implicit quest: {e}")

        return None
