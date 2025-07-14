"""
AIエージェント基底クラス
"""

from abc import ABC, abstractmethod
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.core.logging import get_logger
from app.schemas.game_session import ActionChoice
from app.services.ai.gemini_client import GeminiClient
from app.services.ai.prompt_manager import AIAgentRole, PromptContext, PromptManager
from app.services.ai.utils import ResponseParser, ContextEnhancer

logger = get_logger(__name__)


class AgentContext(BaseModel):
    """エージェント処理用のコンテキスト"""

    session_id: Optional[str] = Field(default=None, description="ゲームセッションID")
    character_id: Optional[str] = Field(default=None, description="キャラクターID")
    character_name: Optional[str] = Field(default=None, description="キャラクター名")
    location: str = Field(description="現在地")
    world_state: dict[str, Any] = Field(default_factory=dict, description="世界の状態")
    recent_actions: list[str] = Field(default_factory=list, description="最近の行動")
    additional_context: dict[str, Any] = Field(default_factory=dict, description="追加コンテキスト")


class AgentResponse(BaseModel):
    """AIエージェントの応答"""

    agent_role: str = Field(description="エージェントの役割")
    narrative: Optional[str] = Field(default=None, description="物語的な描写")
    choices: Optional[list[ActionChoice]] = Field(default=None, description="行動選択肢")
    state_changes: Optional[dict[str, Any]] = Field(default_factory=lambda: {}, description="状態変更")
    metadata: dict[str, Any] = Field(default_factory=lambda: {}, description="追加メタデータ")


class BaseAgent(ABC):
    """
    AIエージェントの基底クラス

    すべてのGM AI評議会メンバーはこのクラスを継承します。
    """

    def __init__(
        self,
        role: AIAgentRole,
        gemini_client: Optional[GeminiClient] = None,
        prompt_manager: Optional[PromptManager] = None,
    ):
        """
        基底エージェントの初期化

        Args:
            role: エージェントの役割
            gemini_client: Geminiクライアント（省略時は新規作成）
            prompt_manager: プロンプトマネージャー（省略時は新規作成）
        """
        self.role = role
        self.gemini_client = gemini_client or GeminiClient()
        self.prompt_manager = prompt_manager or PromptManager()
        self.logger = logger.bind(agent=role.value)

    @abstractmethod
    async def process(self, context: PromptContext, **kwargs: Any) -> AgentResponse:
        """
        コンテキストを処理してレスポンスを生成

        Args:
            context: プロンプトコンテキスト
            **kwargs: 追加パラメータ

        Returns:
            エージェントレスポンス
        """
        pass

    async def generate_response(self, context: PromptContext, **generation_kwargs: Any) -> str:
        """
        基本的なレスポンス生成

        Args:
            context: プロンプトコンテキスト
            **generation_kwargs: LLM生成パラメータ

        Returns:
            生成されたテキスト
        """
        try:
            # プロンプトメッセージの構築
            messages = self.prompt_manager.build_messages(self.role, context)

            # Gemini APIで生成
            response = await self.gemini_client.generate(messages=messages, **generation_kwargs)

            content = response.content
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                return "".join(str(item) for item in content)
            # Handle any other types by converting to string
            return str(content)  # type: ignore[unreachable]

        except Exception as e:
            self.logger.error("Response generation failed", error=str(e), context_character=context.character_name)
            raise

    def validate_context(self, context: PromptContext) -> bool:
        """
        コンテキストの妥当性を検証

        Args:
            context: プロンプトコンテキスト

        Returns:
            妥当性の真偽値
        """
        # 基本的な検証
        if not context.character_name:
            self.logger.warning("Invalid context: missing character_name")
            return False

        if not context.location:
            self.logger.warning("Invalid context: missing location")
            return False

        return True

    def extract_metadata(self, context: PromptContext) -> dict[str, Any]:
        """
        コンテキストからメタデータを抽出

        Args:
            context: プロンプトコンテキスト

        Returns:
            メタデータ辞書
        """
        return {
            "character_name": context.character_name,
            "location": context.location,
            "action_count": len(context.recent_actions),
            "has_world_state": bool(context.world_state),
            "session_length": len(context.session_history),
        }
    
    def parse_json_response(self, raw_response: str) -> Optional[dict[str, Any]]:
        """
        AI応答からJSONを抽出

        Args:
            raw_response: 生のAI応答

        Returns:
            抽出されたJSONデータまたはNone
        """
        return ResponseParser.extract_json_block(raw_response)
