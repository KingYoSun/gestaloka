"""
AI基底サービスクラス
"""

from typing import Any, Optional

from sqlmodel import Session

from app.services.llm_service import LLMService


class AIBaseService:
    """全てのAIサービスの基底クラス"""

    def __init__(self, db: Session):
        self.db = db
        self.llm_service = LLMService()

    async def generate_ai_response(
        self,
        prompt: str,
        agent_type: str,
        character_name: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> str:
        """AI応答を生成"""
        # プロンプトにエージェントタイプを追加
        full_prompt = f"[{agent_type.upper()} AI]\n\n{prompt}"

        # LLMサービスを使用して応答を生成
        response = await self.llm_service.generate_response(
            prompt=full_prompt, context={"agent_type": agent_type, "character_name": character_name, **(metadata or {})}
        )

        return response
