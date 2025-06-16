"""
SharedContext のテスト
"""

import asyncio
from datetime import datetime
from unittest.mock import AsyncMock, Mock

import pytest

from app.ai.shared_context import (
    AIDecision,
    CharacterState,
    Decision,
    EventPriority,
    EventType,
    GameEvent,
    NPCState,
    PlayerAction,
    SharedContext,
    SharedContextManager,
    TemporaryEffect,
    WorldState,
)
from app.models.enums import TimeOfDay, Weather


class TestSharedContext:
    """SharedContext のテスト"""
    
    def test_shared_context_initialization(self):
        """SharedContext の初期化テスト"""
        context = SharedContext(session_id="test_session")
        
        assert context.session_id == "test_session"
        assert context.turn_number == 0
        assert isinstance(context.world_state, WorldState)
        assert context.weather == Weather.CLEAR
        assert context.time_of_day == TimeOfDay.MORNING
        assert len(context.recent_actions) == 0
        assert len(context.recent_events) == 0
    
    def test_world_state_defaults(self):
        """WorldState のデフォルト値テスト"""
        world_state = WorldState()
        
        assert world_state.stability == 1.0
        assert world_state.chaos_level == 0.0
        assert len(world_state.active_world_events) == 0
        assert len(world_state.world_modifiers) == 0
    
    def test_character_state_creation(self):
        """CharacterState の作成テスト"""
        char_state = CharacterState(
            character_id="char_001",
            level=5,
            hp=80,
            max_hp=100,
            mp=30,
            max_mp=50,
            stamina=40,
            max_stamina=50,
            sanity=90,
            max_sanity=100,
            location="森の入り口"
        )
        
        assert char_state.character_id == "char_001"
        assert char_state.level == 5
        assert char_state.hp == 80
        assert char_state.location == "森の入り口"
        assert len(char_state.status_effects) == 0
    
    def test_game_event_creation(self):
        """GameEvent の作成テスト"""
        event = GameEvent(
            id="event_001",
            type=EventType.PLAYER_ACTION,
            source="player",
            data={"action": "attack", "target": "goblin"}
        )
        
        assert event.id == "event_001"
        assert event.type == EventType.PLAYER_ACTION
        assert event.source == "player"
        assert event.priority == EventPriority.NORMAL
        assert event.can_trigger_chain is True
        assert event.max_chain_depth == 3


class TestSharedContextManager:
    """SharedContextManager のテスト"""
    
    @pytest.fixture
    def manager(self):
        """テスト用の SharedContextManager インスタンス"""
        return SharedContextManager(session_id="test_session")
    
    @pytest.mark.asyncio
    async def test_manager_initialization(self, manager):
        """SharedContextManager の初期化テスト"""
        assert manager.context.session_id == "test_session"
        assert manager.context.turn_number == 0
        assert len(manager.update_history) == 0
        assert len(manager.change_listeners) == 0
    
    @pytest.mark.asyncio
    async def test_update_context(self, manager):
        """コンテキスト更新のテスト"""
        updates = {
            "turn_number": 5,
            "weather": Weather.RAIN,
            "time_of_day": TimeOfDay.NIGHT
        }
        
        await manager.update(updates)
        
        assert manager.context.turn_number == 5
        assert manager.context.weather == Weather.RAIN
        assert manager.context.time_of_day == TimeOfDay.NIGHT
        assert manager.context.update_count == 1
        assert len(manager.update_history) == 1
    
    @pytest.mark.asyncio
    async def test_update_with_invalid_attribute(self, manager):
        """無効な属性での更新テスト（警告は出るが例外は発生しない）"""
        updates = {
            "turn_number": 10,
            "invalid_attribute": "should_be_ignored"
        }
        
        await manager.update(updates)
        
        assert manager.context.turn_number == 10
        assert not hasattr(manager.context, "invalid_attribute")
    
    def test_add_player_action(self, manager):
        """プレイヤーアクション追加のテスト"""
        action = PlayerAction(
            action_id="action_001",
            action_type="movement",
            action_text="北へ移動する"
        )
        
        manager.add_player_action(action)
        
        assert len(manager.context.recent_actions) == 1
        assert manager.context.recent_actions[0] == action
    
    def test_recent_actions_limit(self, manager):
        """recent_actions の最大保持数テスト"""
        # 15個のアクションを追加（最大10個）
        for i in range(15):
            action = PlayerAction(
                action_id=f"action_{i:03d}",
                action_type="test",
                action_text=f"Action {i}"
            )
            manager.add_player_action(action)
        
        assert len(manager.context.recent_actions) == 10
        assert manager.context.recent_actions[0].action_id == "action_005"
        assert manager.context.recent_actions[-1].action_id == "action_014"
    
    def test_add_game_event(self, manager):
        """ゲームイベント追加のテスト"""
        event = GameEvent(
            id="event_001",
            type=EventType.WORLD_EVENT,
            source="world_ai",
            priority=EventPriority.HIGH
        )
        
        manager.add_game_event(event)
        
        assert len(manager.context.recent_events) == 1
        assert len(manager.context.active_events) == 1  # HIGH優先度なので保存される
        assert manager.context.recent_events[0] == event
    
    def test_add_game_event_normal_priority(self, manager):
        """通常優先度のイベント追加テスト"""
        event = GameEvent(
            id="event_002",
            type=EventType.NPC_SPAWN,
            source="npc_manager",
            priority=EventPriority.NORMAL
        )
        
        manager.add_game_event(event)
        
        assert len(manager.context.recent_events) == 1
        assert len(manager.context.active_events) == 0  # NORMAL優先度なので保存されない
    
    def test_add_ai_decision(self, manager):
        """AI決定追加のテスト"""
        decision = AIDecision(
            agent_name="dramatist",
            decision_type="narrative",
            reasoning="プレイヤーが新しいエリアに入った",
            confidence=0.9
        )
        
        manager.add_ai_decision("dramatist", decision)
        
        assert "dramatist" in manager.context.ai_decisions
        assert len(manager.context.ai_decisions["dramatist"]) == 1
        assert manager.context.ai_decisions["dramatist"][0] == decision
    
    def test_ai_decision_limit(self, manager):
        """AI決定の最大保持数テスト"""
        # 15個の決定を追加（最大10個）
        for i in range(15):
            decision = AIDecision(
                agent_name="state_manager",
                decision_type="rule_check",
                reasoning=f"Decision {i}",
                confidence=0.8
            )
            manager.add_ai_decision("state_manager", decision)
        
        assert len(manager.context.ai_decisions["state_manager"]) == 10
        assert manager.context.ai_decisions["state_manager"][0].reasoning == "Decision 5"
        assert manager.context.ai_decisions["state_manager"][-1].reasoning == "Decision 14"
    
    def test_update_turn(self, manager):
        """ターン更新のテスト"""
        # 一時効果を追加
        effect1 = TemporaryEffect(
            effect_id="effect_001",
            effect_type="buff",
            description="攻撃力上昇",
            duration_turns=3,
            remaining_turns=3
        )
        effect2 = TemporaryEffect(
            effect_id="effect_002",
            effect_type="debuff",
            description="移動速度低下",
            duration_turns=1,
            remaining_turns=1
        )
        
        manager.context.active_effects = [effect1, effect2]
        
        # ターンを更新
        manager.update_turn()
        
        assert manager.context.turn_number == 1
        assert len(manager.context.active_effects) == 1  # effect2は期限切れで削除
        assert manager.context.active_effects[0].effect_id == "effect_001"
        assert manager.context.active_effects[0].remaining_turns == 2
    
    def test_get_recent_context(self, manager):
        """最近のコンテキスト取得テスト"""
        # テストデータを設定
        manager.context.turn_number = 5
        manager.context.weather = Weather.STORM
        
        # アクションを追加
        for i in range(3):
            action = PlayerAction(
                action_id=f"action_{i}",
                action_type="test",
                action_text=f"Action {i}"
            )
            manager.add_player_action(action)
        
        # コンテキストを取得
        recent_context = manager.get_recent_context(num_actions=2)
        
        assert recent_context["turn_number"] == 5
        assert recent_context["weather"] == Weather.STORM
        assert len(recent_context["recent_actions"]) == 2
        assert recent_context["recent_actions"][0].action_id == "action_1"
        assert recent_context["recent_actions"][1].action_id == "action_2"
    
    def test_get_ai_context(self, manager):
        """AI用コンテキスト取得テスト"""
        # AI決定を追加
        for i in range(5):
            decision = AIDecision(
                agent_name="dramatist",
                decision_type="narrative",
                reasoning=f"Decision {i}",
                confidence=0.8 + i * 0.02
            )
            manager.add_ai_decision("dramatist", decision)
        
        # AI用コンテキストを取得
        ai_context = manager.get_ai_context("dramatist")
        
        assert "previous_decisions" in ai_context
        assert len(ai_context["previous_decisions"]) == 3  # 最新3件
        assert ai_context["previous_decisions"][0].reasoning == "Decision 2"
        assert ai_context["previous_decisions"][2].reasoning == "Decision 4"
    
    @pytest.mark.asyncio
    async def test_change_listener_notification(self, manager):
        """変更リスナー通知のテスト"""
        # モックリスナーを作成
        async_listener = AsyncMock()
        sync_listener = Mock()
        
        manager.register_change_listener(async_listener)
        manager.register_change_listener(sync_listener)
        
        # コンテキストを更新
        updates = {"turn_number": 10}
        await manager.update(updates)
        
        # リスナーが呼び出されたことを確認
        async_listener.assert_called_once()
        sync_listener.assert_called_once()
        
        # 呼び出し時の引数を確認
        call_args = async_listener.call_args[0]
        assert call_args[0] == updates
        assert isinstance(call_args[1], SharedContext)
    
    @pytest.mark.asyncio
    async def test_concurrent_updates(self, manager):
        """並行更新のテスト（ロックが正しく機能することを確認）"""
        update_count = 10
        
        async def update_turn(turn: int):
            await manager.update({"turn_number": turn})
        
        # 並行して複数の更新を実行
        tasks = [update_turn(i) for i in range(update_count)]
        await asyncio.gather(*tasks)
        
        # 更新回数が正しいことを確認
        assert manager.context.update_count == update_count
        assert len(manager.update_history) == update_count
    
    def test_update_history_limit(self, manager):
        """更新履歴の最大保持数テスト"""
        # 150回更新（最大100件）
        async def update_many():
            for i in range(150):
                await manager.update({"turn_number": i})
        
        asyncio.run(update_many())
        
        assert len(manager.update_history) == 100
        assert manager.update_history[0]["updates"]["turn_number"] == 50
        assert manager.update_history[-1]["updates"]["turn_number"] == 149