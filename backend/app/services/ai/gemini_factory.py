"""
Geminiクライアントファクトリー

このモジュールは、用途に応じたGeminiクライアントの生成と管理を行います。
モデルタイプごとにクライアントインスタンスをキャッシュし、効率的な再利用を可能にします。
"""

from typing import Optional

from app.services.ai.gemini_client import GeminiClient, GeminiConfig
from app.services.ai.model_types import AIAgentType, ModelType, get_model_type_for_agent

# クライアントインスタンスのキャッシュ
_client_cache: dict[tuple[ModelType, float], GeminiClient] = {}


def get_gemini_client(
    model_type: Optional[ModelType] = None,
    temperature: float = 0.7,
    max_tokens: Optional[int] = None,
) -> GeminiClient:
    """
    指定されたモデルタイプと設定でGeminiクライアントを取得

    Args:
        model_type: 使用するモデルタイプ（省略時は標準モデル）
        temperature: 生成温度（0.0-1.0）
        max_tokens: 最大トークン数

    Returns:
        Geminiクライアントインスタンス
    """
    # デフォルト値の設定
    if model_type is None:
        model_type = ModelType.STANDARD

    # キャッシュキーの生成
    cache_key = (model_type, temperature)

    # キャッシュからクライアントを取得または新規作成
    if cache_key not in _client_cache:
        config = GeminiConfig(
            temperature=temperature,
            max_tokens=max_tokens,
        )
        _client_cache[cache_key] = GeminiClient(config=config, model_type=model_type)

    return _client_cache[cache_key]


def get_gemini_client_for_agent(
    agent_type: AIAgentType,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> GeminiClient:
    """
    AIエージェントタイプに応じたGeminiクライアントを取得

    Args:
        agent_type: AIエージェントのタイプ
        temperature: 生成温度（省略時はエージェントごとのデフォルト値）
        max_tokens: 最大トークン数

    Returns:
        適切に設定されたGeminiクライアントインスタンス
    """
    # エージェントごとのデフォルト温度設定
    default_temperatures = {
        AIAgentType.DRAMATIST: 0.8,  # 創造的な物語生成
        AIAgentType.STATE_MANAGER: 0.3,  # 一貫性のあるルール判定
        AIAgentType.HISTORIAN: 0.5,  # バランスの取れた記録
        AIAgentType.NPC_MANAGER: 0.8,  # 多様なNPC生成
        AIAgentType.THE_WORLD: 0.3,  # 予測可能な世界状態
        AIAgentType.THE_ANOMALY: 0.95,  # カオスなイベント生成
    }

    # 温度が指定されていない場合はデフォルト値を使用
    if temperature is None:
        temperature = default_temperatures.get(agent_type, 0.7)

    # エージェントに適したモデルタイプを取得
    model_type = get_model_type_for_agent(agent_type)

    return get_gemini_client(
        model_type=model_type,
        temperature=temperature,
        max_tokens=max_tokens,
    )


def clear_client_cache() -> None:
    """クライアントキャッシュをクリア"""
    _client_cache.clear()
