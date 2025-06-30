"""
AIモデルタイプの定義

このモジュールは、各AIエージェントが使用するモデルタイプを定義します。
パフォーマンス最適化のため、処理内容に応じて軽量/標準モデルを使い分けます。
"""

from enum import Enum


class ModelType(str, Enum):
    """使用するモデルのタイプ"""

    FAST = "fast"  # 軽量モデル（gemini-2.5-flash）
    STANDARD = "standard"  # 標準モデル（gemini-2.5-pro）


class AIAgentType(str, Enum):
    """AIエージェントのタイプ"""

    DRAMATIST = "dramatist"  # 脚本家AI
    STATE_MANAGER = "state_manager"  # 状態管理AI
    HISTORIAN = "historian"  # 歴史家AI
    NPC_MANAGER = "npc_manager"  # NPC管理AI
    THE_WORLD = "the_world"  # 世界の意識AI
    THE_ANOMALY = "the_anomaly"  # 混沌AI


# AIエージェントごとのモデルタイプマッピング
AGENT_MODEL_MAPPING = {
    AIAgentType.DRAMATIST: ModelType.STANDARD,  # 物語生成には標準モデル
    AIAgentType.STATE_MANAGER: ModelType.FAST,  # ルール判定には軽量モデル
    AIAgentType.HISTORIAN: ModelType.STANDARD,  # ログ編纂には標準モデル
    AIAgentType.NPC_MANAGER: ModelType.STANDARD,  # NPC生成には標準モデル
    AIAgentType.THE_WORLD: ModelType.FAST,  # 状態更新には軽量モデル
    AIAgentType.THE_ANOMALY: ModelType.FAST,  # イベント判定には軽量モデル
}


def get_model_type_for_agent(agent_type: AIAgentType) -> ModelType:
    """
    AIエージェントタイプに応じたモデルタイプを取得

    Args:
        agent_type: AIエージェントのタイプ

    Returns:
        使用すべきモデルタイプ
    """
    return AGENT_MODEL_MAPPING.get(agent_type, ModelType.STANDARD)