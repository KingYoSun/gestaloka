"""
AI協調動作のための共有コンテキスト管理システム

このモジュールは、GM AI評議会のメンバー間で共有される情報を管理し、
効率的な協調動作を実現するための基盤を提供します。
"""

import asyncio
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional

import structlog

from app.models.enums import TimeOfDay, Weather

logger = structlog.get_logger()


class EventPriority(Enum):
    """イベントの優先度"""

    LOW = 1
    NORMAL = 2
    HIGH = 3
    CRITICAL = 4


class EventType(Enum):
    """イベントタイプの定義"""

    # プレイヤー起因イベント
    PLAYER_ACTION = "player_action"
    PLAYER_LEVEL_UP = "player_level_up"
    PLAYER_DEATH = "player_death"

    # 世界イベント
    WORLD_EVENT = "world_event"
    WEATHER_CHANGE = "weather_change"
    TIME_PASSAGE = "time_passage"

    # NPCイベント
    NPC_SPAWN = "npc_spawn"
    NPC_INTERACTION = "npc_interaction"
    NPC_DEATH = "npc_death"

    # 混沌イベント
    ANOMALY_TRIGGER = "anomaly_trigger"
    REALITY_DISTORTION = "reality_distortion"

    # システムイベント
    QUEST_COMPLETE = "quest_complete"
    ACHIEVEMENT_UNLOCK = "achievement_unlock"
    STATE_CHANGE = "state_change"


@dataclass
class WorldState:
    """世界の状態を表すデータクラス"""

    stability: float = 1.0  # 世界の安定度 (0.0-1.0)
    chaos_level: float = 0.0  # 混沌レベル (0.0-1.0)
    active_world_events: list[str] = field(default_factory=list)
    world_modifiers: dict[str, float] = field(default_factory=dict)


@dataclass
class CharacterState:
    """キャラクターの状態を表すデータクラス"""

    character_id: str
    level: int
    hp: int
    max_hp: int
    mp: int
    max_mp: int
    stamina: int
    max_stamina: int
    sanity: int
    max_sanity: int
    location: str
    status_effects: list[str] = field(default_factory=list)
    active_quests: list[str] = field(default_factory=list)


@dataclass
class NPCState:
    """NPCの状態を表すデータクラス"""

    npc_id: str
    name: str
    location: str
    relationship_level: float = 0.0  # -1.0 (敵対) to 1.0 (友好)
    is_active: bool = True
    current_behavior: str = "idle"
    memory: list[str] = field(default_factory=list)


@dataclass
class GameEvent:
    """ゲームイベントを表すデータクラス"""

    id: str
    type: EventType
    source: str  # 発生源（AI名またはシステム）
    timestamp: datetime = field(default_factory=lambda: datetime.utcnow())
    data: dict[str, Any] = field(default_factory=dict)
    priority: EventPriority = EventPriority.NORMAL

    # イベント連鎖情報
    parent_event_id: Optional[str] = None
    can_trigger_chain: bool = True
    max_chain_depth: int = 3


@dataclass
class PlayerAction:
    """プレイヤーのアクションを表すデータクラス"""

    action_id: str
    action_type: str
    action_text: str
    timestamp: datetime = field(default_factory=lambda: datetime.utcnow())
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class Decision:
    """重要な決定事項を表すデータクラス"""

    decision_id: str
    decision_type: str
    description: str
    timestamp: datetime
    impact_level: str  # "low", "medium", "high", "critical"
    affected_entities: list[str] = field(default_factory=list)


@dataclass
class AIDecision:
    """AI の決定を表すデータクラス"""

    agent_name: str
    decision_type: str
    reasoning: str
    confidence: float
    timestamp: datetime = field(default_factory=lambda: datetime.utcnow())
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class TemporaryEffect:
    """一時的な効果を表すデータクラス"""

    effect_id: str
    effect_type: str
    description: str
    duration_turns: int
    remaining_turns: int
    modifiers: dict[str, float] = field(default_factory=dict)


@dataclass
class SharedContext:
    """AI間で共有されるコンテキスト情報"""

    # セッション情報
    session_id: str
    turn_number: int = 0

    # 世界状態
    world_state: WorldState = field(default_factory=WorldState)
    weather: Weather = Weather.CLEAR
    time_of_day: TimeOfDay = TimeOfDay.MORNING
    active_events: list[GameEvent] = field(default_factory=list)

    # キャラクター状態
    player_state: Optional[CharacterState] = None
    active_npcs: dict[str, NPCState] = field(default_factory=dict)

    # 履歴情報（最大保持数を設定）
    recent_actions: deque[PlayerAction] = field(default_factory=lambda: deque(maxlen=10))
    recent_events: deque[GameEvent] = field(default_factory=lambda: deque(maxlen=20))
    important_decisions: list[Decision] = field(default_factory=list)

    # AI決定履歴
    ai_decisions: dict[str, list[AIDecision]] = field(default_factory=dict)

    # 一時的な効果
    active_effects: list[TemporaryEffect] = field(default_factory=list)
    environmental_modifiers: dict[str, float] = field(default_factory=dict)

    # メタデータ
    last_updated: datetime = field(default_factory=lambda: datetime.utcnow())
    update_count: int = 0


class SharedContextManager:
    """SharedContextの管理クラス"""

    def __init__(self, session_id: str):
        self.context = SharedContext(session_id=session_id)
        self.update_lock = asyncio.Lock()
        self.update_history: list[dict[str, Any]] = []
        self.change_listeners: list[Any] = []  # コールバック関数のリスト

    async def update(self, updates: dict[str, Any]) -> None:
        """コンテキストを更新する"""
        async with self.update_lock:
            try:
                # 更新前の状態を記録
                before_state = self._get_current_state()

                # 更新を適用
                for key, value in updates.items():
                    if hasattr(self.context, key):
                        setattr(self.context, key, value)
                    else:
                        logger.warning(f"Unknown context attribute: {key}", session_id=self.context.session_id)

                # メタデータ更新
                self.context.last_updated = datetime.utcnow()
                self.context.update_count += 1

                # 更新履歴の記録
                self._log_update(updates, before_state)

                # 関連AIへの通知
                await self._notify_context_change(updates)

            except Exception as e:
                logger.error("Failed to update shared context", error=str(e), session_id=self.context.session_id)
                raise

    def add_player_action(self, action: PlayerAction) -> None:
        """プレイヤーアクションを履歴に追加"""
        self.context.recent_actions.append(action)

    def add_game_event(self, event: GameEvent) -> None:
        """ゲームイベントを履歴に追加"""
        self.context.recent_events.append(event)

        # 重要なイベントは別途保存
        if event.priority in [EventPriority.HIGH, EventPriority.CRITICAL]:
            self.context.active_events.append(event)

    def add_ai_decision(self, agent_name: str, decision: AIDecision) -> None:
        """AI決定を履歴に追加"""
        if agent_name not in self.context.ai_decisions:
            self.context.ai_decisions[agent_name] = []

        self.context.ai_decisions[agent_name].append(decision)

        # 古い決定を削除（最新10件のみ保持）
        if len(self.context.ai_decisions[agent_name]) > 10:
            self.context.ai_decisions[agent_name] = self.context.ai_decisions[agent_name][-10:]

    def update_turn(self) -> None:
        """ターンを進める"""
        self.context.turn_number += 1

        # 一時効果の残りターン数を減らす
        for effect in self.context.active_effects:
            effect.remaining_turns -= 1

        # 期限切れの効果を削除
        self.context.active_effects = [effect for effect in self.context.active_effects if effect.remaining_turns > 0]

    def get_recent_context(self, num_actions: int = 5) -> dict[str, Any]:
        """最近のコンテキスト情報を取得"""
        return {
            "turn_number": self.context.turn_number,
            "world_state": self.context.world_state,
            "weather": self.context.weather,
            "time_of_day": self.context.time_of_day,
            "recent_actions": list(self.context.recent_actions)[-num_actions:],
            "recent_events": list(self.context.recent_events)[-num_actions:],
            "player_state": self.context.player_state,
            "active_npcs": list(self.context.active_npcs.values()),
            "active_effects": self.context.active_effects,
            "environmental_modifiers": self.context.environmental_modifiers,
        }

    def get_ai_context(self, agent_name: str) -> dict[str, Any]:
        """特定のAIエージェント用のコンテキストを取得"""
        base_context = self.get_recent_context()

        # エージェント固有の情報を追加
        if agent_name in self.context.ai_decisions:
            base_context["previous_decisions"] = self.context.ai_decisions[agent_name][-3:]

        return base_context

    def register_change_listener(self, callback: Any) -> None:
        """コンテキスト変更時のリスナーを登録"""
        self.change_listeners.append(callback)

    def _get_current_state(self) -> dict[str, Any]:
        """現在の状態のスナップショットを取得"""
        return {
            "turn_number": self.context.turn_number,
            "world_stability": self.context.world_state.stability,
            "chaos_level": self.context.world_state.chaos_level,
            "player_hp": self.context.player_state.hp if self.context.player_state else None,
            "active_npcs_count": len(self.context.active_npcs),
            "active_effects_count": len(self.context.active_effects),
        }

    def _log_update(self, updates: dict[str, Any], before_state: dict[str, Any]) -> None:
        """更新履歴を記録"""
        update_record = {
            "timestamp": datetime.utcnow(),
            "updates": updates,
            "before_state": before_state,
            "after_state": self._get_current_state(),
        }

        self.update_history.append(update_record)

        # 履歴が100件を超えたら古いものを削除
        if len(self.update_history) > 100:
            self.update_history = self.update_history[-100:]

        logger.info(
            "Shared context updated",
            session_id=self.context.session_id,
            update_count=self.context.update_count,
            changes=list(updates.keys()),
        )

    async def _notify_context_change(self, updates: dict[str, Any]) -> None:
        """コンテキスト変更を関連AIに通知"""
        for listener in self.change_listeners:
            try:
                if asyncio.iscoroutinefunction(listener):
                    await listener(updates, self.context)
                else:
                    listener(updates, self.context)
            except Exception as e:
                logger.error(
                    "Failed to notify context change listener", error=str(e), session_id=self.context.session_id
                )
