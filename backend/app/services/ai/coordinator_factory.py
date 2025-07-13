"""
Coordinator AIファクトリー

Coordinator AIインスタンスの生成と管理を行います。
"""

from typing import Optional

from app.services.ai.agents.coordinator import CoordinatorAI
from app.services.ai.gemini_factory import get_gemini_client
from app.services.ai.model_types import ModelType

# Coordinator AIインスタンスのキャッシュ
_coordinator_instance: Optional[CoordinatorAI] = None


def get_coordinator_ai() -> CoordinatorAI:
    """
    Coordinator AIのシングルトンインスタンスを取得
    
    Returns:
        Coordinator AIインスタンス
    """
    global _coordinator_instance
    
    if _coordinator_instance is None:
        # Geminiクライアントを取得（標準モデルを使用）
        gemini_client = get_gemini_client(
            model_type=ModelType.STANDARD,
            temperature=0.7
        )
        
        # Coordinator AIを初期化
        _coordinator_instance = CoordinatorAI(gemini_client=gemini_client)
    
    return _coordinator_instance


def clear_coordinator_cache() -> None:
    """Coordinator AIキャッシュをクリア（主にテスト用）"""
    global _coordinator_instance
    _coordinator_instance = None