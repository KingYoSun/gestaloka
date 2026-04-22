from __future__ import annotations

import hashlib
import json
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field, ValidationError

from app.core.config import Settings
from app.core.prompts import PromptDefinition, PromptRegistry
from app.modules.observability.service import ObservabilityService
from app.modules.world_state.rules import WorldTag, infer_world_tags, normalize_world_tags

try:
    from google import genai
    from google.genai import types as genai_types
except ImportError:  # pragma: no cover - dependency is installed in runtime image
    genai = None
    genai_types = None


T = TypeVar("T", bound=BaseModel)


@dataclass(frozen=True)
class PromptRouteOverride:
    prompt_id: str
    default_lane: str
    model_ids: dict[str, str]


@dataclass(frozen=True)
class PromptExecutionAttempt:
    prompt_id: str
    schema_version: str
    model_lane: str
    model_id: str
    input_hash: str
    input_context_hash: str
    status: str
    output_schema_status: str
    output_payload: dict[str, Any]
    provider_name: str
    provider_response_id: str | None


@dataclass(frozen=True)
class PromptExecutionOutcome(Generic[T]):
    attempts: list[PromptExecutionAttempt]
    final_lane: str
    final_payload: T | None
    failure_reason: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.final_payload is not None

    @property
    def used_fallback(self) -> bool:
        return len(self.attempts) > 1


@dataclass(frozen=True)
class ProviderResponse:
    raw_output: dict[str, Any]
    provider_name: str
    provider_response_id: str | None


@dataclass(frozen=True)
class CouncilRoleRun:
    council_role: str
    stage_index: int
    prompt_id: str
    approval_status: str
    attempts: list[PromptExecutionAttempt]
    final_lane: str
    final_payload: dict[str, Any] | None
    failure_reason: str | None = None


class MemoryDraft(BaseModel):
    scope: str = Field(min_length=1)
    text: str = Field(min_length=1)
    salience: float = Field(ge=0.0, le=1.0)


class TurnResolutionPayload(BaseModel):
    narrative: str = Field(min_length=1)
    npc_reaction: str = Field(min_length=1)
    event_type: str = Field(min_length=1)
    event_payload: dict[str, Any]
    memories: list[MemoryDraft] = Field(min_length=1)
    world_tags: list[WorldTag] = Field(min_length=1)


@dataclass(frozen=True)
class TurnResolutionOutcome:
    role_runs: list[CouncilRoleRun]
    final_lane: str
    final_payload: TurnResolutionPayload | None
    failure_reason: str | None = None
    rejection_role: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.final_payload is not None

    @property
    def attempts(self) -> list[PromptExecutionAttempt]:
        flattened: list[PromptExecutionAttempt] = []
        for role_run in self.role_runs:
            flattened.extend(role_run.attempts)
        return flattened

    @property
    def used_fallback(self) -> bool:
        return any(len(role_run.attempts) > 1 for role_run in self.role_runs)


class BaseModelProvider:
    provider_name = "base"

    def generate(
        self,
        *,
        prompt: PromptDefinition,
        response_model: type[T],
        model_id: str,
        lane: str,
        input_payload: dict[str, Any],
        temperature: float,
    ) -> ProviderResponse:
        raise NotImplementedError


class StubModelProvider(BaseModelProvider):
    provider_name = "stub"

    def generate(
        self,
        *,
        prompt: PromptDefinition,
        response_model: type[T],
        model_id: str,
        lane: str,
        input_payload: dict[str, Any],
        temperature: float,
    ) -> ProviderResponse:
        del response_model, model_id, temperature
        return ProviderResponse(
            raw_output=self._generate_stub_output(prompt.prompt_id, lane=lane, input_payload=input_payload),
            provider_name=self.provider_name,
            provider_response_id=None,
        )

    def _generate_stub_output(self, prompt_id: str, *, lane: str, input_payload: dict[str, Any]) -> dict[str, Any]:
        if "__force_invalid_all__" in str(input_payload.get("input_text", "")):
            return {"status": "invalid"}
        if prompt_id in {"council.rules_arbiter", "council.safety_guard", "council.narrative"} and lane == "main_lane":
            if "__force_invalid_main__" in str(input_payload.get("input_text", "")):
                return {"status": "invalid"}

        if prompt_id == "council.memory_manager":
            return self._memory_manager_output(input_payload)
        if prompt_id == "council.npc_manager":
            return self._npc_manager_output(input_payload)
        if prompt_id == "council.world_progress":
            return self._world_progress_output(input_payload)
        if prompt_id == "council.rules_arbiter":
            return self._rules_arbiter_output(input_payload)
        if prompt_id == "council.safety_guard":
            return self._safety_guard_output(input_payload)
        if prompt_id == "council.narrative":
            return self._narrative_output(input_payload)
        raise KeyError(f"Unsupported stub prompt: {prompt_id}")

    def _memory_manager_output(self, input_payload: dict[str, Any]) -> dict[str, Any]:
        memories = [str(item) for item in input_payload.get("relevant_memories") or []]
        relations = [str(item) for item in input_payload.get("relation_context") or []]
        quests = [item.get("title", "") for item in input_payload.get("quests") or [] if item.get("title")]
        factions = [item.get("name", "") for item in input_payload.get("factions") or [] if item.get("name")]
        inventory = [item.get("name", "") for item in input_payload.get("inventory") or [] if item.get("name")]
        active_quest_stage = str(input_payload.get("active_quest_stage") or "none")
        usable_items = [item.get("name", "") for item in input_payload.get("usable_reward_items") or [] if item.get("name")]
        used_items = [item.get("name", "") for item in input_payload.get("used_reward_items") or [] if item.get("name")]
        summary_parts = []
        if memories:
            summary_parts.append(f"memory={' / '.join(memories[:2])}")
        if relations:
            summary_parts.append(f"relation={' / '.join(relations[:2])}")
        if quests:
            summary_parts.append(f"quest={quests[0]}")
        summary_parts.append(f"quest_stage={active_quest_stage}")
        if factions:
            summary_parts.append(f"faction={factions[0]}")
        if inventory:
            summary_parts.append(f"inventory={', '.join(inventory[:2])}")
        if usable_items:
            summary_parts.append(f"usable_reward={', '.join(usable_items[:2])}")
        if used_items:
            summary_parts.append(f"used_reward={', '.join(used_items[:2])}")
        summary = " | ".join(summary_parts) if summary_parts else "no prior context"
        return {
            "memory_summary": summary,
            "focus_memories": memories[:3],
            "relation_summary": " / ".join(relations[:3]) if relations else "same-world relation graph is quiet",
            "state_summary": (
                f"quests={len(quests)} factions={len(factions)} inventory={len(inventory)} "
                f"usable_reward_items={len(usable_items)} used_reward_items={len(used_items)}"
            ),
        }

    def _npc_manager_output(self, input_payload: dict[str, Any]) -> dict[str, Any]:
        npc_name = str(input_payload.get("npc_name") or "NPC")
        memory_summary = str(input_payload.get("memory_summary") or "no prior memory")
        focus_memories = [str(item) for item in input_payload.get("focus_memories") or []]
        active_quest_stage = str(input_payload.get("active_quest_stage") or "none")
        return {
            "npc_intent": f"{npc_name} keeps same-world continuity and responds to the latest player action.",
            "reaction_style": "measured",
            "focus_memories": focus_memories[:2],
            "reaction_outline": (
                f"{npc_name} references {memory_summary}, keeps quest stage {active_quest_stage}, "
                "and factors in the current faction/inventory state."
            ),
        }

    def _world_progress_output(self, input_payload: dict[str, Any]) -> dict[str, Any]:
        player_name = str(input_payload.get("player_name") or "Player")
        npc_name = str(input_payload.get("npc_name") or "NPC")
        input_text = str(input_payload.get("input_text") or "")
        relation_summary = str(input_payload.get("relation_summary") or "")
        world_tags = normalize_world_tags(infer_world_tags(input_text))
        if "__force_council_reject__" in input_text:
            world_tags = ["threaten_local"]
        risk_level = "high" if any(tag in {"threaten_local", "collect_reward"} for tag in world_tags) else "medium"
        if world_tags == ["none"]:
            risk_level = "low"
        npc_anchor = str(input_payload.get("reaction_outline") or f"{npc_name} responds to the new event.")
        return {
            "event_type": "player.turn.resolved",
            "event_payload": {
                "action": input_text,
                "world_tags": world_tags,
                "npc_anchor": npc_anchor,
                "relation_summary": relation_summary,
            },
            "memories": [
                {
                    "scope": "world",
                    "text": f"{player_name}は{input_text}。{npc_anchor}",
                    "salience": 0.92,
                },
                {
                    "scope": "actor",
                    "text": f"{npc_name} remembers: {player_name}は{input_text}。",
                    "salience": 0.88,
                },
            ],
            "world_tags": world_tags,
            "resolution_summary": f"{player_name} acted with tags {', '.join(world_tags)}.",
            "risk_level": risk_level,
        }

    def _rules_arbiter_output(self, input_payload: dict[str, Any]) -> dict[str, Any]:
        input_text = str(input_payload.get("input_text") or "")
        world_tags = normalize_world_tags([str(item) for item in input_payload.get("world_tags") or []])
        risk_level = str(input_payload.get("risk_level") or "low")
        approval_status = "approved"
        reason = "Quest/faction/location rules are consistent and SP remains execution-only."
        if "__force_rules_reject__" in input_text:
            approval_status = "rejected"
            reason = "Rule arbiter rejected the turn."
        return {
            "approval_status": approval_status,
            "normalized_world_tags": world_tags,
            "reason": reason,
            "risk_level": risk_level,
        }

    def _safety_guard_output(self, input_payload: dict[str, Any]) -> dict[str, Any]:
        input_text = str(input_payload.get("input_text") or "")
        world_id = str(input_payload.get("world_id") or "")
        event_world_id = str(input_payload.get("event_world_id") or world_id)
        violations: list[str] = []
        approval_status = "approved"
        reason = "Same-world invariants are preserved."
        if event_world_id != world_id:
            violations.append("event world_id mismatch")
        if "__force_council_reject__" in input_text or "__force_safety_reject__" in input_text:
            violations.append("forced safety rejection")
        if violations:
            approval_status = "rejected"
            reason = "; ".join(violations)
        return {
            "approval_status": approval_status,
            "reason": reason,
            "violations": violations,
        }

    def _narrative_output(self, input_payload: dict[str, Any]) -> dict[str, Any]:
        player_name = str(input_payload.get("player_name") or "Player")
        npc_name = str(input_payload.get("npc_name") or "NPC")
        input_text = str(input_payload.get("input_text") or "")
        memory_summary = str(input_payload.get("memory_summary") or "")
        reaction_outline = str(input_payload.get("reaction_outline") or "")
        world_tags = normalize_world_tags([str(item) for item in input_payload.get("world_tags") or []])
        narrative = (
            f"{player_name}は『{input_text}』と行動した。"
            f"{npc_name}はその結果を同じ世界の事実として受け止めた。"
        )
        if world_tags != ["none"]:
            narrative = f"{narrative} world_tags={', '.join(world_tags)} が確定した。"
        npc_reaction = f"{npc_name}は{reaction_outline}"
        if memory_summary:
            npc_reaction = f"{npc_reaction.rstrip('。')} 記憶要約「{memory_summary}」も踏まえた。"
        return {
            "narrative": narrative,
            "npc_reaction": npc_reaction,
            "tone": "measured",
        }


class GeminiDeveloperAPIProvider(BaseModelProvider):
    provider_name = "gemini_developer_api"

    def __init__(self, settings: Settings) -> None:
        if genai is None or genai_types is None:  # pragma: no cover - import is validated in runtime image
            raise RuntimeError("google-genai is not installed")
        if not settings.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is required when MODEL_PROVIDER=gemini_developer_api")
        self.settings = settings
        try:
            # The SDK expects timeout in milliseconds, while repo config is expressed in seconds.
            timeout_ms = max(int(settings.gemini_timeout_seconds * 1000), 1)
            http_options = genai_types.HttpOptions(timeout=timeout_ms)
            self.client = genai.Client(api_key=settings.gemini_api_key, http_options=http_options)
        except Exception:  # pragma: no cover - fallback for SDK signature drift
            self.client = genai.Client(api_key=settings.gemini_api_key)

    def generate(
        self,
        *,
        prompt: PromptDefinition,
        response_model: type[T],
        model_id: str,
        lane: str,
        input_payload: dict[str, Any],
        temperature: float,
    ) -> ProviderResponse:
        prompt_text = "\n\n".join(
            [
                prompt.instructions.strip(),
                "Return a JSON object only.",
                json.dumps(input_payload, ensure_ascii=False, indent=2, sort_keys=True),
            ]
        )
        last_error: Exception | None = None
        for _ in range(max(self.settings.gemini_max_retries, 1)):
            try:
                response = self.client.models.generate_content(
                    model=model_id,
                    contents=prompt_text,
                    config={
                        "response_mime_type": "application/json",
                        "response_json_schema": response_model.model_json_schema(),
                        "temperature": temperature,
                    },
                )
                response_text = self._response_text(response)
                return ProviderResponse(
                    raw_output=json.loads(response_text),
                    provider_name=self.provider_name,
                    provider_response_id=self._response_id(response),
                )
            except Exception as exc:  # pragma: no cover - exercised only with live credentials
                last_error = exc
        assert last_error is not None
        raise last_error

    @staticmethod
    def _response_text(response: Any) -> str:
        text = getattr(response, "text", None)
        if isinstance(text, str) and text.strip():
            return text
        candidates = getattr(response, "candidates", None) or []
        if candidates:
            content = getattr(candidates[0], "content", None)
            parts = getattr(content, "parts", None) or []
            for part in parts:
                part_text = getattr(part, "text", None)
                if isinstance(part_text, str) and part_text.strip():
                    return part_text
        raise ValueError("Gemini response did not include JSON text")

    @staticmethod
    def _response_id(response: Any) -> str | None:
        for attribute in ("response_id", "name", "id"):
            value = getattr(response, attribute, None)
            if isinstance(value, str) and value:
                return value
        return None


class ModelRouter:
    def __init__(
        self,
        settings: Settings,
        prompt_registry: PromptRegistry,
        *,
        route_overrides: dict[str, PromptRouteOverride] | None = None,
        config_name: str = "settings",
        observability_service: ObservabilityService | None = None,
    ) -> None:
        self.settings = settings
        self.prompt_registry = prompt_registry
        self.route_overrides = route_overrides or {}
        self.config_name = config_name
        self.observability_service = observability_service
        self._provider: BaseModelProvider | None = None

    def execute_structured_prompt(
        self,
        *,
        prompt_id: str,
        response_model: type[T],
        input_payload: dict[str, Any],
        world_id: str,
        turn_id: str | None = None,
        graph_context_status: str = "ready",
        allow_pro_fallback: bool = False,
        force_pro_after_success: bool = False,
    ) -> PromptExecutionOutcome[T]:
        route = self.route_overrides.get(prompt_id)
        resolved_prompt_id = route.prompt_id if route is not None else prompt_id
        prompt = self.prompt_registry.get(resolved_prompt_id)
        requested_lane = route.default_lane if route is not None else prompt.model_lane
        input_context_hash = self._input_context_hash(prompt, input_payload)
        attempts: list[PromptExecutionAttempt] = []
        failure_reason: str | None = None

        span_attributes = {
            "world_id": world_id,
            "turn_id": turn_id,
            "prompt_id": prompt.prompt_id,
            "graph_context_status": graph_context_status,
            "config_name": self.config_name,
            "runtime_role": self.settings.app_runtime_role,
        }
        context_manager = (
            self.observability_service.span("model_router.execute_structured_prompt", attributes=span_attributes)
            if self.observability_service is not None
            else _null_span()
        )

        with context_manager:
            lanes = self._lane_sequence(requested_lane, allow_pro_fallback or force_pro_after_success)
            for lane_index, lane in enumerate(lanes):
                model_id = self._model_id_for_lane(lane, route)
                try:
                    provider_response = self.provider.generate(
                        prompt=prompt,
                        response_model=response_model,
                        model_id=model_id,
                        lane=lane,
                        input_payload=input_payload,
                        temperature=self._temperature_for_lane(lane),
                    )
                except Exception as exc:
                    failure_reason = f"{lane} provider execution failed: {exc}"
                    attempt = PromptExecutionAttempt(
                        prompt_id=prompt.prompt_id,
                        schema_version=prompt.schema_version,
                        model_lane=lane,
                        model_id=model_id,
                        input_hash=input_context_hash,
                        input_context_hash=input_context_hash,
                        status="provider_error",
                        output_schema_status="invalid",
                        output_payload={"status": "provider_error", "reason": str(exc)},
                        provider_name=self.provider.provider_name,
                        provider_response_id=None,
                    )
                    attempts.append(attempt)
                    self._record_attempt(
                        world_id,
                        turn_id,
                        lane,
                        prompt.prompt_id,
                        model_id,
                        graph_context_status,
                        False,
                        len(attempts) > 1,
                    )
                    if lane == "pro_lane" or not allow_pro_fallback:
                        return PromptExecutionOutcome(
                            attempts=attempts,
                            final_lane=attempts[-1].model_lane,
                            final_payload=None,
                            failure_reason=failure_reason,
                        )
                    continue

                raw_output = provider_response.raw_output
                try:
                    payload = response_model.model_validate(raw_output)
                except ValidationError as exc:
                    failure_reason = f"{lane} output failed schema validation"
                    attempt = PromptExecutionAttempt(
                        prompt_id=prompt.prompt_id,
                        schema_version=prompt.schema_version,
                        model_lane=lane,
                        model_id=model_id,
                        input_hash=input_context_hash,
                        input_context_hash=input_context_hash,
                        status="schema_invalid",
                        output_schema_status="invalid",
                        output_payload={
                            "status": "schema_invalid",
                            "reason": failure_reason,
                            "errors": exc.errors(),
                            "raw_output": raw_output,
                        },
                        provider_name=provider_response.provider_name,
                        provider_response_id=provider_response.provider_response_id,
                    )
                    attempts.append(attempt)
                    self._record_attempt(
                        world_id,
                        turn_id,
                        lane,
                        prompt.prompt_id,
                        model_id,
                        graph_context_status,
                        False,
                        len(attempts) > 1,
                    )
                    if lane == "pro_lane" or not allow_pro_fallback:
                        return PromptExecutionOutcome(
                            attempts=attempts,
                            final_lane=attempts[-1].model_lane,
                            final_payload=None,
                            failure_reason=failure_reason,
                        )
                    continue

                attempt = PromptExecutionAttempt(
                    prompt_id=prompt.prompt_id,
                    schema_version=prompt.schema_version,
                    model_lane=lane,
                    model_id=model_id,
                    input_hash=input_context_hash,
                    input_context_hash=input_context_hash,
                    status="resolved",
                    output_schema_status="valid",
                    output_payload={"status": "resolved", "raw_output": payload.model_dump()},
                    provider_name=provider_response.provider_name,
                    provider_response_id=provider_response.provider_response_id,
                )
                attempts.append(attempt)
                self._record_attempt(
                    world_id,
                    turn_id,
                    lane,
                    prompt.prompt_id,
                    model_id,
                    graph_context_status,
                    True,
                    len(attempts) > 1,
                )
                if force_pro_after_success and lane != "pro_lane" and lane_index < len(lanes) - 1:
                    continue
                return PromptExecutionOutcome(attempts=attempts, final_lane=lane, final_payload=payload)

        return PromptExecutionOutcome(
            attempts=attempts,
            final_lane=attempts[-1].model_lane if attempts else requested_lane,
            final_payload=None,
            failure_reason=failure_reason or "No LLM lane executed",
        )

    def _build_provider(self) -> BaseModelProvider:
        if self.settings.model_provider == "gemini_developer_api":
            return GeminiDeveloperAPIProvider(self.settings)
        return StubModelProvider()

    @property
    def provider(self) -> BaseModelProvider:
        if self._provider is None:
            self._provider = self._build_provider()
        return self._provider

    def _lane_sequence(self, requested_lane: str, allow_pro_fallback: bool) -> list[str]:
        if requested_lane == "pro_lane":
            return ["pro_lane"]
        if allow_pro_fallback:
            return [requested_lane, "pro_lane"]
        return [requested_lane]

    def _model_id_for_lane(self, lane: str, route: PromptRouteOverride | None) -> str:
        if route is not None and lane in route.model_ids:
            return route.model_ids[lane]
        if lane == "lite_lane":
            return self.settings.model_lite_id
        if lane == "pro_lane":
            return self.settings.model_pro_id
        return self.settings.model_main_id

    def _temperature_for_lane(self, lane: str) -> float:
        if lane == "lite_lane":
            return self.settings.gemini_temperature_lite
        if lane == "pro_lane":
            return self.settings.gemini_temperature_pro
        return self.settings.gemini_temperature_main

    @staticmethod
    def _input_context_hash(prompt: PromptDefinition, input_payload: dict[str, Any]) -> str:
        payload = json.dumps(
            {
                "prompt_id": prompt.prompt_id,
                "instructions": prompt.instructions,
                "input": input_payload,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def _record_attempt(
        self,
        world_id: str,
        turn_id: str | None,
        lane: str,
        prompt_id: str,
        model_id: str,
        graph_context_status: str,
        schema_valid: bool,
        used_fallback: bool,
    ) -> None:
        if self.observability_service is None:
            return
        self.observability_service.record_llm_attempt(
            world_id=world_id,
            turn_id=turn_id,
            prompt_id=prompt_id,
            model_id=model_id,
            lane=lane,
            graph_context_status=graph_context_status,
            schema_valid=schema_valid,
            used_fallback=used_fallback,
        )


@contextmanager
def _null_span():
    yield None
