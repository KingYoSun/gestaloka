"""
AI協調動作システムの統合テスト

すべてのコンポーネントが適切に連携することを確認します。
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.ai.coordinator import CoordinatorAI
from app.ai.shared_context import (
    PlayerAction,
)
from app.schemas.game_session import GameSessionResponse as GameSession
from app.services.ai.agents.base import AgentResponse, BaseAgent
from app.services.ai.prompt_manager import AIAgentRole


class MockAgent(BaseAgent):
    """テスト用のモックエージェント"""

    def __init__(self, role: AIAgentRole):
        super().__init__(role=role)
        self.process_mock = AsyncMock()
        self.last_context = None

    async def process(self, prompt_context):
        self.last_context = prompt_context
        return await self.process_mock(prompt_context)


class TestAICoordinationIntegration:
    """AI協調動作の統合テスト"""

    @pytest.fixture
    def mock_agents(self):
        """テスト用のモックエージェント一式"""
        agents = {
            "dramatist": MockAgent(AIAgentRole.DRAMATIST),
            "state_manager": MockAgent(AIAgentRole.STATE_MANAGER),
            "historian": MockAgent(AIAgentRole.HISTORIAN),
            "npc_manager": MockAgent(AIAgentRole.NPC_MANAGER),
            "the_world": MockAgent(AIAgentRole.THE_WORLD),
            "anomaly": MockAgent(AIAgentRole.ANOMALY),
        }

        # デフォルトのレスポンスを設定
        for name, agent in agents.items():
            agent.process_mock.return_value = AgentResponse(
                agent_role=agent.role.value, narrative=f"{name} response", choices=[], state_changes={}, metadata={}
            )

        return agents

    @pytest.fixture
    def game_session(self):
        """テスト用のゲームセッション"""
        session = MagicMock(spec=GameSession)
        session.id = "test_session_001"
        session.turn_number = 10
        session.character_id = "character_001"
        return session

    @pytest.fixture
    def coordinator(self, mock_agents):
        """WebSocketマネージャー付きのCoordinatorAI"""
        mock_websocket = AsyncMock()
        return CoordinatorAI(agents=mock_agents, websocket_manager=mock_websocket)

    @pytest.mark.asyncio
    async def test_full_action_processing_flow(self, coordinator, game_session, mock_agents):
        """アクション処理の完全なフローテスト"""
        # セッション初期化
        await coordinator.initialize_session(game_session)

        # プレイヤーアクション
        action = PlayerAction(action_id="action_001", action_type="exploration", action_text="古代の遺跡を探索する")

        # 各エージェントのレスポンスを設定
        mock_agents["the_world"].process_mock.return_value = AgentResponse(
            agent_role="the_world", narrative="遺跡の空気が重い。", metadata={"weather": "foggy", "time": "dusk"}
        )

        mock_agents["dramatist"].process_mock.return_value = AgentResponse(
            agent_role="dramatist",
            narrative="薄暗い通路を進むと、古代の文字が刻まれた扉を見つけた。",
            choices=[
                {"id": "c1", "text": "扉を調べる"},
                {"id": "c2", "text": "通路を戻る"},
                {"id": "c3", "text": "別の道を探す"},
            ],
        )

        mock_agents["state_manager"].process_mock.return_value = AgentResponse(
            agent_role="state_manager",
            narrative="探索により疲労が蓄積した。",
            state_changes={"stamina": -15, "experience": 10},
        )

        # アクション処理
        response = await coordinator.process_action(action, game_session)

        # レスポンス検証
        assert response.narrative != ""
        assert len(response.choices) > 0
        assert response.state_changes.get("stamina") == -15
        assert response.state_changes.get("experience") == 10

        # 共有コンテキストの更新を確認
        assert coordinator.shared_context.context.turn_number == 10
        assert len(coordinator.shared_context.context.recent_actions) > 0

    @pytest.mark.asyncio
    async def test_event_chain_reaction(self, coordinator, game_session, mock_agents):
        """イベント連鎖反応のテスト"""
        await coordinator.initialize_session(game_session)

        # NPCの死亡を引き起こすアクション
        action = PlayerAction(action_id="action_002", action_type="combat", action_text="敵NPCに致命的な攻撃を加える")

        # State ManagerがNPC死亡イベントを含むレスポンスを返す
        mock_agents["state_manager"].process_mock.return_value = AgentResponse(
            agent_role="state_manager",
            narrative="攻撃が成功し、敵が倒れた。",
            state_changes={"enemy_hp": -100},
            metadata={"npc_died": True, "npc_id": "enemy_001"},
        )

        # アクション処理
        response = await coordinator.process_action(action, game_session)

        # イベント連鎖が処理されたことを確認
        # （実際のイベント処理はモックされているため、イベントシステムの呼び出しを確認）
        assert response.narrative != ""
        assert "enemy_hp" in response.state_changes

    @pytest.mark.asyncio
    async def test_parallel_task_execution(self, coordinator, game_session):
        """並列タスク実行のテスト"""
        await coordinator.initialize_session(game_session)

        # 環境確認アクション（並列処理が期待される）
        action = PlayerAction(action_id="action_003", action_type="observation", action_text="周囲の状況を確認する")

        # タスク生成をモニタリング
        with patch.object(coordinator.task_generator, "generate_tasks") as mock_generate:
            from app.ai.task_generator import CoordinationTask, CoordinationType

            mock_generate.return_value = [
                CoordinationTask(
                    id="task1",
                    name="環境描写",
                    required_agents=["the_world", "dramatist"],
                    coordination_type=CoordinationType.PARALLEL,
                    priority=1,
                    progress_weight=50,
                ),
                CoordinationTask(
                    id="task2",
                    name="NPC配置",
                    required_agents=["npc_manager"],
                    coordination_type=CoordinationType.PARALLEL,
                    priority=2,
                    progress_weight=30,
                ),
            ]

            _ = await coordinator.process_action(action, game_session)

            # 並列タスクが生成されたことを確認
            assert mock_generate.called
            tasks = mock_generate.return_value
            assert all(t.coordination_type == CoordinationType.PARALLEL for t in tasks)

    @pytest.mark.asyncio
    async def test_shared_context_synchronization(self, coordinator, game_session, mock_agents):
        """共有コンテキストの同期テスト"""
        await coordinator.initialize_session(game_session)

        # 天候変化を引き起こすアクション
        action = PlayerAction(action_id="action_004", action_type="ritual", action_text="天候制御の儀式を行う")

        # The WorldがGameEventを生成
        mock_agents["the_world"].process_mock.return_value = AgentResponse(
            agent_role="the_world",
            narrative="儀式により嵐が発生した。",
            metadata={"world_event": True, "weather_changed": "storm"},
        )

        _ = await coordinator.process_action(action, game_session)

        # 共有コンテキストが更新されていることを確認
        assert len(coordinator.shared_context.context.recent_actions) > 0
        last_action = list(coordinator.shared_context.context.recent_actions)[-1]
        assert last_action.action_id == "action_004"

    @pytest.mark.asyncio
    async def test_response_caching(self, coordinator, game_session):
        """レスポンスキャッシングのテスト"""
        await coordinator.initialize_session(game_session)

        # 同じアクションを2回実行
        action = PlayerAction(action_id="action_005", action_type="movement", action_text="北へ移動する")

        # 1回目の実行
        _ = await coordinator.process_action(action, game_session)

        # キャッシュの統計を取得
        stats1 = coordinator.response_cache.get_stats()

        # 2回目の実行（同じアクション）
        _ = await coordinator.process_action(action, game_session)

        # キャッシュの統計を再取得
        stats2 = coordinator.response_cache.get_stats()

        # キャッシュサイズが増えていることを確認（異なるコンテキストのため）
        # 実際のキャッシュヒットは、まったく同じコンテキストでのみ発生
        assert stats2["size"] >= stats1["size"]
        assert stats2["miss_count"] > stats1["miss_count"]

    @pytest.mark.asyncio
    async def test_progress_notification_flow(self, coordinator, game_session):
        """進捗通知フローのテスト"""
        await coordinator.initialize_session(game_session)

        # WebSocketマネージャーのモックを確認
        # mock_websocket = coordinator.websocket_manager

        action = PlayerAction(action_id="action_006", action_type="investigation", action_text="手がかりを調査する")

        # 進捗通知の呼び出しを追跡
        with patch.object(coordinator.progress_notifier, "notify_progress") as mock_notify:
            _ = await coordinator.process_action(action, game_session)

            # 進捗通知が複数回呼ばれたことを確認
            assert mock_notify.call_count > 2

            # 開始と完了の通知を確認
            first_call = mock_notify.call_args_list[0]
            assert "処理開始" in first_call[0][0]

    @pytest.mark.asyncio
    async def test_error_recovery(self, coordinator, game_session, mock_agents):
        """エラー回復のテスト"""
        await coordinator.initialize_session(game_session)

        # 一部のエージェントでエラーを発生させる
        mock_agents["anomaly"].process_mock.side_effect = Exception("Anomaly error")

        action = PlayerAction(action_id="action_007", action_type="anomaly_interaction", action_text="異常現象に触れる")

        # エラーが発生してもシステムが継続することを確認
        with patch.object(coordinator.task_generator, "generate_tasks") as mock_generate:
            from app.ai.task_generator import CoordinationTask, CoordinationType

            mock_generate.return_value = [
                CoordinationTask(
                    id="task1",
                    name="異常現象解析",
                    required_agents=["anomaly"],
                    coordination_type=CoordinationType.SEQUENTIAL,
                    priority=1,
                ),
                CoordinationTask(
                    id="task2",
                    name="影響評価",
                    required_agents=["state_manager"],
                    coordination_type=CoordinationType.SEQUENTIAL,
                    priority=2,
                    dependencies=["task1"],
                ),
            ]

            response = await coordinator.process_action(action, game_session)

            # エラーが発生してもレスポンスが返されることを確認
            assert response is not None
            assert response.narrative != ""

    @pytest.mark.asyncio
    async def test_complex_coordination_scenario(self, coordinator, game_session, mock_agents):
        """複雑な協調シナリオのテスト"""
        await coordinator.initialize_session(game_session)

        # クエスト完了アクション
        action = PlayerAction(
            action_id="action_008", action_type="quest_complete", action_text="古代の秘宝を手に入れ、クエストを完了する"
        )

        # 各エージェントが協調して動作
        mock_agents["state_manager"].process_mock.return_value = AgentResponse(
            agent_role="state_manager",
            narrative="クエスト完了！",
            state_changes={"quest_completed": True, "gold": 1000, "experience": 500},
        )

        mock_agents["historian"].process_mock.return_value = AgentResponse(
            agent_role="historian", narrative="この出来事は歴史に刻まれるだろう。", metadata={"record_created": True}
        )

        mock_agents["dramatist"].process_mock.return_value = AgentResponse(
            agent_role="dramatist",
            narrative="秘宝を手にしたあなたは、新たな冒険への扉を開いた。",
            choices=[
                {"id": "c1", "text": "街へ戻る"},
                {"id": "c2", "text": "さらなる秘宝を探す"},
                {"id": "c3", "text": "仲間と祝杯をあげる"},
            ],
        )

        mock_agents["the_world"].process_mock.return_value = AgentResponse(
            agent_role="the_world",
            narrative="世界のバランスが微妙に変化した。",
            metadata={"world_event": True, "stability_change": -5},
        )

        response = await coordinator.process_action(action, game_session)

        # 複数のエージェントからの情報が統合されていることを確認
        assert "クエスト完了" in response.narrative
        assert "歴史に刻まれる" in response.narrative
        assert "新たな冒険" in response.narrative
        # 探索選択肢が追加される可能性があるため、最低3つの選択肢があることを確認
        assert len(response.choices) >= 3
        assert response.state_changes["gold"] == 1000
        assert response.state_changes["experience"] == 500
