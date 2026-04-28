from __future__ import annotations

import json
from typing import Any

import pytest
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import app.modules.llm_harness.service as llm_service
import app.modules.world_memory.service as memory_service
from app.core.config import Settings
from app.core.prompts import PromptDefinition
from app.models.base import Base
from app.models.entities import LLMRun
from app.modules.llm_harness.service import CouncilRoleRun, OpenAICompatibleProvider, PromptExecutionAttempt
from app.modules.session.service import _persist_role_runs
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
                    "usage": {
                        "prompt_cache_hit_tokens": 12,
                        "prompt_cache_miss_tokens": 34,
                    },
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

    provider = OpenAICompatibleProvider(
        _settings(openai_compat_response_format="json_schema", openai_compat_context_cache_enabled=False)
    )
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
    assert response.prompt_cache_hit_tokens == 12
    assert response.prompt_cache_miss_tokens == 34
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

    provider = OpenAICompatibleProvider(
        _settings(openai_compat_response_format="json_object", openai_compat_context_cache_enabled=False)
    )
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


def test_openai_compatible_provider_orders_stable_context_before_request_context(monkeypatch):
    _FakeClient.instances.clear()
    monkeypatch.setattr(llm_service.httpx, "Client", _FakeClient)

    provider = OpenAICompatibleProvider(_settings(openai_compat_response_format="json_object"))
    provider.generate(
        prompt=_prompt(),
        response_model=_ProviderPayload,
        model_id="main-test",
        lane="main_lane",
        input_payload={
            "world_id": "world-1",
            "world_pack": {"pack_id": "gestaloka_reference"},
            "player_profile": {"background": "lamp keeper"},
            "narrative_preferences": {"tone": "measured"},
            "current_location": {"name": "Harbor"},
            "local_figures": [{"name": "Mira"}],
            "nearby_routes": [{"destination_key": "plaza"}],
            "shared_world_context": {"world_axes": []},
            "input_text": "first action",
            "relevant_memories": ["recent beat"],
        },
        temperature=0.3,
    )

    content = _FakeClient.instances[-1].requests[-1]["json"]["messages"][1]["content"]
    assert content.index("## stable_context") < content.index("## request_context")
    stable_section = content.split("## request_context", 1)[0]
    request_section = content.split("## request_context", 1)[1]
    assert '"world_pack":{"pack_id":"gestaloka_reference"}' in stable_section
    assert '"player_profile":{"background":"lamp keeper"}' in stable_section
    assert '"current_location":{"name":"Harbor"}' in stable_section
    assert '"input_text":"first action"' not in stable_section
    assert '"input_text":"first action"' in request_section


def test_openai_compatible_provider_keeps_stable_prefix_when_only_input_text_changes(monkeypatch):
    _FakeClient.instances.clear()
    monkeypatch.setattr(llm_service.httpx, "Client", _FakeClient)

    provider = OpenAICompatibleProvider(_settings(openai_compat_response_format="json_object"))
    base_payload = {
        "world_id": "world-1",
        "world_pack": {"pack_id": "gestaloka_reference"},
        "player_profile": {"background": "lamp keeper"},
        "current_location": {"name": "Harbor"},
        "input_text": "first action",
    }
    for input_text in ("first action", "second action"):
        provider.generate(
            prompt=_prompt(),
            response_model=_ProviderPayload,
            model_id="main-test",
            lane="main_lane",
            input_payload={**base_payload, "input_text": input_text},
            temperature=0.3,
        )

    first_content = _FakeClient.instances[-1].requests[-2]["json"]["messages"][1]["content"]
    second_content = _FakeClient.instances[-1].requests[-1]["json"]["messages"][1]["content"]
    assert first_content.split("## request_context", 1)[0] == second_content.split("## request_context", 1)[0]
    assert first_content != second_content


def test_llm_run_persistence_keeps_prompt_cache_token_counts(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'cache-tokens.db'}")
    Base.metadata.create_all(bind=engine)
    attempt = PromptExecutionAttempt(
        prompt_id="test.prompt",
        schema_version="1",
        model_lane="main_lane",
        model_id="main-test",
        input_hash="input-hash",
        input_context_hash="input-context-hash",
        status="resolved",
        output_schema_status="valid",
        output_payload={"status": "resolved", "raw_output": {"answer": "ok"}},
        provider_name="openai_compatible",
        provider_response_id="chatcmpl-test",
        prompt_cache_hit_tokens=12,
        prompt_cache_miss_tokens=34,
    )
    role_run = CouncilRoleRun(
        council_role="test_role",
        stage_index=1,
        prompt_id="test.prompt",
        approval_status="approved",
        attempts=[attempt],
        final_lane="main_lane",
        final_payload={"answer": "ok"},
    )

    with Session(engine) as db:
        _persist_role_runs(
            db,
            world_id="world-1",
            turn_id="turn-1",
            workflow_name="gm_council",
            role_runs=[role_run],
            graph_context_status="ready",
        )
        db.commit()
        row = db.execute(select(LLMRun)).scalar_one()

    assert row.prompt_cache_hit_tokens == 12
    assert row.prompt_cache_miss_tokens == 34


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
