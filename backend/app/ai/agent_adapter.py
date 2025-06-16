"""
既存のAIエージェントを協調動作システムに適応させるアダプター
"""

from typing import Any

from app.ai.coordination_models import ActionContext, AIResponse, Choice
from app.ai.shared_context import SharedContext
from app.services.ai.agents.base import AgentResponse, BaseAgent
from app.services.ai.prompt_manager import PromptContext


class CoordinationAgentAdapter:
    """既存のBaseAgentを協調動作システムに適応させるアダプター"""

    def __init__(self, agent: BaseAgent):
        self.agent = agent
        self.name = agent.role.value

    async def process(
        self,
        context: dict[str, Any],
        shared_context: SharedContext
    ) -> AIResponse:
        """
        協調動作用の処理メソッド

        Args:
            context: アクションコンテキスト
            shared_context: 共有コンテキスト

        Returns:
            AIResponse
        """
        # アクションコンテキストから情報を抽出
        if isinstance(context.get("action"), ActionContext):
            action_context = context["action"]
            action = {
                "action_id": action_context.action_id,
                "action_type": action_context.action_type,
                "action_text": action_context.action_text,
                "character_name": getattr(action_context, "character_name", "Unknown")
            }
        else:
            action = context.get("action", {})

        # previous_responses = context.get("previous_responses", {})  # Currently unused

        # PromptContextを構築
        shared_ctx = context.get("shared_context", {})
        player_state = shared_ctx.get("player_state", {})

        # player_stateがNoneの場合は空の辞書にする
        if player_state is None:
            player_state = {}

        prompt_context = PromptContext(
            character_name=action.get("character_name", "Unknown"),
            character_stats=player_state if isinstance(player_state, dict) else {},
            location=shared_ctx.get("location", "Unknown"),
            recent_actions=self._format_recent_history(shared_context),
            world_state=self._extract_game_state(shared_context),
            session_history=[],
            additional_context={"action": action.get("action_text", "")}
        )

        # 既存のprocessメソッドを呼び出し
        agent_response = await self.agent.process(prompt_context)

        # AIResponseに変換
        return self._convert_to_ai_response(agent_response)

    def _format_recent_history(self, shared_context: SharedContext) -> list[str]:
        """最近の履歴をフォーマット"""
        history = []

        # 最近のアクションを追加
        for action in list(shared_context.recent_actions)[-5:]:
            history.append(f"[アクション] {action.action_text}")

        # 最近のイベントを追加
        for event in list(shared_context.recent_events)[-5:]:
            history.append(f"[イベント] {event.type.value}: {event.data.get('description', '')}")

        return history

    def _extract_game_state(self, shared_context: SharedContext) -> dict[str, Any]:
        """ゲーム状態を抽出"""
        return {
            "turn_number": shared_context.turn_number,
            "world_state": {
                "stability": shared_context.world_state.stability,
                "chaos_level": shared_context.world_state.chaos_level
            },
            "weather": shared_context.weather.value,
            "time_of_day": shared_context.time_of_day.value,
            "active_npcs": len(shared_context.active_npcs),
            "active_effects": [
                {
                    "type": effect.effect_type,
                    "remaining_turns": effect.remaining_turns
                }
                for effect in shared_context.active_effects
            ]
        }

    def _convert_to_ai_response(self, agent_response: AgentResponse) -> AIResponse:
        """AgentResponseをAIResponseに変換"""
        choices = []

        if agent_response.choices:
            choices = [
                Choice(
                    id=choice.id,
                    text=choice.text,
                    description=getattr(choice, "description", None)
                )
                for choice in agent_response.choices
            ]

        return AIResponse(
            agent_name=self.name,
            task_id="",  # タスクIDは後で設定される
            narrative=agent_response.narrative,
            choices=choices,
            state_changes=agent_response.state_changes,
            events=[],  # イベントは別途処理
            metadata=agent_response.metadata,
            success=True
        )


