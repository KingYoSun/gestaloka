"""
LLMサービス
"""

from typing import Any, Optional


class LLMService:
    """LLM統合サービス"""

    async def generate_response(
        self,
        prompt: str,
        context: Optional[dict[str, Any]] = None,
    ) -> str:
        """LLMレスポンスを生成"""
        # TODO: 実際のLLM統合を実装
        # 現在は仮実装
        action = context.get("action", "行動") if context else "行動"
        return f"[GM AI Response]\n\nキャラクターは{action}を実行しました。\n\n周囲を見渡すと、薄暗い廊下が続いています。古びた石壁には苔がむし、どこか湿った空気が漂っています。奥からは微かに水の滴る音が聞こえてきます。"
