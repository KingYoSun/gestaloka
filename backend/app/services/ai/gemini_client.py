"""
Gemini API クライアント

このモジュールは、Google Gemini APIとの通信を管理します。
LangChainを使用して、Gemini 2.5 Proモデルとの統合を提供します。
"""

import asyncio
from collections.abc import AsyncIterator
from typing import Any, Optional

import structlog
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel, Field
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.config import settings
from app.core.exceptions import AIRateLimitError, AIServiceError, AITimeoutError

logger = structlog.get_logger(__name__)


class GeminiConfig(BaseModel):
    """Gemini API設定"""

    model: str = Field(default="gemini-2.5-pro")
    temperature: float = Field(default=0.7, ge=0.0, le=1.0)  # langchain-google-genaiは0.0-1.0の範囲のみサポート
    max_tokens: Optional[int] = Field(default=None)
    timeout: Optional[int] = Field(default=30)
    max_retries: int = Field(default=3)

    class Config:
        use_enum_values = True


class GeminiClient:
    """
    Gemini APIクライアント

    LangChainを使用してGemini APIとの通信を管理し、
    エラーハンドリング、リトライ、レート制限の管理を行います。
    """

    def __init__(self, config: Optional[GeminiConfig] = None):
        """
        Geminiクライアントの初期化

        Args:
            config: Gemini設定（省略時はデフォルト設定を使用）
        """
        self.config = config or GeminiConfig()
        self.logger = logger.bind(service="gemini_client")

        # LangChain ChatGoogleGenerativeAI初期化
        # langchain-google-genai 2.1.5ではtemperatureはmodel_kwargsで設定
        kwargs: dict[str, Any] = {
            "model": self.config.model,
            "model_kwargs": {
                "temperature": self.config.temperature,
            }
        }
        if self.config.max_tokens:
            kwargs["max_output_tokens"] = self.config.max_tokens
        if settings.GEMINI_API_KEY:
            kwargs["google_api_key"] = settings.GEMINI_API_KEY

        self._llm = ChatGoogleGenerativeAI(**kwargs)

        self.logger.info("Gemini client initialized", model=self.config.model, temperature=self.config.temperature)

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=60),
        retry=retry_if_exception_type((AITimeoutError, AIRateLimitError)),
    )
    async def generate(self, messages: list[BaseMessage], **kwargs: Any) -> AIMessage:
        """
        メッセージ配列から応答を生成

        Args:
            messages: LangChainメッセージのリスト
            **kwargs: 追加のLLMパラメータ

        Returns:
            AI応答メッセージ

        Raises:
            AIServiceError: API呼び出しエラー
            AITimeoutError: タイムアウトエラー
            AIRateLimitError: レート制限エラー
        """
        try:
            self.logger.info("Generating response", message_count=len(messages), kwargs=kwargs)

            # 非同期実行のためのラッパー
            # 注意: temperatureは初期化時に設定されるため、invoke時には渡さない
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, lambda: self._llm.invoke(messages, **kwargs))

            self.logger.info("Response generated successfully", response_length=len(result.content))

            return result  # type: ignore[return-value]

        except TimeoutError as e:
            self.logger.error("Gemini API timeout", error=str(e))
            raise AITimeoutError("Gemini API request timed out") from e

        except Exception as e:
            error_message = str(e)

            # レート制限エラーのチェック
            if "rate limit" in error_message.lower() or "quota" in error_message.lower():
                self.logger.warning("Rate limit exceeded", error=error_message)
                raise AIRateLimitError("Gemini API rate limit exceeded") from e

            # その他のエラー
            self.logger.error("Gemini API error", error=error_message, error_type=type(e).__name__)
            raise AIServiceError(f"Gemini API error: {error_message}") from e

    async def generate_with_system(self, system_prompt: str, user_prompt: str, **kwargs: Any) -> str:
        """
        システムプロンプトとユーザープロンプトから応答を生成

        Args:
            system_prompt: システムプロンプト
            user_prompt: ユーザープロンプト
            **kwargs: 追加のLLMパラメータ

        Returns:
            生成されたテキスト応答
        """
        messages = [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)]

        response = await self.generate(messages, **kwargs)
        content = response.content
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            # Join list elements if they're strings
            return "".join(str(item) for item in content)
        # Handle any other types by converting to string
        return str(content)  # type: ignore[unreachable]

    async def stream(self, messages: list[BaseMessage], **kwargs: Any) -> AsyncIterator[str]:
        """
        ストリーミングレスポンスを生成

        Args:
            messages: LangChainメッセージのリスト
            **kwargs: 追加のLLMパラメータ

        Yields:
            レスポンスのチャンク
        """
        try:
            self.logger.info("Starting streaming response", message_count=len(messages))

            # ストリーミング実行
            # 注意: temperatureは初期化時に設定されるため、astream時には渡さない
            async for chunk in self._llm.astream(messages, **kwargs):
                if chunk.content:
                    content = chunk.content
                    if isinstance(content, str):
                        yield content
                    elif isinstance(content, list):
                        yield "".join(str(item) for item in content)
                    else:
                        yield str(content)  # type: ignore[unreachable]

        except Exception as e:
            self.logger.error("Streaming error", error=str(e), error_type=type(e).__name__)
            raise AIServiceError(f"Streaming error: {e!s}") from e

    async def batch(self, message_batches: list[list[BaseMessage]], **kwargs: Any) -> list[AIMessage]:
        """
        複数のメッセージセットを並列処理

        Args:
            message_batches: メッセージセットのリスト
            **kwargs: 追加のLLMパラメータ

        Returns:
            AI応答メッセージのリスト
        """
        try:
            self.logger.info("Processing batch", batch_size=len(message_batches))

            # 並列実行
            tasks = [self.generate(messages, **kwargs) for messages in message_batches]

            results = await asyncio.gather(*tasks, return_exceptions=True)

            # エラーチェック
            successful_results: list[AIMessage] = []
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    self.logger.error("Batch item failed", index=i, error=str(result))
                    raise AIServiceError(f"Batch processing failed at index {i}: {result}")
                successful_results.append(result)  # type: ignore[arg-type]

            return successful_results

        except Exception as e:
            self.logger.error("Batch processing error", error=str(e), error_type=type(e).__name__)
            raise AIServiceError(f"Batch processing error: {e!s}") from e

    def update_config(self, **kwargs: Any) -> None:
        """
        クライアント設定を動的に更新

        Args:
            **kwargs: 更新する設定パラメータ
        """
        for key, value in kwargs.items():
            if hasattr(self.config, key):
                setattr(self.config, key, value)

        # 生成設定を更新して温度パラメータを適用
        if "temperature" in kwargs:
            # temperatureが変更された場合は、LLMインスタンスを再初期化
            llm_kwargs: dict[str, Any] = {
                "model": self.config.model,
                "temperature": self.config.temperature,
            }
            if self.config.max_tokens:
                llm_kwargs["max_output_tokens"] = self.config.max_tokens
            if settings.GEMINI_API_KEY:
                llm_kwargs["google_api_key"] = settings.GEMINI_API_KEY

            self._llm = ChatGoogleGenerativeAI(**llm_kwargs)

        self.logger.info("Configuration updated", updated_params=list(kwargs.keys()))
