"""
状態管理AI (State Manager) - ゲームルールとDB管理の中核
"""

import json
import re
from typing import Any, Optional

import structlog

from app.core.exceptions import AIServiceError
from app.services.ai.agents.base import AgentResponse, BaseAgent
from app.services.ai.prompt_manager import AIAgentRole, PromptContext

logger = structlog.get_logger(__name__)


class StateChangeResult:
    """状態変更の結果を表すクラス"""

    def __init__(
        self,
        success: bool,
        parameter_changes: dict[str, Any],
        triggered_events: list[dict[str, Any]],
        new_relationships: list[dict[str, Any]],
        reason: Optional[str] = None,
    ):
        self.success = success
        self.parameter_changes = parameter_changes
        self.triggered_events = triggered_events
        self.new_relationships = new_relationships
        self.reason = reason


class StateManagerAgent(BaseAgent):
    """
    状態管理AI (State Manager)

    全エンティティの状態を管理するルールエンジンとして、
    プレイヤーの行動結果を判定し、ステータス変更やイベントトリガーを管理します。
    """

    def __init__(self, **kwargs):
        """状態管理AIの初期化"""
        super().__init__(role=AIAgentRole.STATE_MANAGER, **kwargs)

        # ゲームルール定義
        self.rules = self._load_game_rules()

    def _load_game_rules(self) -> dict[str, Any]:
        """
        ゲームルールをロード

        Returns:
            ゲームルール辞書
        """
        return {
            "difficulty_modifiers": {"easy": 0.8, "medium": 1.0, "hard": 1.5},
            "base_success_rate": 0.7,
            "critical_threshold": 0.95,
            "critical_failure_threshold": 0.05,
            "status_limits": {
                "hp": {"min": 0, "max": 9999},
                "mp": {"min": 0, "max": 9999},
                "stamina": {"min": 0, "max": 100},
                "sanity": {"min": 0, "max": 100},
            },
            "action_costs": {
                "physical": {"stamina": 10, "hp": 0},
                "magical": {"mp": 20, "stamina": 5},
                "mental": {"sanity": 5, "mp": 10},
                "social": {"stamina": 5, "sanity": 0},
            },
        }

    async def process(self, context: PromptContext, **kwargs: Any) -> AgentResponse:
        """
        行動結果の判定と状態変更を処理

        Args:
            context: プロンプトコンテキスト
            **kwargs: 追加パラメータ（action_type, difficulty等）

        Returns:
            状態変更を含むレスポンス
        """
        # コンテキストの検証
        if not self.validate_context(context):
            raise AIServiceError("Invalid context for State Manager agent")

        try:
            # 行動情報の取得
            action = kwargs.get("action", context.recent_actions[-1] if context.recent_actions else "")
            action_type = kwargs.get("action_type", "physical")
            difficulty = kwargs.get("difficulty", "medium")

            # コンテキストの拡張
            enhanced_context = self._enhance_context(context, action, action_type, difficulty)

            # AIによる判定生成
            raw_response = await self.generate_response(
                enhanced_context,
                temperature=kwargs.get("temperature", 0.3),  # 判定は一貫性重視で低めの温度
                max_tokens=kwargs.get("max_tokens", 1000),
            )

            # レスポンスの解析
            state_changes = self._parse_response(raw_response)

            # ルールベースの検証と調整
            validated_changes = self._validate_state_changes(context.character_stats, state_changes, action_type)

            # メタデータの構築
            metadata = self.extract_metadata(context)
            metadata.update(
                {
                    "action_type": action_type,
                    "difficulty": difficulty,
                    "success": validated_changes.success,
                    "critical_hit": self._check_critical(validated_changes),
                    "rules_applied": True,
                }
            )

            return AgentResponse(
                agent_role=self.role.value,
                state_changes={
                    "success": validated_changes.success,
                    "parameter_changes": validated_changes.parameter_changes,
                    "triggered_events": validated_changes.triggered_events,
                    "new_relationships": validated_changes.new_relationships,
                    "reason": validated_changes.reason,
                },
                metadata=metadata,
            )

        except Exception as e:
            self.logger.error("State Manager processing failed", error=str(e), character=context.character_name)
            raise AIServiceError(f"State Manager agent error: {e!s}")

    def _enhance_context(self, context: PromptContext, action: str, action_type: str, difficulty: str) -> PromptContext:
        """
        状態管理AI用にコンテキストを拡張

        Args:
            context: 元のコンテキスト
            action: 実行された行動
            action_type: 行動タイプ
            difficulty: 難易度

        Returns:
            拡張されたコンテキスト
        """
        # 戦闘中かどうかを確認
        battle_context = {}
        if context.additional_context and "battle_data" in context.additional_context:
            battle_data = context.additional_context["battle_data"]
            if battle_data and battle_data.get("state") not in ["none", "finished"]:
                battle_context = {
                    "is_in_battle": True,
                    "battle_state": battle_data.get("state"),
                    "battle_turn": battle_data.get("turn_count", 0),
                    "combatants": battle_data.get("combatants", []),
                    "battle_rules": {
                        "damage_calculation": "base_attack - (defense / 2) + random(-20%, +20%)",
                        "critical_chance": 0.1,
                        "escape_base_chance": 0.5,
                        "defense_damage_reduction": 0.5,
                    }
                }
        
        # 追加コンテキストに判定用情報を追加
        context.additional_context.update(
            {
                "action": action,
                "action_type": action_type,
                "difficulty": difficulty,
                "base_success_rate": self.rules["base_success_rate"],
                "difficulty_modifier": self.rules["difficulty_modifiers"].get(difficulty, 1.0),
                "action_cost": self.rules["action_costs"].get(action_type, {}),
                "current_buffs": context.character_stats.get("buffs", []),
                "current_debuffs": context.character_stats.get("debuffs", []),
                "environment_modifiers": self._calculate_environment_modifiers(context),
                **battle_context,
            }
        )

        return context

    def _calculate_environment_modifiers(self, context: PromptContext) -> dict[str, float]:
        """
        環境による修正値を計算

        Args:
            context: プロンプトコンテキスト

        Returns:
            環境修正値辞書
        """
        modifiers = {}

        # 時間帯による修正
        time_of_day = context.world_state.get("time_of_day", "昼")
        if time_of_day == "夜":
            modifiers["visibility"] = 0.7
            modifiers["stealth"] = 1.3
        elif time_of_day == "朝":
            modifiers["energy"] = 1.2

        # 天候による修正
        weather = context.world_state.get("weather", "晴れ")
        if weather == "雨":
            modifiers["physical_action"] = 0.8
            modifiers["fire_magic"] = 0.5
        elif weather == "霧":
            modifiers["visibility"] = 0.5
            modifiers["mysterious_encounter"] = 1.5

        # 場所による修正
        location = context.location
        if "森" in location:
            modifiers["nature_affinity"] = 1.2
        elif "都市" in location:
            modifiers["social_action"] = 1.2
        elif "遺跡" in location:
            modifiers["magical_power"] = 1.3
            modifiers["danger"] = 1.5

        return modifiers

    def _parse_response(self, raw_response: str) -> StateChangeResult:
        """
        AIレスポンスを解析して状態変更を抽出

        Args:
            raw_response: 生のAIレスポンス

        Returns:
            状態変更結果
        """
        try:
            # JSONブロックを抽出
            json_match = re.search(r"```json\s*(.*?)\s*```", raw_response, re.DOTALL)
            if json_match:
                json_str = json_match.group(1)
            else:
                # JSONブロックがない場合は全体をJSONとして試す
                json_str = raw_response

            # JSON解析
            data = json.loads(json_str)

            return StateChangeResult(
                success=data.get("success", True),
                parameter_changes=data.get("parameter_changes", {}),
                triggered_events=data.get("triggered_events", []),
                new_relationships=data.get("new_relationships", []),
                reason=data.get("reason"),
            )

        except json.JSONDecodeError:
            self.logger.warning("Failed to parse JSON response, using fallback")
            # フォールバック: テキストから簡易的に解析
            return self._fallback_parse(raw_response)

    def _fallback_parse(self, raw_response: str) -> StateChangeResult:
        """
        JSON解析に失敗した場合のフォールバック解析

        Args:
            raw_response: 生のAIレスポンス

        Returns:
            状態変更結果
        """
        # 成功/失敗の判定
        success = "成功" in raw_response or "success" in raw_response.lower()

        # パラメータ変更の簡易抽出
        parameter_changes = {}
        if "HP" in raw_response or "hp" in raw_response:
            # 簡単な数値抽出（例: "HP -10"）
            hp_match = re.search(r"HP\s*([+-]?\d+)", raw_response, re.IGNORECASE)
            if hp_match:
                parameter_changes["hp"] = int(hp_match.group(1))

        if "MP" in raw_response or "mp" in raw_response:
            mp_match = re.search(r"MP\s*([+-]?\d+)", raw_response, re.IGNORECASE)
            if mp_match:
                parameter_changes["mp"] = int(mp_match.group(1))

        return StateChangeResult(
            success=success,
            parameter_changes=parameter_changes,
            triggered_events=[],
            new_relationships=[],
            reason="AI response parsing fallback",
        )

    def _validate_state_changes(
        self, current_stats: dict[str, Any], state_changes: StateChangeResult, action_type: str
    ) -> StateChangeResult:
        """
        状態変更をゲームルールに基づいて検証・調整

        Args:
            current_stats: 現在のキャラクターステータス
            state_changes: AI判定による状態変更
            action_type: 行動タイプ

        Returns:
            検証済みの状態変更
        """
        validated_changes = state_changes.parameter_changes.copy()

        # アクションコストの適用
        action_cost = self.rules["action_costs"].get(action_type, {})
        for resource, cost in action_cost.items():
            if cost > 0:
                current_value = validated_changes.get(resource, 0)
                validated_changes[resource] = current_value - cost

        # ステータス上限・下限の適用
        for stat, change in validated_changes.items():
            if stat in self.rules["status_limits"]:
                limits = self.rules["status_limits"][stat]
                current_value = current_stats.get(stat, 0)
                new_value = current_value + change

                # 上限・下限でクリップ
                new_value = max(limits["min"], min(new_value, limits["max"]))
                validated_changes[stat] = new_value - current_value

        # HP0チェック
        final_hp = current_stats.get("hp", 100) + validated_changes.get("hp", 0)
        if final_hp <= 0:
            # 戦闘不能イベントのトリガー
            if not any(event.get("type") == "incapacitated" for event in state_changes.triggered_events):
                state_changes.triggered_events.append(
                    {
                        "type": "incapacitated",
                        "description": "HPが0になり、戦闘不能状態になりました",
                        "severity": "critical",
                    }
                )

        # 戦闘トリガーのチェック（戦闘中でない場合）
        if not self._is_in_battle(action_type):
            for event in state_changes.triggered_events:
                if event.get("type") == "combat_encounter":
                    validated_changes["battle_triggered"] = True
                    validated_changes["enemy_data"] = event.get("enemy_data")
                    break

        return StateChangeResult(
            success=state_changes.success,
            parameter_changes=validated_changes,
            triggered_events=state_changes.triggered_events,
            new_relationships=state_changes.new_relationships,
            reason=state_changes.reason,
        )
    
    def _is_in_battle(self, action_type: str) -> bool:
        """戦闘中かどうかを判定"""
        # processメソッド内でコンテキストにis_in_battleフラグを設定しているため、
        # ここではaction_typeから簡易的に判定
        return action_type in ["battle_attack", "battle_defend", "battle_escape", "battle_skill"]

    def _check_critical(self, state_changes: StateChangeResult) -> bool:
        """
        クリティカルヒットの判定

        Args:
            state_changes: 状態変更結果

        Returns:
            クリティカルヒットかどうか
        """
        # イベントにクリティカル関連があるかチェック
        for event in state_changes.triggered_events:
            if "critical" in event.get("type", "").lower():
                return True

        # パラメータ変更が大きい場合
        for param, change in state_changes.parameter_changes.items():
            if param in ["hp", "mp"] and abs(change) > 50:
                return True

        return False

    async def calculate_action_result(
        self,
        character_stats: dict[str, Any],
        action: str,
        difficulty: str = "medium",
        modifiers: Optional[dict[str, float]] = None,
    ) -> dict[str, Any]:
        """
        行動の成功率と結果を計算（外部から呼び出し可能）

        Args:
            character_stats: キャラクターステータス
            action: 実行する行動
            difficulty: 難易度
            modifiers: 追加修正値

        Returns:
            計算結果
        """
        base_rate = self.rules["base_success_rate"]
        difficulty_mod = self.rules["difficulty_modifiers"].get(difficulty, 1.0)

        # キャラクターレベルによる修正
        level = character_stats.get("level", 1)
        level_mod = 1.0 + (level - 1) * 0.02  # レベル毎に2%向上

        # 最終成功率
        success_rate = base_rate * difficulty_mod * level_mod

        # 修正値の適用
        if modifiers:
            for mod_value in modifiers.values():
                success_rate *= mod_value

        # 0-1の範囲にクリップ
        success_rate = max(0.0, min(1.0, success_rate))

        return {
            "success_rate": success_rate,
            "critical_chance": max(0, success_rate - self.rules["critical_threshold"]),
            "failure_chance": max(0, self.rules["critical_failure_threshold"] - success_rate),
        }

