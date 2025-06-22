# AI協調実装リファレンス

**最終更新日:** 2025/06/16  
**親ドキュメント:** [AI協調動作プロトコル仕様書](./ai_coordination_protocol.md)

## 1. Coordinator AIクラス実装

### 1.1 基本実装（最適化版）

```python
class CoordinatorAI:
    def __init__(self, agents: Dict[str, BaseAgent]):
        self.agents = agents
        self.shared_context = SharedContextManager()
        self.event_chain = EventChain()
        self.task_generator = TaskListGenerator()
        self.response_cache = ResponseCache()
        
    async def process_action(
        self,
        action: PlayerAction,
        session: GameSession
    ) -> GameResponse:
        # 1. アクション解析
        context = self.analyze_action(action)
        
        # 2. Shared Context更新
        await self.shared_context.update({
            'recent_actions': action,
            'turn_number': session.turn_number
        })
        
        # 3. タスクリスト生成（最適化の核心）
        tasks = self.task_generator.generate_tasks(
            action,
            self.shared_context.context
        )
        
        # 4. 進捗通知開始
        await self.notify_progress("処理開始", 0)
        await self.notify_progress(
            f"タスク数: {len(tasks)}, 予想時間: {self._estimate_time(tasks)}秒",
            5
        )
        
        # 5. タスク実行（最適化された呼び出し）
        responses = await self.execute_tasks(tasks, context)
        
        # 6. レスポンス統合
        integrated = self.integrate_responses(responses)
        
        # 7. 必要最小限のイベント処理
        if integrated.events:
            await self.process_event_chain(integrated.events)
        
        # 8. 最終レスポンス生成
        await self.notify_progress("完了", 100)
        return self.generate_final_response(integrated)
    
    def _estimate_time(self, tasks: List[CoordinationTask]) -> float:
        """タスクリストから推定実行時間を計算"""
        parallel_time = 0
        sequential_time = 0
        
        for task in tasks:
            if task.coordination_type == CoordinationType.PARALLEL:
                parallel_time = max(parallel_time, task.estimated_time)
            else:
                sequential_time += task.estimated_time
        
        return parallel_time + sequential_time
```

### 1.2 タスク実行の詳細実装

```python
async def execute_tasks(
    self,
    tasks: List[CoordinationTask],
    action_context: ActionContext
) -> List[AIResponse]:
    """タスクリストに基づいて最適化されたAI呼び出しを実行"""
    
    responses = {}
    total_weight = sum(task.progress_weight for task in tasks)
    current_progress = 0.0
    
    # 進捗通知
    await self.notify_progress("タスク分析完了", 10)
    
    # 依存関係グラフの構築
    task_graph = self._build_dependency_graph(tasks)
    execution_order = self._topological_sort(task_graph)
    
    for task_batch in execution_order:
        # 同じ層のタスクは並列実行可能
        if len(task_batch) > 1:
            batch_responses = await self._execute_parallel_batch(
                task_batch,
                action_context,
                responses
            )
            responses.update(batch_responses)
        else:
            # 単一タスクは順次実行
            task = task_batch[0]
            response = await self._execute_single_task(
                task,
                action_context,
                responses
            )
            responses[task.id] = response
        
        # 進捗更新
        batch_weight = sum(t.progress_weight for t in task_batch)
        current_progress += batch_weight / total_weight * 80
        await self.notify_progress(
            f"{len(task_batch)}個のタスク完了",
            10 + current_progress
        )
    
    await self.notify_progress("応答生成中", 95)
    return list(responses.values())

async def _execute_parallel_batch(
    self,
    tasks: List[CoordinationTask],
    context: ActionContext,
    previous_responses: Dict[str, AIResponse]
) -> Dict[str, AIResponse]:
    """並列タスクバッチの実行"""
    
    # エージェントごとにタスクをグループ化
    agent_tasks = defaultdict(list)
    for task in tasks:
        for agent_name in task.required_agents:
            agent_tasks[agent_name].append(task)
    
    # 各エージェントへの呼び出しを準備
    agent_calls = []
    for agent_name, task_list in agent_tasks.items():
        # 複数タスクのコンテキストをマージ
        merged_context = self._merge_task_contexts(
            task_list,
            context,
            previous_responses
        )
        
        agent = self.agents[agent_name]
        call = self._create_agent_call(
            agent,
            merged_context,
            task_list
        )
        agent_calls.append(call)
    
    # 並列実行
    results = await asyncio.gather(*agent_calls, return_exceptions=True)
    
    # 結果を各タスクに配分
    return self._distribute_batch_results(results, tasks, agent_tasks)

def _build_dependency_graph(
    self,
    tasks: List[CoordinationTask]
) -> Dict[str, Set[str]]:
    """タスクの依存関係グラフを構築"""
    graph = {task.id: set(task.dependencies) for task in tasks}
    return graph

def _topological_sort(
    self,
    graph: Dict[str, Set[str]]
) -> List[List[str]]:
    """依存関係を考慮したタスクの実行順序を決定"""
    # カーンのアルゴリズムを使用
    in_degree = defaultdict(int)
    for node, deps in graph.items():
        for dep in deps:
            in_degree[dep] += 1
    
    queue = [node for node in graph if in_degree[node] == 0]
    layers = []
    
    while queue:
        current_layer = []
        next_queue = []
        
        for node in queue:
            current_layer.append(node)
            for neighbor in graph.get(node, []):
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    next_queue.append(neighbor)
        
        layers.append(current_layer)
        queue = next_queue
    
    return layers
```

## 2. BaseAgentの拡張実装

### 2.1 抽象基底クラス

**BaseAgent抽象基底クラス**

全てのAIエージェントの基底となる抽象クラス。共通機能とインターフェースを定義。

**主要コンポーネント**：
- name: エージェント名
- config: エージェント設定
- gemini_client: Gemini APIクライアント
- prompt_manager: プロンプト管理
- response_validator: レスポンス検証

**抽象メソッド**：
- process: メイン処理メソッド（各エージェントが実装）
- should_react_to: イベントへの反応必要性を判定
- react_to_event: イベントへの反応を生成

**共通メソッド**：
- notify_event: 他AIからのイベント通知を処理
- _call_llm: LLM呼び出しの共通処理
  - プロンプト構築
  - Gemini API呼び出し
  - レスポンス検証
  - エラーハンドリング

### 2.2 具体的なエージェント実装例

**DramatistAgentクラス - 脚本家AI実装例**

物語生成とテキスト創作を担当する脚本家AIの具体的な実装例。

**主要機能**：
- NarrativeStyleManagerを使用して物語スタイルを管理
- アクションタイプと世界状態に応じた適切なスタイル選択
- temperature=0.8で創造的なテキスト生成

**processメソッドの処理**：
1. コンテキスト情報の抽出と準備
2. 物語スタイルの決定
3. 最近5件の最近のイベントを含めてLLM呼び出し
4. 必要に応じて選択肢を生成
5. ワードカウントを含むメタデータ付きでレスポンスを返す

**イベント反応**：
- 重要イベント：PLAYER_DEATH、QUEST_COMPLETE、ANOMALY_TRIGGER、NPC_DEATH
- プレイヤー死亡時は特別な死亡シークエンスを生成

**選択肢生成**：
- 3つのAI生成選択肢
- 必ず第四の選択肢として自由入力オプションを追加
- JSON形式のレスポンスをパースして選択肢オブジェクトに変換

## 3. イベントシステム実装

### 3.1 イベント定義の詳細

**イベントシステムの基本定義**

ゲーム内イベントの型定義と構造を定義するモジュール。

**EventPriority Enum**: イベント優先度
- LOW (1): 低優先度
- NORMAL (2): 通常優先度
- HIGH (3): 高優先度
- CRITICAL (4): 緊急優先度

**EventType Enum**: イベントタイプの定義
- プレイヤー起因: PLAYER_ACTION, PLAYER_LEVEL_UP, PLAYER_DEATH, PLAYER_ACHIEVEMENT
- 世界イベント: WORLD_EVENT, WEATHER_CHANGE, TIME_PASSAGE, SEASON_CHANGE
- NPCイベント: NPC_SPAWN, NPC_INTERACTION, NPC_DEATH, NPC_STATE_CHANGE
- 混沌イベント: ANOMALY_TRIGGER, REALITY_DISTORTION, CHAOS_SURGE
- システムイベント: QUEST_START, QUEST_PROGRESS, QUEST_COMPLETE, ACHIEVEMENT_UNLOCK
- 特殊イベント: NARRATIVE_SPECIAL, LOG_FRAGMENT_CREATED, LOG_NPC_SPAWNED

**GameEventデータクラス**: ゲームイベントの基本構造
- 基本フィールド: id, type, source, timestamp, data, priority
- イベント連鎖情報: parent_event_id, chain_depth, can_trigger_chain, max_chain_depth
- メタデータ: session_id, player_id, location
- to_dictメソッドでシリアライズ可能

### 3.2 Event Busの実装

**EventBusクラス - イベント配信システム**

イベントの発行、配信、管理を担当する中央イベントバス。

**主要コンポーネント**：
- subscribers: イベントタイプ別のハンドラーリスト
- event_queue: 優先順位付きイベントキュー
- event_history: 最大1000件のイベント履歴
- processing: 処理中フラグ

**主要メソッド**：

1. **subscribe**: イベントハンドラーの登録
   - イベントタイプごとにハンドラーを登録
   - 優先順位でソートして保持

2. **publish**: イベントの発行
   - イベント履歴に記録
   - 優先順位キューに追加
   - 非同期で処理を開始

3. **_process_events**: イベント処理ループ
   - キューからイベントを取得
   - 登録されたハンドラーを実行
   - イベント連鎖を管理
   - エラーハンドリング

4. **_can_chain_event**: イベント連鎖の可否判定
   - 親イベントが連鎖可能か
   - 最大連鎖深度を超えていないか
   - 無限ループ防止（同一タイプの連鎖を禁止）

## 4. SharedContext実装

### 4.1 SharedContextManager

**SharedContextManagerクラス - 共有コンテキスト管理**

AIエージェント間で共有されるコンテキスト情報を管理するクラス。

**主要コンポーネント**：
- context: SharedContextインスタンス
- update_lock: 更新の排他制御
- update_history: 最大100件の更新履歴
- subscribers: 更新通知の購読者リスト

**主要機能**：

1. **update**: コンテキストの安全な更新
   - 排他ロックで同時更新を防止
   - 更新前の値を履歴に保存
   - recent_actions/eventsは追加、その他は上書き
   - 購読者への通知

2. **get_snapshot**: 現在のコンテキストスナップショット
   - session_id, turn_number
   - world_state, player_state
   - active_npcsの辞書
   - recent_actionsのリスト
   - active_effectsのリスト

3. **rollback**: 更新のロールバック機能
   - 指定ステップ数分の更新を取り消し
   - 履歴上限を超える場合はエラー

4. **_notify_subscribers**: 非同期購読者通知
   - 全購読者のon_context_updateを並列呼び出し
   - 例外をキャッチして処理継続

## 5. 進捗通知システム

### 5.1 ProgressNotifierの実装

**ProgressNotifier & ProgressContext - 進捗通知システム**

AI処理の進捗をリアルタイムでプレイヤーに通知するシステム。

**ProgressNotifierクラス**：
- WebSocketを通じて進捗情報を配信
- セッション別の進捗追跡

主要メソッド：
- **notify_progress**: 進捗情報の送信
  - パーセンテージ、メッセージ、詳細情報を含む
  - タイムスタンプ付き
  - ログ記録付き

- **create_progress_context**: タスク実行用コンテキストの作成

**ProgressContextクラス**：
- タスク実行中の進捗管理を簡素化
- タスク完了数とフェーズを追跡

主要メソッド：
- **task_completed**: タスク完了時の進捗更新
  - 完了率を自動計算（最大90%まで）
  - 完了数、総数、フェーズ情報を含む

- **set_phase**: 処理フェーズの更新
  - フェーズ名を含む進捗通知

- **_current_percentage**: 現在の進捗率計算
  - 最終的な100%は全ての処理完了時に予約

### 5.2 フロントエンド統合例

**AIProgressIndicator Reactコンポーネント**

AI処理の進捗をリアルタイムで表示するReactコンポーネントの実装例。

**ProgressUpdateインターフェース**：
- type: 'ai_processing_progress'固定
- percentage: 進捗率（0-100）
- message: 進捗メッセージ
- timestamp: ISO形式のタイムスタンプ
- details: オプショナルな詳細情報
  - completed/total: 完了タスク数
  - phase: 現在のフェーズ
  - estimatedTime: 予想残り時間

**コンポーネントの機能**：
1. **WebSocketリスナー**: 'game_progress'イベントをリッスン
2. **履歴管理**: 最新5件の進捗更新を保持
3. **UI要素**:
   - メインプログレスバー（アニメーション付き）
   - 進捗メッセージ表示
   - 詳細情報パネル（フェーズ、タスク数、残り時間）
   - 履歴表示（フェードアウト効果付き）

**スタイリング**：
- プログレスバーに0.3秒のトランジション
- 履歴アイテムにopacityグラデーション
- クラス名でスタイルを管理