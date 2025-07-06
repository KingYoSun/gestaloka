"""
AI協調動作の中核となるCoordinatorAIクラス

すべてのAIエージェントを統括し、最適化されたタスク実行と
レスポンス統合を行います。
"""

import asyncio
import time
from collections import defaultdict
from typing import Any, Optional

import structlog

from app.ai.agent_adapter import CoordinationAgentAdapter
from app.ai.coordination_models import (
    ActionContext,
    AIResponse,
    Choice,
    FinalResponse,
    TaskExecutionResult,
)
from app.ai.event_chain import EventChain
from app.ai.event_integration import EventIntegration
from app.ai.progress_notifier import ProgressNotifier
from app.ai.response_cache import ResponseCache
from app.ai.shared_context import (
    EventType,
    GameEvent,
    PlayerAction,
    SharedContext,
    SharedContextManager,
)
from app.ai.task_generator import (
    CoordinationTask,
    CoordinationType,
    TaskListGenerator,
)
from app.schemas.game_session import GameSessionResponse as GameSession

logger = structlog.get_logger()


class CoordinatorAI:
    """AI協調の中核クラス"""

    def __init__(
        self,
        agents: dict[str, Any],  # BaseAgentまたはCoordinationAgentAdapter
        websocket_manager: Optional[Any] = None,
    ):
        # BaseAgentをアダプターでラップ
        self.agents: dict[str, CoordinationAgentAdapter] = {}
        for name, agent in agents.items():
            if isinstance(agent, CoordinationAgentAdapter):
                self.agents[name] = agent
            else:
                self.agents[name] = CoordinationAgentAdapter(agent)

        self.shared_context: Optional[SharedContextManager] = None
        self.task_generator = TaskListGenerator()
        self.response_cache = ResponseCache()
        self.progress_notifier = ProgressNotifier(websocket_manager)
        self.websocket_manager = websocket_manager

        # イベント連鎖システム
        self.event_chain = EventChain(max_chain_depth=3)
        self.event_integration = EventIntegration(self.event_chain)

        # イベント統合にエージェントを登録
        for name, agent in self.agents.items():
            self.event_integration.register_agent(name, agent)

        # タスク実行統計
        self.task_execution_times: dict[str, list[float]] = defaultdict(list)

    async def initialize_session(self, session: GameSession) -> None:
        """セッションを初期化"""
        self.shared_context = SharedContextManager(session.id)
        self.progress_notifier.set_session(session.id)

        # 初期コンテキストを設定
        await self.shared_context.update({"session_id": session.id, "turn_number": session.turn_number})

    async def process_action(self, action: PlayerAction, session: GameSession, **kwargs) -> FinalResponse:
        """プレイヤーアクションを処理"""

        start_time = time.time()

        try:
            # 1. 進捗通知開始
            await self.progress_notifier.notify_progress("処理開始", 0)

            # 2. アクションコンテキストを作成
            action_context = ActionContext(
                action_id=action.action_id,
                action_type=action.action_type,
                action_text=action.action_text,
                session_id=session.id,
                character_id=session.character_id,
            )

            # NPC遭遇情報があれば、アクションのmetadataに追加
            npc_encounters = kwargs.get("npc_encounters", [])
            if npc_encounters and hasattr(action, "metadata"):
                if action.metadata is None:
                    action.metadata = {}  # type: ignore[unreachable]
                action.metadata["npc_encounters"] = npc_encounters

            # 3. Shared Context更新
            if self.shared_context:
                self.shared_context.add_player_action(action)
                await self.shared_context.update({"turn_number": session.turn_number})

            # 4. タスクリスト生成（最適化の核心）
            await self.progress_notifier.notify_progress("タスク分析中", 5)
            tasks = self.task_generator.generate_tasks(
                action, self.shared_context.context if self.shared_context else SharedContext(session_id=session.id)
            )

            total_time = self.task_generator.estimate_total_time(tasks)
            await self.progress_notifier.notify_progress(
                f"タスク数: {len(tasks)}, 予想時間: {total_time:.1f}秒",
                10,
                details={
                    "task_count": len(tasks),
                    "estimated_time": total_time,
                    "unique_agents": len(self._get_unique_agents(tasks)),
                },
            )

            # 5. タスク実行（最適化された呼び出し）
            responses = await self.execute_tasks(tasks, action_context)

            # 6. レスポンス統合
            await self.progress_notifier.notify_progress("応答生成中", 90)
            integrated = self._integrate_responses(responses)

            # 7. レスポンスからイベントを生成
            generated_events = await self._generate_events_from_responses(responses)
            if generated_events:
                integrated.events.extend(generated_events)

            # 8. 必要最小限のイベント処理
            if integrated.events:
                await self._process_events(integrated.events)

            # 9. 最終レスポンス生成
            final_response = self._generate_final_response(integrated)

            # 9. 完了通知
            await self.progress_notifier.notify_completion()

            # 実行時間を記録
            execution_time = time.time() - start_time

            # 各エージェントの平均実行時間を計算
            agent_stats = {}
            for agent_name, times in self.task_execution_times.items():
                if times:
                    agent_stats[agent_name] = {
                        "avg_time": sum(times) / len(times),
                        "total_calls": len(times),
                        "total_time": sum(times),
                    }

            logger.info(
                "Action processed",
                session_id=session.id,
                action_type=action.action_type,
                execution_time=execution_time,
                task_count=len(tasks),
                cache_hit_rate=self.response_cache.get_hit_rate(),
                agent_performance=agent_stats,
            )

            return final_response

        except Exception as e:
            logger.error(
                "Failed to process action", error=str(e), session_id=session.id, action_type=action.action_type
            )
            await self.progress_notifier.notify_error(str(e))
            raise

    async def execute_tasks(self, tasks: list[CoordinationTask], action_context: ActionContext) -> list[AIResponse]:
        """タスクリストに基づいて最適化されたAI呼び出しを実行"""

        responses: dict[str, TaskExecutionResult] = {}
        total_weight = sum(task.progress_weight for task in tasks)
        current_progress = 0.0
        completed_tasks = 0

        # 依存関係を考慮したタスク実行
        for i, task in enumerate(tasks):
            try:
                # 依存タスクの完了を待つ
                await self._wait_for_dependencies(task, responses)

                # タスク開始通知
                await self.progress_notifier.notify_task_start(task.name, len(tasks) - i)

                # タスクタイプに応じた実行
                task_result = await self._execute_task(task, action_context, responses)

                responses[task.id] = task_result
                completed_tasks += 1

                # 進捗更新
                current_progress += task.progress_weight / total_weight * 80
                progress_percentage = self.progress_notifier.calculate_progress(completed_tasks, len(tasks), 10)

                # 残り時間の推定
                avg_time = self._get_average_task_time(task.required_agents[0])
                remaining_time = self.progress_notifier.estimate_remaining_time(completed_tasks, len(tasks), avg_time)

                await self.progress_notifier.notify_progress(
                    f"{task.name}完了", progress_percentage, estimated_time_remaining=remaining_time
                )

            except Exception as e:
                logger.error("Task execution failed", task_id=task.id, error=str(e))
                # エラーレスポンスを作成
                error_response = AIResponse(
                    agent_name="coordinator", task_id=task.id, success=False, error_message=str(e)
                )
                responses[task.id] = TaskExecutionResult(
                    task=task, responses=[error_response], success=False, error_message=str(e)
                )

        # 全レスポンスを統合して返す
        all_responses = []
        for task_result in responses.values():
            if isinstance(task_result, TaskExecutionResult):
                all_responses.extend(task_result.responses)

        return all_responses

    async def _execute_task(
        self, task: CoordinationTask, action_context: ActionContext, previous_responses: dict[str, TaskExecutionResult]
    ) -> TaskExecutionResult:
        """個別タスクを実行"""

        start_time = time.time()

        if task.coordination_type == CoordinationType.PARALLEL:
            # 並列実行可能なタスクをグループ化
            responses = await self._execute_parallel_task(task, action_context, previous_responses)
        else:
            # 順次実行
            responses = await self._execute_sequential_task(task, action_context, previous_responses)

        execution_time = time.time() - start_time

        # 実行時間を記録
        for agent_name in task.required_agents:
            self.task_execution_times[agent_name].append(execution_time)

        return TaskExecutionResult(
            task=task, responses=responses, success=all(r.success for r in responses), execution_time=execution_time
        )

    async def _execute_parallel_task(
        self, task: CoordinationTask, action_context: ActionContext, previous_responses: dict[str, TaskExecutionResult]
    ) -> list[AIResponse]:
        """並列タスクを実行"""

        # 各エージェントへの非同期タスクを作成
        async_tasks = []
        for agent_name in task.required_agents:
            if agent_name not in self.agents:
                logger.warning(f"Agent {agent_name} not found")
                continue

            agent = self.agents[agent_name]
            context = self._prepare_agent_context(agent_name, action_context, previous_responses)

            # キャッシュチェック
            cached_response = self.response_cache.get(agent_name, context)
            if cached_response:
                async_tasks.append(asyncio.create_task(self._return_cached_response(cached_response)))
            else:
                async_tasks.append(asyncio.create_task(self._call_agent(agent, context, task.id)))

        # 全タスクの完了を待機
        responses = await asyncio.gather(*async_tasks, return_exceptions=True)

        # エラー処理
        valid_responses = []
        for response in responses:
            if isinstance(response, Exception):
                logger.error(f"Parallel task error: {response}")
                valid_responses.append(
                    AIResponse(agent_name="unknown", task_id=task.id, success=False, error_message=str(response))
                )
            elif isinstance(response, AIResponse):
                valid_responses.append(response)

        return valid_responses

    async def _execute_sequential_task(
        self, task: CoordinationTask, action_context: ActionContext, previous_responses: dict[str, TaskExecutionResult]
    ) -> list[AIResponse]:
        """順次実行タスクを実行"""

        responses = []

        for agent_name in task.required_agents:
            if agent_name not in self.agents:
                logger.warning(f"Agent {agent_name} not found")
                continue

            agent = self.agents[agent_name]
            context = self._prepare_agent_context(agent_name, action_context, previous_responses)

            # キャッシュチェック
            cached_response = self.response_cache.get(agent_name, context)
            if cached_response:
                responses.append(cached_response)
            else:
                response = await self._call_agent(agent, context, task.id)
                responses.append(response)

        return responses

    async def _call_agent(self, agent: CoordinationAgentAdapter, context: dict[str, Any], task_id: str) -> AIResponse:
        """個別のAIエージェントを呼び出し"""

        await self.progress_notifier.notify_ai_call(agent.name)

        try:
            start_time = time.time()

            # エージェントを呼び出し
            shared_context = self.shared_context.context if self.shared_context else None
            if shared_context is None:
                raise ValueError("Shared context not initialized")
            response = await agent.process(context, shared_context)

            # タスクIDを追加
            response.task_id = task_id
            response.processing_time = time.time() - start_time

            # パフォーマンスログ
            logger.info(
                "Agent execution completed",
                agent_name=agent.name,
                task_id=task_id,
                processing_time=response.processing_time,
                model_type=getattr(agent, "model_type", "unknown"),
            )

            # 実行時間を記録
            self.task_execution_times[agent.name].append(response.processing_time)

            # キャッシュに保存
            self.response_cache.set(agent.name, context, response)

            return response

        except Exception as e:
            logger.error(f"Agent call failed: {agent.name}", error=str(e))
            return AIResponse(agent_name=agent.name, task_id=task_id, success=False, error_message=str(e))

    async def _return_cached_response(self, response: AIResponse) -> AIResponse:
        """キャッシュされたレスポンスを返す"""
        await asyncio.sleep(0.1)  # 最小限の遅延
        return response

    async def _wait_for_dependencies(self, task: CoordinationTask, responses: dict[str, TaskExecutionResult]) -> None:
        """依存タスクの完了を待つ"""

        for dep_id in task.dependencies:
            if dep_id not in responses:
                # 依存タスクがまだ実行されていない場合は待機
                max_wait = 30  # 最大30秒待機
                wait_time = 0

                while dep_id not in responses and wait_time < max_wait:
                    await asyncio.sleep(0.1)
                    wait_time += 0.1  # type: ignore

                if dep_id not in responses:
                    raise Exception(f"Dependency {dep_id} not satisfied")

    def _prepare_agent_context(
        self, agent_name: str, action_context: ActionContext, previous_responses: dict[str, TaskExecutionResult]
    ) -> dict[str, Any]:
        """エージェント用のコンテキストを準備"""

        # 基本コンテキスト
        if not self.shared_context:
            raise ValueError("Shared context not initialized")

        context = {
            "action": action_context,
            "shared_context": self.shared_context.get_ai_context(agent_name),
            "previous_responses": {},
        }

        # 前のレスポンスから関連情報を抽出
        for _task_id, result in previous_responses.items():
            if result.success:
                for response in result.responses:
                    prev_responses = context["previous_responses"]
                    if isinstance(prev_responses, dict):
                        prev_responses[response.agent_name] = {
                            "narrative": response.narrative,
                            "state_changes": response.state_changes,
                            "metadata": response.metadata,
                        }

        return context

    def _integrate_responses(self, responses: list[AIResponse]) -> FinalResponse:
        """各AIのレスポンスを統合"""

        final_response = FinalResponse(narrative="", choices=[])

        # 物語要素の統合
        narratives = []
        for response in responses:
            if response.success and response.narrative:
                narratives.append(response.narrative)

        if narratives:
            # TODO: より洗練された物語統合ロジック
            final_response.narrative = "\n\n".join(narratives)

        # 選択肢の統合
        all_choices = []
        for response in responses:
            if response.success and response.choices:
                all_choices.extend(response.choices)

        # 探索関連の選択肢を追加（物語の文脈に基づいて）
        exploration_choices = self._generate_exploration_choices_from_context(final_response.narrative)
        if exploration_choices:
            all_choices.extend(exploration_choices)

        # 重複を除去して最大4つに制限（探索選択肢を含めるため1つ増やす）
        seen_texts = set()
        for choice in all_choices:
            if choice.text not in seen_texts:
                final_response.choices.append(choice)
                seen_texts.add(choice.text)
                if len(final_response.choices) >= 4:
                    break

        # 状態変更の統合
        for response in responses:
            if response.success and response.state_changes:
                final_response.state_changes.update(response.state_changes)

        # イベントの統合
        for response in responses:
            if response.success and response.events:
                final_response.events.extend(response.events)

        return final_response

    def _generate_exploration_choices_from_context(self, narrative: str) -> list[Choice]:
        """物語の文脈から探索関連の選択肢を生成"""
        choices = []

        # 物語の内容に基づいて適切な探索選択肢を提案
        if any(word in narrative for word in ["街", "町", "都市", "村"]):
            choices.append(Choice(
                id="explore_town",
                text="街を探索する",
                description="街の中を探索してみます（SP消費: 5）"
            ))

        if any(word in narrative for word in ["森", "山", "野", "洞窟"]):
            choices.append(Choice(
                id="search_area",
                text="周囲を詳しく調べる",
                description="周囲を注意深く調査します（SP消費: 5）"
            ))

        # 移動の選択肢（常に1つは含める）
        if not choices or len(choices) < 1:
            choices.append(Choice(
                id="explore_surroundings",
                text="周囲を探索する",
                description="周辺地域を探索します（SP消費: 5）"
            ))

        return choices

    def _generate_final_response(self, integrated: FinalResponse) -> FinalResponse:
        """最終レスポンスを生成"""

        # デフォルトの選択肢がない場合は追加
        if not integrated.choices:
            integrated.choices = [
                Choice(id="continue", text="続ける"),
                Choice(id="look_around", text="周囲を見回す"),
                Choice(id="status", text="ステータスを確認する"),
            ]

        # 物語が空の場合はデフォルトメッセージ
        if not integrated.narrative:
            integrated.narrative = "あなたは次の行動を考えています。"

        return integrated

    async def _process_events(self, events: list[GameEvent]) -> None:
        """イベントを処理"""
        if not self.shared_context:
            logger.warning("Shared context not initialized, skipping event processing")
            return

        for event in events:
            # 共有コンテキストに追加
            self.shared_context.add_game_event(event)

            # イベント連鎖システムに発行
            await self.event_chain.emit_event(event)

            # 重要なイベントはログに記録
            if event.priority.value >= 3:
                logger.info(
                    "Important event", event_id=event.id, event_type=event.type.value, priority=event.priority.value
                )

        # イベント連鎖の処理
        await self.event_chain.process_events()

    async def _generate_events_from_responses(self, responses: list[AIResponse]) -> list[GameEvent]:
        """AIレスポンスからイベントを生成"""
        events = []

        for response in responses:
            if not response.success:
                continue

            # 状態変更がある場合はイベントを生成
            if response.state_changes:
                event = await self.event_integration.create_event_from_response(response, EventType.STATE_CHANGE)
                if event:
                    events.append(event)

            # 特定のエージェントからの重要な決定
            if response.agent_name == "the_world" and response.metadata.get("world_event"):
                event = await self.event_integration.create_event_from_response(response, EventType.WORLD_EVENT)
                if event:
                    events.append(event)

            # NPCの生成や死亡
            if response.agent_name == "npc_manager":
                if response.metadata.get("npc_spawned"):
                    event = await self.event_integration.create_event_from_response(response, EventType.NPC_SPAWN)
                    if event:
                        events.append(event)
                elif response.metadata.get("npc_died"):
                    event = await self.event_integration.create_event_from_response(response, EventType.NPC_DEATH)
                elif response.metadata.get("action") == "log_npc_encounter":
                    # ログNPC遭遇イベントを処理
                    from app.websocket.events import GameEventEmitter

                    npc_data = response.metadata.get("encountered_npc", {})
                    choices = response.choices if hasattr(response, "choices") else []

                    # WebSocketでNPC遭遇イベントを送信
                    if self.shared_context:
                        await GameEventEmitter.emit_npc_encounter(
                            self.shared_context.context.session_id,
                            npc_data,
                            encounter_type=response.metadata.get("encounter_type", "log_npc"),
                            choices=[
                                {"id": c.id, "text": c.text, "description": getattr(c, "description", None)}
                                for c in choices
                            ]
                            if choices
                            else [],
                        )

                    # イベントとしても記録
                    event = await self.event_integration.create_event_from_response(response, EventType.NPC_SPAWN)
                    if event:
                        events.append(event)

        return events

    def _get_unique_agents(self, tasks: list[CoordinationTask]) -> set[str]:
        """タスクリストから必要な固有のエージェントを取得"""
        agents = set()
        for task in tasks:
            agents.update(task.required_agents)
        return agents

    def _get_average_task_time(self, agent_name: str) -> float:
        """エージェントの平均タスク実行時間を取得"""
        if agent_name not in self.task_execution_times:
            return 5.0  # デフォルト5秒

        times = self.task_execution_times[agent_name]
        if not times:
            return 5.0

        # 最新10件の平均を計算
        recent_times = times[-10:]
        return sum(recent_times) / len(recent_times)
