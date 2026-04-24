from __future__ import annotations

import hashlib
import json
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.core.prompts import PromptDefinition, PromptRegistry
from app.models.entities import World
from app.modules.observability.service import ObservabilityService
from app.modules.world_pack.service import PackRegistry, world_pack_metadata
from app.modules.world_state.branch import BranchSignal, normalize_branch_signals
from app.modules.world_state.consequence import ConsequenceTag, OutcomeBand, normalize_consequence_tags
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
    langfuse_trace_id: str | None = None
    langfuse_observation_id: str | None = None
    langfuse_trace_url: str | None = None
    langfuse_status: str = "disabled"


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


class NarrativeChoiceDraft(BaseModel):
    posture: Literal["safe", "progress", "explore"]
    label: str = Field(min_length=1)
    intent_summary: str = Field(min_length=1)
    action_kind: Literal["narrative", "use_reward_item", "travel"] = "narrative"
    travel_target_key: str | None = None


class CouncilIntentInterpreterPayload(BaseModel):
    input_mode: Literal["choice", "free_text"]
    canonical_action_kind: Literal["narrative", "use_reward_item", "travel"]
    intent_summary: str = Field(min_length=1)
    travel_target_key: str | None = None
    requested_choice_posture: Literal["safe", "progress", "explore", "none"] = "none"
    fail_forward: bool = False
    consequence_flags: list[str] = Field(default_factory=list)
    consequence_tags: list[ConsequenceTag] = Field(default_factory=list)
    consequence_summary: str = Field(min_length=1)


class TurnResolutionPayload(BaseModel):
    narrative: str = Field(min_length=1)
    npc_reaction: str = Field(min_length=1)
    event_type: str = Field(min_length=1)
    event_payload: dict[str, Any]
    memories: list[MemoryDraft] = Field(min_length=1)
    world_tags: list[WorldTag] = Field(min_length=1)
    interpreted_intent: dict[str, Any] = Field(default_factory=dict)
    next_choices: list[NarrativeChoiceDraft] = Field(min_length=3)
    consequence_summary: str = Field(min_length=1)
    consequence_tags: list[ConsequenceTag] = Field(default_factory=list)
    branch_signals: list[BranchSignal] = Field(default_factory=list)
    outcome_band: OutcomeBand = "steady"
    scene_tone: str = Field(min_length=1)
    scene_move: Literal["hold", "deepen", "pivot", "close"] = "hold"
    scene_pressure: Literal["low", "medium", "high"] = "medium"


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
        if prompt_id in {
            "council.rules_arbiter",
            "council.safety_guard",
            "council.narrative",
            "ambient.safety_guard",
        } and lane == "main_lane":
            if "__force_invalid_main__" in str(input_payload.get("input_text", "")):
                return {"status": "invalid"}

        if prompt_id == "council.memory_manager":
            return self._memory_manager_output(input_payload)
        if prompt_id == "council.intent_interpreter":
            return self._intent_interpreter_output(input_payload)
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
        if prompt_id == "ambient.memory_manager":
            return self._ambient_memory_manager_output(input_payload)
        if prompt_id == "ambient.npc_manager":
            return self._ambient_npc_manager_output(input_payload)
        if prompt_id == "ambient.safety_guard":
            return self._ambient_safety_guard_output(input_payload)
        if prompt_id == "idle.memory_manager":
            return self._ambient_memory_manager_output(input_payload)
        if prompt_id == "idle.npc_manager":
            return self._idle_npc_manager_output(input_payload)
        if prompt_id == "idle.safety_guard":
            return self._ambient_safety_guard_output(input_payload)
        raise KeyError(f"Unsupported stub prompt: {prompt_id}")

    def _intent_interpreter_output(self, input_payload: dict[str, Any]) -> dict[str, Any]:
        input_mode = str(input_payload.get("input_mode") or "choice")
        selected_choice = input_payload.get("selected_choice") or {}
        if not isinstance(selected_choice, dict):
            selected_choice = {}
        input_text = str(input_payload.get("input_text") or "")
        selected_posture = str(selected_choice.get("posture") or "none")
        action_kind = str(selected_choice.get("action_kind") or "narrative")
        travel_target_key = str(selected_choice.get("travel_target_key") or "").strip() or None
        intent_summary = str(selected_choice.get("intent_summary") or selected_choice.get("canonical_input_text") or input_text)
        fail_forward = False
        consequence_flags: list[str] = []
        consequence_tags: list[str] = []
        consequence_summary = "The world accepts the player's chosen line of action."
        nearby_routes = [item for item in input_payload.get("nearby_routes") or [] if isinstance(item, dict)]
        world_pack = input_payload.get("world_pack") or {}
        reward_effect_kind = str(world_pack.get("reward_effect_kind") or "").strip()

        def reward_item_names(raw_items: Any) -> list[str]:
            names: list[str] = []
            for item in raw_items or []:
                if not isinstance(item, dict):
                    continue
                effect_kind = str(item.get("effect_kind") or "").strip()
                if reward_effect_kind and effect_kind and effect_kind != reward_effect_kind:
                    continue
                if reward_effect_kind and not effect_kind:
                    continue
                name = str(item.get("name") or "").strip()
                if name:
                    names.append(name)
            return names

        usable_items = reward_item_names(input_payload.get("usable_reward_items"))
        used_reward_items = reward_item_names(input_payload.get("used_reward_items"))

        def route_targets() -> list[tuple[str, str]]:
            targets: list[tuple[str, str]] = []
            for route in nearby_routes:
                destination_key = str(
                    route.get("destination_key") or ((route.get("to_location") or {}).get("key") or "")
                ).strip()
                destination_name = str(
                    route.get("destination_name") or ((route.get("to_location") or {}).get("name") or "")
                ).strip()
                if destination_key:
                    targets.append((destination_key, destination_name))
            return targets

        available_targets = route_targets()

        def mentioned_target(text: str) -> str | None:
            for destination_key, destination_name in available_targets:
                key_token = destination_key.lower()
                name_token = destination_name.lower()
                if (key_token and key_token in text) or (name_token and name_token in text):
                    return destination_key
            return None

        reward_tokens = [name.lower() for name in [*usable_items, *used_reward_items] if name]
        mentions_reward_item = any(token in input_text.lower() for token in reward_tokens)

        normalized = input_text.lower()
        if input_mode == "choice":
            if action_kind == "travel" and travel_target_key:
                consequence_tags.append("careful_observation")
                consequence_summary = "The player follows a route the current scene actually affords."
            if selected_posture == "progress":
                consequence_tags.append("earned_trust")
            elif selected_posture in {"safe", "explore"}:
                consequence_tags.append("careful_observation")
        if input_mode == "free_text":
            travel_verbs = ("向か", "行く", "進む", "移動", "赴", "go to", "head to", "walk to", "toward", "towards")
            route_target_key = mentioned_target(normalized) if any(token in normalized for token in travel_verbs) else None
            if mentions_reward_item:
                if usable_items:
                    action_kind = "use_reward_item"
                    reward_name = usable_items[0]
                    intent_summary = intent_summary or f"{reward_name}を掲げて次の道を開く"
                    consequence_tags.extend(["reward_item_respect", "kept_promise"])
                    consequence_summary = "The world recognizes the reward item and prepares to answer the request."
                elif used_reward_items:
                    action_kind = "narrative"
                    intent_summary = input_text or "The player follows the route opened by the reward item."
                    consequence_tags.append("careful_observation")
                    consequence_summary = "The scene proceeds through the route the reward item already opened."
                else:
                    action_kind = "narrative"
                    fail_forward = True
                    consequence_flags = ["premature_reward_item_request"]
                    consequence_tags.extend(["overreach", "public_attention"])
                    intent_summary = input_text or "The player reaches for power that is not yet available."
                    consequence_summary = "The attempt runs ahead of the world's current affordances and turns into a visible hesitation."
            elif any(token in normalized for token in ("後で", "あとで", "later", "そのうち", "待って", "今は行かない", "また今度")):
                consequence_tags.append("missed_timing")
                consequence_summary = "The scene moves on, but a promise is left hanging in the current district."
            elif any(token in normalized for token in ("無理", "impossible", "空を飛", "teleport", "爆破")):
                action_kind = "narrative"
                fail_forward = True
                consequence_flags = ["overreach"]
                consequence_tags.extend(["overreach", "public_attention"])
                consequence_summary = "The world bends the request into a costly misunderstanding rather than allowing an impossible leap."
            elif route_target_key:
                action_kind = "travel"
                travel_target_key = route_target_key
                consequence_tags.append("careful_observation")
                consequence_summary = "The player tries to follow a route the current scene actually affords."
            elif any(token in normalized for token in ("約束", "promise", "引き受ける", "応える")):
                consequence_tags.append("kept_promise")
            elif any(token in normalized for token in ("探", "確か", "観察", "様子", "observe")):
                consequence_tags.append("careful_observation")
            elif any(token in normalized for token in ("助け", "help", "灯", "light")):
                consequence_tags.append("earned_trust")

        if input_mode == "choice" and action_kind == "use_reward_item":
            consequence_tags.extend(["reward_item_respect", "kept_promise"])
            consequence_summary = "The selected choice invokes an important reward-item affordance."

        if not intent_summary:
            intent_summary = input_text or str(selected_choice.get("label") or "The player presses forward.")

        return {
            "input_mode": input_mode if input_mode in {"choice", "free_text"} else "choice",
            "canonical_action_kind": action_kind if action_kind in {"narrative", "use_reward_item", "travel"} else "narrative",
            "intent_summary": intent_summary,
            "travel_target_key": travel_target_key,
            "requested_choice_posture": selected_posture if selected_posture in {"safe", "progress", "explore"} else "none",
            "fail_forward": fail_forward,
            "consequence_flags": consequence_flags,
            "consequence_tags": normalize_consequence_tags(consequence_tags),
            "consequence_summary": consequence_summary,
        }

    def _memory_manager_output(self, input_payload: dict[str, Any]) -> dict[str, Any]:
        memories = [str(item) for item in input_payload.get("relevant_memories") or []]
        relations = [str(item) for item in input_payload.get("relation_context") or []]
        quests = [item.get("title", "") for item in input_payload.get("quests") or [] if item.get("title")]
        factions = [item.get("name", "") for item in input_payload.get("factions") or [] if item.get("name")]
        inventory = [item.get("name", "") for item in input_payload.get("inventory") or [] if item.get("name")]
        active_quest_stage = str(input_payload.get("active_quest_stage") or "none")
        usable_items = [item.get("name", "") for item in input_payload.get("usable_reward_items") or [] if item.get("name")]
        used_items = [item.get("name", "") for item in input_payload.get("used_reward_items") or [] if item.get("name")]
        consequence_flags = [str(item) for item in input_payload.get("consequence_flags") or [] if str(item)]
        important_affordances = [str(item) for item in input_payload.get("important_inventory_affordances") or [] if str(item)]
        relationship_summaries = [item.get("summary", "") for item in input_payload.get("relationship_summaries") or [] if item.get("summary")]
        consequence_threads = [item.get("summary", "") for item in input_payload.get("active_consequence_threads") or [] if item.get("summary")]
        recent_history = [str(item) for item in input_payload.get("recent_consequence_history") or [] if str(item)]
        current_scene = input_payload.get("current_scene") or {}
        current_chapter = input_payload.get("current_chapter") or {}
        recent_scene_history = [str(item) for item in input_payload.get("recent_scene_history") or [] if str(item)]
        current_location = input_payload.get("current_location") or {}
        nearby_routes = [item for item in input_payload.get("nearby_routes") or [] if isinstance(item, dict)]
        local_figures = [item for item in input_payload.get("local_figures") or [] if isinstance(item, dict)]
        recent_travel_history = [str(item) for item in input_payload.get("recent_travel_history") or [] if str(item)]
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
        if important_affordances:
            summary_parts.append(f"affordances={', '.join(important_affordances[:2])}")
        if relationship_summaries:
            summary_parts.append(f"relationships={relationship_summaries[0]}")
        if consequence_threads:
            summary_parts.append(f"threads={consequence_threads[0]}")
        if recent_history:
            summary_parts.append(f"recent_consequence={recent_history[0]}")
        if current_scene:
            summary_parts.append(f"scene={str(current_scene.get('summary') or '')}")
        if current_chapter:
            summary_parts.append(f"chapter={str(current_chapter.get('summary') or '')}")
        if current_location:
            summary_parts.append(f"location={str(current_location.get('name') or '')}")
        if nearby_routes:
            summary_parts.append(f"route={str((nearby_routes[0].get('summary') or ''))}")
        if local_figures:
            summary_parts.append(f"local_figure={str((local_figures[0].get('summary') or ''))}")
        if recent_travel_history:
            summary_parts.append(f"travel_echo={recent_travel_history[0]}")
        if recent_scene_history:
            summary_parts.append(f"scene_echo={recent_scene_history[0]}")
        if consequence_flags:
            summary_parts.append(f"consequence_flags={', '.join(consequence_flags[:2])}")
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
        consequence_summary = str(input_payload.get("consequence_summary") or "")
        thread_summary = next(
            (str(item.get("summary") or "") for item in input_payload.get("active_consequence_threads") or [] if item.get("summary")),
            "",
        )
        current_scene_summary = str(((input_payload.get("current_scene") or {}) if isinstance(input_payload.get("current_scene"), dict) else {}).get("summary") or "")
        current_chapter_summary = str(((input_payload.get("current_chapter") or {}) if isinstance(input_payload.get("current_chapter"), dict) else {}).get("summary") or "")
        return {
            "npc_intent": f"{npc_name} keeps same-world continuity and responds to the latest player action.",
            "reaction_style": "measured",
            "focus_memories": focus_memories[:2],
            "reaction_outline": (
                f"{npc_name} references {memory_summary}, keeps quest stage {active_quest_stage}, "
                f"the current scene {current_scene_summary}, and chapter pressure {current_chapter_summary}. "
                f"{consequence_summary} {thread_summary}".strip()
            ),
        }

    def _world_progress_output(self, input_payload: dict[str, Any]) -> dict[str, Any]:
        player_name = str(input_payload.get("player_name") or "Player")
        npc_name = str(input_payload.get("npc_name") or "NPC")
        input_text = str(input_payload.get("input_text") or "")
        interpreted_intent = str(input_payload.get("intent_summary") or input_text)
        relation_summary = str(input_payload.get("relation_summary") or "")
        consequence_tags = normalize_consequence_tags([str(item) for item in input_payload.get("consequence_tags") or []])
        world_tags = normalize_world_tags(infer_world_tags(interpreted_intent))
        active_quest_stage = str(input_payload.get("active_quest_stage") or "none")
        current_scene = input_payload.get("current_scene") or {}
        current_chapter = input_payload.get("current_chapter") or {}
        world_pack = input_payload.get("world_pack") or {}
        followup_stage_key = str(world_pack.get("followup_stage_key") or "")
        followup_chapter_key = str(world_pack.get("followup_chapter_key") or followup_stage_key)
        current_chapter_key = str(current_chapter.get("key") or "")
        if "__force_council_reject__" in input_text:
            world_tags = ["threaten_local"]
        if bool(input_payload.get("fail_forward")):
            world_tags = ["none"]
        risk_level = "high" if any(tag in {"threaten_local", "collect_reward"} for tag in world_tags) else "medium"
        if world_tags == ["none"]:
            risk_level = "low"
        npc_anchor = str(input_payload.get("reaction_outline") or f"{npc_name} responds to the new event.")
        default_choice_templates = input_payload.get("default_choice_templates") or []
        if not isinstance(default_choice_templates, list):
            default_choice_templates = []
        next_choices: list[dict[str, Any]] = []
        for template in default_choice_templates[:3]:
            if not isinstance(template, dict):
                continue
            posture = str(template.get("posture") or "progress")
            label = str(template.get("label") or template.get("canonical_input_text") or "Continue through the scene.")
            action_kind = str(template.get("action_kind") or "narrative")
            next_choices.append(
                {
                    "posture": posture if posture in {"safe", "progress", "explore"} else "progress",
                    "label": label,
                    "intent_summary": str(template.get("canonical_input_text") or label),
                    "action_kind": action_kind if action_kind in {"narrative", "use_reward_item", "travel"} else "narrative",
                    "travel_target_key": str(template.get("travel_target_key") or "").strip() or None,
                }
            )
        if len(next_choices) < 3:
            next_choices = [
                {
                    "posture": "safe",
                    "label": "一歩退いて場の気配を見守る",
                    "intent_summary": "場の気配を見守り、流れを乱さず状況を確かめる",
                    "action_kind": "narrative",
                    "travel_target_key": None,
                },
                {
                    "posture": "progress",
                    "label": "困っている相手へ手を差し伸べ、次の進展を作る",
                    "intent_summary": "困っている相手へ手を差し伸べ、次の進展を作る",
                    "action_kind": "narrative",
                    "travel_target_key": None,
                },
                {
                    "posture": "explore",
                    "label": "周囲の噂や視線を探り、関係の糸口を拾う",
                    "intent_summary": "周囲の噂や視線を探り、関係の糸口を拾う",
                    "action_kind": "narrative",
                    "travel_target_key": None,
                },
            ]
        outcome_band: OutcomeBand = "steady"
        if "overreach" in consequence_tags:
            outcome_band = "setback"
        elif {"missed_timing", "public_attention"} & set(consequence_tags):
            outcome_band = "tangled"
        scene_move: Literal["hold", "deepen", "pivot", "close"] = "hold"
        scene_pressure: Literal["low", "medium", "high"] = "medium"
        if "reward_item_respect" in consequence_tags:
            scene_move = "pivot"
            scene_pressure = "medium"
        elif outcome_band == "setback":
            scene_move = "deepen"
            scene_pressure = "high"
        elif outcome_band == "tangled":
            scene_move = "deepen"
            scene_pressure = "medium"
        elif followup_stage_key and active_quest_stage == followup_stage_key:
            scene_move = "deepen" if "investigate" in world_tags else "hold"
            scene_pressure = "medium"
        elif followup_chapter_key and current_chapter_key == followup_chapter_key:
            scene_move = "hold"
            scene_pressure = "medium"
        branch_signals = normalize_branch_signals([str(item) for item in input_payload.get("branch_signals") or []])
        lower_text = f"{interpreted_intent} {input_text}".lower()
        followup_branches = dict(world_pack.get("followup_branches") or {})

        def _branch_tokens(slot: str) -> set[str]:
            entry = followup_branches.get(slot)
            if not isinstance(entry, dict):
                return set()
            raw_values = [
                str(entry.get("label") or ""),
                str(entry.get("branch_key") or ""),
                str(entry.get("summary") or ""),
                str(entry.get("committed_summary") or ""),
                str(entry.get("player_hint") or ""),
                *[str(item) for item in entry.get("anchor_npcs") or []],
            ]
            tokens: set[str] = set()
            for value in raw_values:
                lowered = value.strip().lower()
                if not lowered:
                    continue
                normalized = lowered.replace("-", " ").replace("_", " ")
                tokens.add(lowered)
                tokens.add(normalized)
            return tokens

        formal_tokens = _branch_tokens("formal_path")
        undercurrent_tokens = _branch_tokens("undercurrent_path")
        if (followup_stage_key and active_quest_stage == followup_stage_key) or (
            followup_chapter_key and current_chapter_key == followup_chapter_key
        ):
            if any(token in lower_text for token in formal_tokens):
                branch_signals = normalize_branch_signals([*branch_signals, "formal_trust", "kept_formal_promise"])
            if any(token in lower_text for token in undercurrent_tokens):
                branch_signals = normalize_branch_signals([*branch_signals, "rumor_curiosity", "street_pull"])
        return {
            "event_type": "player.turn.resolved",
            "event_payload": {
                "action": interpreted_intent,
                "world_tags": world_tags,
                "npc_anchor": npc_anchor,
                "relation_summary": relation_summary,
                "scene_summary": str(current_scene.get("summary") or ""),
                "chapter_summary": str(current_chapter.get("summary") or ""),
            },
            "memories": [
                {
                    "scope": "world",
                    "text": f"{player_name}は{interpreted_intent}。{npc_anchor}",
                    "salience": 0.92,
                },
                {
                    "scope": "actor",
                    "text": f"{npc_name} remembers: {player_name}は{interpreted_intent}。",
                    "salience": 0.88,
                },
            ],
            "world_tags": world_tags,
            "consequence_tags": consequence_tags,
            "branch_signals": branch_signals,
            "outcome_band": outcome_band,
            "resolution_summary": (
                str(input_payload.get("consequence_summary") or "").strip()
                or f"{player_name} acted with tags {', '.join(world_tags)}."
            ),
            "risk_level": risk_level,
            "next_choices": next_choices,
            "scene_move": scene_move,
            "scene_pressure": scene_pressure,
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
        consequence_summary = str(input_payload.get("consequence_summary") or "")
        outcome_band = str(input_payload.get("outcome_band") or "steady")
        current_scene_summary = str(input_payload.get("current_scene_summary") or "")
        current_chapter_summary = str(input_payload.get("current_chapter_summary") or "")
        narrative = (
            f"{player_name}は『{input_text}』と行動した。"
            f"{npc_name}はその結果を同じ世界の事実として受け止めた。"
        )
        if world_tags != ["none"]:
            narrative = f"{narrative} world_tags={', '.join(world_tags)} が確定した。"
        if current_scene_summary:
            narrative = f"{narrative} Scene: {current_scene_summary}".strip()
        if consequence_summary:
            narrative = f"{narrative} {consequence_summary}".strip()
        npc_reaction = f"{npc_name}は{reaction_outline}"
        if memory_summary:
            npc_reaction = f"{npc_reaction.rstrip('。')} 記憶要約「{memory_summary}」も踏まえた。"
        if current_chapter_summary:
            npc_reaction = f"{npc_reaction.rstrip('。')} 章の流れとしては「{current_chapter_summary}」を意識している。"
        return {
            "narrative": narrative,
            "npc_reaction": npc_reaction,
            "tone": "tense" if outcome_band == "setback" else "uneasy" if outcome_band == "tangled" else "measured",
        }

    def _ambient_memory_manager_output(self, input_payload: dict[str, Any]) -> dict[str, Any]:
        npc_name = str(input_payload.get("npc_name") or "An onlooker")
        routine_state = input_payload.get("routine_state") or {}
        rumor_focus = str(routine_state.get("rumor_focus") or "the current place")
        relevant_memories = [str(item) for item in input_payload.get("relevant_memories") or [] if str(item)]
        current_scene = input_payload.get("current_scene") or {}
        current_location = input_payload.get("current_location") or input_payload.get("location") or {}
        current_location_name = str(current_location.get("name") or "the current place")
        recent_world_beats = [str(item) for item in input_payload.get("recent_world_beats") or [] if str(item)]
        summary_parts = [f"{npc_name} keeps {current_location_name} in mind through {rumor_focus}."]
        if relevant_memories:
            summary_parts.append(f"Recent memory: {relevant_memories[0]}")
        if recent_world_beats:
            summary_parts.append(f"Latest world beat: {recent_world_beats[0]}")
        return {
            "memory_summary": " ".join(summary_parts).strip(),
            "focus_memories": relevant_memories[:2],
            "scene_summary": str(current_scene.get("summary") or f"{current_location_name} listens to itself."),
            "rumor_focus": rumor_focus,
        }

    def _ambient_npc_manager_output(self, input_payload: dict[str, Any]) -> dict[str, Any]:
        npc_name = str(input_payload.get("npc_name") or "An onlooker")
        routine_state = input_payload.get("routine_state") or {}
        thread_types = {
            str(item.get("thread_type") or "")
            for item in (input_payload.get("active_consequence_threads") or [])
            if isinstance(item, dict)
        }
        recent_world_beats = [str(item) for item in input_payload.get("recent_world_beats") or [] if str(item)]
        role = str(routine_state.get("routine_role") or "watcher")
        rumor_focus = str(input_payload.get("rumor_focus") or routine_state.get("rumor_focus") or "the current place")
        current_location = input_payload.get("current_location") or input_payload.get("location") or {}
        current_location_name = str(current_location.get("name") or "the current place")

        if "promise" in thread_types:
            beat_kind = "murmur"
            summary = f"{npc_name} lets a rumor move through {current_location_name} about {rumor_focus}, as if a promise were still hanging there."
            tension_band = "medium"
        elif "scrutiny" in thread_types:
            beat_kind = "question"
            summary = f"{npc_name} turns a sharper question over {current_location_name}, making its scrutiny more visible."
            tension_band = "high"
        elif role in {"lamplighter", "beacon_keeper"}:
            beat_kind = "reassure"
            summary = f"{npc_name} trims the light around {current_location_name} and eases the scene without making a show of it."
            tension_band = "low"
        elif role in {"courier", "runner"} and recent_world_beats:
            beat_kind = "murmur"
            summary = f"{npc_name} carries the latest local murmur a little further, letting it circulate under the open sky."
            tension_band = "medium"
        else:
            beat_kind = "observe"
            summary = f"{npc_name} watches {current_location_name} as the {role}, measuring what the last turn left behind."
            tension_band = str(routine_state.get("tension_band") or "medium")
        return {
            "beat_kind": beat_kind,
            "summary": summary,
            "tension_band": tension_band,
        }

    def _ambient_safety_guard_output(self, input_payload: dict[str, Any]) -> dict[str, Any]:
        summary = str(input_payload.get("summary") or "")
        violations: list[str] = []
        if "__force_safety_reject__" in summary:
            violations.append("forced ambient safety rejection")
        approval_status = "approved" if not violations else "rejected"
        return {
            "approval_status": approval_status,
            "reason": "ambient beat stays inside same-world local constraints" if approval_status == "approved" else "; ".join(violations),
            "violations": violations,
        }

    def _idle_npc_manager_output(self, input_payload: dict[str, Any]) -> dict[str, Any]:
        npc_name = str(input_payload.get("npc_name") or "An offstage figure")
        routine_state = input_payload.get("routine_state") or {}
        role = str(routine_state.get("routine_role") or "watcher")
        thread_types = {
            str(item.get("thread_type") or "")
            for item in (input_payload.get("active_consequence_threads") or [])
            if isinstance(item, dict)
        }
        nearby_routes = [item for item in input_payload.get("nearby_routes") or [] if isinstance(item, dict)]
        route_keys = [str(item.get("route_key") or "") for item in nearby_routes if str(item.get("status") or "") == "open"]

        if "scrutiny" in thread_types:
            return {
                "beat_kind": "question",
                "summary": f"{npc_name} keeps a sharper offstage question alive, making the district feel watched even in the player's absence.",
                "tension_band": "high",
                "target_route_key": None,
            }
        if "promise" in thread_types:
            return {
                "beat_kind": "murmur",
                "summary": f"{npc_name} lets a rumor drift between districts about a promise that still has not settled.",
                "tension_band": "medium",
                "target_route_key": None,
            }
        if role in {"courier", "runner"} and route_keys:
            return {
                "beat_kind": "relocate",
                "summary": f"{npc_name} keeps moving with the district's latest whisper, carrying it onward to the next stop.",
                "tension_band": "medium",
                "target_route_key": route_keys[0],
            }
        if role in {"lamplighter", "beacon_keeper"} and route_keys:
            return {
                "beat_kind": "reassure",
                "summary": f"{npc_name} keeps the district calmer from just out of sight, softening the line of rumor without erasing it.",
                "tension_band": "low",
                "target_route_key": None,
            }
        return {
            "beat_kind": "observe",
            "summary": f"{npc_name} keeps a quiet offstage watch and leaves the district to settle around that attention.",
            "tension_band": str(routine_state.get("tension_band") or "medium"),
            "target_route_key": None,
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
        pack_registry: PackRegistry | None = None,
        session_factory: sessionmaker[Session] | None = None,
        route_overrides: dict[str, PromptRouteOverride] | None = None,
        config_name: str = "settings",
        observability_service: ObservabilityService | None = None,
    ) -> None:
        self.settings = settings
        self.prompt_registry = prompt_registry
        self.pack_registry = pack_registry
        self.session_factory = session_factory
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
        prompt = self._resolve_prompt_for_world(resolved_prompt_id, world_id)
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
                langfuse_context = (
                    self.observability_service.langfuse_observation(
                        name=prompt.prompt_id,
                        as_type="generation",
                        input_payload=input_payload,
                        metadata={
                            "world_id": world_id,
                            "turn_id": turn_id,
                            "prompt_id": prompt.prompt_id,
                            "model_id": model_id,
                            "lane": lane,
                            "graph_context_status": graph_context_status,
                            "runtime_role": self.settings.app_runtime_role,
                            "config_name": self.config_name,
                        },
                        model=model_id,
                        model_parameters={"lane": lane, "config_name": self.config_name},
                    )
                    if self.observability_service is not None
                    else _null_trace_link()
                )
                with langfuse_context as langfuse_link:
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
                        _update_langfuse_observation(
                            langfuse_link,
                            output={"status": "provider_error", "reason": str(exc)},
                            metadata={"status": "provider_error", "failure_reason": failure_reason},
                        )
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
                            langfuse_trace_id=langfuse_link.trace_id,
                            langfuse_observation_id=langfuse_link.observation_id,
                            langfuse_trace_url=langfuse_link.trace_url,
                            langfuse_status=langfuse_link.status,
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
                        _update_langfuse_observation(
                            langfuse_link,
                            output={
                                "status": "schema_invalid",
                                "reason": failure_reason,
                                "raw_output": raw_output,
                            },
                            metadata={
                                "status": "schema_invalid",
                                "failure_reason": failure_reason,
                                "provider_response_id": provider_response.provider_response_id,
                            },
                        )
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
                            langfuse_trace_id=langfuse_link.trace_id,
                            langfuse_observation_id=langfuse_link.observation_id,
                            langfuse_trace_url=langfuse_link.trace_url,
                            langfuse_status=langfuse_link.status,
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

                    _update_langfuse_observation(
                        langfuse_link,
                        output={"status": "resolved", "raw_output": payload.model_dump()},
                        metadata={
                            "status": "resolved",
                            "provider_response_id": provider_response.provider_response_id,
                        },
                    )
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
                        langfuse_trace_id=langfuse_link.trace_id,
                        langfuse_observation_id=langfuse_link.observation_id,
                        langfuse_trace_url=langfuse_link.trace_url,
                        langfuse_status=langfuse_link.status,
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

    def _resolve_prompt_for_world(self, prompt_id: str, world_id: str) -> PromptDefinition:
        prompt = self.prompt_registry.get(prompt_id)
        if self.pack_registry is None or self.session_factory is None:
            return prompt
        try:
            with self.session_factory() as db:
                world = db.execute(select(World).where(World.id == world_id)).scalar_one_or_none()
        except Exception:
            return prompt
        if world is None:
            return prompt
        metadata = world_pack_metadata(world)
        try:
            overlay = self.pack_registry.resolve_prompt_overlay(
                pack_id=metadata["pack_id"],
                template_id=metadata["world_template_id"],
                prompt_id=prompt_id,
            )
        except Exception:
            return prompt
        return self.prompt_registry.compose(prompt, overlay_instructions=overlay)

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
        pack_id: str | None = None
        world_template_id: str | None = None
        if self.session_factory is not None:
            try:
                with self.session_factory() as db:
                    world = db.execute(select(World).where(World.id == world_id)).scalar_one_or_none()
                    if world is not None:
                        metadata = world_pack_metadata(world)
                        pack_id = metadata["pack_id"]
                        world_template_id = metadata["world_template_id"]
            except Exception:
                pack_id = None
                world_template_id = None
        self.observability_service.record_llm_attempt(
            world_id=world_id,
            pack_id=pack_id,
            world_template_id=world_template_id,
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


@contextmanager
def _null_trace_link():
    yield type("NullTraceLink", (), {"trace_id": None, "observation_id": None, "trace_url": None, "status": "disabled", "observation": None})()


def _update_langfuse_observation(link: Any, *, output: Any | None = None, metadata: dict[str, Any] | None = None) -> None:
    observation = getattr(link, "observation", None)
    if observation is None:
        return
    try:
        observation.update(output=output, metadata=metadata)
    except Exception:
        if hasattr(link, "status"):
            link.status = "degraded"
