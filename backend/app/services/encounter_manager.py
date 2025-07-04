"""
遭遇マネージャー
ログとの遭遇をストーリー性のあるイベントに発展させる
"""

import random
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.models import (
    Character,
    DispatchEncounter,
    EncounterChoice,
    EncounterStory,
    EncounterType,
    LogDispatch,
    Quest,
    QuestOrigin,
    QuestStatus,
    RelationshipStatus,
    SharedQuest,
    StoryArcType,
)
from app.services.ai.agents.base import AgentContext
from app.services.gm_ai_service import GMAIService
from app.services.ai.dispatch_interaction import DispatchInteractionManager


class EncounterManager:
    """遭遇イベントを管理し、ストーリーに発展させる"""

    def __init__(self, db: Session):
        self.db = db
        self.gm_ai_service = GMAIService(db)
        self.dispatch_interaction = DispatchInteractionManager()

    async def process_encounter(
        self,
        character: Character,
        encounter_entity_id: str,
        encounter_type: EncounterType,
        context: AgentContext,
    ) -> dict[str, Any]:
        """遭遇を処理し、ストーリーに発展させる"""

        # 既存のストーリーがあるか確認
        existing_story = self._get_existing_story(character.id, encounter_entity_id)

        if existing_story:
            # 既存のストーリーを継続
            return await self._continue_story(existing_story, context)
        else:
            # 新しいストーリーを開始
            return await self._start_new_story(
                character, encounter_entity_id, encounter_type, context
            )

    def _get_existing_story(
        self, character_id: str, encounter_entity_id: str
    ) -> Optional[EncounterStory]:
        """既存のストーリーを取得"""
        stmt = select(EncounterStory).where(
            EncounterStory.character_id == character_id,
            EncounterStory.encounter_entity_id == encounter_entity_id,
            EncounterStory.relationship_status != RelationshipStatus.CONCLUDED,
        )
        return self.db.exec(stmt).first()

    async def _start_new_story(
        self,
        character: Character,
        encounter_entity_id: str,
        encounter_type: EncounterType,
        context: AgentContext,
    ) -> dict[str, Any]:
        """新しいストーリーを開始"""

        # GM評議会でストーリーアークを決定
        story_arc = await self._determine_story_arc(character, encounter_type, context)

        # ストーリーを作成
        story = EncounterStory(
            character_id=character.id,
            encounter_entity_id=encounter_entity_id,
            encounter_type=encounter_type,
            story_arc_type=story_arc["arc_type"],
            title=story_arc["title"],
            total_chapters=story_arc.get("estimated_chapters"),
        )

        # 初回の遭遇イベントを生成
        first_event = await self._generate_first_encounter(
            character, story, context
        )

        # ストーリービートを追加
        story.story_beats.append({
            "chapter": 1,
            "beat": "初めての出会い",
            "description": first_event["description"],
            "timestamp": datetime.utcnow().isoformat(),
            "choices_presented": first_event.get("choices", []),
        })

        # クエストが発生する場合
        if story_arc.get("generates_quest", False):
            quest = await self._create_quest_from_encounter(
                character, story, story_arc, context
            )
            if quest:
                story.active_quest_ids.append(quest.id)

        self.db.add(story)
        self.db.commit()

        return {
            "story_id": story.id,
            "story_arc": story.story_arc_type,
            "title": story.title,
            "first_event": first_event,
            "quest_generated": len(story.active_quest_ids) > 0,
        }

    async def _continue_story(
        self, story: EncounterStory, context: AgentContext
    ) -> dict[str, Any]:
        """既存のストーリーを継続"""

        # 関係性の深化を判定
        relationship_progression = self._calculate_relationship_progression(story)

        # 次のストーリービートを生成
        next_beat = await self._generate_next_beat(story, context)

        # ストーリーの更新
        story.current_chapter = min(story.current_chapter + 1, story.total_chapters or 99)
        story.last_interaction_at = datetime.utcnow()
        story.relationship_depth = min(1.0, story.relationship_depth + relationship_progression)

        # ストーリービートを追加
        story.story_beats.append({
            "chapter": story.current_chapter,
            "beat": next_beat["beat_title"],
            "description": next_beat["description"],
            "timestamp": datetime.utcnow().isoformat(),
            "relationship_change": relationship_progression,
        })

        # 共同クエストの可能性を判定
        if story.relationship_depth > 0.5 and not self._has_active_shared_quest(story):
            shared_quest = await self._propose_shared_quest(story, context)
            if shared_quest:
                story.active_quest_ids.append(shared_quest["quest_id"])

        # 関係性の状態を更新
        story.relationship_status = self._update_relationship_status(story)

        self.db.add(story)
        self.db.commit()

        return {
            "story_id": story.id,
            "chapter": story.current_chapter,
            "beat": next_beat,
            "relationship_depth": story.relationship_depth,
            "relationship_status": story.relationship_status,
            "shared_quest_proposed": "shared_quest" in locals(),
        }

    async def _determine_story_arc(
        self, character: Character, encounter_type: EncounterType, context: AgentContext
    ) -> dict[str, Any]:
        """ストーリーアークを決定"""

        # キャラクターの履歴と性格を考慮
        prompt = f"""
        キャラクター「{character.name}」が{encounter_type}との遭遇を開始します。
        
        キャラクター情報:
        - 性格: {character.personality or "未設定"}
        - 最近の行動: {context.recent_actions[-5:] if context.recent_actions else []}
        
        この遭遇から発展するストーリーアークを提案してください。
        
        利用可能なアークタイプ:
        - QUEST_CHAIN: 連続クエスト
        - RIVALRY: ライバル関係
        - ALLIANCE: 同盟関係
        - MENTORSHIP: 師弟関係
        - ROMANCE: ロマンス
        - MYSTERY: 謎解き
        - CONFLICT: 対立
        - COLLABORATION: 協力関係
        """

        # GM AIサービスで協議
        from app.models import Location
        
        location = self.db.exec(
            select(Location).where(Location.name == context.location)
        ).first()
        
        if location:
            ai_response = await self.gm_ai_service.generate_ai_response(
                prompt,
                agent_type="dramatist",
                character_name=character.name,
                metadata={
                    "encounter_type": encounter_type.value,
                    "location": location.name,
                }
            )
            
            # レスポンスを解析
            council_result = self._parse_story_arc_response(ai_response)
        else:
            council_result = {}

        # デフォルト値を設定
        arc_types = list(StoryArcType)
        selected_arc = council_result.get("arc_type", random.choice(arc_types))
        
        return {
            "arc_type": selected_arc,
            "title": council_result.get("story_title", f"{selected_arc.value}の物語"),
            "estimated_chapters": council_result.get("estimated_chapters", random.randint(3, 7)),
            "generates_quest": council_result.get("generates_quest", True),
        }

    def _parse_story_arc_response(self, ai_response: str) -> dict[str, Any]:
        """AIレスポンスからストーリーアーク情報を解析"""
        import json
        
        result = {}
        
        # StoryArcTypeのマッピング
        arc_type_map = {
            "連続クエスト": StoryArcType.QUEST_CHAIN,
            "ライバル関係": StoryArcType.RIVALRY,
            "同盟関係": StoryArcType.ALLIANCE,
            "師弟関係": StoryArcType.MENTORSHIP,
            "ロマンス": StoryArcType.ROMANCE,
            "謎解き": StoryArcType.MYSTERY,
            "対立": StoryArcType.CONFLICT,
            "協力関係": StoryArcType.COLLABORATION,
        }
        
        # テキストから情報を抽出
        lines = ai_response.strip().split("\n")
        for line in lines:
            # アークタイプの検出
            for jp_name, arc_type in arc_type_map.items():
                if jp_name in line:
                    result["arc_type"] = arc_type
                    break
            
            # タイトルの検出
            if "タイトル:" in line or "物語:" in line:
                result["story_title"] = line.split(":", 1)[1].strip()
            
            # 章数の検出
            if "章" in line and ("予定" in line or "全" in line):
                import re
                numbers = re.findall(r'\d+', line)
                if numbers:
                    result["estimated_chapters"] = int(numbers[0])
            
            # クエスト生成の検出
            if "クエスト" in line and ("発生" in line or "生成" in line):
                result["generates_quest"] = True
        
        return result

    async def _generate_first_encounter(
        self, character: Character, story: EncounterStory, context: AgentContext
    ) -> dict[str, Any]:
        """初回の遭遇イベントを生成"""

        prompt = f"""
        {character.name}が{story.encounter_type}と初めて遭遇します。
        ストーリーアーク: {story.story_arc_type}
        タイトル: {story.title}
        
        印象的で記憶に残る初回の遭遇シーンを生成してください。
        プレイヤーに選択肢を提示し、今後の関係性に影響を与えるようにしてください。
        """

        from app.models import Location
        
        location = self.db.exec(
            select(Location).where(Location.name == context.location)
        ).first()
        
        if location:
            ai_response = await self.gm_ai_service.generate_ai_response(
                prompt,
                agent_type="dramatist",
                character_name=character.name,
                metadata={
                    "story_id": story.id,
                    "encounter_type": story.encounter_type.value,
                }
            )
            result = self._parse_encounter_event_response(ai_response)
        else:
            result = {}

        return {
            "description": result.get("scene_description", "神秘的な存在との遭遇"),
            "choices": result.get("player_choices", [
                {"id": "approach", "text": "慎重に近づく"},
                {"id": "greet", "text": "友好的に挨拶する"},
                {"id": "observe", "text": "距離を置いて観察する"},
            ]),
            "atmosphere": result.get("atmosphere", "mysterious"),
        }

    async def _create_quest_from_encounter(
        self,
        character: Character,
        story: EncounterStory,
        story_arc: dict[str, Any],
        context: AgentContext,
    ) -> Optional[Quest]:
        """遭遇からクエストを生成"""

        from app.models import Location
        
        location = self.db.exec(
            select(Location).where(Location.name == context.location)
        ).first()
        
        quest_prompt = f"""
            ストーリー「{story.title}」から発生するクエストを生成してください。
            ストーリーアーク: {story.story_arc_type}
            キャラクター: {character.name}
            """
        
        if location:
            ai_response = await self.gm_ai_service.generate_ai_response(
                quest_prompt,
                agent_type="state_manager",
                character_name=character.name,
                metadata={
                    "story_id": story.id,
                    "story_arc_type": story.story_arc_type.value,
                }
            )
            quest_proposal = self._parse_quest_proposal_response(ai_response)
        else:
            quest_proposal = {}

        if not quest_proposal.get("quest_title"):
            return None

        quest = Quest(
            character_id=character.id,
            session_id=context.session_id,
            title=quest_proposal["quest_title"],
            description=quest_proposal.get("quest_description", ""),
            status=QuestStatus.PROPOSED,
            origin=QuestOrigin.NPC_GIVEN,
            context_summary=f"ストーリー「{story.title}」から発生",
        )

        self.db.add(quest)
        return quest

    def _calculate_relationship_progression(self, story: EncounterStory) -> float:
        """関係性の進展度を計算"""
        # 基本進展度
        base_progression = 0.1

        # ストーリーアークによる調整
        arc_modifiers = {
            StoryArcType.ROMANCE: 1.5,
            StoryArcType.ALLIANCE: 1.3,
            StoryArcType.MENTORSHIP: 1.2,
            StoryArcType.RIVALRY: 0.8,
            StoryArcType.CONFLICT: 0.5,
        }
        
        modifier = arc_modifiers.get(story.story_arc_type, 1.0)
        
        # 最近の相互作用からの時間経過による減衰
        time_since_last = datetime.utcnow() - story.last_interaction_at
        if time_since_last > timedelta(days=7):
            modifier *= 0.5
        
        return base_progression * modifier

    async def _generate_next_beat(
        self, story: EncounterStory, context: AgentContext
    ) -> dict[str, Any]:
        """次のストーリービートを生成"""

        recent_beats = story.story_beats[-3:] if story.story_beats else []
        
        prompt = f"""
        ストーリー「{story.title}」の次の展開を生成してください。
        
        現在の章: {story.current_chapter}
        関係性の深さ: {story.relationship_depth}
        最近のビート: {recent_beats}
        
        物語を前進させ、関係性を深める展開を作ってください。
        """

        from app.models import Location
        
        location = self.db.exec(
            select(Location).where(Location.name == context.location)
        ).first()
        
        if location:
            ai_response = await self.gm_ai_service.generate_ai_response(
                prompt,
                agent_type="dramatist",
                character_name=context.character_name or "Unknown",
                metadata={
                    "story_id": story.id,
                    "chapter": story.current_chapter,
                }
            )
            result = self._parse_story_beat_response(ai_response)
        else:
            result = {}

        return {
            "beat_title": result.get("beat_title", f"第{story.current_chapter}章"),
            "description": result.get("description", "物語は続く..."),
            "emotional_tone": result.get("emotional_tone", "neutral"),
            "introduces_choice": result.get("introduces_choice", False),
        }

    def _has_active_shared_quest(self, story: EncounterStory) -> bool:
        """アクティブな共同クエストがあるか確認"""
        if not story.active_quest_ids:
            return False
            
        stmt = select(SharedQuest).where(
            SharedQuest.story_id == story.id,
            SharedQuest.completed_at == None
        )
        return self.db.exec(stmt).first() is not None

    async def _propose_shared_quest(
        self, story: EncounterStory, context: AgentContext
    ) -> Optional[dict[str, Any]]:
        """共同クエストを提案"""

        prompt = f"""
        関係性が深まったキャラクターとの共同クエストを提案してください。
        
        ストーリー: {story.title}
        関係性タイプ: {story.story_arc_type}
        関係性の深さ: {story.relationship_depth}
        
        二人で協力して達成する意味のあるクエストを生成してください。
        """

        from app.models import Character, Location
        
        character = self.db.get(Character, story.character_id)
        location = self.db.exec(
            select(Location).where(Location.name == context.location)
        ).first()
        
        if character and location:
            ai_response = await self.gm_ai_service.generate_ai_response(
                prompt,
                agent_type="state_manager",
                character_name=character.name,
                metadata={
                    "story_id": story.id,
                    "relationship_depth": story.relationship_depth,
                }
            )
            proposal = self._parse_shared_quest_proposal_response(ai_response)
        else:
            proposal = {}

        if not proposal.get("quest_title"):
            return None

        # 通常のクエストを作成
        quest = Quest(
            character_id=story.character_id,
            session_id=context.session_id,
            title=proposal["quest_title"],
            description=proposal.get("quest_description", ""),
            status=QuestStatus.PROPOSED,
            origin=QuestOrigin.NPC_GIVEN,
            context_summary=f"共同クエスト - {story.title}",
        )
        self.db.add(quest)
        self.db.flush()

        # 共同クエスト情報を作成
        shared_quest = SharedQuest(
            quest_id=quest.id,
            story_id=story.id,
            participants=[
                {"id": story.character_id, "type": "player", "role": "leader"},
                {"id": story.encounter_entity_id, "type": story.encounter_type, "role": "partner"},
            ],
            leader_id=story.character_id,
            shared_objectives=proposal.get("objectives", []),
        )
        self.db.add(shared_quest)

        return {
            "quest_id": quest.id,
            "shared_quest_id": shared_quest.id,
            "title": quest.title,
            "partner_role": "partner",
        }

    def _update_relationship_status(self, story: EncounterStory) -> RelationshipStatus:
        """関係性の状態を更新"""
        depth = story.relationship_depth
        current_status = story.relationship_status

        # 深さに基づいて状態を決定
        if depth < 0.2:
            return RelationshipStatus.INITIAL
        elif depth < 0.4:
            return RelationshipStatus.DEVELOPING
        elif depth < 0.6:
            return RelationshipStatus.ESTABLISHED
        elif depth < 0.8:
            return RelationshipStatus.DEEPENING
        elif depth >= 0.8:
            # ストーリーが完結に近い場合
            if story.current_chapter >= (story.total_chapters or 99) - 1:
                return RelationshipStatus.TRANSFORMED
            return RelationshipStatus.DEEPENING

        return current_status

    async def process_player_choice(
        self,
        story_id: str,
        session_id: str,
        choice_id: str,
        context: AgentContext,
    ) -> dict[str, Any]:
        """プレイヤーの選択を処理"""

        story = self.db.get(EncounterStory, story_id)
        if not story:
            raise ValueError(f"Story {story_id} not found")

        # 最新のビートから選択肢を取得
        latest_beat = story.story_beats[-1] if story.story_beats else {}
        available_choices = latest_beat.get("choices_presented", [])

        # 選択の妥当性を確認
        valid_choice = next((c for c in available_choices if c["id"] == choice_id), None)
        if not valid_choice:
            raise ValueError(f"Invalid choice {choice_id}")

        # 選択の結果を生成
        from app.models import Character, Location
        
        character = self.db.get(Character, story.character_id)
        location = self.db.exec(
            select(Location).where(Location.name == context.location)
        ).first()
        
        choice_prompt = f"""
            プレイヤーが「{valid_choice['text']}」を選択しました。
            ストーリー: {story.title}
            現在の関係性: {story.relationship_status}
            
            この選択の即座の結果と長期的な影響を生成してください。
            """
        
        if character and location:
            ai_response = await self.gm_ai_service.generate_ai_response(
                choice_prompt,
                agent_type="dramatist",
                character_name=character.name,
                metadata={
                    "story_id": story.id,
                    "choice_id": choice_id,
                }
            )
            choice_result = self._parse_choice_consequence_response(ai_response)
        else:
            choice_result = {}

        # 選択記録を作成
        encounter_choice = EncounterChoice(
            story_id=story_id,
            session_id=session_id,
            situation_context=latest_beat.get("description", ""),
            available_choices=available_choices,
            player_choice=choice_id,
            choice_reasoning=choice_result.get("reasoning", ""),
            immediate_consequence=choice_result.get("immediate_consequence", ""),
            long_term_impact=choice_result.get("long_term_impact", {}),
            relationship_change=choice_result.get("relationship_change", {}),
            decided_at=datetime.utcnow(),
        )

        # 関係性への影響を適用
        relationship_delta = choice_result.get("relationship_change", {})
        story.trust_level = max(0.0, min(1.0, 
            story.trust_level + relationship_delta.get("trust", 0)))
        story.conflict_level = max(0.0, min(1.0,
            story.conflict_level + relationship_delta.get("conflict", 0)))

        self.db.add(encounter_choice)
        self.db.add(story)
        self.db.commit()

        return {
            "choice_id": choice_id,
            "immediate_result": encounter_choice.immediate_consequence,
            "relationship_impact": relationship_delta,
            "story_continues": True,
        }

    def _parse_encounter_event_response(self, ai_response: str) -> dict[str, Any]:
        """遭遇イベントレスポンスを解析"""
        result = {
            "scene_description": ai_response,
            "player_choices": [],
            "atmosphere": "mysterious"
        }
        
        # 選択肢を抽出
        lines = ai_response.strip().split("\n")
        choices = []
        for line in lines:
            if line.strip().startswith(("1.", "2.", "3.", "・")):
                choice_text = line.strip().lstrip("1234567890.・ ")
                choices.append({
                    "id": f"choice_{len(choices)+1}",
                    "text": choice_text
                })
        
        if choices:
            result["player_choices"] = choices
        
        return result

    def _parse_quest_proposal_response(self, ai_response: str) -> dict[str, Any]:
        """クエスト提案レスポンスを解析"""
        result = {}
        lines = ai_response.strip().split("\n")
        
        for line in lines:
            if "タイトル:" in line or "クエスト名:" in line:
                result["quest_title"] = line.split(":", 1)[1].strip()
            elif "説明:" in line or "内容:" in line:
                result["quest_description"] = line.split(":", 1)[1].strip()
        
        return result

    def _parse_story_beat_response(self, ai_response: str) -> dict[str, Any]:
        """ストーリービートレスポンスを解析"""
        result = {
            "beat_title": "次の展開",
            "description": ai_response,
            "emotional_tone": "neutral",
            "introduces_choice": False
        }
        
        lines = ai_response.strip().split("\n")
        for line in lines:
            if "タイトル:" in line or "ビート:" in line:
                result["beat_title"] = line.split(":", 1)[1].strip()
            elif "感情:" in line or "トーン:" in line:
                result["emotional_tone"] = line.split(":", 1)[1].strip()
        
        return result

    def _parse_shared_quest_proposal_response(self, ai_response: str) -> dict[str, Any]:
        """共同クエスト提案レスポンスを解析"""
        result = {}
        lines = ai_response.strip().split("\n")
        
        for line in lines:
            if "タイトル:" in line or "クエスト名:" in line:
                result["quest_title"] = line.split(":", 1)[1].strip()
            elif "説明:" in line or "内容:" in line:
                result["quest_description"] = line.split(":", 1)[1].strip()
            elif "目標:" in line or "目的:" in line:
                # 目標をリストとして解析
                objectives = []
                i = lines.index(line) + 1
                while i < len(lines) and lines[i].strip().startswith(("-", "・", "*")):
                    objectives.append(lines[i].strip().lstrip("-・* "))
                    i += 1
                result["objectives"] = objectives
        
        return result

    def _parse_choice_consequence_response(self, ai_response: str) -> dict[str, Any]:
        """選択結果レスポンスを解析"""
        result = {
            "immediate_consequence": ai_response,
            "reasoning": "",
            "long_term_impact": {},
            "relationship_change": {}
        }
        
        lines = ai_response.strip().split("\n")
        for line in lines:
            if "理由:" in line or "判断:" in line:
                result["reasoning"] = line.split(":", 1)[1].strip()
            elif "信頼度:" in line:
                try:
                    trust_value = float(line.split(":", 1)[1].strip().replace("+", "").replace("-", ""))
                    result["relationship_change"]["trust"] = trust_value
                except ValueError:
                    pass
            elif "対立度:" in line:
                try:
                    conflict_value = float(line.split(":", 1)[1].strip().replace("+", "").replace("-", ""))
                    result["relationship_change"]["conflict"] = conflict_value
                except ValueError:
                    pass
        
        return result