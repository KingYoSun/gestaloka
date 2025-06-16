"""
AI協調動作のためのタスクリスト生成システム

プレイヤーアクションに基づいて、最小限のLLMリクエストで
最大の効果を得るためのタスクリストを生成します。
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import structlog

from app.ai.shared_context import PlayerAction, SharedContext

logger = structlog.get_logger()


class ActionType(str, Enum):
    """プレイヤーアクションのタイプ"""
    MOVEMENT = "movement"  # 移動
    COMBAT = "combat"  # 戦闘
    DIALOGUE = "dialogue"  # 会話
    EXPLORATION = "exploration"  # 探索
    ITEM_USE = "item_use"  # アイテム使用
    SKILL_USE = "skill_use"  # スキル使用
    QUEST_RELATED = "quest_related"  # クエスト関連
    SYSTEM_COMMAND = "system_command"  # システムコマンド
    UNKNOWN = "unknown"  # 不明


class CoordinationType(str, Enum):
    """AI協調のタイプ"""
    SEQUENTIAL = "sequential"  # 順次実行
    PARALLEL = "parallel"  # 並列実行
    REACTIVE = "reactive"  # リアクティブ実行
    CONSENSUS = "consensus"  # 合意形成


@dataclass
class CoordinationTask:
    """AI協調タスクを表すデータクラス"""
    id: str
    name: str
    required_agents: list[str]
    coordination_type: CoordinationType
    dependencies: list[str] = field(default_factory=list)
    estimated_time: float = 5.0
    progress_weight: float = 1.0
    priority: int = 0  # 高いほど優先
    metadata: dict[str, Any] = field(default_factory=dict)


class TaskListGenerator:
    """タスクリスト生成クラス"""

    def __init__(self):
        self.action_keywords = {
            ActionType.MOVEMENT: ["移動", "行く", "向かう", "進む", "戻る", "歩く", "走る", "入る", "出る"],
            ActionType.COMBAT: ["攻撃", "戦う", "倒す", "防御", "守る", "戦闘", "撃つ"],
            ActionType.DIALOGUE: ["話す", "会話", "聞く", "尋ねる", "交渉", "説得", "言う", "約束"],
            ActionType.EXPLORATION: ["調べる", "探索", "見る", "観察", "探す", "発見"],
            ActionType.ITEM_USE: ["使う", "飲む", "食べる", "装備", "外す", "投げる"],
            ActionType.SKILL_USE: ["詠唱", "発動", "スキル", "魔法", "能力", "技"],
            ActionType.QUEST_RELATED: ["クエスト", "依頼", "完了", "報告", "受注"],
            ActionType.SYSTEM_COMMAND: ["ステータス", "インベントリ", "設定", "セーブ", "ログ"]
        }

    def generate_tasks(
        self,
        action: PlayerAction,
        shared_context: SharedContext
    ) -> list[CoordinationTask]:
        """アクションに基づいて最適なタスクリストを生成"""

        action_type = self.classify_action(action)
        tasks = []

        # アクションタイプに基づくタスク生成
        if action_type == ActionType.MOVEMENT:
            tasks.extend(self._generate_movement_tasks(action, shared_context))
        elif action_type == ActionType.COMBAT:
            tasks.extend(self._generate_combat_tasks(action, shared_context))
        elif action_type == ActionType.DIALOGUE:
            tasks.extend(self._generate_dialogue_tasks(action, shared_context))
        elif action_type == ActionType.EXPLORATION:
            tasks.extend(self._generate_exploration_tasks(action, shared_context))
        elif action_type == ActionType.ITEM_USE:
            tasks.extend(self._generate_item_use_tasks(action, shared_context))
        elif action_type == ActionType.SKILL_USE:
            tasks.extend(self._generate_skill_use_tasks(action, shared_context))
        elif action_type == ActionType.QUEST_RELATED:
            tasks.extend(self._generate_quest_tasks(action, shared_context))
        elif action_type == ActionType.SYSTEM_COMMAND:
            # システムコマンドは最小限のAI呼び出し
            tasks.extend(self._generate_system_command_tasks(action, shared_context))
        else:
            # 不明なアクションはデフォルトタスクセット
            tasks.extend(self._generate_default_tasks(action, shared_context))

        # 混沌チェックは確率的に追加
        if self._should_check_anomaly(shared_context):
            tasks.insert(0, CoordinationTask(
                id="anomaly_check",
                name="混沌チェック",
                required_agents=["anomaly"],
                coordination_type=CoordinationType.PARALLEL,
                estimated_time=3.0,
                progress_weight=0.5,
                priority=5
            ))

        # タスクの最適化と並び替え
        optimized_tasks = self._optimize_task_order(tasks)

        logger.info(
            "Generated task list",
            session_id=shared_context.session_id,
            action_type=action_type.value,
            task_count=len(optimized_tasks),
            total_agents=len(self._get_unique_agents(optimized_tasks))
        )

        return optimized_tasks

    def classify_action(self, action: PlayerAction) -> ActionType:
        """プレイヤーアクションを分類"""
        action_text = action.action_text.lower()

        # メタデータから分類（優先）
        if action.metadata.get("action_type"):
            try:
                return ActionType(action.metadata["action_type"])
            except ValueError:
                pass

        # キーワードマッチングで分類
        for action_type, keywords in self.action_keywords.items():
            if any(keyword in action_text for keyword in keywords):
                return ActionType(action_type)

        return ActionType.UNKNOWN

    def _generate_movement_tasks(
        self,
        action: PlayerAction,
        shared_context: SharedContext
    ) -> list[CoordinationTask]:
        """移動アクション用のタスク生成"""
        tasks = []

        # 新しいエリアへの移動かチェック
        if self._is_new_area(action, shared_context):
            # 環境確認タスク
            tasks.append(CoordinationTask(
                id="env_check",
                name="環境確認",
                required_agents=["the_world", "npc_manager"],
                coordination_type=CoordinationType.PARALLEL,
                estimated_time=4.0,
                priority=10
            ))

        # 物語描写タスク（常に必要）
        tasks.append(CoordinationTask(
            id="movement_narrative",
            name="移動描写",
            required_agents=["dramatist"],
            coordination_type=CoordinationType.SEQUENTIAL,
            dependencies=["env_check"] if self._is_new_area(action, shared_context) else [],
            estimated_time=5.0,
            priority=8
        ))

        return tasks

    def _generate_combat_tasks(
        self,
        action: PlayerAction,
        shared_context: SharedContext
    ) -> list[CoordinationTask]:
        """戦闘アクション用のタスク生成"""
        tasks = []

        # 戦闘ルール適用
        tasks.append(CoordinationTask(
            id="combat_rules",
            name="戦闘ルール適用",
            required_agents=["state_manager"],
            coordination_type=CoordinationType.SEQUENTIAL,
            estimated_time=3.0,
            priority=10
        ))

        # NPC行動決定（敵NPCがいる場合）
        if shared_context.active_npcs:
            tasks.append(CoordinationTask(
                id="npc_combat_action",
                name="NPC戦闘行動",
                required_agents=["npc_manager"],
                coordination_type=CoordinationType.PARALLEL,
                estimated_time=3.0,
                priority=9
            ))

        # 戦闘描写
        tasks.append(CoordinationTask(
            id="combat_narrative",
            name="戦闘描写",
            required_agents=["dramatist"],
            coordination_type=CoordinationType.SEQUENTIAL,
            dependencies=["combat_rules"],
            estimated_time=5.0,
            priority=8
        ))

        return tasks

    def _generate_dialogue_tasks(
        self,
        action: PlayerAction,
        shared_context: SharedContext
    ) -> list[CoordinationTask]:
        """会話アクション用のタスク生成"""
        tasks = []

        # NPC反応生成
        tasks.append(CoordinationTask(
            id="npc_dialogue",
            name="NPC会話応答",
            required_agents=["npc_manager", "dramatist"],
            coordination_type=CoordinationType.SEQUENTIAL,
            estimated_time=6.0,
            priority=10
        ))

        # 関係性の更新（重要な会話の場合）
        if self._is_important_dialogue(action):
            tasks.append(CoordinationTask(
                id="relationship_update",
                name="関係性更新",
                required_agents=["state_manager"],
                coordination_type=CoordinationType.PARALLEL,
                estimated_time=2.0,
                priority=5
            ))

        return tasks

    def _generate_exploration_tasks(
        self,
        action: PlayerAction,
        shared_context: SharedContext
    ) -> list[CoordinationTask]:
        """探索アクション用のタスク生成"""
        tasks = []

        # 発見判定
        tasks.append(CoordinationTask(
            id="exploration_check",
            name="探索判定",
            required_agents=["state_manager"],
            coordination_type=CoordinationType.SEQUENTIAL,
            estimated_time=3.0,
            priority=9
        ))

        # 探索結果の描写
        tasks.append(CoordinationTask(
            id="exploration_narrative",
            name="探索結果描写",
            required_agents=["dramatist"],
            coordination_type=CoordinationType.SEQUENTIAL,
            dependencies=["exploration_check"],
            estimated_time=5.0,
            priority=8
        ))

        return tasks

    def _generate_item_use_tasks(
        self,
        action: PlayerAction,
        shared_context: SharedContext
    ) -> list[CoordinationTask]:
        """アイテム使用アクション用のタスク生成"""
        tasks = []

        # アイテム効果適用
        tasks.append(CoordinationTask(
            id="item_effect",
            name="アイテム効果適用",
            required_agents=["state_manager"],
            coordination_type=CoordinationType.SEQUENTIAL,
            estimated_time=3.0,
            priority=10
        ))

        # 使用描写
        tasks.append(CoordinationTask(
            id="item_use_narrative",
            name="アイテム使用描写",
            required_agents=["dramatist"],
            coordination_type=CoordinationType.SEQUENTIAL,
            dependencies=["item_effect"],
            estimated_time=4.0,
            priority=8
        ))

        return tasks

    def _generate_skill_use_tasks(
        self,
        action: PlayerAction,
        shared_context: SharedContext
    ) -> list[CoordinationTask]:
        """スキル使用アクション用のタスク生成"""
        tasks = []

        # スキル効果判定
        tasks.append(CoordinationTask(
            id="skill_check",
            name="スキル効果判定",
            required_agents=["state_manager"],
            coordination_type=CoordinationType.SEQUENTIAL,
            estimated_time=3.0,
            priority=10
        ))

        # スキル演出
        tasks.append(CoordinationTask(
            id="skill_narrative",
            name="スキル演出",
            required_agents=["dramatist"],
            coordination_type=CoordinationType.SEQUENTIAL,
            dependencies=["skill_check"],
            estimated_time=5.0,
            priority=8
        ))

        return tasks

    def _generate_quest_tasks(
        self,
        action: PlayerAction,
        shared_context: SharedContext
    ) -> list[CoordinationTask]:
        """クエスト関連アクション用のタスク生成"""
        tasks = []

        # クエスト状態確認
        tasks.append(CoordinationTask(
            id="quest_validation",
            name="クエスト状態確認",
            required_agents=["state_manager"],
            coordination_type=CoordinationType.SEQUENTIAL,
            estimated_time=3.0,
            priority=10
        ))

        # 世界への影響（クエスト完了時）
        if "完了" in action.action_text or "complete" in action.action_text.lower():
            tasks.append(CoordinationTask(
                id="world_impact",
                name="世界への影響",
                required_agents=["the_world"],
                coordination_type=CoordinationType.SEQUENTIAL,
                estimated_time=4.0,
                priority=9
            ))

            # 歴史記録
            tasks.append(CoordinationTask(
                id="historical_record",
                name="歴史記録",
                required_agents=["historian"],
                coordination_type=CoordinationType.PARALLEL,
                estimated_time=3.0,
                priority=7
            ))

        # クエスト描写
        tasks.append(CoordinationTask(
            id="quest_narrative",
            name="クエスト描写",
            required_agents=["dramatist"],
            coordination_type=CoordinationType.SEQUENTIAL,
            dependencies=["quest_validation"],
            estimated_time=5.0,
            priority=8
        ))

        return tasks

    def _generate_system_command_tasks(
        self,
        action: PlayerAction,
        shared_context: SharedContext
    ) -> list[CoordinationTask]:
        """システムコマンド用のタスク生成（最小限）"""
        tasks = []

        # ステータス表示などは状態管理AIのみ
        tasks.append(CoordinationTask(
            id="system_response",
            name="システム応答",
            required_agents=["state_manager"],
            coordination_type=CoordinationType.SEQUENTIAL,
            estimated_time=2.0,
            priority=10
        ))

        return tasks

    def _generate_default_tasks(
        self,
        action: PlayerAction,
        shared_context: SharedContext
    ) -> list[CoordinationTask]:
        """デフォルトのタスクセット"""
        tasks = []

        # 基本的な処理
        tasks.append(CoordinationTask(
            id="action_processing",
            name="アクション処理",
            required_agents=["state_manager"],
            coordination_type=CoordinationType.SEQUENTIAL,
            estimated_time=3.0,
            priority=9
        ))

        # 描写
        tasks.append(CoordinationTask(
            id="narrative",
            name="描写生成",
            required_agents=["dramatist"],
            coordination_type=CoordinationType.SEQUENTIAL,
            dependencies=["action_processing"],
            estimated_time=5.0,
            priority=8
        ))

        return tasks

    def _is_new_area(self, action: PlayerAction, shared_context: SharedContext) -> bool:
        """新しいエリアへの移動かどうか判定"""
        # 実装: 最近のアクションや現在位置から判定
        # ここでは簡易的にキーワードで判定
        new_area_keywords = ["新しい", "初めて", "未知", "入る", "到着"]
        return any(keyword in action.action_text for keyword in new_area_keywords)

    def _is_important_dialogue(self, action: PlayerAction) -> bool:
        """重要な会話かどうか判定"""
        important_keywords = ["重要", "秘密", "約束", "契約", "同盟", "裏切り"]
        return any(keyword in action.action_text for keyword in important_keywords)

    def _should_check_anomaly(self, shared_context: SharedContext) -> bool:
        """混沌チェックが必要かどうか判定"""
        # 基本確率15%
        base_chance = 0.15

        # 混沌レベルによる補正
        chaos_modifier = shared_context.world_state.chaos_level * 0.3

        # 最近のターンで混沌イベントがあった場合は確率を下げる
        recent_anomaly = any(
            event.type.value.startswith("anomaly")
            for event in shared_context.recent_events
        )
        if recent_anomaly:
            return False

        # 5ターンごとにチェック確率を上げる
        turn_modifier = 0.05 if shared_context.turn_number % 5 == 0 else 0

        total_chance = base_chance + chaos_modifier + turn_modifier

        # ここでは決定的に判定（実際の実装では乱数を使用）
        return total_chance > 0.3

    def _optimize_task_order(self, tasks: list[CoordinationTask]) -> list[CoordinationTask]:
        """タスクの実行順序を最適化"""
        # 優先度でソート
        tasks.sort(key=lambda t: t.priority, reverse=True)

        # 依存関係を考慮した並び替え
        optimized = []
        added_ids = set()

        def add_task_with_deps(task: CoordinationTask):
            if task.id in added_ids:
                return

            # 依存タスクを先に追加
            for dep_id in task.dependencies:
                dep_task = next((t for t in tasks if t.id == dep_id), None)
                if dep_task and dep_task.id not in added_ids:
                    add_task_with_deps(dep_task)

            optimized.append(task)
            added_ids.add(task.id)

        # 全タスクを依存関係順に追加
        for task in tasks:
            add_task_with_deps(task)

        return optimized

    def _get_unique_agents(self, tasks: list[CoordinationTask]) -> set[str]:
        """タスクリストから必要な固有のエージェントを取得"""
        agents = set()
        for task in tasks:
            agents.update(task.required_agents)
        return agents

    def estimate_total_time(self, tasks: list[CoordinationTask]) -> float:
        """タスクリストの推定実行時間を計算"""
        parallel_time = 0.0
        sequential_time = 0.0

        for task in tasks:
            if task.coordination_type == CoordinationType.PARALLEL:
                parallel_time = max(parallel_time, task.estimated_time)
            else:
                sequential_time += task.estimated_time

        return parallel_time + sequential_time

