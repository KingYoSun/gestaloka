"""
イベント連鎖システムとAIエージェントの統合

各AIエージェントのイベントハンドラーを定義し、
イベント駆動型の相互作用を実現します。
"""

import uuid
from typing import Any, Optional

from app.ai.coordination_models import AIResponse
from app.ai.event_chain import EventChain
from app.ai.shared_context import EventPriority, EventType, GameEvent
from app.core.logging import get_logger

logger = get_logger(__name__)


class EventIntegration:
    """イベント統合クラス"""

    def __init__(self, event_chain: EventChain):
        self.event_chain = event_chain
        self.agents: dict[str, Any] = {}

    def register_agent(self, agent_name: str, agent_adapter) -> None:
        """エージェントを登録"""
        self.agents[agent_name] = agent_adapter

        # エージェントごとのイベントハンドラーを登録
        if agent_name == "dramatist":
            self._register_dramatist_handlers()
        elif agent_name == "state_manager":
            self._register_state_manager_handlers()
        elif agent_name == "historian":
            self._register_historian_handlers()
        elif agent_name == "npc_manager":
            self._register_npc_manager_handlers()
        elif agent_name == "the_world":
            self._register_world_handlers()
        elif agent_name == "anomaly":
            self._register_anomaly_handlers()

    def _register_dramatist_handlers(self) -> None:
        """脚本家AIのイベントハンドラー"""

        async def handle_dramatic_event(event: GameEvent) -> Optional[list[GameEvent]]:
            """劇的なイベントに対する物語的な反応"""
            if event.priority.value >= EventPriority.HIGH.value:
                logger.info(f"Dramatist handling dramatic event: {event.type.value}")
                # 物語的な演出が必要な場合は新しいイベントを生成
                # 実際の実装では、AIを呼び出して物語を生成
                return None
            return None

        self.event_chain.register_handler(
            agent_name="dramatist",
            event_types={EventType.PLAYER_DEATH, EventType.QUEST_COMPLETE, EventType.WORLD_EVENT},
            handler_func=handle_dramatic_event,
            priority=5,
        )

    def _register_state_manager_handlers(self) -> None:
        """状態管理AIのイベントハンドラー"""

        async def handle_state_change(event: GameEvent) -> Optional[list[GameEvent]]:
            """状態変更イベントの処理"""
            logger.info(f"State Manager handling: {event.type.value}")

            # プレイヤーのレベルアップ時の処理
            if event.type == EventType.PLAYER_LEVEL_UP:
                # スキルポイントの付与などの処理
                return [
                    GameEvent(
                        id=str(uuid.uuid4()),
                        type=EventType.STATE_CHANGE,
                        source="state_manager",
                        data={"skill_points": 3},
                        priority=EventPriority.NORMAL,
                    )
                ]

            return None

        self.event_chain.register_handler(
            agent_name="state_manager",
            event_types={EventType.PLAYER_LEVEL_UP, EventType.STATE_CHANGE, EventType.PLAYER_ACTION},
            handler_func=handle_state_change,
            priority=8,
        )

    def _register_historian_handlers(self) -> None:
        """歴史家AIのイベントハンドラー"""

        async def record_important_event(event: GameEvent) -> Optional[list[GameEvent]]:
            """重要なイベントを記録"""
            if event.priority.value >= EventPriority.HIGH.value:
                logger.info(f"Historian recording: {event.type.value}")
                # 歴史的記録の作成
                # 実際の実装では、データベースに記録
            return None

        self.event_chain.register_handler(
            agent_name="historian",
            event_types={
                EventType.QUEST_COMPLETE,
                EventType.PLAYER_DEATH,
                EventType.WORLD_EVENT,
                EventType.ACHIEVEMENT_UNLOCK,
            },
            handler_func=record_important_event,
            priority=3,
        )

    def _register_npc_manager_handlers(self) -> None:
        """NPC管理AIのイベントハンドラー"""

        async def handle_npc_event(event: GameEvent) -> Optional[list[GameEvent]]:
            """NPC関連イベントの処理"""
            logger.info(f"NPC Manager handling: {event.type.value}")

            # NPCの死亡時の処理
            if event.type == EventType.NPC_DEATH:
                npc_id = event.data.get("npc_id")
                # 関連NPCの反応を生成
                return [
                    GameEvent(
                        id=str(uuid.uuid4()),
                        type=EventType.NPC_INTERACTION,
                        source="npc_manager",
                        data={"npc_id": "nearby_npc", "reaction": "mourn", "target_npc": npc_id},
                        priority=EventPriority.NORMAL,
                    )
                ]

            return None

        self.event_chain.register_handler(
            agent_name="npc_manager",
            event_types={EventType.NPC_SPAWN, EventType.NPC_INTERACTION, EventType.NPC_DEATH},
            handler_func=handle_npc_event,
            priority=6,
        )

    def _register_world_handlers(self) -> None:
        """世界の意識AIのイベントハンドラー"""

        async def handle_world_event(event: GameEvent) -> Optional[list[GameEvent]]:
            """世界規模のイベント処理"""
            logger.info(f"World AI handling: {event.type.value}")

            # 天候変化の連鎖
            if event.type == EventType.WEATHER_CHANGE:
                weather = event.data.get("weather")
                if weather == "storm":
                    # 嵐による影響
                    return [
                        GameEvent(
                            id=str(uuid.uuid4()),
                            type=EventType.WORLD_EVENT,
                            source="the_world",
                            data={"event": "flooding", "affected_areas": ["lower_town", "riverside"]},
                            priority=EventPriority.HIGH,
                        )
                    ]

            return None

        self.event_chain.register_handler(
            agent_name="the_world",
            event_types={EventType.WORLD_EVENT, EventType.WEATHER_CHANGE, EventType.TIME_PASSAGE},
            handler_func=handle_world_event,
            priority=7,
        )

    def _register_anomaly_handlers(self) -> None:
        """混沌AIのイベントハンドラー"""

        async def trigger_chaos(event: GameEvent) -> Optional[list[GameEvent]]:
            """混沌イベントの連鎖"""
            logger.info(f"Anomaly AI reacting to: {event.type.value}")

            # 高優先度イベントに反応して混沌を生成
            if event.priority == EventPriority.CRITICAL:
                return [
                    GameEvent(
                        id=str(uuid.uuid4()),
                        type=EventType.ANOMALY_TRIGGER,
                        source="anomaly",
                        data={"chaos_type": "reality_glitch", "intensity": "medium", "trigger_event": event.id},
                        priority=EventPriority.HIGH,
                    )
                ]

            return None

        # 条件付きハンドラー（混沌レベルが高い時のみ）
        def chaos_condition(event: GameEvent) -> bool:
            # 実際の実装では、SharedContextから混沌レベルを確認
            return event.priority.value >= EventPriority.HIGH.value

        self.event_chain.register_handler(
            agent_name="anomaly",
            event_types={EventType.PLAYER_DEATH, EventType.REALITY_DISTORTION, EventType.ANOMALY_TRIGGER},
            handler_func=trigger_chaos,
            priority=4,
            conditions=chaos_condition,
        )

    async def create_event_from_response(self, response: AIResponse, event_type: EventType) -> Optional[GameEvent]:
        """AIレスポンスからイベントを生成"""
        if not response.success:
            return None

        # レスポンスのメタデータからイベントデータを抽出
        event_data: dict[str, Any] = {
            "agent": response.agent_name,
            "narrative": response.narrative[:100] if response.narrative else None,
            "has_choices": len(response.choices) > 0 if response.choices else False,
        }

        # 状態変更がある場合は高優先度
        priority = EventPriority.NORMAL
        if response.state_changes:
            priority = EventPriority.HIGH
            event_data["state_changes"] = response.state_changes

        return GameEvent(
            id=str(uuid.uuid4()),
            type=event_type,
            source=response.agent_name,
            data=event_data,
            priority=priority,
            can_trigger_chain=True,
        )
