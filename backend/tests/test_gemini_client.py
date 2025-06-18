"""
Gemini APIクライアントのテスト
"""

from unittest.mock import AsyncMock, Mock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from tenacity import RetryError

from app.services.ai.gemini_client import GeminiClient, GeminiConfig


class TestGeminiClient:
    """GeminiClientクラスのテスト"""

    @pytest.fixture
    def gemini_config(self):
        """テスト用のGemini設定"""
        return GeminiConfig(model="gemini-2.5-pro", temperature=0.7, max_tokens=1000, timeout=30, max_retries=3)

    @pytest.fixture
    def gemini_client(self, gemini_config):
        """テスト用のGeminiクライアント"""
        with patch("app.services.ai.gemini_client.settings.GEMINI_API_KEY", "test-api-key"):
            return GeminiClient(gemini_config)

    def test_initialization(self, gemini_client, gemini_config):
        """初期化のテスト"""
        assert gemini_client.config.model == gemini_config.model
        assert gemini_client.config.temperature == gemini_config.temperature
        assert gemini_client.config.max_tokens == gemini_config.max_tokens
        assert gemini_client._llm is not None

    def test_initialization_with_temperature(self):
        """temperature設定のテスト"""
        with patch("app.services.ai.gemini_client.settings.GEMINI_API_KEY", "test-api-key"):
            # 様々なtemperature値でテスト
            for temp in [0.0, 0.5, 1.0]:
                config = GeminiConfig(temperature=temp)
                client = GeminiClient(config)
                assert client.config.temperature == temp

    @pytest.mark.asyncio
    async def test_generate_success(self, gemini_client):
        """正常な応答生成のテスト"""
        mock_response = AIMessage(content="Test response")

        # run_in_executorをモックしてレスポンスを返す
        with patch("asyncio.get_event_loop") as mock_loop:
            mock_loop.return_value.run_in_executor = AsyncMock(return_value=mock_response)
            messages = [SystemMessage(content="You are a test assistant"), HumanMessage(content="Hello")]

            result = await gemini_client.generate(messages)

            assert result == mock_response
            assert result.content == "Test response"

    @pytest.mark.asyncio
    async def test_generate_with_system_prompt(self, gemini_client):
        """システムプロンプト付き生成のテスト"""
        mock_response = AIMessage(content="Test response")

        with patch("asyncio.get_event_loop") as mock_loop:
            mock_loop.return_value.run_in_executor = AsyncMock(return_value=mock_response)
            result = await gemini_client.generate_with_system(
                system_prompt="You are a helpful assistant", user_prompt="What is 2+2?"
            )

            assert result == "Test response"

    @pytest.mark.asyncio
    async def test_generate_timeout_error(self, gemini_client):
        """タイムアウトエラーのテスト"""
        with patch("asyncio.get_event_loop") as mock_loop:
            mock_loop.return_value.run_in_executor = AsyncMock(side_effect=TimeoutError("Timeout"))
            messages = [HumanMessage(content="Test")]

            # tenacityのリトライによりRetryErrorが発生する
            with pytest.raises(RetryError):
                await gemini_client.generate(messages)

    @pytest.mark.asyncio
    async def test_generate_rate_limit_error(self, gemini_client):
        """レート制限エラーのテスト"""
        error = Exception("Rate limit exceeded")

        with patch("asyncio.get_event_loop") as mock_loop:
            mock_loop.return_value.run_in_executor = AsyncMock(side_effect=error)
            messages = [HumanMessage(content="Test")]

            # tenacityのリトライによりRetryErrorが発生する
            with pytest.raises(RetryError):
                await gemini_client.generate(messages)

    @pytest.mark.asyncio
    async def test_stream_success(self):
        """ストリーミング応答のテスト"""
        mock_chunks = [Mock(content="Hello "), Mock(content="world"), Mock(content="!")]

        async def mock_astream(*args, **kwargs):
            for chunk in mock_chunks:
                yield chunk

        # ChatGoogleGenerativeAIクラス全体をモック
        with patch("app.services.ai.gemini_client.ChatGoogleGenerativeAI") as mock_llm:
            mock_llm_instance = mock_llm.return_value
            mock_llm_instance.astream = mock_astream

            with patch("app.services.ai.gemini_client.settings.GEMINI_API_KEY", "test-api-key"):
                config = GeminiConfig(model="gemini-2.5-pro", temperature=0.7)
                gemini_client = GeminiClient(config)
                messages = [HumanMessage(content="Test")]

                result = []
                async for chunk in gemini_client.stream(messages):
                    result.append(chunk)

                assert result == ["Hello ", "world", "!"]

    @pytest.mark.asyncio
    async def test_batch_processing(self, gemini_client):
        """バッチ処理のテスト"""
        mock_responses = [
            AIMessage(content="Response 1"),
            AIMessage(content="Response 2"),
            AIMessage(content="Response 3"),
        ]

        with patch.object(gemini_client, "generate", side_effect=mock_responses):
            message_batches = [
                [HumanMessage(content="Query 1")],
                [HumanMessage(content="Query 2")],
                [HumanMessage(content="Query 3")],
            ]

            results = await gemini_client.batch(message_batches)

            assert len(results) == 3
            assert all(isinstance(r, AIMessage) for r in results)
            assert [r.content for r in results] == ["Response 1", "Response 2", "Response 3"]

    def test_update_config(self, gemini_client):
        """設定更新のテスト"""
        original_temp = gemini_client.config.temperature
        new_temp = 0.9

        with patch("app.services.ai.gemini_client.settings.GEMINI_API_KEY", "test-api-key"):
            gemini_client.update_config(temperature=new_temp)

            assert gemini_client.config.temperature == new_temp
            assert gemini_client.config.temperature != original_temp
            # 設定が更新されていることを確認
            # langchain-google-genai 2.1.5ではtemperatureはmodel_kwargsで設定される

    def test_config_validation(self):
        """設定値の検証テスト"""
        # 温度の範囲チェック
        with pytest.raises(ValueError):
            GeminiConfig(temperature=1.5)  # 範囲外

        with pytest.raises(ValueError):
            GeminiConfig(temperature=-0.1)  # 範囲外

        # 正常な値
        config = GeminiConfig(temperature=0.0)
        assert config.temperature == 0.0

        config = GeminiConfig(temperature=1.0)
        assert config.temperature == 1.0  # langchain-google-genaiは1.0まで対応
