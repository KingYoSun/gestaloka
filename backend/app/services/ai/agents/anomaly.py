"""
混沌AI (The Anomaly) - 予測不能なイベント生成を担当
"""

import random
import re
from typing import Any, Optional

import structlog

from app.core.exceptions import AIServiceError
from app.schemas.game_session import ActionChoice
from app.services.ai.agents.base import AgentResponse, BaseAgent
from app.services.ai.prompt_manager import AIAgentRole, PromptContext

logger = structlog.get_logger(__name__)


class AnomalyEvent:
    """混沌イベントの定義"""

    def __init__(
        self,
        event_type: str,
        intensity: str,
        description: str,
        effects: dict[str, Any],
        duration: Optional[int] = None,
    ):
        self.event_type = event_type
        self.intensity = intensity  # low, medium, high, extreme
        self.description = description
        self.effects = effects
        self.duration = duration  # ターン数、Noneなら即時効果


class AnomalyAgent(BaseAgent):
    """
    混沌AI (The Anomaly)

    世界の理から外れた「理不尽」なイベントをランダムに発生させ、
    プレイヤーに驚きと挑戦を提供します。
    """

    def __init__(self, **kwargs):
        """混沌AIの初期化"""
        super().__init__(role=AIAgentRole.ANOMALY, **kwargs)
        self.event_probability = 0.15  # 基本発生確率
        self.cooldown_turns = 5  # 最小間隔
        self.last_event_turn: float = -float("inf")

    async def process(self, context: PromptContext, **kwargs: Any) -> AgentResponse:
        """
        混沌イベントの発生判定と生成

        Args:
            context: プロンプトコンテキスト
            **kwargs: 追加パラメータ

        Returns:
            混沌イベントまたは空のレスポンス
        """
        # コンテキストの検証
        if not self.validate_context(context):
            raise AIServiceError("Invalid context for Anomaly agent")

        try:
            # イベント発生判定
            if not self._should_trigger_event(context):
                return self._create_empty_response()

            # 混沌エネルギーレベルの計算
            chaos_level = self._calculate_chaos_level(context)

            # イベントタイプの決定
            event_type = self._determine_event_type(context, chaos_level)

            # イベントの生成
            event = await self._generate_anomaly_event(context, event_type, chaos_level)

            # ログNPC暴走の可能性チェック
            if event_type == "log_corruption" and self._check_log_rampage(context):
                event = await self._enhance_to_log_rampage(context, event)

            # レスポンスの構築
            return self._build_response(event, context)

        except Exception as e:
            self.logger.error("Anomaly processing failed", error=str(e), character=context.character_name)
            raise AIServiceError(f"Anomaly agent error: {e!s}")

    def _should_trigger_event(self, context: PromptContext) -> bool:
        """
        イベント発生判定

        Args:
            context: プロンプトコンテキスト

        Returns:
            イベントを発生させるかどうか
        """
        # クールダウンチェック
        current_turn = len(context.session_history)
        if current_turn - self.last_event_turn < self.cooldown_turns:
            return False

        # 世界の安定度による補正
        stability = context.world_state.get("stability", 1.0)
        adjusted_probability = self.event_probability * (2.0 - stability)

        # 特定の場所では確率上昇
        if context.location in ["次元の狭間", "古代遺跡", "禁忌の森"]:
            adjusted_probability *= 2.0

        # 確率判定
        if random.random() < adjusted_probability:
            self.last_event_turn = current_turn
            return True

        return False

    def _calculate_chaos_level(self, context: PromptContext) -> float:
        """
        混沌エネルギーレベルの計算

        Args:
            context: プロンプトコンテキスト

        Returns:
            混沌レベル (0.0-1.0)
        """
        base_chaos = 0.3

        # 世界の不安定度
        instability = 1.0 - context.world_state.get("stability", 1.0)
        base_chaos += instability * 0.3

        # プレイヤーの行動による影響
        forbidden_actions = ["禁呪", "次元操作", "時間改変", "神への挑戦"]
        recent_text = " ".join(context.recent_actions)
        for action in forbidden_actions:
            if action in recent_text:
                base_chaos += 0.1

        # ログNPCの密度
        log_density = context.world_state.get("log_npc_density", 0.0)
        base_chaos += log_density * 0.2

        return min(base_chaos, 1.0)

    def _determine_event_type(self, context: PromptContext, chaos_level: float) -> str:
        """
        イベントタイプの決定

        Args:
            context: プロンプトコンテキスト
            chaos_level: 混沌レベル

        Returns:
            イベントタイプ
        """
        # 混沌レベルに基づく重み付け
        weights = {
            "reality_glitch": 1.0,  # 現実の歪み
            "time_anomaly": 0.8 * chaos_level,  # 時間異常
            "dimensional_rift": 0.6 * chaos_level,  # 次元の裂け目
            "log_corruption": 0.7,  # ログの汚染
            "causality_break": 0.5 * chaos_level,  # 因果律の破綻
            "memory_distortion": 0.6,  # 記憶の歪曲
            "entity_duplication": 0.4 * chaos_level,  # 存在の複製
            "law_reversal": 0.3 * chaos_level,  # 法則の反転
        }

        # 場所による特殊イベント
        if "次元" in context.location:
            weights["dimensional_rift"] *= 3.0
        if "ログ" in context.location or "記録" in context.location:
            weights["log_corruption"] *= 2.0

        # 重み付きランダム選択
        total_weight = sum(weights.values())
        rand = random.uniform(0, total_weight)
        cumulative = 0.0

        for event_type, weight in weights.items():
            cumulative += weight
            if rand <= cumulative:
                return event_type

        return "reality_glitch"  # フォールバック

    async def _generate_anomaly_event(
        self, context: PromptContext, event_type: str, chaos_level: float
    ) -> AnomalyEvent:
        """
        混沌イベントの生成

        Args:
            context: プロンプトコンテキスト
            event_type: イベントタイプ
            chaos_level: 混沌レベル

        Returns:
            生成されたイベント
        """
        # イベント強度の決定
        intensity = self._determine_intensity(chaos_level)

        # AIによる創造的なイベント生成
        enhanced_context = self._enhance_context_for_event(context, event_type, intensity)
        raw_response = await self.generate_response(
            enhanced_context,
            temperature=0.95,
            max_tokens=800,  # 高い創造性
        )

        # レスポンス解析
        event_data = self._parse_event_response(raw_response, event_type, intensity)

        return AnomalyEvent(
            event_type=event_type,
            intensity=intensity,
            description=event_data["description"],
            effects=event_data["effects"],
            duration=event_data.get("duration"),
        )

    def _determine_intensity(self, chaos_level: float) -> str:
        """
        イベント強度の決定

        Args:
            chaos_level: 混沌レベル

        Returns:
            強度 (low, medium, high, extreme)
        """
        if chaos_level < 0.3:
            return "low"
        elif chaos_level < 0.6:
            return "medium"
        elif chaos_level < 0.85:
            return "high"
        else:
            return "extreme"

    def _enhance_context_for_event(self, context: PromptContext, event_type: str, intensity: str) -> PromptContext:
        """
        イベント生成用にコンテキストを拡張

        Args:
            context: 元のコンテキスト
            event_type: イベントタイプ
            intensity: イベント強度

        Returns:
            拡張されたコンテキスト
        """
        event_templates = {
            "reality_glitch": "物理法則が一時的に歪み、予期せぬ現象が発生",
            "time_anomaly": "時間の流れが異常をきたし、過去と現在が交錯",
            "dimensional_rift": "次元の境界が不安定になり、異世界の影響が侵入",
            "log_corruption": "記憶のコンテキストが汚染され、本来の意味が歪曲",
            "causality_break": "原因と結果の関係が崩壊し、論理が通用しない",
            "memory_distortion": "記憶と現実の境界が曖昧になり、偽りの記憶が生成",
            "entity_duplication": "存在が複製され、同一人物の複数体が出現",
            "law_reversal": "世界の基本法則が反転し、常識が通用しない",
        }

        context.additional_context.update(
            {
                "anomaly_type": event_type,
                "anomaly_template": event_templates.get(event_type, "未知の異常現象"),
                "intensity": intensity,
                "chaos_theme": "理不尽で予測不能な出来事",
                "player_confusion": "プレイヤーを驚かせ、新たな挑戦を提供",
            }
        )

        # ログ汚染イベントの場合、コンテキスト汚染の詳細を追加
        if event_type == "log_corruption":
            context.additional_context["contamination_mechanics"] = {
                "emotional_corruption": "負の感情が記憶を蝕む",
                "context_distortion": "文脈が歪み、意味が変質する",
                "self_reinforcement": "汚染が汚染を呼び、悪循環に陥る",
                "memory_collapse": "極度の汚染で記憶が崩壊し、歪みへと変貌",
            }

        return context

    def _parse_event_response(self, raw_response: str, event_type: str, intensity: str) -> dict[str, Any]:
        """
        AIレスポンスからイベントデータを解析

        Args:
            raw_response: 生のAIレスポンス
            event_type: イベントタイプ
            intensity: イベント強度

        Returns:
            イベントデータ
        """
        # デフォルト値
        default_effects = self._get_default_effects(event_type, intensity)

        try:
            # レスポンスから要素を抽出
            lines = raw_response.strip().split("\n")
            description_lines = []
            effects = {}
            duration = None

            in_effects = False
            for line in lines:
                if "【効果】" in line or "効果:" in line:
                    in_effects = True
                    continue
                elif "【期間】" in line or "期間:" in line:
                    duration_match = re.search(r"\d+", line)
                    if duration_match:
                        duration = int(duration_match.group())
                    continue
                elif in_effects and ":" in line:
                    key, value = line.split(":", 1)
                    effects[key.strip()] = value.strip()
                else:
                    if not in_effects:
                        description_lines.append(line)

            description = "\n".join(description_lines).strip()

            # 効果が空の場合はデフォルトを使用
            if not effects:
                effects = default_effects

            return {
                "description": description or "説明不能な異常現象が発生した。",
                "effects": effects,
                "duration": duration,
            }

        except Exception as e:
            self.logger.warning("Failed to parse event response", error=str(e))
            return {"description": raw_response[:500], "effects": default_effects, "duration": None}

    def _get_default_effects(self, event_type: str, intensity: str) -> dict[str, Any]:
        """
        デフォルトの効果を取得

        Args:
            event_type: イベントタイプ
            intensity: イベント強度

        Returns:
            デフォルト効果
        """
        intensity_multiplier = {"low": 0.5, "medium": 1.0, "high": 1.5, "extreme": 2.0}[intensity]

        effects_map = {
            "reality_glitch": {
                "physics_distortion": intensity_multiplier,
                "random_teleport": 0.3 * intensity_multiplier,
            },
            "time_anomaly": {"time_dilation": intensity_multiplier, "action_repeat": 0.2 * intensity_multiplier},
            "dimensional_rift": {"dimension_bleed": intensity_multiplier, "alien_entities": 0.4 * intensity_multiplier},
            "log_corruption": {
                "context_distortion": intensity_multiplier,  # コンテキストの歪み度
                "memory_contamination": 0.5 * intensity_multiplier,  # 記憶汚染の伝播率
                "interpretation_bias": 0.7 * intensity_multiplier,  # 解釈の偏向度
                "semantic_drift": 0.3 * intensity_multiplier,  # 意味のドリフト
            },
            "causality_break": {"logic_failure": intensity_multiplier, "paradox_damage": 10 * intensity_multiplier},
            "memory_distortion": {
                "memory_loss": 0.3 * intensity_multiplier,
                "skill_shuffle": 0.2 * intensity_multiplier,
            },
            "entity_duplication": {
                "duplicate_count": int(2 * intensity_multiplier),
                "identity_crisis": intensity_multiplier,
            },
            "law_reversal": {"gravity_reverse": 0.5 * intensity_multiplier, "damage_heal": 0.3 * intensity_multiplier},
        }

        return effects_map.get(event_type, {"chaos_energy": intensity_multiplier})

    def _check_log_rampage(self, context: PromptContext) -> bool:
        """
        ログ暴走の可能性をチェック
        汚染されたコンテキストが自己強化ループに入った場合、ログが暴走する

        Args:
            context: プロンプトコンテキスト

        Returns:
            ログ暴走が発生するか
        """
        # ログNPCが近くにいる場合
        nearby_npcs = context.additional_context.get("nearby_npcs", [])
        log_npcs = [npc for npc in nearby_npcs if npc.get("type") == "log"]

        if not log_npcs:
            return False

        # コンテキスト汚染度による確率計算
        corruption_level = context.world_state.get("log_corruption_level", 0.0)

        # 汚染度が高いほど自己強化ループが発生しやすい
        # 0-25%: ほぼ暴走なし
        # 26-50%: 低確率で暴走
        # 51-75%: 中確率で暴走
        # 76-100%: 高確率で暴走
        if corruption_level < 0.25:
            base_chance = 0.05
        elif corruption_level < 0.5:
            base_chance = 0.2
        elif corruption_level < 0.75:
            base_chance = 0.4
        else:
            base_chance = 0.7

        rampage_chance = base_chance * len(log_npcs)

        return bool(random.random() < rampage_chance)

    async def _enhance_to_log_rampage(self, context: PromptContext, base_event: AnomalyEvent) -> AnomalyEvent:
        """
        基本イベントをログ暴走イベントに強化

        Args:
            context: プロンプトコンテキスト
            base_event: 基本イベント

        Returns:
            強化されたイベント
        """
        # ログ暴走の詳細を生成
        rampage_context = context.model_copy()
        rampage_context.additional_context["log_rampage"] = True
        rampage_context.additional_context["original_event"] = base_event.description

        raw_response = await self.generate_response(rampage_context, temperature=0.9, max_tokens=600)

        # 効果を強化
        enhanced_effects = base_event.effects.copy()
        enhanced_effects.update(
            {
                "log_rampage": True,
                "hostile_log_npcs": True,
                "reality_instability": enhanced_effects.get("reality_instability", 0) + 0.5,
                "corruption_spread": 0.3,
            }
        )

        return AnomalyEvent(
            event_type="log_rampage",
            intensity="extreme",
            description=raw_response,
            effects=enhanced_effects,
            duration=base_event.duration,
        )

    def _build_response(self, event: AnomalyEvent, context: PromptContext) -> AgentResponse:
        """
        レスポンスの構築

        Args:
            event: 発生したイベント
            context: プロンプトコンテキスト

        Returns:
            エージェントレスポンス
        """
        # 選択肢の生成
        choices = self._generate_event_choices(event)

        # メタデータ
        metadata = self.extract_metadata(context)
        metadata.update(
            {
                "event_type": event.event_type,
                "intensity": event.intensity,
                "has_duration": event.duration is not None,
                "chaos_level": self._calculate_chaos_level(context),
            }
        )

        # 状態変更
        state_changes = {"anomaly_active": True, "anomaly_effects": event.effects}

        if event.duration:
            state_changes["anomaly_duration"] = event.duration

        return AgentResponse(
            agent_role=self.role.value,
            narrative=event.description,
            choices=choices,
            state_changes=state_changes,
            metadata=metadata,
        )

    def _generate_event_choices(self, event: AnomalyEvent) -> list[ActionChoice]:
        """
        イベントに対する選択肢を生成

        Args:
            event: 発生したイベント

        Returns:
            選択肢リスト
        """
        # イベントタイプに応じた選択肢
        choices_map = {
            "reality_glitch": [
                ActionChoice(id="adapt", text="現実の歪みに適応を試みる", difficulty="hard"),
                ActionChoice(id="resist", text="理性を保ち、異常に抵抗する", difficulty="medium"),
                ActionChoice(id="embrace", text="混沌を受け入れ、流れに身を任せる", difficulty="easy"),
            ],
            "time_anomaly": [
                ActionChoice(id="anchor", text="現在に意識を固定する", difficulty="hard"),
                ActionChoice(id="explore", text="時間の流れを探索する", difficulty="medium"),
                ActionChoice(id="wait", text="異常が収まるのを待つ", difficulty="easy"),
            ],
            "dimensional_rift": [
                ActionChoice(id="seal", text="次元の裂け目を閉じようとする", difficulty="hard"),
                ActionChoice(id="investigate", text="裂け目の向こうを調査する", difficulty="medium"),
                ActionChoice(id="flee", text="危険から逃げる", difficulty="easy"),
            ],
            "log_corruption": [
                ActionChoice(id="purify", text="ログの浄化を試みる", difficulty="hard"),
                ActionChoice(id="contain", text="汚染の拡大を防ぐ", difficulty="medium"),
                ActionChoice(id="evacuate", text="汚染地域から退避する", difficulty="easy"),
            ],
        }

        # デフォルトの選択肢
        default_choices = [
            ActionChoice(id="investigate", text="異常現象を調査する", difficulty="medium"),
            ActionChoice(id="defend", text="身を守る態勢を取る", difficulty="easy"),
            ActionChoice(id="escape", text="この場から離れる", difficulty="easy"),
        ]

        return choices_map.get(event.event_type, default_choices)

    def _create_empty_response(self) -> AgentResponse:
        """
        イベントが発生しない場合の空レスポンス

        Returns:
            空のエージェントレスポンス
        """
        return AgentResponse(agent_role=self.role.value, metadata={"event_triggered": False})
