"""
イベント連鎖システムのテスト
"""

import asyncio
from datetime import datetime
from unittest.mock import AsyncMock

import pytest

from app.ai.event_chain import EventChain, EventChainNode, EventHandler
from app.ai.shared_context import EventPriority, EventType, GameEvent


class TestEventChain:
    """EventChain のテスト"""
    
    @pytest.fixture
    def event_chain(self):
        """テスト用の EventChain インスタンス"""
        return EventChain(max_chain_depth=3)
    
    def test_register_handler(self, event_chain):
        """ハンドラー登録のテスト"""
        handler_func = AsyncMock()
        
        event_chain.register_handler(
            agent_name="test_agent",
            event_types={EventType.PLAYER_ACTION, EventType.STATE_CHANGE},
            handler_func=handler_func,
            priority=5
        )
        
        # ハンドラーが登録されていることを確認
        assert len(event_chain.handlers[EventType.PLAYER_ACTION]) == 1
        assert len(event_chain.handlers[EventType.STATE_CHANGE]) == 1
        
        # 優先度順でソートされていることを確認
        event_chain.register_handler(
            agent_name="high_priority_agent",
            event_types={EventType.PLAYER_ACTION},
            handler_func=AsyncMock(),
            priority=10
        )
        
        handlers = event_chain.handlers[EventType.PLAYER_ACTION]
        assert handlers[0].priority == 10  # 高優先度が先頭
        assert handlers[1].priority == 5
    
    @pytest.mark.asyncio
    async def test_emit_event(self, event_chain):
        """イベント発行のテスト"""
        event = GameEvent(
            id="test_event_001",
            type=EventType.PLAYER_ACTION,
            source="test",
            data={"action": "move"},
            priority=EventPriority.NORMAL
        )
        
        await event_chain.emit_event(event)
        
        # イベントノードが作成されていることを確認
        assert event.id in event_chain.event_nodes
        node = event_chain.event_nodes[event.id]
        assert node.depth == 0
        assert not node.processed
        
        # キューに追加されていることを確認
        assert len(event_chain.event_queue) == 1
    
    @pytest.mark.asyncio
    async def test_event_chain_depth_limit(self, event_chain):
        """イベント連鎖の深度制限テスト"""
        # 最初のイベント
        event1 = GameEvent(
            id="event1",
            type=EventType.PLAYER_ACTION,
            source="test",
            data={},
            priority=EventPriority.NORMAL,
            can_trigger_chain=True
        )
        await event_chain.emit_event(event1)
        
        # 連鎖イベント（深度1）
        event2 = GameEvent(
            id="event2",
            type=EventType.STATE_CHANGE,
            source="test",
            data={},
            priority=EventPriority.NORMAL,
            parent_event_id="event1",
            can_trigger_chain=True
        )
        await event_chain.emit_event(event2)
        
        # 連鎖イベント（深度2）
        event3 = GameEvent(
            id="event3",
            type=EventType.NPC_SPAWN,
            source="test",
            data={},
            priority=EventPriority.NORMAL,
            parent_event_id="event2",
            can_trigger_chain=True
        )
        await event_chain.emit_event(event3)
        
        # 連鎖イベント（深度3 - 制限に達する）
        event4 = GameEvent(
            id="event4",
            type=EventType.WORLD_EVENT,
            source="test",
            data={},
            priority=EventPriority.NORMAL,
            parent_event_id="event3",
            can_trigger_chain=True
        )
        await event_chain.emit_event(event4)
        
        # event3までがキューに入り、event4は深度制限で入らない
        assert len(event_chain.event_queue) == 3
        assert event_chain.event_nodes["event3"].depth == 2
        assert "event4" in event_chain.event_nodes  # ノードは作成される
        assert event_chain.event_nodes["event4"].depth == 3
    
    @pytest.mark.asyncio
    async def test_process_events(self, event_chain):
        """イベント処理のテスト"""
        # ハンドラーを登録
        handler_called = False
        handler_event = None
        
        async def test_handler(event: GameEvent):
            nonlocal handler_called, handler_event
            handler_called = True
            handler_event = event
            return None
        
        event_chain.register_handler(
            agent_name="test_agent",
            event_types={EventType.PLAYER_ACTION},
            handler_func=test_handler,
            priority=5
        )
        
        # イベントを発行
        event = GameEvent(
            id="test_process_event",
            type=EventType.PLAYER_ACTION,
            source="test",
            data={"action": "test"},
            priority=EventPriority.NORMAL
        )
        await event_chain.emit_event(event)
        
        # イベントを処理
        await event_chain.process_events()
        
        # ハンドラーが呼ばれたことを確認
        assert handler_called
        assert handler_event.id == event.id
        
        # イベントが処理済みになっていることを確認
        assert event_chain.event_nodes[event.id].processed
    
    @pytest.mark.asyncio
    async def test_secondary_events(self, event_chain):
        """二次イベント生成のテスト"""
        secondary_event_emitted = False
        
        async def primary_handler(event: GameEvent):
            """プライマリイベントのハンドラー"""
            return [
                GameEvent(
                    id="secondary_event",
                    type=EventType.STATE_CHANGE,
                    source="primary_handler",
                    data={"triggered_by": event.id},
                    priority=EventPriority.HIGH
                )
            ]
        
        async def secondary_handler(event: GameEvent):
            """セカンダリイベントのハンドラー"""
            nonlocal secondary_event_emitted
            secondary_event_emitted = True
            return None
        
        # ハンドラーを登録
        event_chain.register_handler(
            agent_name="primary",
            event_types={EventType.PLAYER_ACTION},
            handler_func=primary_handler,
            priority=5
        )
        
        event_chain.register_handler(
            agent_name="secondary",
            event_types={EventType.STATE_CHANGE},
            handler_func=secondary_handler,
            priority=5
        )
        
        # プライマリイベントを発行
        event = GameEvent(
            id="primary_event",
            type=EventType.PLAYER_ACTION,
            source="test",
            data={},
            priority=EventPriority.NORMAL
        )
        await event_chain.emit_event(event)
        
        # イベントを処理
        await event_chain.process_events()
        
        # セカンダリイベントが発行・処理されたことを確認
        assert secondary_event_emitted
        
        # イベントチェーンの構造を確認
        chain = event_chain.get_event_chain(event.id)
        assert len(chain) == 2  # プライマリ + セカンダリ
    
    @pytest.mark.asyncio
    async def test_conditional_handler(self, event_chain):
        """条件付きハンドラーのテスト"""
        handler_called = False
        
        async def conditional_handler(event: GameEvent):
            nonlocal handler_called
            handler_called = True
            return None
        
        def condition(event: GameEvent) -> bool:
            """優先度が高いイベントのみ処理"""
            return event.priority == EventPriority.HIGH
        
        event_chain.register_handler(
            agent_name="conditional",
            event_types={EventType.WORLD_EVENT},
            handler_func=conditional_handler,
            priority=5,
            conditions=condition
        )
        
        # 低優先度イベント（処理されない）
        low_priority_event = GameEvent(
            id="low_priority",
            type=EventType.WORLD_EVENT,
            source="test",
            data={},
            priority=EventPriority.LOW
        )
        await event_chain.emit_event(low_priority_event)
        await event_chain.process_events()
        
        assert not handler_called
        
        # 高優先度イベント（処理される）
        high_priority_event = GameEvent(
            id="high_priority",
            type=EventType.WORLD_EVENT,
            source="test",
            data={},
            priority=EventPriority.HIGH
        )
        await event_chain.emit_event(high_priority_event)
        await event_chain.process_events()
        
        assert handler_called
    
    @pytest.mark.asyncio
    async def test_priority_queue_ordering(self, event_chain):
        """優先度キューの順序テスト"""
        processed_order = []
        
        async def tracking_handler(event: GameEvent):
            processed_order.append(event.id)
            return None
        
        event_chain.register_handler(
            agent_name="tracker",
            event_types={EventType.PLAYER_ACTION},
            handler_func=tracking_handler,
            priority=5
        )
        
        # 異なる優先度のイベントを発行
        events = [
            GameEvent(id="low", type=EventType.PLAYER_ACTION, source="test", 
                     data={}, priority=EventPriority.LOW),
            GameEvent(id="critical", type=EventType.PLAYER_ACTION, source="test", 
                     data={}, priority=EventPriority.CRITICAL),
            GameEvent(id="normal", type=EventType.PLAYER_ACTION, source="test", 
                     data={}, priority=EventPriority.NORMAL),
            GameEvent(id="high", type=EventType.PLAYER_ACTION, source="test", 
                     data={}, priority=EventPriority.HIGH),
        ]
        
        for event in events:
            await event_chain.emit_event(event)
        
        await event_chain.process_events()
        
        # 優先度順に処理されていることを確認
        assert processed_order == ["critical", "high", "normal", "low"]
    
    def test_get_event_tree(self, event_chain):
        """イベントツリー取得のテスト"""
        # イベントチェーンを構築
        event_chain.event_nodes = {
            "root": EventChainNode(
                event=GameEvent(id="root", type=EventType.PLAYER_ACTION, 
                               source="test", data={}, priority=EventPriority.NORMAL),
                depth=0,
                children=["child1", "child2"]
            ),
            "child1": EventChainNode(
                event=GameEvent(id="child1", type=EventType.STATE_CHANGE, 
                               source="test", data={}, priority=EventPriority.NORMAL),
                depth=1,
                parent_id="root",
                children=["grandchild"]
            ),
            "child2": EventChainNode(
                event=GameEvent(id="child2", type=EventType.NPC_SPAWN, 
                               source="test", data={}, priority=EventPriority.NORMAL),
                depth=1,
                parent_id="root"
            ),
            "grandchild": EventChainNode(
                event=GameEvent(id="grandchild", type=EventType.WORLD_EVENT, 
                               source="test", data={}, priority=EventPriority.NORMAL),
                depth=2,
                parent_id="child1"
            )
        }
        
        tree = event_chain.get_event_tree("root")
        
        assert tree["event_id"] == "root"
        assert len(tree["children"]) == 2
        assert tree["children"][0]["event_id"] == "child1"
        assert len(tree["children"][0]["children"]) == 1
        assert tree["children"][0]["children"][0]["event_id"] == "grandchild"
    
    def test_clear_processed_events(self, event_chain):
        """処理済みイベントのクリアテスト"""
        # 複数のイベントノードを作成
        for i in range(150):
            event = GameEvent(
                id=f"event_{i}",
                type=EventType.PLAYER_ACTION,
                source="test",
                data={},
                priority=EventPriority.NORMAL
            )
            node = EventChainNode(event=event, processed=(i < 120))
            event_chain.event_nodes[event.id] = node
        
        # 古い処理済みイベントをクリア
        event_chain.clear_processed_events(keep_recent=100)
        
        # 最近の100件は保持され、古い処理済みイベントは削除される
        assert len(event_chain.event_nodes) == 100
    
    def test_get_statistics(self, event_chain):
        """統計情報取得のテスト"""
        # いくつかのイベントを追加
        event_chain.event_stats["total_events"] = 10
        event_chain.event_stats["chain_events"] = 3
        event_chain.event_stats["events_by_type"][EventType.PLAYER_ACTION] = 5
        
        stats = event_chain.get_statistics()
        
        assert stats["total_events"] == 10
        assert stats["chain_events"] == 3
        assert stats["events_by_type"][EventType.PLAYER_ACTION] == 5
        assert "pending_events" in stats
        assert "total_nodes" in stats