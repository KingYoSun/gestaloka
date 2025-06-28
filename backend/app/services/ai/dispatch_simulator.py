"""
派遣ログ活動シミュレーターAI

派遣されたログの活動をAI駆動でシミュレートし、
豊かな物語と意味のある成果を生成します。
"""

import random
from datetime import datetime
from typing import Any, Optional

import structlog
from pydantic import BaseModel, Field

from app.models.log import CompletedLog
from app.models.log_dispatch import (
    DispatchEncounter,
    DispatchObjectiveType,
    LogDispatch,
)
from app.services.ai.agents.dramatist import DramatistAgent
from app.services.ai.agents.npc_manager import NPCManagerAgent
from app.services.ai.prompt_manager import PromptContext

logger = structlog.get_logger(__name__)


class ActivityContext(BaseModel):
    """活動シミュレーションのコンテキスト"""

    dispatch: LogDispatch
    completed_log: CompletedLog
    current_location: str
    elapsed_hours: int
    previous_activities: list[dict[str, Any]]
    world_state: dict[str, Any]
    encounter_potential: float = Field(ge=0.0, le=1.0)


class SimulatedActivity(BaseModel):
    """シミュレートされた活動"""

    timestamp: datetime
    location: str
    action: str
    result: str
    narrative: str
    success_level: float = Field(ge=0.0, le=1.0)
    discovered_location: Optional[str] = None
    collected_item: Optional[dict[str, Any]] = None
    encounter: Optional[DispatchEncounter] = None
    experience_gained: dict[str, Any] = Field(default_factory=dict)
    relationship_changes: list[dict[str, Any]] = Field(default_factory=list)


class DispatchSimulator:
    """
    派遣ログの活動をシミュレートするAI駆動システム
    """

    def __init__(self):
        """シミュレーターの初期化"""
        self.dramatist = DramatistAgent()
        self.npc_manager = NPCManagerAgent()
        self.logger = logger

    async def simulate_activity(
        self,
        dispatch: LogDispatch,
        completed_log: CompletedLog,
        db: Any,
    ) -> SimulatedActivity:
        """
        AI駆動で派遣ログの活動をシミュレート

        Args:
            dispatch: 派遣記録
            completed_log: 完成ログ
            db: データベースセッション

        Returns:
            シミュレートされた活動
        """
        # 活動コンテキストの構築
        context = self._build_activity_context(dispatch, completed_log)

        # 目的タイプに応じた活動生成
        if dispatch.objective_type == DispatchObjectiveType.EXPLORE:
            activity = await self._simulate_exploration(context, db)
        elif dispatch.objective_type == DispatchObjectiveType.INTERACT:
            activity = await self._simulate_interaction(context, db)
        elif dispatch.objective_type == DispatchObjectiveType.COLLECT:
            activity = await self._simulate_collection(context, db)
        elif dispatch.objective_type == DispatchObjectiveType.GUARD:
            activity = await self._simulate_guarding(context, db)
        elif dispatch.objective_type == DispatchObjectiveType.TRADE:
            activity = await self._simulate_trading(context, db)
        elif dispatch.objective_type == DispatchObjectiveType.MEMORY_PRESERVE:
            activity = await self._simulate_memory_preservation(context, db)
        elif dispatch.objective_type == DispatchObjectiveType.RESEARCH:
            activity = await self._simulate_research(context, db)
        else:  # FREE
            activity = await self._simulate_free_activity(context, db)

        # ログの性格を反映した調整
        activity = self._apply_personality_modifiers(activity, completed_log)

        return activity

    def _build_activity_context(
        self,
        dispatch: LogDispatch,
        completed_log: CompletedLog,
    ) -> ActivityContext:
        """活動コンテキストを構築"""
        # 経過時間の計算
        elapsed_hours = int(
            (datetime.utcnow() - dispatch.dispatched_at).total_seconds() / 3600
        )

        # 遭遇可能性の計算（時間経過と目的による）
        base_encounter_rate = 0.3
        if dispatch.objective_type == DispatchObjectiveType.INTERACT:
            base_encounter_rate = 0.7
        elif dispatch.objective_type == DispatchObjectiveType.GUARD:
            base_encounter_rate = 0.1

        encounter_potential = min(1.0, base_encounter_rate + (elapsed_hours * 0.02))

        return ActivityContext(
            dispatch=dispatch,
            completed_log=completed_log,
            current_location=self._determine_current_location(dispatch, elapsed_hours),
            elapsed_hours=elapsed_hours,
            previous_activities=dispatch.travel_log[-5:] if dispatch.travel_log else [],
            world_state=self._get_world_state(dispatch),
            encounter_potential=encounter_potential,
        )

    async def _simulate_exploration(
        self,
        context: ActivityContext,
        db: Any,
    ) -> SimulatedActivity:
        """探索活動のシミュレーション"""
        # AIプロンプトコンテキストの構築
        prompt_context = PromptContext(
            character_name=context.completed_log.name,
            action=f"探索中（{context.elapsed_hours}時間経過）",
            location=context.current_location,
            recent_actions=[
                f"{activity.get('action', '')} - {activity.get('result', '')}"
                for activity in context.previous_activities
            ],
            world_state=context.world_state,
            additional_context={
                "objective": "新しい場所の発見と地図作成",
                "personality": context.completed_log.personality,
                "contamination_level": context.completed_log.contamination_level,
                "discovered_so_far": context.dispatch.discovered_locations,
            },
        )

        # 脚本家AIによる物語生成
        response = await self.dramatist.process(
            prompt_context,
            narrative_style="exploration_report",
        )

        # 発見判定
        discovery_chance = 0.3 + (context.completed_log.contamination_level * 0.1)
        discovered_location = None

        if random.random() < discovery_chance:
            # 新しい場所の発見
            discovered_location = await self._generate_unique_location(
                context,
                prompt_context,
            )

        # 活動結果の構築
        activity = SimulatedActivity(
            timestamp=datetime.utcnow(),
            location=context.current_location,
            action="周辺地域の詳細な調査",
            result=(
                f"{discovered_location}を発見した"
                if discovered_location
                else "既知の地域の詳細な地図を作成した"
            ),
            narrative=response.narrative or "探索は続く...",
            success_level=0.8 if discovered_location else 0.5,
            discovered_location=discovered_location,
            experience_gained={
                "exploration": 10 + (20 if discovered_location else 0),
                "mapping": 5,
            },
        )

        return activity

    async def _simulate_interaction(
        self,
        context: ActivityContext,
        db: Any,
    ) -> SimulatedActivity:
        """交流活動のシミュレーション"""
        # 遭遇判定
        if random.random() < context.encounter_potential:
            # NPCとの遭遇を生成
            encounter = await self._create_ai_driven_encounter(context, db)

            if encounter:
                # 遭遇した場合の活動
                activity = SimulatedActivity(
                    timestamp=datetime.utcnow(),
                    location=context.current_location,
                    action=f"{encounter.encountered_npc_name}との出会い",
                    result=encounter.interaction_summary,
                    narrative=await self._generate_encounter_narrative(
                        context,
                        encounter,
                    ),
                    success_level=0.7 + (0.3 if encounter.outcome == "friendly" else 0),
                    encounter=encounter,
                    experience_gained={
                        "social": 15,
                        "diplomacy": 10 if encounter.outcome == "friendly" else 5,
                    },
                    relationship_changes=[
                        {
                            "target": encounter.encountered_npc_name,
                            "change": encounter.relationship_change,
                            "new_status": self._determine_relationship_status(
                                encounter.relationship_change
                            ),
                        }
                    ],
                )
            else:
                # 遭遇なしの場合
                activity = await self._generate_no_encounter_activity(context)
        else:
            # 遭遇なしの場合
            activity = await self._generate_no_encounter_activity(context)

        return activity

    async def _simulate_collection(
        self,
        context: ActivityContext,
        db: Any,
    ) -> SimulatedActivity:
        """収集活動のシミュレーション"""
        # ログの特性に基づく収集成功率
        base_success_rate = 0.25
        skill_bonus = 0.1 if "収集" in context.completed_log.skills else 0
        contamination_bonus = context.completed_log.contamination_level * 0.15

        success_rate = min(0.7, base_success_rate + skill_bonus + contamination_bonus)

        collected_item = None
        if random.random() < success_rate:
            # アイテム収集成功
            collected_item = await self._generate_contextual_item(context)

        activity = SimulatedActivity(
            timestamp=datetime.utcnow(),
            location=context.current_location,
            action="貴重な資源の探索",
            result=(
                f"{collected_item['name']}を発見した"
                if collected_item
                else "有用なものは見つからなかった"
            ),
            narrative=await self._generate_collection_narrative(
                context,
                collected_item,
            ),
            success_level=0.8 if collected_item else 0.3,
            collected_item=collected_item,
            experience_gained={
                "collection": 10 + (15 if collected_item else 0),
                "perception": 5,
            },
        )

        return activity

    async def _simulate_guarding(
        self,
        context: ActivityContext,
        db: Any,
    ) -> SimulatedActivity:
        """守護活動のシミュレーション"""
        # 脅威遭遇率（時間経過で増加）
        threat_chance = 0.1 + (context.elapsed_hours * 0.01)
        threat_encountered = random.random() < threat_chance

        if threat_encountered:
            # 脅威への対処
            success_level = 0.7 + (random.random() * 0.3)
            action = "侵入者を発見し対処"
            result = "脅威を無事に退けた" if success_level > 0.5 else "苦戦しながらも任務を遂行"
        else:
            # 平穏な守護
            success_level = 0.9
            action = "指定区域の巡回と監視"
            result = "異常なし、区域は安全に保たれている"

        activity = SimulatedActivity(
            timestamp=datetime.utcnow(),
            location=context.current_location,
            action=action,
            result=result,
            narrative=await self._generate_guard_narrative(
                context,
                threat_encountered,
                success_level,
            ),
            success_level=success_level,
            experience_gained={
                "vigilance": 10,
                "combat": 20 if threat_encountered else 5,
                "endurance": 5,
            },
        )

        return activity

    async def _simulate_trading(
        self,
        context: ActivityContext,
        db: Any,
    ) -> SimulatedActivity:
        """商業活動のシミュレーション"""
        # 取引の成功度（ログの性格による）
        base_profit_rate = 0.3
        if "商才" in context.completed_log.skills:
            base_profit_rate += 0.2

        # 市場状況の反映
        market_modifier = random.uniform(0.8, 1.2)
        final_profit_rate = base_profit_rate * market_modifier

        # 取引詳細の生成
        trade_value = random.randint(100, 1000)
        profit = int(trade_value * final_profit_rate)

        activity = SimulatedActivity(
            timestamp=datetime.utcnow(),
            location=context.current_location,
            action="商取引の実施",
            result=f"{profit}ゴールドの利益を獲得",
            narrative=await self._generate_trade_narrative(
                context,
                trade_value,
                profit,
            ),
            success_level=min(1.0, final_profit_rate),
            experience_gained={
                "trade": 15,
                "negotiation": 10,
                "market_knowledge": 5,
            },
        )

        # 経済詳細を派遣記録に追加
        if "economic_details" not in context.dispatch.objective_details:
            context.dispatch.objective_details["economic_details"] = {
                "transactions": [],
                "total_profit": 0,
            }

        context.dispatch.objective_details["economic_details"]["transactions"].append(
            {
                "timestamp": activity.timestamp.isoformat(),
                "value": trade_value,
                "profit": profit,
                "location": context.current_location,
            }
        )
        context.dispatch.objective_details["economic_details"]["total_profit"] += profit

        return activity

    async def _simulate_memory_preservation(
        self,
        context: ActivityContext,
        db: Any,
    ) -> SimulatedActivity:
        """記憶保存活動のシミュレーション"""
        # 記憶収集の成功率
        base_success_rate = 0.6
        if context.completed_log.contamination_level > 0.7:
            # 高汚染度は記憶との親和性が高い
            base_success_rate += 0.2

        memories_found = random.randint(3, 10)
        memories_preserved = int(memories_found * random.uniform(0.5, 0.9))

        activity = SimulatedActivity(
            timestamp=datetime.utcnow(),
            location=context.current_location,
            action="失われた記憶の収集と保存",
            result=f"{memories_found}個の記憶を発見、{memories_preserved}個を保存",
            narrative=await self._generate_memory_narrative(
                context,
                memories_found,
                memories_preserved,
            ),
            success_level=memories_preserved / memories_found if memories_found > 0 else 0,
            experience_gained={
                "memory_work": 20,
                "preservation": 15,
                "empathy": 10,
            },
        )

        # 記憶保存詳細を更新
        if "memory_details" not in context.dispatch.objective_details:
            context.dispatch.objective_details["memory_details"] = {
                "total_found": 0,
                "total_preserved": 0,
                "notable_memories": [],
            }

        context.dispatch.objective_details["memory_details"]["total_found"] += memories_found
        context.dispatch.objective_details["memory_details"]["total_preserved"] += memories_preserved

        return activity

    async def _simulate_research(
        self,
        context: ActivityContext,
        db: Any,
    ) -> SimulatedActivity:
        """研究活動のシミュレーション"""
        # 研究進捗の計算
        base_progress = 0.1
        if "学者" in context.completed_log.skills:
            base_progress += 0.05

        progress = random.uniform(base_progress, base_progress + 0.1)

        activity = SimulatedActivity(
            timestamp=datetime.utcnow(),
            location=context.current_location,
            action="古代の遺物や現象の研究",
            result=f"研究が{progress * 100:.1f}%進展",
            narrative=await self._generate_research_narrative(
                context,
                progress,
            ),
            success_level=progress * 5,  # 研究は着実な進歩が重要
            experience_gained={
                "research": 25,
                "analysis": 15,
                "knowledge": 20,
            },
        )

        # 研究詳細を更新
        if "research_details" not in context.dispatch.objective_details:
            context.dispatch.objective_details["research_details"] = {
                "total_progress": 0,
                "discoveries": [],
            }

        context.dispatch.objective_details["research_details"]["total_progress"] += progress

        return activity

    async def _simulate_free_activity(
        self,
        context: ActivityContext,
        db: Any,
    ) -> SimulatedActivity:
        """自由活動のシミュレーション"""
        # ログの性格に基づいて活動を選択
        personality = context.completed_log.personality

        # AIによる創造的な活動生成
        prompt_context = PromptContext(
            character_name=context.completed_log.name,
            action="自由に行動中",
            location=context.current_location,
            recent_actions=[],
            world_state=context.world_state,
            additional_context={
                "personality": personality,
                "skills": context.completed_log.skills,
                "contamination_level": context.completed_log.contamination_level,
                "instruction": "このキャラクターの性格とスキルに基づいて、創造的で個性的な活動を生成してください",
            },
        )

        response = await self.dramatist.process(
            prompt_context,
            narrative_style="free_activity",
        )

        # 活動タイプの決定
        activity_types = self._determine_free_activity_types(personality)
        chosen_type = random.choice(activity_types)

        activity = SimulatedActivity(
            timestamp=datetime.utcnow(),
            location=context.current_location,
            action=chosen_type["action"],
            result=chosen_type["result"],
            narrative=response.narrative or chosen_type["default_narrative"],
            success_level=random.uniform(0.6, 0.9),
            experience_gained=chosen_type["experience"],
        )

        return activity

    def _determine_free_activity_types(
        self,
        personality: str,
    ) -> list[dict[str, Any]]:
        """性格に基づく自由活動タイプを決定"""
        base_activities = [
            {
                "action": "周辺地域の散策",
                "result": "心地よい時間を過ごした",
                "default_narrative": "のんびりと歩きながら、世界の美しさを再発見した。",
                "experience": {"exploration": 5, "peace": 10},
            },
            {
                "action": "戦闘技術の鍛錬",
                "result": "技術が向上した",
                "default_narrative": "汗を流しながら、己の限界に挑戦した。",
                "experience": {"combat": 15, "endurance": 10},
            },
        ]

        # 性格による追加活動
        if "慈悲深い" in personality or "親切" in personality:
            base_activities.append({
                "action": "困っている人々への援助",
                "result": "感謝の言葉を受けた",
                "default_narrative": "小さな親切が、誰かの一日を明るくした。",
                "experience": {"kindness": 20, "social": 10},
            })

        if "学究的" in personality or "知的" in personality:
            base_activities.append({
                "action": "古文書の解読と研究",
                "result": "新たな知識を得た",
                "default_narrative": "知識の探求は、終わりなき旅である。",
                "experience": {"research": 15, "wisdom": 15},
            })

        if "冒険好き" in personality:
            base_activities.append({
                "action": "危険な場所への挑戦",
                "result": "スリルを味わった",
                "default_narrative": "危険と隣り合わせの瞬間こそ、生きている実感。",
                "experience": {"courage": 20, "exploration": 15},
            })

        return base_activities

    async def _create_ai_driven_encounter(
        self,
        context: ActivityContext,
        db: Any,
    ) -> Optional[DispatchEncounter]:
        """AI駆動の遭遇を作成"""
        # NPC管理AIに遭遇NPCの生成を依頼
        # npc_context = PromptContext(
        #     character_name=context.completed_log.name,
        #     location=context.current_location,
        #     recent_actions=[],
        #     world_state=context.world_state,
        #     additional_context={
        #         "encounter_type": "dispatch_log_encounter",
        #         "dispatch_objective": context.dispatch.objective_type.value,
        #         "log_personality": context.completed_log.personality,
        #     },
        # )

        # 遭遇タイプの決定
        encounter_types = self._determine_encounter_type(context)
        chosen_type = random.choice(encounter_types)

        # NPCの生成または選択
        npc_name = await self._generate_encounter_npc_name(context, chosen_type)

        # 相互作用の結果を決定
        interaction_result = await self._simulate_encounter_interaction(
            context,
            npc_name,
            chosen_type,
        )

        # 遭遇記録の作成
        encounter = DispatchEncounter(
            dispatch_id=context.dispatch.id,
            encountered_npc_name=npc_name,
            location=context.current_location,
            interaction_type=chosen_type,
            interaction_summary=interaction_result["summary"],
            outcome=interaction_result["outcome"],
            relationship_change=interaction_result["relationship_change"],
            items_exchanged=interaction_result.get("items_exchanged", []),
            occurred_at=datetime.utcnow(),
        )

        db.add(encounter)
        db.commit()

        return encounter

    def _determine_encounter_type(
        self,
        context: ActivityContext,
    ) -> list[str]:
        """遭遇タイプを決定"""
        base_types = ["conversation", "trade"]

        # 目的による追加タイプ
        if context.dispatch.objective_type == DispatchObjectiveType.GUARD:
            base_types.extend(["conflict", "inspection"])
        elif context.dispatch.objective_type == DispatchObjectiveType.INTERACT:
            base_types.extend(["cooperation", "friendship"])

        # 汚染度による影響
        if context.completed_log.contamination_level > 0.6:
            base_types.append("mysterious")

        return base_types

    async def _generate_encounter_npc_name(
        self,
        context: ActivityContext,
        encounter_type: str,
    ) -> str:
        """遭遇NPCの名前を生成"""
        # タイプ別の名前パターン
        name_patterns = {
            "conversation": ["旅人", "住民", "冒険者"],
            "trade": ["商人", "行商人", "収集家"],
            "conflict": ["盗賊", "ならず者", "競合者"],
            "cooperation": ["同志", "協力者", "仲間"],
            "friendship": ["友人候補", "同好の士", "理解者"],
            "mysterious": ["謎の人物", "影の存在", "名も無き者"],
        }

        base_name = random.choice(name_patterns.get(encounter_type, ["通りすがりの人"]))
        suffix = random.choice(["", "・A", "・B", "の末裔", "見習い"])

        return f"{base_name}{suffix}"

    async def _simulate_encounter_interaction(
        self,
        context: ActivityContext,
        npc_name: str,
        encounter_type: str,
    ) -> dict[str, Any]:
        """遭遇の相互作用をシミュレート"""
        # 基本的な結果パターン
        interaction_patterns = {
            "conversation": {
                "summary": "情報交換と親しい会話",
                "outcome": "friendly",
                "relationship_change": random.uniform(0.1, 0.5),
            },
            "trade": {
                "summary": "物品の交換と商談",
                "outcome": "neutral",
                "relationship_change": random.uniform(0, 0.3),
                "items_exchanged": [{"name": "交易品", "quantity": random.randint(1, 5)}],
            },
            "conflict": {
                "summary": "意見の対立と小競り合い",
                "outcome": "hostile",
                "relationship_change": random.uniform(-0.5, -0.1),
            },
            "cooperation": {
                "summary": "共同作業と目標達成",
                "outcome": "friendly",
                "relationship_change": random.uniform(0.3, 0.8),
            },
            "friendship": {
                "summary": "深い絆の形成",
                "outcome": "friendly",
                "relationship_change": random.uniform(0.5, 1.0),
            },
            "mysterious": {
                "summary": "不可解な遭遇と謎めいた会話",
                "outcome": "neutral",
                "relationship_change": random.uniform(-0.2, 0.2),
            },
        }

        result = interaction_patterns.get(
            encounter_type,
            {
                "summary": "偶然の出会い",
                "outcome": "neutral",
                "relationship_change": 0,
            },
        )

        # ログの性格による調整
        if "友好的" in context.completed_log.personality:
            result["relationship_change"] = min(1.0, result["relationship_change"] + 0.2)
        elif "敵対的" in context.completed_log.personality:
            result["relationship_change"] = max(-1.0, result["relationship_change"] - 0.2)

        return result

    async def _generate_encounter_narrative(
        self,
        context: ActivityContext,
        encounter: DispatchEncounter,
    ) -> str:
        """遭遇の物語を生成"""
        prompt_context = PromptContext(
            character_name=context.completed_log.name,
            action=f"{encounter.encountered_npc_name}との遭遇",
            location=context.current_location,
            recent_actions=[],
            world_state=context.world_state,
            additional_context={
                "encounter_type": encounter.interaction_type,
                "outcome": encounter.outcome,
                "npc_name": encounter.encountered_npc_name,
            },
        )

        response = await self.dramatist.process(
            prompt_context,
            narrative_style="encounter",
        )

        return response.narrative or f"{encounter.encountered_npc_name}との出会いは、予想外の展開をもたらした。"

    async def _generate_no_encounter_activity(
        self,
        context: ActivityContext,
    ) -> SimulatedActivity:
        """遭遇なしの交流活動を生成"""
        activities = [
            {
                "action": "他の旅人を探して歩き回る",
                "result": "今日は誰とも出会えなかった",
                "experience": {"exploration": 5, "patience": 10},
            },
            {
                "action": "宿場で情報収集",
                "result": "有益な噂話を聞いた",
                "experience": {"social": 10, "information": 15},
            },
            {
                "action": "手紙を書いて交流を試みる",
                "result": "返事が来ることを期待している",
                "experience": {"writing": 10, "hope": 5},
            },
        ]

        chosen = random.choice(activities)

        return SimulatedActivity(
            timestamp=datetime.utcnow(),
            location=context.current_location,
            action=chosen["action"],
            result=chosen["result"],
            narrative="人との繋がりを求めて、旅は続く。",
            success_level=0.4,
            experience_gained=chosen["experience"],
        )

    async def _generate_unique_location(
        self,
        context: ActivityContext,
        prompt_context: PromptContext,
    ) -> str:
        """ユニークな場所名を生成"""
        # 既に発見された場所を考慮
        existing_locations = context.dispatch.discovered_locations

        # AIによる場所名生成
        enhanced_context = prompt_context.model_copy()
        enhanced_context.additional_context["task"] = "generate_unique_location_name"
        enhanced_context.additional_context["existing_locations"] = existing_locations

        response = await self.dramatist.process(
            enhanced_context,
            narrative_style="location_name",
        )

        # レスポンスから場所名を抽出
        if response.metadata and "location_name" in response.metadata:
            return response.metadata["location_name"]

        # フォールバック
        prefixes = ["隠された", "古の", "忘れられた", "神秘の", "禁断の"]
        suffixes = ["遺跡", "神殿", "渓谷", "森", "洞窟", "塔", "庭園"]

        return f"{random.choice(prefixes)}{random.choice(suffixes)}"

    async def _generate_contextual_item(
        self,
        context: ActivityContext,
    ) -> dict[str, Any]:
        """文脈に応じたアイテムを生成"""
        # 場所と目的に応じたアイテムカテゴリー
        location_based_items = {
            "森": ["薬草", "きのこ", "樹皮", "鳥の羽"],
            "遺跡": ["古代の硬貨", "石板の欠片", "錆びた鍵", "古文書"],
            "洞窟": ["鉱石", "発光石", "コウモリの牙", "地下水"],
            "街": ["地図", "手紙", "小物", "食料"],
        }

        # デフォルトアイテム
        default_items = [
            {"name": "謎の結晶", "rarity": "uncommon", "value": 50},
            {"name": "古い地図の断片", "rarity": "rare", "value": 100},
            {"name": "薬草の束", "rarity": "common", "value": 20},
        ]

        # 汚染度による特殊アイテム
        if context.completed_log.contamination_level > 0.7:
            default_items.extend([
                {"name": "歪んだ記憶の欠片", "rarity": "rare", "value": 200},
                {"name": "汚染された宝石", "rarity": "uncommon", "value": 80},
            ])

        # アイテム選択
        location_key = None
        for key in location_based_items.keys():
            if key in context.current_location:
                location_key = key
                break

        if location_key:
            item_name = random.choice(location_based_items[location_key])
            rarity = random.choice(["common", "common", "uncommon", "rare"])
            value = {"common": 10, "uncommon": 50, "rare": 200}[rarity]

            return {
                "name": item_name,
                "rarity": rarity,
                "value": value + random.randint(-5, 20),
                "found_at": context.current_location,
            }

        return random.choice(default_items)

    async def _generate_collection_narrative(
        self,
        context: ActivityContext,
        item: Optional[dict[str, Any]],
    ) -> str:
        """収集活動の物語を生成"""
        if item:
            rarity_text = {
                "common": "ありふれた",
                "uncommon": "珍しい",
                "rare": "非常に貴重な",
            }
            return (
                f"{context.completed_log.name}は注意深く探索を続け、"
                f"{rarity_text.get(item['rarity'], '')} {item['name']}を発見した。"
                f"これは{item['value']}ゴールドの価値がある品だ。"
            )
        else:
            return (
                f"{context.completed_log.name}は熱心に探索したが、"
                "今回は価値あるものを見つけることはできなかった。"
                "しかし、この経験は無駄ではない。"
            )

    async def _generate_guard_narrative(
        self,
        context: ActivityContext,
        threat_encountered: bool,
        success_level: float,
    ) -> str:
        """守護活動の物語を生成"""
        if threat_encountered:
            if success_level > 0.8:
                return (
                    f"{context.completed_log.name}の鋭い観察眼が侵入者を早期に発見。"
                    "迅速かつ的確な対応により、脅威は完全に排除された。"
                    "守護者としての責務は見事に果たされた。"
                )
            else:
                return (
                    f"突如現れた侵入者に{context.completed_log.name}は対峙した。"
                    "激しい戦いの末、なんとか脅威を退けることに成功。"
                    "傷は負ったが、守るべきものは守り抜いた。"
                )
        else:
            return (
                f"{context.completed_log.name}は黙々と巡回を続ける。"
                f"{context.elapsed_hours}時間が経過したが、異常は見られない。"
                "平和こそが最高の報酬である。"
            )

    async def _generate_trade_narrative(
        self,
        context: ActivityContext,
        trade_value: int,
        profit: int,
    ) -> str:
        """商業活動の物語を生成"""
        profit_rate = profit / trade_value if trade_value > 0 else 0

        if profit_rate > 0.5:
            return (
                f"{context.completed_log.name}の巧みな交渉術が光った。"
                f"{trade_value}ゴールドの取引で{profit}ゴールドもの利益を生み出した。"
                "商人たちの間でも評判が高まっている。"
            )
        elif profit_rate > 0:
            return (
                f"慎重な商談の末、{context.completed_log.name}は取引を成立させた。"
                f"{profit}ゴールドの利益は決して多くないが、"
                "信頼関係の構築には成功した。"
            )
        else:
            return (
                f"市場の状況は厳しく、{context.completed_log.name}は苦戦を強いられた。"
                "利益は出なかったが、貴重な経験を積むことができた。"
            )

    async def _generate_memory_narrative(
        self,
        context: ActivityContext,
        found: int,
        preserved: int,
    ) -> str:
        """記憶保存活動の物語を生成"""
        preservation_rate = preserved / found if found > 0 else 0

        if preservation_rate > 0.8:
            return (
                f"{context.completed_log.name}は失われつつある記憶と深く共鳴した。"
                f"{found}個の貴重な記憶を発見し、そのうち{preserved}個を完璧に保存。"
                "これらの記憶は、永遠に失われることはない。"
            )
        else:
            return (
                f"儚い記憶たちは、{context.completed_log.name}の手をすり抜けていく。"
                f"{found}個の記憶に触れたが、保存できたのは{preserved}個のみ。"
                "それでも、救われた記憶は確かに存在する。"
            )

    async def _generate_research_narrative(
        self,
        context: ActivityContext,
        progress: float,
    ) -> str:
        """研究活動の物語を生成"""
        if progress > 0.15:
            return (
                f"{context.completed_log.name}の研究に大きな進展があった。"
                f"新たな発見により、理解が{progress * 100:.1f}%も深まった。"
                "真実への道筋が、少しずつ見えてきている。"
            )
        else:
            return (
                f"地道な調査と分析を続ける{context.completed_log.name}。"
                f"今回の進捗は{progress * 100:.1f}%に留まったが、"
                "研究とは忍耐の積み重ねである。"
            )

    def _apply_personality_modifiers(
        self,
        activity: SimulatedActivity,
        completed_log: CompletedLog,
    ) -> SimulatedActivity:
        """ログの性格による活動の調整"""
        # 汚染度による影響
        if completed_log.contamination_level > 0.7:
            # 高汚染度は予測不能な結果をもたらす
            activity.success_level *= random.uniform(0.8, 1.3)
            activity.success_level = min(1.0, activity.success_level)

            # 追加の不思議な効果
            if random.random() < 0.2:
                activity.narrative += "\n何か奇妙な感覚が残った..."

        # 性格による成功率の調整
        if "慎重" in completed_log.personality:
            # 慎重な性格は安定した結果
            activity.success_level = max(0.4, min(0.8, activity.success_level))
        elif "大胆" in completed_log.personality:
            # 大胆な性格は極端な結果
            if activity.success_level > 0.5:
                activity.success_level = min(1.0, activity.success_level * 1.2)
            else:
                activity.success_level *= 0.8

        return activity

    def _determine_current_location(
        self,
        dispatch: LogDispatch,
        elapsed_hours: int,
    ) -> str:
        """現在地を決定"""
        # 基本的には出発地点からの距離で決定
        locations = [
            "出発地点付近",
            "街道沿い",
            "森の中",
            "山麓",
            "平原",
            "古い遺跡",
            "小さな村",
            "交易所",
        ]

        # 経過時間に応じて遠い場所へ
        location_index = min(len(locations) - 1, elapsed_hours // 12)

        # 目的に応じた調整
        if dispatch.objective_type == DispatchObjectiveType.GUARD:
            return "指定された守護地点"
        elif dispatch.objective_type == DispatchObjectiveType.TRADE:
            return random.choice(["市場", "交易所", "商業地区"])

        return locations[location_index]

    def _get_world_state(self, dispatch: LogDispatch) -> dict[str, Any]:
        """世界の状態を取得"""
        # 実際の実装では、データベースから取得
        return {
            "time_of_day": "昼",
            "weather": "晴れ",
            "atmosphere": "平和",
            "recent_events": [],
        }

    def _determine_relationship_status(self, change: float) -> str:
        """関係性の変化から新しいステータスを決定"""
        if change >= 0.7:
            return "親友"
        elif change >= 0.4:
            return "友好的"
        elif change >= 0:
            return "中立"
        elif change >= -0.4:
            return "警戒"
        else:
            return "敵対"
