from __future__ import annotations

import json
from typing import Any

import pytest
from pydantic import BaseModel, Field

import app.modules.llm_harness.service as llm_service
import app.modules.world_memory.service as memory_service
from app.core.config import Settings
from app.core.prompts import PromptDefinition
from app.modules.llm_harness.service import OpenAICompatibleProvider
from app.modules.world_memory.service import OpenAICompatibleEmbeddingProvider


class _ProviderPayload(BaseModel):
    answer: str = Field(min_length=1)


class _FakeResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self.payload


class _FakeClient:
    instances: list["_FakeClient"] = []

    def __init__(self, *, base_url: str, timeout: float, headers: dict[str, str]) -> None:
        self.base_url = base_url
        self.timeout = timeout
        self.headers = headers
        self.requests: list[dict[str, Any]] = []
        _FakeClient.instances.append(self)

    def post(self, url: str, *, json: dict[str, Any]) -> _FakeResponse:
        self.requests.append({"url": url, "json": json})
        if url == "/chat/completions":
            return _FakeResponse(
                {
                    "id": "chatcmpl-test",
                    "choices": [
                        {
                            "message": {
                                "content": '{"answer":"ok"}',
                            },
                        }
                    ],
                }
            )
        if url == "/embeddings":
            return _FakeResponse({"data": [{"embedding": [0.1, 0.2, 0.3]}]})
        raise AssertionError(f"unexpected URL: {url}")


def _settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "model_provider": "openai_compatible",
        "embedding_provider": "openai_compatible",
        "openai_compat_api_key": "test-key",
        "openai_compat_base_url": "https://llm.example.test/v1",
        "openai_compat_timeout_seconds": 5,
        "openai_compat_max_retries": 1,
        "openai_compat_embedding_api_key": "embed-key",
        "openai_compat_embedding_base_url": "https://embed.example.test/v1",
        "openai_compat_embedding_model": "embed-test",
        "memory_embedding_dim": 3,
        "model_lite_id": "cheap-test",
        "model_main_id": "main-test",
        "model_pro_id": "pro-test",
    }
    values.update(overrides)
    return Settings(**values)


def _prompt() -> PromptDefinition:
    return PromptDefinition(
        prompt_id="test.prompt",
        owner_module="test",
        schema_version="1",
        model_lane="main_lane",
        expected_output_schema="test",
        eval_dataset_ref="test",
        world_invariants=[],
        instructions="Answer with structured JSON.",
    )


def test_openai_compatible_provider_posts_chat_completion_json_schema(monkeypatch):
    _FakeClient.instances.clear()
    monkeypatch.setattr(llm_service.httpx, "Client", _FakeClient)

    provider = OpenAICompatibleProvider(_settings(openai_compat_response_format="json_schema"))
    response = provider.generate(
        prompt=_prompt(),
        response_model=_ProviderPayload,
        model_id="main-test",
        lane="main_lane",
        input_payload={"input_text": "hello"},
        temperature=0.3,
    )

    assert response.raw_output == {"answer": "ok"}
    assert response.provider_response_id == "chatcmpl-test"
    client = _FakeClient.instances[-1]
    assert client.base_url == "https://llm.example.test/v1"
    assert client.headers["Authorization"] == "Bearer test-key"
    request = client.requests[-1]
    assert request["url"] == "/chat/completions"
    body = request["json"]
    assert body["model"] == "main-test"
    assert body["temperature"] == 0.3
    assert body["messages"][0]["role"] == "system"
    assert body["messages"][1] == {
        "role": "user",
        "content": json.dumps({"input_text": "hello"}, ensure_ascii=False, indent=2, sort_keys=True),
    }
    assert body["response_format"]["type"] == "json_schema"
    assert body["response_format"]["json_schema"]["name"] == "test_prompt"
    assert "schema" in body["response_format"]["json_schema"]


def test_openai_compatible_provider_can_use_json_object_response_format(monkeypatch):
    _FakeClient.instances.clear()
    monkeypatch.setattr(llm_service.httpx, "Client", _FakeClient)

    provider = OpenAICompatibleProvider(_settings(openai_compat_response_format="json_object"))
    provider.generate(
        prompt=_prompt(),
        response_model=_ProviderPayload,
        model_id="main-test",
        lane="main_lane",
        input_payload={"input_text": "hello"},
        temperature=0.3,
    )

    body = _FakeClient.instances[-1].requests[-1]["json"]
    assert body["response_format"] == {"type": "json_object"}


def test_openai_compatible_embedding_posts_dimensions(monkeypatch):
    _FakeClient.instances.clear()
    monkeypatch.setattr(memory_service.httpx, "Client", _FakeClient)

    provider = OpenAICompatibleEmbeddingProvider(_settings(memory_embedding_dim=3))
    embedding = provider.embed_query("memory")

    assert embedding == [0.1, 0.2, 0.3]
    client = _FakeClient.instances[-1]
    assert client.base_url == "https://embed.example.test/v1"
    assert client.headers["Authorization"] == "Bearer embed-key"
    body = client.requests[-1]["json"]
    assert body == {"model": "embed-test", "input": "memory", "dimensions": 3}


def test_openai_compatible_embedding_rejects_dimension_mismatch(monkeypatch):
    _FakeClient.instances.clear()
    monkeypatch.setattr(memory_service.httpx, "Client", _FakeClient)

    provider = OpenAICompatibleEmbeddingProvider(_settings(memory_embedding_dim=4))

    with pytest.raises(ValueError, match="dimension mismatch"):
        provider.embed_document("memory")
