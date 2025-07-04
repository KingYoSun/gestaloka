"""
ストーリー進行管理システム
遭遇から発展したストーリーの進行を管理し、世界に影響を与える
"""

from datetime import datetime, timedelta
from typing import Any, Optional

from sqlmodel import Session, select

from app.models import (
    Character,
    EncounterChoice,
    EncounterStory,
    Quest,
    QuestStatus,
    RelationshipStatus,
    SharedQuest,
    StoryArcType,
)
from app.services.ai.agents.base import AgentContext
from app.services.ai.agents.the_world import TheWorldAI
from app.services.gm_ai_service import GMAIService


class StoryProgressionManager:
    """ストーリーの進行を管理し、世界への影響を処理"""

    def __init__(self, db: Session):
        self.db = db
        self.gm_ai_service = GMAIService(db)
        self.world_ai = TheWorldAI()

    async def check_story_progression(self, character_id: str) -> list[dict[str, Any]]:
        """
        キャラクターの全てのアクティブなストーリーをチェック

        Args:
            character_id: キャラクターID

        Returns:
            進行が必要なストーリーのリスト
        """
        # アクティブなストーリーを取得
        stmt = select(EncounterStory).where(
            EncounterStory.character_id == character_id,
            EncounterStory.relationship_status != RelationshipStatus.CONCLUDED,
        )

        stories = self.db.exec(stmt).all()

        stories_to_progress: list[dict[str, Any]] = []

        for story in stories:
            # 進行条件をチェック
            if self._should_progress_story(story):
                stories_to_progress.append(
                    {
                        "story_id": story.id,
                        "title": story.title,
                        "current_chapter": story.current_chapter,
                        "relationship_depth": story.relationship_depth,
                        "last_interaction": story.last_interaction_at,
                        "urgency": self._calculate_urgency(story),
                    }
                )

        # 緊急度でソート
        stories_to_progress.sort(key=lambda x: float(x["urgency"]), reverse=True)

        return stories_to_progress

    def _should_progress_story(self, story: EncounterStory) -> bool:
        """ストーリーが進行すべきかを判定"""
        # 最後の相互作用からの経過時間
        time_since_last = datetime.utcnow() - story.last_interaction_at

        # ストーリーアークタイプによる進行頻度
        progression_intervals = {
            StoryArcType.QUEST_CHAIN: timedelta(hours=2),
            StoryArcType.RIVALRY: timedelta(hours=6),
            StoryArcType.ALLIANCE: timedelta(hours=4),
            StoryArcType.MENTORSHIP: timedelta(days=1),
            StoryArcType.ROMANCE: timedelta(hours=12),
            StoryArcType.MYSTERY: timedelta(hours=3),
            StoryArcType.CONFLICT: timedelta(hours=1),
            StoryArcType.COLLABORATION: timedelta(hours=4),
        }

        required_interval = progression_intervals.get(story.story_arc_type, timedelta(hours=6))

        return time_since_last >= required_interval

    def _calculate_urgency(self, story: EncounterStory) -> float:
        """ストーリーの緊急度を計算"""
        base_urgency = 0.5

        # 時間経過による増加
        time_since_last = datetime.utcnow() - story.last_interaction_at
        time_factor = min(1.0, time_since_last.total_seconds() / (24 * 3600))

        # ストーリータイプによる重み
        type_weights = {
            StoryArcType.CONFLICT: 2.0,
            StoryArcType.QUEST_CHAIN: 1.5,
            StoryArcType.MYSTERY: 1.3,
            StoryArcType.RIVALRY: 1.2,
        }

        type_weight = type_weights.get(story.story_arc_type, 1.0)

        # 物語の緊張度
        tension_factor = story.narrative_tension

        # 完了に近いストーリーは優先
        completion_factor = 1.0
        if story.total_chapters:
            progress = story.current_chapter / story.total_chapters
            if progress > 0.7:
                completion_factor = 1.5

        return base_urgency * time_factor * type_weight * tension_factor * completion_factor

    async def progress_story(
        self,
        story_id: str,
        context: AgentContext,
        player_action: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        ストーリーを進行させる

        Args:
            story_id: ストーリーID
            context: エージェントコンテキスト
            player_action: プレイヤーの最新アクション

        Returns:
            進行結果
        """
        story = self.db.get(EncounterStory, story_id)
        if not story:
            raise ValueError(f"Story {story_id} not found")

        # ストーリーの現在の状態を分析
        analysis = await self._analyze_story_state(story, context)

        # 次の展開を決定
        next_development = await self._determine_next_development(story, analysis, player_action, context)

        # ストーリーを更新
        self._update_story(story, next_development)

        # 世界への影響を処理
        if next_development.get("world_impact"):
            await self._apply_world_impact(story, next_development["world_impact"], context)

        # 関連クエストの更新
        if story.active_quest_ids:
            await self._update_related_quests(story, next_development, context)

        self.db.add(story)
        self.db.commit()

        return {
            "story_id": story_id,
            "development": next_development,
            "new_chapter": story.current_chapter,
            "relationship_status": story.relationship_status,
            "world_impact_applied": bool(next_development.get("world_impact")),
        }

    async def _analyze_story_state(self, story: EncounterStory, context: AgentContext) -> dict[str, Any]:
        """ストーリーの現在の状態を分析"""
        # 最近の選択を取得
        from sqlmodel import desc

        from app.models import EncounterChoice

        stmt = (
            select(EncounterChoice)
            .where(EncounterChoice.story_id == story.id)
            .order_by(desc(EncounterChoice.presented_at))
            .limit(5)
        )

        recent_choices = self.db.exec(stmt).all()

        # プレイヤーの傾向を分析
        choice_patterns = self._analyze_choice_patterns(list(recent_choices))

        # 関係性の変化を追跡
        relationship_trajectory = self._calculate_relationship_trajectory(story)

        return {
            "recent_choices": recent_choices,
            "choice_patterns": choice_patterns,
            "relationship_trajectory": relationship_trajectory,
            "story_momentum": story.story_momentum,
            "pending_threads": story.pending_plot_threads,
            "emotional_state": {
                "tension": story.narrative_tension,
                "resonance": story.emotional_resonance,
            },
        }

    def _analyze_choice_patterns(self, choices: list[EncounterChoice]) -> dict[str, Any]:
        """プレイヤーの選択パターンを分析"""
        if not choices:
            return {"tendency": "neutral", "consistency": 0.0}

        # 選択の傾向を集計
        tendencies = {
            "aggressive": 0,
            "diplomatic": 0,
            "cautious": 0,
            "curious": 0,
        }

        for choice in choices:
            # 選択IDから傾向を推測（実際の実装では選択のメタデータを使用）
            if choice.player_choice:
                if "attack" in choice.player_choice or "fight" in choice.player_choice:
                    tendencies["aggressive"] += 1
                elif "talk" in choice.player_choice or "negotiate" in choice.player_choice:
                    tendencies["diplomatic"] += 1
                elif "hide" in choice.player_choice or "avoid" in choice.player_choice:
                    tendencies["cautious"] += 1
                elif "investigate" in choice.player_choice or "explore" in choice.player_choice:
                    tendencies["curious"] += 1

        # 最も多い傾向を特定
        dominant_tendency = max(tendencies.items(), key=lambda x: x[1])

        # 一貫性を計算
        total_choices = sum(tendencies.values())
        consistency = dominant_tendency[1] / total_choices if total_choices > 0 else 0.0

        return {
            "tendency": dominant_tendency[0],
            "consistency": consistency,
            "all_tendencies": tendencies,
        }

    def _calculate_relationship_trajectory(self, story: EncounterStory) -> str:
        """関係性の軌跡を計算"""
        # ストーリービートから関係性の変化を追跡
        if len(story.story_beats) < 2:
            return "stable"

        recent_beats = story.story_beats[-3:]
        trust_changes = []

        for beat in recent_beats:
            if "relationship_change" in beat:
                trust_changes.append(beat["relationship_change"])

        if not trust_changes:
            return "stable"

        # 平均変化を計算
        avg_change = sum(trust_changes) / len(trust_changes)

        if avg_change > 0.1:
            return "improving"
        elif avg_change < -0.1:
            return "deteriorating"
        else:
            return "stable"

    def _parse_story_development_response(self, ai_response: str) -> dict[str, Any]:
        """AIレスポンスからストーリー展開情報を解析"""
        import json

        # デフォルト値
        result: dict[str, Any] = {
            "beat_title": "新たな展開",
            "description": ai_response,
            "choices": [],
            "world_impact": None,
            "relationship_change": {},
            "new_plot_threads": [],
            "emotional_shift": {},
        }

        # JSONブロックを探す
        try:
            json_start = ai_response.find("{")
            json_end = ai_response.rfind("}")
            if json_start != -1 and json_end != -1:
                json_str = ai_response[json_start : json_end + 1]
                parsed = json.loads(json_str)
                result.update(parsed)
        except json.JSONDecodeError:
            # JSONパースに失敗した場合は、テキストから情報を抽出
            lines = ai_response.strip().split("\n")
            for line in lines:
                if "タイトル:" in line or "章:" in line:
                    result["beat_title"] = line.split(":", 1)[1].strip()
                elif "説明:" in line or "描写:" in line:
                    result["description"] = line.split(":", 1)[1].strip()

        return result

    async def _determine_next_development(
        self,
        story: EncounterStory,
        analysis: dict[str, Any],
        player_action: Optional[str],
        context: AgentContext,
    ) -> dict[str, Any]:
        """次の展開を決定"""
        prompt = f"""
        ストーリー「{story.title}」の次の展開を決定してください。

        現在の状況:
        - 章: {story.current_chapter}/{story.total_chapters or '?'}
        - 関係性: {story.relationship_status} (深さ: {story.relationship_depth})
        - プレイヤーの傾向: {analysis['choice_patterns']['tendency']}
        - 関係性の軌跡: {analysis['relationship_trajectory']}
        - 未解決のプロット: {story.pending_plot_threads}

        最新のプレイヤーアクション: {player_action or 'なし'}

        以下を決定してください:
        1. 次のストーリービート
        2. 提示する選択肢
        3. 世界への影響
        4. 関係性の変化
        5. 新しいプロットスレッド
        """

        # GM AIサービスを使用してストーリー展開を決定
        from app.models import Location

        character = self.db.get(Character, context.character_id)
        location = self.db.exec(select(Location).where(Location.name == context.location)).first()

        if not character or not location:
            # デフォルトの展開を返す
            result: dict[str, Any] = {
                "beat_title": f"第{story.current_chapter + 1}章",
                "description": "物語は続く...",
                "choices": [],
                "world_impact": None,
                "relationship_change": {},
                "new_plot_threads": [],
                "emotional_shift": {},
            }
        else:
            # AI応答を生成
            ai_response = await self.gm_ai_service.generate_ai_response(
                prompt,
                agent_type="dramatist",
                character_name=character.name,
                metadata={
                    "story_id": story.id,
                    "chapter": story.current_chapter,
                    "relationship_status": story.relationship_status,
                },
            )

            # レスポンスを解析
            result = self._parse_story_development_response(ai_response)

        return {
            "beat_title": result.get("beat_title", f"第{story.current_chapter + 1}章"),
            "description": result.get("description", "物語は続く..."),
            "choices": result.get("choices", []),
            "world_impact": result.get("world_impact"),
            "relationship_change": result.get("relationship_change", {}),
            "new_plot_threads": result.get("new_plot_threads", []),
            "emotional_shift": result.get("emotional_shift", {}),
        }

    def _update_story(self, story: EncounterStory, development: dict[str, Any]) -> dict[str, Any]:
        """ストーリーを更新"""
        # 章を進める
        story.current_chapter += 1
        story.last_interaction_at = datetime.utcnow()

        # ストーリービートを追加
        new_beat = {
            "chapter": story.current_chapter,
            "beat": development["beat_title"],
            "description": development["description"],
            "timestamp": datetime.utcnow().isoformat(),
            "choices_presented": development.get("choices", []),
        }
        story.story_beats.append(new_beat)

        # 関係性を更新
        rel_change = development.get("relationship_change", {})
        if rel_change:
            story.trust_level = max(0.0, min(1.0, story.trust_level + rel_change.get("trust", 0)))
            story.conflict_level = max(0.0, min(1.0, story.conflict_level + rel_change.get("conflict", 0)))
            story.relationship_depth = max(0.0, min(1.0, story.relationship_depth + rel_change.get("depth", 0.05)))

        # 感情的な状態を更新
        emotional_shift = development.get("emotional_shift", {})
        if emotional_shift:
            story.narrative_tension = max(0.0, min(1.0, story.narrative_tension + emotional_shift.get("tension", 0)))
            story.emotional_resonance = max(
                0.0, min(1.0, story.emotional_resonance + emotional_shift.get("resonance", 0))
            )

        # プロットスレッドを更新
        if development.get("new_plot_threads"):
            story.pending_plot_threads.extend(development["new_plot_threads"])

        # 解決されたプロットスレッドを削除
        resolved_threads = development.get("resolved_threads", [])
        story.pending_plot_threads = [thread for thread in story.pending_plot_threads if thread not in resolved_threads]

        # 関係性の状態を再評価
        story.relationship_status = self._evaluate_relationship_status(story)

        # 次の重要なビートの予想時期を設定
        story.next_expected_beat = datetime.utcnow() + timedelta(hours=self._calculate_next_beat_interval(story))

        return {
            "new_beat": new_beat,
            "relationship_updated": bool(rel_change),
            "emotional_shift_applied": bool(emotional_shift),
        }

    def _evaluate_relationship_status(self, story: EncounterStory) -> RelationshipStatus:
        """関係性の状態を評価"""
        depth = story.relationship_depth
        chapters = story.current_chapter
        total_chapters = story.total_chapters or 99

        # 深さと進行度から状態を決定
        if depth < 0.2:
            return RelationshipStatus.INITIAL
        elif depth < 0.4:
            return RelationshipStatus.DEVELOPING
        elif depth < 0.6:
            return RelationshipStatus.ESTABLISHED
        elif depth < 0.8:
            return RelationshipStatus.DEEPENING
        elif depth >= 0.8:
            if chapters >= total_chapters - 1:
                return RelationshipStatus.CONCLUDED
            else:
                return RelationshipStatus.TRANSFORMED

        return story.relationship_status

    def _calculate_next_beat_interval(self, story: EncounterStory) -> float:
        """次のビートまでの間隔を計算（時間）"""
        base_intervals = {
            StoryArcType.CONFLICT: 1.0,
            StoryArcType.QUEST_CHAIN: 2.0,
            StoryArcType.MYSTERY: 3.0,
            StoryArcType.RIVALRY: 4.0,
            StoryArcType.ALLIANCE: 6.0,
            StoryArcType.COLLABORATION: 6.0,
            StoryArcType.ROMANCE: 12.0,
            StoryArcType.MENTORSHIP: 24.0,
        }

        base = base_intervals.get(story.story_arc_type, 6.0)

        # 緊張度による調整
        tension_modifier = 2.0 - story.narrative_tension  # 高い緊張度ほど短い間隔

        # 関係性の深さによる調整
        depth_modifier = 1.0 + (story.relationship_depth * 0.5)  # 深い関係ほど長い間隔

        return base * tension_modifier * depth_modifier

    async def _apply_world_impact(
        self,
        story: EncounterStory,
        impact: dict[str, Any],
        context: AgentContext,
    ) -> None:
        """世界への影響を適用"""
        # 世界の意識AIに影響を通知
        from app.services.ai.prompt_manager import PromptContext

        # AgentContextをPromptContextに変換
        prompt_context = PromptContext(
            session_id=context.session_id or "",
            character_id=context.character_id or "",
            character_name=context.character_name or "",
            location=context.location,
            world_state=context.world_state,
            recent_actions=context.recent_actions,
            session_history=[],
            character_stats={},
            inventory=[],
            available_actions=[],
            custom_prompt="",
            additional_context=context.additional_context,
        )

        await self.world_ai.apply_story_impact(
            story_id=story.id,
            impact_data=impact,
            context=prompt_context,
        )

        # ストーリーの影響記録を更新
        if not story.world_impact:
            story.world_impact = {}

        story.world_impact[datetime.utcnow().isoformat()] = impact

    async def _update_related_quests(
        self,
        story: EncounterStory,
        development: dict[str, Any],
        context: AgentContext,
    ) -> None:
        """関連するクエストを更新"""
        for quest_id in story.active_quest_ids:
            quest = self.db.get(Quest, quest_id)
            if not quest:
                continue

            # クエストの進行度を更新
            if development.get("quest_progress"):
                quest.progress_percentage = min(100.0, quest.progress_percentage + development["quest_progress"])

            # クエストの完了判定
            if quest.progress_percentage >= 100.0:
                quest.status = QuestStatus.COMPLETED
                quest.completed_at = datetime.utcnow()
                story.completed_quest_ids.append(quest_id)
                story.active_quest_ids.remove(quest_id)

            self.db.add(quest)

    async def handle_shared_quest_sync(
        self,
        shared_quest_id: str,
        participant_actions: list[dict[str, Any]],
        context: AgentContext,
    ) -> dict[str, Any]:
        """
        共同クエストの同期を処理

        Args:
            shared_quest_id: 共同クエストID
            participant_actions: 参加者のアクション
            context: コンテキスト

        Returns:
            同期結果
        """
        shared_quest = self.db.get(SharedQuest, shared_quest_id)
        if not shared_quest:
            raise ValueError(f"SharedQuest {shared_quest_id} not found")

        # 参加者の貢献度を更新
        for action in participant_actions:
            participant_id = action["participant_id"]
            contribution = action.get("contribution", 0.1)

            if participant_id not in shared_quest.contribution_balance:
                shared_quest.contribution_balance[participant_id] = 0.0

            shared_quest.contribution_balance[participant_id] += contribution

        # 協力度を計算
        total_contribution = sum(shared_quest.contribution_balance.values())
        if total_contribution > 0:
            # 貢献度のバランスから協力度を計算
            contributions = list(shared_quest.contribution_balance.values())
            avg_contribution = total_contribution / len(contributions)
            variance = sum((c - avg_contribution) ** 2 for c in contributions) / len(contributions)

            # 分散が小さいほど協力度が高い
            shared_quest.cooperation_level = max(0.0, min(1.0, 1.0 - (variance**0.5)))

        # 同期アクションを記録
        sync_action = {
            "timestamp": datetime.utcnow().isoformat(),
            "participants": [a["participant_id"] for a in participant_actions],
            "actions": participant_actions,
            "cooperation_level": shared_quest.cooperation_level,
        }
        shared_quest.synchronized_actions.append(sync_action)

        shared_quest.last_sync_at = datetime.utcnow()

        self.db.add(shared_quest)
        self.db.commit()

        return {
            "shared_quest_id": shared_quest_id,
            "sync_successful": True,
            "cooperation_level": shared_quest.cooperation_level,
            "contribution_balance": shared_quest.contribution_balance,
        }
