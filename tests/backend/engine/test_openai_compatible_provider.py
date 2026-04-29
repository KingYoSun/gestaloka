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
from app.modules.gm_council.service import (
    CouncilMemoryManagerPayload,
    CouncilNarrativePayload,
    CouncilNPCManagerPayload,
    CouncilRulesArbiterPayload,
    CouncilSafetyGuardPayload,
    CouncilWorldProgressPayload,
)
from app.modules.llm_harness.service import (
    CouncilIntentInterpreterPayload,
    CouncilRoleRun,
    OpenAICompatibleProvider,
    PromptExecutionAttempt,
)
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
                        "prompt_tokens": 46,
                        "completion_tokens": 7,
                        "total_tokens": 53,
                        "prompt_tokens_details": {"cached_tokens": 12},
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
    assert response.prompt_tokens == 46
    assert response.completion_tokens == 7
    assert response.total_tokens == 53
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


def test_live_intent_payload_shape_is_normalized_before_validation():
    payload = CouncilIntentInterpreterPayload.model_validate(
        {
            "label": "到着記録の処理を手伝い、門番の信頼を得る",
            "posture": "progress",
            "summary": "到着記録を手伝うことで、次の進展を促す。",
            "action_kind": "narrative",
            "consequence_tags": ["trust:minor", "public_scrutiny"],
            "canonical_input_text": "Nexus Gateで到着記録の処理を手伝う",
            "narrative_consequence": "Gate Steward Rikka acknowledges the help.",
        },
        context={"input_payload": {"input_mode": "free_text", "input_text": "Nexus Gateで到着記録を助ける"}},
    )

    assert payload.input_mode == "free_text"
    assert payload.canonical_action_kind == "narrative"
    assert payload.intent_summary == "Nexus Gateで到着記録の処理を手伝う"
    assert payload.requested_choice_posture == "progress"
    assert payload.consequence_tags == ["earned_trust"]
    assert payload.consequence_summary == "Gate Steward Rikka acknowledges the help."


def test_live_memory_payload_shape_is_normalized_before_validation():
    payload = CouncilMemoryManagerPayload.model_validate(
        {
            "same_world_memory": "Demo Player helped with arrival records.",
            "relation": "Gate Steward Rikka KNOWS Demo Player (0.65)",
            "quest": "First Stabilizer Request [active 1/2]",
            "faction": "Nexus Custodians standing=0.40",
            "inventory": [],
            "scene": "Nexus Gate is waiting on the current request.",
            "chapter": "The opening chapter is gathering momentum.",
        },
        context={"input_payload": {"relevant_memories": ["Demo Player helped with arrival records."]}},
    )

    assert payload.memory_summary == "Demo Player helped with arrival records."
    assert payload.focus_memories == ["Demo Player helped with arrival records."]
    assert payload.relation_summary == "Gate Steward Rikka KNOWS Demo Player (0.65)"
    assert "First Stabilizer Request" in payload.state_summary
    assert "Nexus Gate" in payload.state_summary


def test_live_memory_payload_normalizes_wrong_scalar_and_mapping_types():
    payload = CouncilMemoryManagerPayload.model_validate(
        {
            "memory_summary": "No significant memories recorded yet.",
            "focus_memories": "Player's intent: help arrival records at Nexus Gate.",
            "relation_summary": "Gate Steward Rikka knows Demo Player.",
            "state_summary": {"location": "Nexus Gate", "active_quest": "First Stabilizer Request"},
        }
    )

    assert payload.focus_memories == ["Player's intent: help arrival records at Nexus Gate."]
    assert "location: Nexus Gate" in payload.state_summary
    assert "active_quest: First Stabilizer Request" in payload.state_summary


def test_live_npc_payload_shape_is_normalized_before_validation():
    payload = CouncilNPCManagerPayload.model_validate(
        {
            "intent": "Guide the player toward the intended quest sequence.",
            "npc_reaction_outline": {
                "initial_reaction": "Rikka nods.",
                "dialogue_summary": "She explains the next proper step.",
            },
        }
    )

    assert payload.npc_intent == "Guide the player toward the intended quest sequence."
    assert payload.reaction_style == "measured"
    assert payload.focus_memories == []
    assert "initial_reaction: Rikka nods." in payload.reaction_outline


def test_live_rules_arbiter_payload_shape_is_normalized_before_validation():
    payload = CouncilRulesArbiterPayload.model_validate(
        {
            "approval_status": "approve",
            "world_tags": ["aid_local"],
            "reason": "",
        },
        context={"input_payload": {"input_text": "到着記録を整える"}},
    )

    assert payload.approval_status == "approved"
    assert payload.normalized_world_tags == ["aid_local"]
    assert payload.reason
    assert payload.risk_level == "low"


def test_live_safety_guard_payload_shape_is_normalized_before_validation():
    payload = CouncilSafetyGuardPayload.model_validate({"approval_status": True, "reason": ""})

    assert payload.approval_status == "approved"
    assert payload.reason == "Same-world safety check passed."
    assert payload.violations == []


def test_live_narrative_payload_shape_is_normalized_before_validation():
    payload = CouncilNarrativePayload.model_validate(
        {
            "narrative": "Rikka steadies the desk and points to the next form.",
            "npc_reaction": {"gesture": "Rikka gives a short approving nod."},
        },
        context={
            "input_payload": {
                "npc_name": "Rikka",
                "outcome_band": "steady",
            }
        },
    )

    assert payload.narrative.startswith("Rikka steadies")
    assert payload.npc_reaction == "gesture: Rikka gives a short approving nod."
    assert payload.tone == "measured"


def test_live_world_progress_payload_shape_is_normalized_before_validation():
    payload = CouncilWorldProgressPayload.model_validate(
        {
            "event_type": "player.turn.resolved",
            "scene_move": "advance",
            "world_tags": ["nexus_gate_activity", "stabilizer_request_progress"],
            "outcome_band": "steady",
            "memory_drafts": ["Demo Player helped Gate Steward Rikka with arrival records."],
            "scene_pressure": "eval: slight escalation",
            "consequence_tags": ["earned_trust", "quest_progress"],
            "canonical_event_draft": "Rikka acknowledges the help and marks the request forward.",
            "next_three_diegetic_player_choices": {
                "safe": {"label": "Observe the gate", "summary": "Keep the flow steady."},
                "forward_progress": {"label": "Help with the next record", "summary": "Advance the request."},
                "exploration_relationship": {"label": "Ask Rikka about the gate", "summary": "Learn more."},
            },
        },
        context={"input_payload": {"world_id": "gestaloka_reference", "input_text": "Nexus Gateで到着記録を助ける"}},
    )

    assert payload.event_payload["world_id"] == "gestaloka_reference"
    assert payload.memories[0].text == "Demo Player helped Gate Steward Rikka with arrival records."
    assert payload.world_tags == ["aid_local"]
    assert payload.consequence_tags == ["earned_trust"]
    assert payload.resolution_summary == "Rikka acknowledges the help and marks the request forward."
    assert payload.risk_level == "low"
    assert payload.scene_move == "deepen"
    assert payload.scene_pressure == "medium"
    assert [item.posture for item in payload.next_choices] == ["safe", "progress", "explore"]


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
        prompt_tokens=46,
        completion_tokens=7,
        total_tokens=53,
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

    assert row.prompt_tokens == 46
    assert row.completion_tokens == 7
    assert row.total_tokens == 53
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
