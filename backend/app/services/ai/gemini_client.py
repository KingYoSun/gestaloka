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
from langchain_google_genai import ChatGoogleGenerativeAI, HarmBlockThreshold, HarmCategory
from pydantic import BaseModel, Field
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.config import settings
from app.core.exceptions import AIRateLimitError, AIServiceError, AITimeoutError
from app.services.ai.model_types import ModelType
from app.services.ai.response_cache import get_response_cache

logger = structlog.get_logger(__name__)


class GeminiConfig(BaseModel):
    """Gemini API設定"""

    model: str = Field(default="gemini-2.5-pro")
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)  # Gemini 2.5は0.0-2.0の範囲をサポート
    max_tokens: Optional[int] = Field(default=None)
    timeout: Optional[int] = Field(default=30)
    max_retries: int = Field(default=3)
    top_p: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    top_k: Optional[int] = Field(default=None, ge=1)
    enable_safety_settings: bool = Field(default=True)

    class Config:
        use_enum_values = True


class GeminiClient:
    """
    Gemini APIクライアント

    LangChainを使用してGemini APIとの通信を管理し、
    エラーハンドリング、リトライ、レート制限の管理を行います。
    """

    def __init__(self, config: Optional[GeminiConfig] = None, model_type: Optional[ModelType] = None):
        """
        Geminiクライアントの初期化

        Args:
            config: Gemini設定（省略時はデフォルト設定を使用）
            model_type: 使用するモデルタイプ（fast/standard）
        """
        self.config = config or GeminiConfig()
        self.model_type = model_type
        self.logger = logger.bind(service="gemini_client")
        self._cache = get_response_cache()

        # モデルタイプに応じてモデル名を選択
        if model_type == ModelType.FAST:
            model_name = settings.GEMINI_MODEL_FAST
        elif model_type == ModelType.STANDARD:
            model_name = settings.GEMINI_MODEL_STANDARD
        else:
            model_name = self.config.model

        # LangChain ChatGoogleGenerativeAI初期化
        # langchain-google-genai 2.1.6では直接temperatureを設定可能
        kwargs: dict[str, Any] = {
            "model": model_name,
            "temperature": self.config.temperature,
            "timeout": self.config.timeout,
            "max_retries": self.config.max_retries,
        }
        
        # Optional parameters
        if self.config.max_tokens:
            kwargs["max_output_tokens"] = self.config.max_tokens
        if self.config.top_p is not None:
            kwargs["top_p"] = self.config.top_p
        if self.config.top_k is not None:
            kwargs["top_k"] = self.config.top_k
        if settings.GEMINI_API_KEY:
            kwargs["google_api_key"] = settings.GEMINI_API_KEY
            
        # Safety settings
        if self.config.enable_safety_settings:
            kwargs["safety_settings"] = {
                HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
                HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            }

        self._llm = ChatGoogleGenerativeAI(**kwargs)
        self._model_name = model_name

        self.logger.info(
            "Gemini client initialized",
            model=model_name,
            model_type=model_type,
            temperature=self.config.temperature,
        )

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
            # temperatureやmax_tokensなどのパラメータを除外
            filtered_kwargs = {k: v for k, v in kwargs.items() if k not in ["temperature", "max_tokens"]}
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, lambda: self._llm.invoke(messages, **filtered_kwargs))

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
        # キャッシュチェック（use_cacheパラメータで制御可能）
        use_cache = kwargs.pop("use_cache", True)
        cache_ttl = kwargs.pop("cache_ttl", 3600)  # デフォルト1時間
        
        if use_cache:
            cache_key_data = {
                "system": system_prompt,
                "user": user_prompt,
                "model": self._model_name,
                "temperature": self.config.temperature,
            }
            cached_response = self._cache.get(
                prompt=f"{system_prompt}\n{user_prompt}",
                **cache_key_data
            )
            if cached_response:
                return cached_response
        
        messages = [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)]

        response = await self.generate(messages, **kwargs)
        content = response.content
        if isinstance(content, str):
            result = content
        elif isinstance(content, list):
            # Join list elements if they're strings
            result = "".join(str(item) for item in content)
        else:
            # Handle any other types by converting to string
            result = str(content)  # type: ignore[unreachable]
            
        # キャッシュに保存
        if use_cache:
            self._cache.set(
                prompt=f"{system_prompt}\n{user_prompt}",
                value=result,
                ttl_seconds=cache_ttl,
                **cache_key_data
            )
            
        return result

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

            # バッチサイズに基づいて並列度を調整
            # 大きなバッチの場合は同時実行数を制限してレート制限を回避
            max_concurrent = min(10, len(message_batches))  # 最大10並列
            semaphore = asyncio.Semaphore(max_concurrent)
            
            async def limited_generate(messages: list[BaseMessage]) -> AIMessage:
                async with semaphore:
                    return await self.generate(messages, **kwargs)
            
            # 並列実行
            tasks = [limited_generate(messages) for messages in message_batches]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # エラーチェック
            successful_results: list[AIMessage] = []
            failed_indices: list[tuple[int, Exception]] = []
            
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    failed_indices.append((i, result))
                else:
                    successful_results.append(result)  # type: ignore[arg-type]
                    
            # 部分的な失敗の場合はリトライ
            if failed_indices and len(failed_indices) < len(message_batches) * 0.5:
                self.logger.warning(
                    "Partial batch failure, retrying failed items",
                    failed_count=len(failed_indices),
                    total_count=len(message_batches)
                )
                
                # 失敗したアイテムのリトライ（順次実行）
                for idx, _ in failed_indices:
                    try:
                        retry_result = await self.generate(message_batches[idx], **kwargs)
                        successful_results.insert(idx, retry_result)
                    except Exception as retry_error:
                        self.logger.error("Retry failed", index=idx, error=str(retry_error))
                        raise AIServiceError(f"Batch processing failed at index {idx} after retry: {retry_error}")
            elif failed_indices:
                # 半数以上が失敗した場合はエラー
                first_error = failed_indices[0]
                raise AIServiceError(f"Batch processing failed at index {first_error[0]}: {first_error[1]}")

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

        # 生成設定を更新してパラメータを適用
        config_keys = {"temperature", "timeout", "max_retries", "top_p", "top_k", "enable_safety_settings"}
        if any(key in kwargs for key in config_keys):
            # パラメータが変更された場合は、LLMインスタンスを再初期化
            llm_kwargs: dict[str, Any] = {
                "model": self._model_name,
                "temperature": self.config.temperature,
                "timeout": self.config.timeout,
                "max_retries": self.config.max_retries,
            }
            
            # Optional parameters
            if self.config.max_tokens:
                llm_kwargs["max_output_tokens"] = self.config.max_tokens
            if self.config.top_p is not None:
                llm_kwargs["top_p"] = self.config.top_p
            if self.config.top_k is not None:
                llm_kwargs["top_k"] = self.config.top_k
            if settings.GEMINI_API_KEY:
                llm_kwargs["google_api_key"] = settings.GEMINI_API_KEY
                
            # Safety settings
            if self.config.enable_safety_settings:
                llm_kwargs["safety_settings"] = {
                    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
                    HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                    HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                }

            self._llm = ChatGoogleGenerativeAI(**llm_kwargs)

        self.logger.info("Configuration updated", updated_params=list(kwargs.keys()))
