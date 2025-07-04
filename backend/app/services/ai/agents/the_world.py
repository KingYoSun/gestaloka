"""
世界の意識AI (The World) - マクロイベント管理
"""

import json
import random
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from pydantic import BaseModel, Field

from app.schemas.game_session import ActionChoice
from app.services.ai.prompt_manager import AIAgentRole, PromptContext

from .base import AgentResponse, BaseAgent

logger = structlog.get_logger(__name__)


class WorldEvent(BaseModel):
    """世界イベントの定義"""

    id: str = Field(description="イベントID")
    type: str = Field(description="イベントタイプ")
    name: str = Field(description="イベント名")
    description: str = Field(description="イベントの説明")
    severity: int = Field(ge=1, le=10, description="影響度（1-10）")
    duration_hours: int = Field(description="持続時間（時間）")
    affected_locations: list[str] = Field(default_factory=list, description="影響を受ける場所")
    prerequisites: dict[str, Any] = Field(default_factory=lambda: {}, description="発生条件")
    effects: dict[str, Any] = Field(default_factory=lambda: {}, description="効果")
    triggers: list[str] = Field(default_factory=list, description="トリガー条件")


class WorldState(BaseModel):
    """世界の状態"""

    peace_level: float = Field(ge=0.0, le=1.0, default=0.7, description="平和度")
    resource_abundance: float = Field(ge=0.0, le=1.0, default=0.6, description="資源の豊富さ")
    magical_activity: float = Field(ge=0.0, le=1.0, default=0.5, description="魔法活動度")
    corruption_level: float = Field(ge=0.0, le=1.0, default=0.3, description="汚染度")
    faction_tensions: dict[str, float] = Field(default_factory=lambda: {}, description="勢力間の緊張度")
    active_events: list[str] = Field(default_factory=list, description="アクティブなイベントID")
    event_history: list[dict[str, Any]] = Field(default_factory=list, description="イベント履歴")


class TheWorldAI(BaseAgent):
    """
    世界の意識AI

    マクロな視点から世界全体を管理し、
    プレイヤーコミュニティの行動の総和に基づいて
    世界規模のイベントを発生させます。
    """

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(AIAgentRole.THE_WORLD, *args, **kwargs)
        self.world_state = WorldState()
        self.event_templates = self._initialize_event_templates()

    def _initialize_event_templates(self) -> dict[str, WorldEvent]:
        """イベントテンプレートの初期化"""
        return {
            "blood_moon": WorldEvent(
                id="blood_moon",
                type="celestial",
                name="血月の夜",
                description="不吉な赤い月が空に昇り、モンスターの活動が活発化する",
                severity=6,
                duration_hours=12,
                affected_locations=["all"],
                prerequisites={"corruption_level": 0.6},
                effects={
                    "monster_spawn_rate": 2.0,
                    "magic_power": 1.5,
                    "sanity_drain": 1.2,
                },
                triggers=["high_corruption", "lunar_cycle"],
            ),
            "harvest_festival": WorldEvent(
                id="harvest_festival",
                type="cultural",
                name="収穫祭",
                description="豊作を祝う祭りが各地で開催され、人々の士気が向上する",
                severity=3,
                duration_hours=72,
                affected_locations=["towns", "villages"],
                prerequisites={"resource_abundance": 0.7, "peace_level": 0.6},
                effects={
                    "happiness": 1.5,
                    "trade_bonus": 1.3,
                    "food_production": 1.2,
                },
                triggers=["autumn_season", "good_harvest"],
            ),
            "faction_war": WorldEvent(
                id="faction_war",
                type="political",
                name="勢力間戦争",
                description="二つの主要勢力が全面戦争に突入する",
                severity=9,
                duration_hours=168,
                affected_locations=["border_regions"],
                prerequisites={"faction_tensions": {"threshold": 0.8}},
                effects={
                    "peace_level": -0.3,
                    "trade_penalty": 0.5,
                    "refugee_crisis": True,
                },
                triggers=["diplomatic_failure", "resource_conflict"],
            ),
            "magical_surge": WorldEvent(
                id="magical_surge",
                type="magical",
                name="魔力の奔流",
                description="世界中の魔力が急激に増大し、予測不能な現象が発生する",
                severity=7,
                duration_hours=24,
                affected_locations=["all"],
                prerequisites={"magical_activity": 0.8},
                effects={
                    "spell_power": 2.0,
                    "spell_failure_rate": 1.5,
                    "random_teleportation": True,
                },
                triggers=["ley_line_convergence", "ancient_artifact_activation"],
            ),
            "plague_outbreak": WorldEvent(
                id="plague_outbreak",
                type="disaster",
                name="疫病の流行",
                description="未知の疫病が急速に広がり始める",
                severity=8,
                duration_hours=336,
                affected_locations=["densely_populated"],
                prerequisites={"corruption_level": 0.7, "resource_abundance": 0.3},
                effects={
                    "population_decline": 0.8,
                    "trade_restriction": True,
                    "medical_demand": 3.0,
                },
                triggers=["poor_sanitation", "corrupted_water"],
            ),
        }

    async def process(self, context: PromptContext, **kwargs: Any) -> AgentResponse:
        """
        世界の状態を分析し、必要に応じてマクロイベントを発生させる
        """
        try:
            # 世界の状態を更新
            await self._update_world_state(context)

            # イベント発生判定
            potential_events = self._check_event_triggers(context)

            # イベントの選択と生成
            if potential_events:
                selected_event = await self._select_and_generate_event(context, potential_events)
                return await self._create_event_response(selected_event, context)

            # 定期的な世界状態レポート
            return await self._create_status_response(context)

        except Exception as e:
            self.logger.error(
                "World AI processing failed",
                error=str(e),
                context_character=context.character_name,
            )
            return AgentResponse(
                agent_role=self.role.value,
                narrative="世界は静かに時を刻んでいる...",
                metadata={"error": str(e)},
            )

    async def _update_world_state(self, context: PromptContext) -> None:
        """世界の状態を更新"""
        # プレイヤーの行動履歴から世界の状態を推測
        if context.recent_actions:
            # 最近の行動を分析
            combat_actions = sum(1 for action in context.recent_actions if "戦" in action or "攻撃" in action)
            peaceful_actions = sum(1 for action in context.recent_actions if "会話" in action or "取引" in action)

            # 平和度の更新
            if combat_actions > peaceful_actions:
                self.world_state.peace_level = max(0.0, self.world_state.peace_level - 0.01)
            else:
                self.world_state.peace_level = min(1.0, self.world_state.peace_level + 0.01)

        # AI生成による詳細な状態分析
        await self._analyze_world_trends(context)

    async def _analyze_world_trends(self, context: PromptContext) -> None:
        """AIによる世界のトレンド分析"""
        analysis_prompt = f"""
現在の世界の状態:
- 平和度: {self.world_state.peace_level:.2f}
- 資源の豊富さ: {self.world_state.resource_abundance:.2f}
- 魔法活動度: {self.world_state.magical_activity:.2f}
- 汚染度: {self.world_state.corruption_level:.2f}

最近のプレイヤーの行動:
{chr(10).join(context.recent_actions[:5])}

この情報から、世界の状態がどのように変化しているか分析してください。
以下の形式でJSON出力してください:

{{
    "peace_level_change": 数値（-0.1から0.1の範囲）,
    "resource_abundance_change": 数値（-0.1から0.1の範囲）,
    "magical_activity_change": 数値（-0.1から0.1の範囲）,
    "corruption_level_change": 数値（-0.1から0.1の範囲）,
    "analysis": "変化の理由"
}}
"""
        try:
            response = await self.generate_response(
                context.model_copy(update={"custom_prompt": analysis_prompt}),
                temperature=0.7,
            )

            # JSON部分を抽出
            json_start = response.find("{")
            json_end = response.rfind("}") + 1
            if json_start >= 0 and json_end > json_start:
                json_str = response[json_start:json_end]
                analysis = json.loads(json_str)

                # 世界の状態を更新
                self.world_state.peace_level = max(
                    0.0,
                    min(1.0, self.world_state.peace_level + analysis.get("peace_level_change", 0)),
                )
                self.world_state.resource_abundance = max(
                    0.0,
                    min(
                        1.0,
                        self.world_state.resource_abundance + analysis.get("resource_abundance_change", 0),
                    ),
                )
                self.world_state.magical_activity = max(
                    0.0,
                    min(
                        1.0,
                        self.world_state.magical_activity + analysis.get("magical_activity_change", 0),
                    ),
                )
                self.world_state.corruption_level = max(
                    0.0,
                    min(
                        1.0,
                        self.world_state.corruption_level + analysis.get("corruption_level_change", 0),
                    ),
                )

                self.logger.info(
                    "World state updated",
                    changes=analysis,
                    new_state={
                        "peace_level": self.world_state.peace_level,
                        "resource_abundance": self.world_state.resource_abundance,
                        "magical_activity": self.world_state.magical_activity,
                        "corruption_level": self.world_state.corruption_level,
                    },
                )

        except (json.JSONDecodeError, KeyError) as e:
            self.logger.warning("Failed to parse world analysis", error=str(e))

    def _check_event_triggers(self, context: PromptContext) -> list[WorldEvent]:
        """イベントトリガーをチェック"""
        potential_events = []

        for event in self.event_templates.values():
            # アクティブなイベントはスキップ
            if event.id in self.world_state.active_events:
                continue

            # 前提条件をチェック
            if self._check_prerequisites(event):
                potential_events.append(event)

        return potential_events

    def _check_prerequisites(self, event: WorldEvent) -> bool:
        """イベントの前提条件をチェック"""
        for key, value in event.prerequisites.items():
            if key == "corruption_level" and self.world_state.corruption_level < value:
                return False
            elif key == "resource_abundance" and self.world_state.resource_abundance < value:
                return False
            elif key == "peace_level" and self.world_state.peace_level < value:
                return False
            elif key == "magical_activity" and self.world_state.magical_activity < value:
                return False
            elif key == "faction_tensions":
                if isinstance(value, dict) and "threshold" in value:
                    # 勢力間緊張度のチェック（簡略化）
                    max_tension = (
                        max(self.world_state.faction_tensions.values()) if self.world_state.faction_tensions else 0.0
                    )
                    if max_tension < value["threshold"]:
                        return False

        return True

    async def _select_and_generate_event(
        self, context: PromptContext, potential_events: list[WorldEvent]
    ) -> WorldEvent:
        """イベントを選択し、詳細を生成"""
        # 重要度でソートして選択
        sorted_events = sorted(potential_events, key=lambda e: e.severity, reverse=True)

        # 確率的に選択（重要度が高いほど選ばれやすい）
        weights = [event.severity for event in sorted_events]
        selected = random.choices(sorted_events, weights=weights, k=1)[0]

        # AIによるイベントのカスタマイズ
        customization_prompt = f"""
世界イベント「{selected.name}」が発生しようとしています。

基本情報:
- タイプ: {selected.type}
- 説明: {selected.description}
- 影響度: {selected.severity}/10
- 持続時間: {selected.duration_hours}時間

現在の場所: {context.location}
キャラクター: {context.character_name}

このイベントが現在の状況でどのように発現するか、
具体的で臨場感のある描写を作成してください。
地域固有の特徴を反映させてください。
"""
        response = await self.generate_response(
            context.model_copy(update={"custom_prompt": customization_prompt}),
            temperature=0.8,
        )

        # イベントをカスタマイズ
        customized_event = selected.model_copy()
        customized_event.description = response

        # アクティブイベントに追加
        self.world_state.active_events.append(customized_event.id)

        # イベント履歴に記録
        self.world_state.event_history.append(
            {
                "id": customized_event.id,
                "name": customized_event.name,
                "started_at": datetime.now(UTC).isoformat(),
                "location": context.location,
            }
        )

        return customized_event

    async def _create_event_response(self, event: WorldEvent, context: PromptContext) -> AgentResponse:
        """イベント発生時のレスポンスを作成"""
        # イベントの影響を反映した選択肢を生成
        choices_prompt = f"""
世界イベント「{event.name}」が発生しました。

イベント詳細:
{event.description}

このイベントに対して、プレイヤーが取れる行動の選択肢を3つ提示してください。
各選択肢は以下の形式で出力してください:

1. [選択肢の内容]
2. [選択肢の内容]
3. [選択肢の内容]
"""
        choices_response = await self.generate_response(
            context.model_copy(update={"custom_prompt": choices_prompt}),
            temperature=0.8,
        )

        # 選択肢を解析
        choices = self._parse_choices(choices_response)

        return AgentResponse(
            agent_role=self.role.value,
            narrative=event.description,
            choices=choices,
            state_changes={
                "world_event": event.model_dump(),
                "world_state": self.world_state.model_dump(),
            },
            metadata={
                "event_id": event.id,
                "event_type": event.type,
                "severity": event.severity,
                "duration_hours": event.duration_hours,
            },
        )

    async def _create_status_response(self, context: PromptContext) -> AgentResponse:
        """定期的な世界状態レポート"""
        status_prompt = f"""
現在の世界の状態:
- 平和度: {self.world_state.peace_level:.2f}
- 資源の豊富さ: {self.world_state.resource_abundance:.2f}
- 魔法活動度: {self.world_state.magical_activity:.2f}
- 汚染度: {self.world_state.corruption_level:.2f}

現在地: {context.location}

この情報を基に、世界の現在の雰囲気を短く描写してください。
プレイヤーが世界の変化を感じられるような、環境描写を含めてください。
"""
        response = await self.generate_response(
            context.model_copy(update={"custom_prompt": status_prompt}),
            temperature=0.7,
        )

        return AgentResponse(
            agent_role=self.role.value,
            narrative=response,
            state_changes={
                "world_state": self.world_state.model_dump(),
            },
            metadata={
                "is_status_update": True,
                "active_events": self.world_state.active_events,
            },
        )

    def _parse_choices(self, response: str) -> list[ActionChoice]:
        """レスポンスから選択肢を解析"""
        choices: list[ActionChoice] = []
        lines = response.strip().split("\n")

        for line in lines:
            line = line.strip()
            # 番号付きリストのパターンをチェック
            for marker in ["1.", "2.", "3.", "1)", "2)", "3)", "①", "②", "③"]:
                if line.startswith(marker):
                    choice_text = line[len(marker) :].strip()
                    choices.append(
                        ActionChoice(
                            id=f"world_event_{len(choices) + 1}",
                            text=choice_text,
                        )
                    )
                    break

        # デフォルトの選択肢
        if not choices:
            choices = [
                ActionChoice(id="observe", text="状況を静観する"),
                ActionChoice(id="investigate", text="イベントの原因を調査する"),
                ActionChoice(id="react", text="直ちに対処する"),
            ]

        return choices[:3]  # 最大3つ

    async def cleanup_expired_events(self) -> None:
        """期限切れのイベントをクリーンアップ"""
        current_time = datetime.now(UTC)
        events_to_remove = []

        for event_record in self.world_state.event_history:
            if "started_at" in event_record:
                started_at = datetime.fromisoformat(event_record["started_at"])
                event_id = event_record["id"]

                # イベントテンプレートから持続時間を取得
                if event_id in self.event_templates:
                    duration = timedelta(hours=self.event_templates[event_id].duration_hours)
                    if current_time > started_at + duration:
                        events_to_remove.append(event_id)

        # アクティブイベントから削除
        for event_id in events_to_remove:
            if event_id in self.world_state.active_events:
                self.world_state.active_events.remove(event_id)
                self.logger.info("Event expired", event_id=event_id)

    async def apply_story_impact(
        self,
        story_id: str,
        impact_data: dict[str, Any],
        context: PromptContext,
    ) -> None:
        """
        ストーリーからの影響を世界の状態に適用
        
        Args:
            story_id: ストーリーID
            impact_data: 影響データ
            context: コンテキスト
        """
        # 影響の種類に応じて世界の状態を更新
        if "peace_change" in impact_data:
            self.world_state.peace_level = max(0.0, min(1.0,
                self.world_state.peace_level + impact_data["peace_change"]))
        
        if "corruption_change" in impact_data:
            self.world_state.corruption_level = max(0.0, min(1.0,
                self.world_state.corruption_level + impact_data["corruption_change"]))
        
        if "resource_change" in impact_data:
            self.world_state.resource_abundance = max(0.0, min(1.0,
                self.world_state.resource_abundance + impact_data["resource_change"]))
        
        if "magical_change" in impact_data:
            self.world_state.magical_activity = max(0.0, min(1.0,
                self.world_state.magical_activity + impact_data["magical_change"]))
        
        # 特定の勢力への影響
        if "faction_impact" in impact_data:
            for faction, tension_change in impact_data["faction_impact"].items():
                if faction not in self.world_state.faction_tensions:
                    self.world_state.faction_tensions[faction] = 0.5
                
                self.world_state.faction_tensions[faction] = max(0.0, min(1.0,
                    self.world_state.faction_tensions[faction] + tension_change))
        
        # ストーリー影響履歴に記録
        self.world_state.event_history.append({
            "type": "story_impact",
            "story_id": story_id,
            "impact": impact_data,
            "timestamp": datetime.now(UTC).isoformat(),
            "location": context.location,
        })
        
        self.logger.info(
            "Story impact applied",
            story_id=story_id,
            impact=impact_data,
            new_world_state=self.world_state.model_dump(),
        )
