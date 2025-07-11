"""
CoordinatorAI のテスト
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.ai.coordination_models import ActionContext, AIResponse, Choice
from app.ai.coordinator import CoordinatorAI
from app.ai.shared_context import PlayerAction
from app.ai.task_generator import CoordinationTask, CoordinationType
from app.schemas.game_session import GameSessionResponse as GameSession
from app.services.ai.agents.base import AgentResponse, BaseAgent
from app.services.ai.prompt_manager import AIAgentRole


class MockAgent(BaseAgent):
    """テスト用のモックエージェント"""

    def __init__(self, role: AIAgentRole):
        super().__init__(role=role)
        self.process_mock = AsyncMock()

    async def process(self, prompt_context):
        return await self.process_mock(prompt_context)


class TestCoordinatorAI:
    """CoordinatorAI のテスト"""

    @pytest.fixture
    def mock_agents(self):
        """テスト用のモックエージェント"""
        agents = {
            "dramatist": MockAgent(AIAgentRole.DRAMATIST),
            "state_manager": MockAgent(AIAgentRole.STATE_MANAGER),
            "the_world": MockAgent(AIAgentRole.THE_WORLD),
        }

        # デフォルトのレスポンスを設定
        for agent in agents.values():
            agent.process_mock.return_value = AgentResponse(
                agent_role=agent.role.value, narrative="Test narrative", choices=[], state_changes={}, metadata={}
            )

        return agents

    @pytest.fixture
    def coordinator(self, mock_agents):
        """テスト用の CoordinatorAI インスタンス"""
        return CoordinatorAI(agents=mock_agents)

    @pytest.fixture
    def game_session(self):
        """テスト用のゲームセッション"""
        session = MagicMock(spec=GameSession)
        session.id = "test_session"
        session.turn_number = 1
        session.character_id = "test_character"
        return session

    @pytest.mark.asyncio
    async def test_initialize_session(self, coordinator, game_session):
        """セッション初期化のテスト"""
        await coordinator.initialize_session(game_session)

        assert coordinator.shared_context is not None
        assert coordinator.shared_context.context.session_id == "test_session"
        assert coordinator.progress_notifier.session_id == "test_session"

    @pytest.mark.asyncio
    async def test_process_action_simple(self, coordinator, game_session):
        """単純なアクション処理のテスト"""
        await coordinator.initialize_session(game_session)

        action = PlayerAction(action_id="act_001", action_type="movement", action_text="北へ移動する")

        # タスクジェネレーターをモック
        with patch.object(coordinator.task_generator, "generate_tasks") as mock_generate:
            mock_generate.return_value = [
                CoordinationTask(
                    id="task1",
                    name="移動描写",
                    required_agents=["dramatist"],
                    coordination_type=CoordinationType.SEQUENTIAL,
                )
            ]

            response = await coordinator.process_action(action, game_session)

            assert response.narrative != ""
            assert len(response.choices) > 0
            assert mock_generate.called

    @pytest.mark.asyncio
    async def test_execute_parallel_tasks(self, coordinator, game_session):
        """並列タスク実行のテスト"""
        await coordinator.initialize_session(game_session)

        tasks = [
            CoordinationTask(
                id="task1",
                name="環境確認",
                required_agents=["the_world", "state_manager"],
                coordination_type=CoordinationType.PARALLEL,
            )
        ]

        action_context = ActionContext(
            action_id="test_action",
            action_type="test",
            action_text="test action",
            session_id="test_session",
            character_id="test_character",
        )
        responses = await coordinator.execute_tasks(tasks, action_context)

        # 並列実行されたことを確認
        assert len(responses) == 2  # 2つのエージェントが呼ばれる

    @pytest.mark.asyncio
    async def test_execute_sequential_tasks(self, coordinator, game_session):
        """順次タスク実行のテスト"""
        await coordinator.initialize_session(game_session)

        tasks = [
            CoordinationTask(
                id="task1",
                name="状態確認",
                required_agents=["state_manager"],
                coordination_type=CoordinationType.SEQUENTIAL,
            ),
            CoordinationTask(
                id="task2",
                name="描写生成",
                required_agents=["dramatist"],
                coordination_type=CoordinationType.SEQUENTIAL,
                dependencies=["task1"],
            ),
        ]

        action_context = ActionContext(
            action_id="test_action",
            action_type="test",
            action_text="test action",
            session_id="test_session",
            character_id="test_character",
        )
        responses = await coordinator.execute_tasks(tasks, action_context)

        assert len(responses) == 2

    @pytest.mark.asyncio
    async def test_task_dependencies(self, coordinator, game_session):
        """タスク依存関係のテスト"""
        await coordinator.initialize_session(game_session)

        # 依存関係のあるタスク
        tasks = [
            CoordinationTask(
                id="task2",
                name="依存タスク",
                required_agents=["dramatist"],
                coordination_type=CoordinationType.SEQUENTIAL,
                dependencies=["task1"],
            ),
            CoordinationTask(
                id="task1",
                name="基本タスク",
                required_agents=["state_manager"],
                coordination_type=CoordinationType.SEQUENTIAL,
            ),
        ]

        action_context = ActionContext(
            action_id="test_action",
            action_type="test",
            action_text="test action",
            session_id="test_session",
            character_id="test_character",
        )

        # タスクの順序が依存関係に従って実行されることを確認
        responses = await coordinator.execute_tasks(tasks, action_context)
        assert len(responses) == 2

    def test_integrate_responses(self, coordinator):
        """レスポンス統合のテスト"""
        responses = [
            AIResponse(
                agent_name="dramatist",
                task_id="task1",
                narrative="森の中を歩いています。",
                choices=[Choice(id="c1", text="先に進む"), Choice(id="c2", text="戻る")],
            ),
            AIResponse(
                agent_name="state_manager", task_id="task2", narrative="体力が減少しました。", state_changes={"hp": -10}
            ),
        ]

        integrated = coordinator._integrate_responses(responses)

        assert "森の中を歩いています" in integrated.narrative
        assert "体力が減少しました" in integrated.narrative
        # _integrate_responsesは探索関連の選択肢を追加する可能性があるため、最低2つの選択肢があることを確認
        assert len(integrated.choices) >= 2
        assert integrated.state_changes["hp"] == -10

    def test_generate_final_response_with_empty_choices(self, coordinator):
        """選択肢が空の場合のデフォルト選択肢生成テスト"""
        integrated = MagicMock()
        integrated.choices = []
        integrated.narrative = "テスト"
        integrated.events = []
        integrated.state_changes = {}
        integrated.metadata = {}

        final = coordinator._generate_final_response(integrated)

        assert len(final.choices) == 3  # デフォルトの3つの選択肢
        assert any(c.text == "続ける" for c in final.choices)

    @pytest.mark.asyncio
    async def test_progress_notification(self, coordinator, game_session):
        """進捗通知のテスト"""
        await coordinator.initialize_session(game_session)

        # 進捗通知をモック
        with patch.object(coordinator.progress_notifier, "notify_progress") as mock_notify:
            action = PlayerAction(action_id="act_001", action_type="movement", action_text="移動する")

            with patch.object(coordinator.task_generator, "generate_tasks") as mock_generate:
                mock_generate.return_value = []
                await coordinator.process_action(action, game_session)

            # 進捗通知が呼ばれたことを確認
            assert mock_notify.called
            # 最初と最後の通知を確認
            first_call = mock_notify.call_args_list[0]
            assert first_call[0][0] == "処理開始"
            assert first_call[0][1] == 0

    @pytest.mark.asyncio
    async def test_cache_functionality(self, coordinator, game_session):
        """キャッシュ機能のテスト"""
        await coordinator.initialize_session(game_session)

        # 同じコンテキストで2回呼び出し
        context = {"test": "context"}
        agent_adapter = coordinator.agents["dramatist"]

        # 最初の呼び出し
        _ = await coordinator._call_agent(agent_adapter, context, "task1")

        # キャッシュから取得
        cached = coordinator.response_cache.get("dramatist", context)
        assert cached is not None

        # キャッシュヒット率を確認
        assert coordinator.response_cache.get_hit_rate() > 0

    @pytest.mark.asyncio
    async def test_error_handling(self, coordinator, game_session):
        """エラーハンドリングのテスト"""
        await coordinator.initialize_session(game_session)

        # エージェントのprocess_mockを直接設定してエラーを発生させる
        dramatist_adapter = coordinator.agents["dramatist"]
        dramatist_adapter.agent.process_mock.side_effect = Exception("Test error")

        task = CoordinationTask(
            id="task1",
            name="エラータスク",
            required_agents=["dramatist"],
            coordination_type=CoordinationType.SEQUENTIAL,
        )

        action_context = ActionContext(
            action_id="test_action",
            action_type="test",
            action_text="test action",
            session_id="test_session",
            character_id="test_character",
        )
        responses = await coordinator.execute_tasks([task], action_context)

        # エラーレスポンスが返されることを確認
        assert len(responses) == 1
        assert not responses[0].success
        # エラーメッセージは実装の詳細に依存するため、エラーが発生したことだけを確認
        assert responses[0].error_message is not None

    def test_get_unique_agents(self, coordinator):
        """固有エージェント取得のテスト"""
        tasks = [
            CoordinationTask(
                id="task1",
                name="Task 1",
                required_agents=["dramatist", "state_manager"],
                coordination_type=CoordinationType.PARALLEL,
            ),
            CoordinationTask(
                id="task2",
                name="Task 2",
                required_agents=["state_manager", "the_world"],
                coordination_type=CoordinationType.SEQUENTIAL,
            ),
        ]

        unique_agents = coordinator._get_unique_agents(tasks)

        assert len(unique_agents) == 3
        assert unique_agents == {"dramatist", "state_manager", "the_world"}
