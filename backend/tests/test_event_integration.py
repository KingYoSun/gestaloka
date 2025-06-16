"""
イベント統合システムのテスト
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.ai.coordination_models import AIResponse
from app.ai.event_chain import EventChain
from app.ai.event_integration import EventIntegration
from app.ai.shared_context import EventPriority, EventType, GameEvent


class TestEventIntegration:
    """EventIntegration のテスト"""
    
    @pytest.fixture
    def event_chain(self):
        """テスト用の EventChain インスタンス"""
        return EventChain()
    
    @pytest.fixture
    def event_integration(self, event_chain):
        """テスト用の EventIntegration インスタンス"""
        return EventIntegration(event_chain)
    
    def test_register_agent(self, event_integration):
        """エージェント登録のテスト"""
        mock_agent = MagicMock()
        
        # 各エージェントタイプの登録をテスト
        agent_types = [
            "dramatist", "state_manager", "historian",
            "npc_manager", "the_world", "anomaly"
        ]
        
        for agent_type in agent_types:
            event_integration.register_agent(agent_type, mock_agent)
            assert agent_type in event_integration.agents
            assert event_integration.agents[agent_type] == mock_agent
    
    @pytest.mark.asyncio
    async def test_dramatist_handlers(self, event_integration, event_chain):
        """脚本家AIのハンドラーテスト"""
        # 脚本家AIを登録
        event_integration.register_agent("dramatist", MagicMock())
        
        # 高優先度イベントを作成
        high_priority_event = GameEvent(
            id="high_priority_event",
            type=EventType.PLAYER_DEATH,
            source="test",
            data={"player_id": "test_player"},
            priority=EventPriority.CRITICAL
        )
        
        # イベントを発行して処理
        await event_chain.emit_event(high_priority_event)
        await event_chain.process_events()
        
        # ハンドラーが登録されていることを確認
        assert EventType.PLAYER_DEATH in event_chain.handlers
        assert EventType.QUEST_COMPLETE in event_chain.handlers
        assert EventType.WORLD_EVENT in event_chain.handlers
    
    @pytest.mark.asyncio
    async def test_state_manager_level_up_handler(self, event_integration, event_chain):
        """状態管理AIのレベルアップハンドラーテスト"""
        event_integration.register_agent("state_manager", MagicMock())
        
        # レベルアップイベントを作成
        level_up_event = GameEvent(
            id="level_up_event",
            type=EventType.PLAYER_LEVEL_UP,
            source="test",
            data={"player_id": "test_player", "new_level": 5},
            priority=EventPriority.HIGH
        )
        
        # イベントを発行して処理
        await event_chain.emit_event(level_up_event)
        await event_chain.process_events()
        
        # 二次イベントが生成されたことを確認
        # （state_changeイベントが追加される）
        state_change_found = False
        for _, event in event_chain.event_queue:
            if event.type == EventType.STATE_CHANGE:
                state_change_found = True
                assert event.data.get("skill_points") == 3
                break
    
    @pytest.mark.asyncio
    async def test_npc_death_chain(self, event_integration, event_chain):
        """NPC死亡時の連鎖イベントテスト"""
        event_integration.register_agent("npc_manager", MagicMock())
        
        # NPC死亡イベントを作成
        npc_death_event = GameEvent(
            id="npc_death_event",
            type=EventType.NPC_DEATH,
            source="test",
            data={"npc_id": "npc_001", "cause": "battle"},
            priority=EventPriority.HIGH
        )
        
        # イベントを発行して処理
        await event_chain.emit_event(npc_death_event)
        await event_chain.process_events()
        
        # 関連NPCの反応イベントが生成されたことを確認
        npc_reaction_found = False
        for node in event_chain.event_nodes.values():
            if node.event.type == EventType.NPC_INTERACTION:
                npc_reaction_found = True
                assert node.event.data.get("reaction") == "mourn"
                assert node.event.data.get("target_npc") == "npc_001"
                break
        
        assert npc_reaction_found
    
    @pytest.mark.asyncio
    async def test_weather_change_cascade(self, event_integration, event_chain):
        """天候変化による連鎖イベントテスト"""
        event_integration.register_agent("the_world", MagicMock())
        
        # 嵐の天候変化イベント
        storm_event = GameEvent(
            id="storm_event",
            type=EventType.WEATHER_CHANGE,
            source="test",
            data={"weather": "storm", "duration": 3},
            priority=EventPriority.NORMAL
        )
        
        # イベントを発行して処理
        await event_chain.emit_event(storm_event)
        await event_chain.process_events()
        
        # 洪水イベントが生成されたことを確認
        flood_event_found = False
        for node in event_chain.event_nodes.values():
            if (node.event.type == EventType.WORLD_EVENT and 
                node.event.data.get("event") == "flooding"):
                flood_event_found = True
                affected_areas = node.event.data.get("affected_areas", [])
                assert "lower_town" in affected_areas
                assert "riverside" in affected_areas
                break
        
        assert flood_event_found
    
    @pytest.mark.asyncio
    async def test_anomaly_conditional_trigger(self, event_integration, event_chain):
        """混沌AIの条件付きトリガーテスト"""
        event_integration.register_agent("anomaly", MagicMock())
        
        # 通常優先度のイベント（トリガーされない）
        normal_event = GameEvent(
            id="normal_event",
            type=EventType.PLAYER_DEATH,
            source="test",
            data={},
            priority=EventPriority.NORMAL
        )
        
        await event_chain.emit_event(normal_event)
        await event_chain.process_events()
        
        # 混沌イベントが生成されていないことを確認
        anomaly_event_count = sum(
            1 for node in event_chain.event_nodes.values()
            if node.event.type == EventType.ANOMALY_TRIGGER
        )
        assert anomaly_event_count == 0
        
        # クリティカル優先度のイベント（トリガーされる）
        critical_event = GameEvent(
            id="critical_event",
            type=EventType.PLAYER_DEATH,
            source="test",
            data={},
            priority=EventPriority.CRITICAL
        )
        
        await event_chain.emit_event(critical_event)
        await event_chain.process_events()
        
        # 混沌イベントが生成されたことを確認
        anomaly_triggered = False
        for node in event_chain.event_nodes.values():
            if node.event.type == EventType.ANOMALY_TRIGGER:
                anomaly_triggered = True
                assert node.event.data.get("chaos_type") == "reality_glitch"
                assert node.event.data.get("trigger_event") == critical_event.id
                break
        
        assert anomaly_triggered
    
    @pytest.mark.asyncio
    async def test_create_event_from_response(self, event_integration):
        """AIレスポンスからのイベント生成テスト"""
        # 成功レスポンス
        success_response = AIResponse(
            agent_name="test_agent",
            task_id="task_001",
            narrative="テストナラティブ",
            choices=[{"id": "c1", "text": "選択肢1"}],
            state_changes={"hp": -10}
        )
        
        event = await event_integration.create_event_from_response(
            success_response,
            EventType.STATE_CHANGE
        )
        
        assert event is not None
        assert event.type == EventType.STATE_CHANGE
        assert event.source == "test_agent"
        assert event.priority == EventPriority.HIGH  # 状態変更があるため高優先度
        assert event.data["has_choices"] is True
        assert event.data["state_changes"] == {"hp": -10}
        assert event.can_trigger_chain is True
        
        # 失敗レスポンス
        failure_response = AIResponse(
            agent_name="test_agent",
            task_id="task_002",
            success=False,
            error_message="エラー"
        )
        
        event = await event_integration.create_event_from_response(
            failure_response,
            EventType.STATE_CHANGE
        )
        
        assert event is None
    
    @pytest.mark.asyncio
    async def test_historian_high_priority_recording(self, event_integration, event_chain):
        """歴史家AIの高優先度イベント記録テスト"""
        event_integration.register_agent("historian", MagicMock())
        
        # 低優先度イベント（記録されない）
        low_priority = GameEvent(
            id="low_priority_quest",
            type=EventType.QUEST_COMPLETE,
            source="test",
            data={"quest_id": "quest_001"},
            priority=EventPriority.NORMAL
        )
        
        # 高優先度イベント（記録される）
        high_priority = GameEvent(
            id="high_priority_quest",
            type=EventType.QUEST_COMPLETE,
            source="test",
            data={"quest_id": "epic_quest"},
            priority=EventPriority.HIGH
        )
        
        # 両方のイベントを処理
        await event_chain.emit_event(low_priority)
        await event_chain.emit_event(high_priority)
        await event_chain.process_events()
        
        # ハンドラーが適切に動作したことを確認
        # （実際の記録処理はモックのため、ここではハンドラーの登録のみ確認）
        historian_handlers = event_chain.handlers.get(EventType.QUEST_COMPLETE, [])
        assert any(h.agent_name == "historian" for h in historian_handlers)