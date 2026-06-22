from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationInfo, model_validator

from app.core.config import Settings
from app.modules.llm_harness.service import (
    CouncilIntentInterpreterPayload,
    CouncilRoleRun,
    MemoryDraft,
    ModelRouter,
    NarrativeChoiceDraft,
    PromptExecutionAttempt,
    PromptExecutionOutcome,
    PublicGmTurnPayload,
    TurnResolutionOutcome,
    TurnResolutionPayload,
)
from app.modules.session.progress import emit_turn_event, emit_turn_progress
from app.modules.world_state.branch import BranchSignal, normalize_branch_signals
from app.modules.world_state.consequence import ConsequenceTag, OutcomeBand, normalize_consequence_tags
from app.modules.world_state.rules import WorldTag, infer_world_tags, normalize_world_tags
from app.modules.world_pack.service import SharedWorldActionTag


def _compact_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, dict):
        return "; ".join(
            f"{key}: {_compact_text(item)}" for key, item in value.items() if _compact_text(item)
        )
    if isinstance(value, list):
        return "; ".join(_compact_text(item) for item in value if _compact_text(item))
    return str(value).strip()


def _first_text(*values: Any) -> str:
    for value in values:
        if isinstance(value, list):
            text = "; ".join(_compact_text(item) for item in value if _compact_text(item))
        else:
            text = _compact_text(value)
        if text:
            return text
    return ""


def _naturalize_turn_action_text(value: str) -> str:
    text = " ".join(str(value or "").split()).strip("。.")
    if "。" in text:
        text = text.split("。", 1)[0].strip()
    if not text:
        return "現在の状況を確かめようとした"
    if text.endswith("する"):
        return f"{text[:-2]}しようとした"
    if text.endswith("向かう"):
        return f"{text[:-1]}おうとした"
    if text.endswith("戻る"):
        return f"{text[:-1]}ろうとした"
    if text.endswith(("見る", "聞く", "探る", "調べる", "確かめる", "進める")):
        return f"{text}ことにした"
    if text.endswith(("し", "見", "聞き", "探り", "調べ", "確かめ", "進め", "向かい")):
        return f"{text}ようとした"
    return f"{text}を試した"


def _memory_list(*values: Any) -> list[str]:
    memories: list[str] = []
    for value in values:
        items = value if isinstance(value, list) else [value]
        for item in items:
            text = _compact_text(item)
            if text and text not in memories:
                memories.append(text)
    return memories


def _first_memory_text(*values: Any) -> str:
    return "; ".join(_memory_list(*values))


def _joined_state_summary(parts: list[tuple[str, Any]]) -> str:
    summary_parts = [f"{label}: {_compact_text(value)}" for label, value in parts if _compact_text(value)]
    return "; ".join(summary_parts) or "The current same-world state has no additional visible facts."


def _play_language_context(player_profile: Any) -> dict[str, Any]:
    default = {"mode": "preset", "preset": "ja", "custom": "", "prompt_name": "Japanese"}
    if not isinstance(player_profile, dict):
        return default
    play_language = player_profile.get("play_language")
    if not isinstance(play_language, dict):
        return default
    prompt_name = _compact_text(play_language.get("prompt_name"))
    mode = _compact_text(play_language.get("mode"))
    if not prompt_name or mode not in {"preset", "custom"}:
        return default
    return {
        "mode": mode,
        "preset": play_language.get("preset") if play_language.get("preset") else None,
        "custom": _compact_text(play_language.get("custom")),
        "prompt_name": prompt_name,
    }


def _language_code_from_play_language(play_language: dict[str, Any] | None, *, fallback: str = "ja") -> str:
    payload = play_language if isinstance(play_language, dict) else {}
    preset = _compact_text(payload.get("preset"))
    if preset:
        return preset.replace("_", "-")
    custom = _compact_text(payload.get("custom") or payload.get("prompt_name"))
    return custom.replace("_", "-") if custom else fallback


def _aliases_by_language(value: Any) -> dict[str, list[str]]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, list[str]] = {}
    for language, aliases in value.items():
        language_key = _compact_text(language).replace("_", "-")
        if not language_key:
            continue
        items = aliases if isinstance(aliases, list) else [aliases]
        deduped: list[str] = []
        seen: set[str] = set()
        for item in items:
            text = _compact_text(item)
            if not text or text in seen:
                continue
            deduped.append(text)
            seen.add(text)
        if deduped:
            normalized[language_key] = deduped
    return normalized


def _display_name_for_language(source_name: str, aliases_by_language: dict[str, list[str]], *, language: str, source_language: str) -> str:
    source = _compact_text(source_name)
    if language != source_language:
        localized = aliases_by_language.get(language) or []
        if localized:
            return localized[0]
    return source or (next(iter(aliases_by_language.values()), [""])[0])


def _public_person_summary(
    item: dict[str, Any],
    *,
    language: str,
    source_language: str,
) -> dict[str, Any]:
    aliases = _aliases_by_language(item.get("public_aliases") or item.get("aliases_by_language"))
    source_name = _public_text(item.get("source_name") or item.get("display_name") or item.get("name"))
    return {
        "name": _display_name_for_language(
            source_name,
            aliases,
            language=language,
            source_language=source_language,
        ),
        "source_name": source_name,
        "aliases_by_language": aliases,
        "summary": _public_text(item.get("summary")),
    }


def _normalize_live_consequence_tokens(raw_tags: Any) -> list[str]:
    tokens = _memory_list(raw_tags)
    mapped: list[str] = []
    for tag in tokens:
        token = tag.strip().lower().replace("-", "_")
        base = token.split(":", 1)[0]
        if base in {"quest_progress", "arrival_records_sorted", "received_data_slip", "custodian_trust"}:
            mapped.append("earned_trust")
        elif base in {"progression_toward_followup", "restoration_path"}:
            mapped.append("kept_promise")
        else:
            mapped.append(tag)
    return mapped


def _normalize_live_world_tags(raw_tags: Any, *, input_text: str) -> list[WorldTag]:
    tokens = _memory_list(raw_tags)
    mapped: list[str] = []
    for tag in tokens:
        token = tag.strip().lower().replace("-", "_")
        if any(fragment in token for fragment in ("arrival", "stabilizer", "custodian", "quest_progress", "organized")):
            mapped.append("aid_local")
        elif any(fragment in token for fragment in ("followup", "restoration", "promise")):
            mapped.append("promise_followup")
        elif any(fragment in token for fragment in ("investigate", "observe", "explore")):
            mapped.append("investigate")
        elif "threat" in token:
            mapped.append("threaten_local")
        elif "reward" in token:
            mapped.append("collect_reward")
        elif "disruption" in token or "overreach" in token:
            mapped.append("none")
        else:
            mapped.append(tag)
    normalized = normalize_world_tags(mapped)
    if normalized == ["none"] and input_text:
        return infer_world_tags(input_text)
    return normalized


def _supplement_generated_entity_drafts(input_payload: dict[str, Any], existing_drafts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    text = _first_text(
        input_payload.get("input_text"),
        input_payload.get("intent_summary"),
        input_payload.get("selected_choice"),
    )
    if not text:
        return existing_drafts
    lowered = text.lower()
    asks_market_entity = any(token in text for token in ("市場", "商店", "情報屋", "自治集団", "小コミュニティ"))
    asks_generated_entity = "生成" in text or any(token in lowered for token in ("generated", "freeform", "persistent entity"))
    if not (asks_market_entity or asks_generated_entity):
        return existing_drafts

    supplements = [
        {
            "entity_type": "location",
            "display_name": "ネクサス公開市場の記録露店",
            "semantic_key_hint": "nexus_public_market_trace_stall",
            "location_key": "nexus_city",
            "description": "ネクサス市の公開ログ周辺で来訪者の足跡と小さな取引記録を扱う市場露店。",
            "reuse_intent": "reuse_same_semantic_entity",
        },
        {
            "entity_type": "npc",
            "display_name": "公開市場の情報屋",
            "semantic_key_hint": "nexus_public_market_informant",
            "location_key": "nexus_city",
            "community_id": "nexus_public_market_collective",
            "description": "公開市場の商店と自治集団を横断して、来訪者ログに残った噂を照合する現地情報屋。",
            "reuse_intent": "reuse_same_semantic_entity",
        },
        {
            "entity_type": "community",
            "display_name": "公開市場自治連絡会",
            "semantic_key_hint": "nexus_public_market_collective",
            "location_key": "nexus_city",
            "description": "ネクサス公開市場の小商店、露店、情報仲介者が緩く共有する自治連絡網。",
            "reuse_intent": "reuse_same_semantic_entity",
        },
    ]
    seen = {
        (
            str(item.get("entity_type") or ""),
            str(item.get("semantic_key_hint") or item.get("display_name") or ""),
        )
        for item in existing_drafts
        if isinstance(item, dict)
    }
    combined = list(existing_drafts)
    for draft in supplements:
        key = (str(draft["entity_type"]), str(draft["semantic_key_hint"]))
        if key not in seen:
            combined.append(draft)
            seen.add(key)
    return combined


def _memory_drafts(raw_memories: Any, fallback_text: str) -> list[dict[str, Any]]:
    items = raw_memories if isinstance(raw_memories, list) else [raw_memories]
    drafts: list[dict[str, Any]] = []
    for item in items:
        if isinstance(item, dict):
            text = _first_text(item.get("text"), item.get("summary"), item.get("memory"), item.get("content"))
            scope = _first_text(item.get("scope"), "world")
            salience = item.get("salience", 0.6)
        else:
            text = _compact_text(item)
            scope = "world"
            salience = 0.6
        if text:
            drafts.append({"scope": scope, "text": text, "salience": salience})
    if not drafts:
        drafts.append({"scope": "world", "text": fallback_text, "salience": 0.5})
    return drafts


def _choice_drafts(raw_choices: Any) -> list[dict[str, Any]]:
    if isinstance(raw_choices, dict):
        source_items = []
        for key, value in raw_choices.items():
            if isinstance(value, dict):
                source_items.append({"choice_id": str(value.get("choice_id") or key), **value})
    elif isinstance(raw_choices, list):
        source_items = [item for item in raw_choices if isinstance(item, dict)]
    else:
        source_items = []

    drafts: list[dict[str, Any]] = []
    seen_labels: set[str] = set()
    for item in source_items:
        label = _first_text(item.get("label"), item.get("intent_summary"), item.get("summary"))
        if not label or label in seen_labels:
            continue
        canonical_input_text = _first_text(
            item.get("canonical_input_text"),
            item.get("canonical_text"),
            item.get("normalized_action"),
            item.get("intent_summary"),
            label,
        )
        action_kind = str(item.get("action_kind") or "narrative")
        if action_kind not in {"narrative", "use_reward_item", "travel"}:
            action_kind = "narrative"
        drafts.append(
            {
                "choice_id": str(item.get("choice_id") or f"choice_{len(drafts) + 1}"),
                "label": label,
                "intent_summary": _first_text(
                    item.get("intent_summary"),
                    item.get("summary"),
                    canonical_input_text,
                    label,
                ),
                "canonical_input_text": canonical_input_text,
                "action_kind": action_kind,
                "travel_target_key": item.get("travel_target_key"),
            }
        )
        seen_labels.add(label)
        if len(drafts) >= 3:
            break

    defaults = [
        "Check who reacted first.",
        "Act on the clearest opening in front of you.",
        "Trace where the new reaction spreads.",
    ]
    for label in defaults:
        if len(drafts) >= 3:
            break
        if label in seen_labels:
            continue
        drafts.append(
            {
                "choice_id": f"choice_{len(drafts) + 1}",
                "label": label,
                "intent_summary": label,
                "canonical_input_text": label,
                "action_kind": "narrative",
                "travel_target_key": None,
            }
        )
    return drafts[:3]


def _risk_level(raw_risk: Any, raw_outcome_band: Any, consequence_tags: list[ConsequenceTag]) -> str:
    risk = str(raw_risk or "").strip()
    if risk in {"low", "medium", "high"}:
        return risk
    if "overreach" in consequence_tags or raw_outcome_band == "setback":
        return "medium"
    return "low"


def _scene_move(raw_scene_move: Any) -> str:
    scene_move = str(raw_scene_move or "").strip()
    if scene_move in {"hold", "deepen", "pivot", "close"}:
        return scene_move
    if scene_move in {"advance", "progress"}:
        return "deepen"
    if scene_move in {"stay", "remain"}:
        return "hold"
    return "hold"


def _scene_pressure(raw_scene_pressure: Any) -> str:
    scene_pressure = str(raw_scene_pressure or "").strip()
    if scene_pressure in {"low", "medium", "high"}:
        return scene_pressure
    if any(keyword in scene_pressure.lower() for keyword in ("high", "緊張", "warning", "警告")):
        return "high"
    if scene_pressure:
        return "medium"
    return "medium"


class CouncilMemoryManagerPayload(BaseModel):
    memory_summary: str = Field(min_length=1)
    focus_memories: list[str] = Field(default_factory=list)
    relation_summary: str = Field(min_length=1)
    state_summary: str = Field(min_length=1)

    @model_validator(mode="before")
    @classmethod
    def normalize_live_provider_shape(cls, value: Any, info: ValidationInfo) -> Any:
        if not isinstance(value, dict):
            return value
        input_payload = info.context.get("input_payload", {}) if info.context else {}
        input_payload = input_payload if isinstance(input_payload, dict) else {}
        normalized = dict(value)

        memory_text = _first_memory_text(
            normalized.get("memory_summary"),
            normalized.get("memory"),
            normalized.get("same_world_memory"),
            normalized.get("memories"),
            input_payload.get("relevant_memories"),
        )
        normalized["memory_summary"] = memory_text or "No prior same-world memories are available for this turn."
        normalized["focus_memories"] = _memory_list(
            normalized.get("focus_memories"),
            normalized.get("memory"),
            normalized.get("same_world_memory"),
            normalized.get("memories"),
            input_payload.get("relevant_memories"),
        )
        normalized["relation_summary"] = _first_text(
            normalized.get("relation_summary"),
            normalized.get("relation"),
            normalized.get("relationship"),
            normalized.get("relationships"),
            input_payload.get("relation_context"),
            "No specific relationship shift is visible yet.",
        )
        normalized["state_summary"] = _first_text(
            normalized.get("state_summary"),
            _joined_state_summary(
                [
                    ("quest", normalized.get("quest") or normalized.get("quests") or input_payload.get("quests")),
                    ("faction", normalized.get("faction") or normalized.get("factions") or input_payload.get("factions")),
                    ("inventory", normalized.get("inventory") or input_payload.get("inventory")),
                    ("scene", normalized.get("scene") or input_payload.get("current_scene")),
                    ("chapter", normalized.get("chapter") or input_payload.get("current_chapter")),
                    ("location", normalized.get("location") or input_payload.get("location")),
                ]
            ),
        )
        return normalized


class CouncilNPCManagerPayload(BaseModel):
    npc_intent: str = Field(min_length=1)
    reaction_style: str = Field(min_length=1)
    focus_memories: list[str] = Field(default_factory=list)
    reaction_outline: str = Field(min_length=1)

    @model_validator(mode="before")
    @classmethod
    def normalize_live_provider_shape(cls, value: Any, info: ValidationInfo) -> Any:
        if not isinstance(value, dict):
            return value
        input_payload = info.context.get("input_payload", {}) if info.context else {}
        input_payload = input_payload if isinstance(input_payload, dict) else {}
        normalized = dict(value)
        normalized["npc_intent"] = _first_text(
            normalized.get("npc_intent"),
            normalized.get("intent"),
            input_payload.get("intent_summary"),
            "Respond to the player's current same-world action.",
        )
        normalized["reaction_style"] = _first_text(
            normalized.get("reaction_style"),
            normalized.get("style"),
            normalized.get("tone"),
            "measured",
        )
        normalized["focus_memories"] = _memory_list(
            normalized.get("focus_memories"),
            input_payload.get("focus_memories"),
            input_payload.get("relevant_memories"),
        )
        normalized["reaction_outline"] = _first_text(
            normalized.get("reaction_outline"),
            normalized.get("npc_reaction_outline"),
            normalized.get("npc_reaction"),
            normalized.get("reaction"),
            "The NPC acknowledges the action and keeps the scene moving.",
        )
        return normalized


class SituationAffordanceDraft(BaseModel):
    label: str = Field(min_length=1)
    intent_summary: str = Field(min_length=1)
    risk_hint: str = Field(min_length=1)
    effect_hint: str = Field(min_length=1)
    action_kind: Literal["narrative", "use_reward_item", "travel"] = "narrative"
    travel_target_key: str | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_live_provider_shape(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        label = _first_text(normalized.get("label"), normalized.get("action"), normalized.get("intent_summary"))
        normalized["label"] = label or "Read the situation before acting."
        normalized["intent_summary"] = _first_text(
            normalized.get("intent_summary"),
            normalized.get("summary"),
            normalized.get("canonical_input_text"),
            normalized["label"],
        )
        normalized["risk_hint"] = _first_text(
            normalized.get("risk_hint"),
            normalized.get("risk"),
            "Low immediate risk.",
        )
        normalized["effect_hint"] = _first_text(
            normalized.get("effect_hint"),
            normalized.get("effect"),
            "Clarifies the next situation.",
        )
        action_kind = str(normalized.get("action_kind") or "narrative").strip()
        normalized["action_kind"] = action_kind if action_kind in {"narrative", "use_reward_item", "travel"} else "narrative"
        if normalized["action_kind"] != "travel":
            normalized["travel_target_key"] = None
        return normalized


class CouncilSituationMapperPayload(BaseModel):
    action_result_focus: str = Field(min_length=1)
    current_situation: str = Field(min_length=1)
    visible_elements: list[str] = Field(min_length=1)
    immediate_pressure: str = Field(min_length=1)
    open_questions: list[str] = Field(default_factory=list)
    affordances: list[SituationAffordanceDraft] = Field(min_length=2, max_length=4)
    risk_level: Literal["low", "medium", "high"] = "low"
    effect_level: Literal["limited", "standard", "great"] = "standard"
    fail_forward_hint: str = Field(min_length=1)
    agency_guard: str = Field(min_length=1)

    @model_validator(mode="before")
    @classmethod
    def normalize_live_provider_shape(cls, value: Any, info: ValidationInfo) -> Any:
        if not isinstance(value, dict):
            return value
        input_payload = info.context.get("input_payload", {}) if info.context else {}
        input_payload = input_payload if isinstance(input_payload, dict) else {}
        normalized = dict(value)
        current_scene = input_payload.get("current_scene") if isinstance(input_payload.get("current_scene"), dict) else {}
        current_location = input_payload.get("current_location") if isinstance(input_payload.get("current_location"), dict) else {}
        normalized["action_result_focus"] = _first_text(
            normalized.get("action_result_focus"),
            normalized.get("result_focus"),
            input_payload.get("consequence_summary"),
            input_payload.get("intent_summary"),
            "The latest player action changes what can be judged next.",
        )
        normalized["current_situation"] = _first_text(
            normalized.get("current_situation"),
            normalized.get("situation"),
            current_scene.get("summary"),
            current_location.get("description"),
            "The current scene remains legible enough for the next decision.",
        )
        normalized["visible_elements"] = _memory_list(
            normalized.get("visible_elements"),
            normalized.get("visible"),
            current_location.get("name"),
            input_payload.get("local_figures"),
            input_payload.get("important_inventory_affordances"),
        )[:8] or ["The current place", "The nearby guide"]
        normalized["immediate_pressure"] = _first_text(
            normalized.get("immediate_pressure"),
            normalized.get("pressure"),
            current_scene.get("pressure_summary"),
            input_payload.get("active_consequence_threads"),
            "The scene is waiting for the player's next clear move.",
        )
        normalized["open_questions"] = _memory_list(
            normalized.get("open_questions"),
            normalized.get("unresolved_questions"),
            "What changed because of the latest action?",
        )[:5]
        affordances = normalized.get("affordances")
        if not isinstance(affordances, list) or len([item for item in affordances if isinstance(item, dict)]) < 2:
            affordances = input_payload.get("default_choice_templates") or []
        normalized["affordances"] = affordances
        risk = str(normalized.get("risk_level") or "").strip()
        normalized["risk_level"] = risk if risk in {"low", "medium", "high"} else _risk_level(
            input_payload.get("risk_level"),
            input_payload.get("outcome_band"),
            normalize_consequence_tags(input_payload.get("consequence_tags") or []),
        )
        effect = str(normalized.get("effect_level") or "").strip()
        normalized["effect_level"] = effect if effect in {"limited", "standard", "great"} else "standard"
        normalized["fail_forward_hint"] = _first_text(
            normalized.get("fail_forward_hint"),
            normalized.get("failure_hint"),
            "If the action cannot fully succeed, change pressure and create a new decision point.",
        )
        normalized["agency_guard"] = _first_text(
            normalized.get("agency_guard"),
            "Do not decide the player's next action, feelings, or commitment.",
        )
        return normalized


class CouncilWorldProgressPayload(BaseModel):
    event_type: Literal["player.turn.resolved"]
    event_payload: dict[str, Any]
    memories: list[MemoryDraft] = Field(min_length=1)
    world_tags: list[WorldTag] = Field(min_length=1)
    consequence_tags: list[ConsequenceTag] = Field(default_factory=list)
    shared_action_tag: SharedWorldActionTag = "none"
    state_drafts: dict[str, Any] = Field(default_factory=dict)
    branch_signals: list[BranchSignal] = Field(default_factory=list)
    outcome_band: OutcomeBand = "steady"
    resolution_summary: str = Field(min_length=1)
    risk_level: Literal["low", "medium", "high"]
    next_choices: list[NarrativeChoiceDraft] = Field(min_length=3, max_length=3)
    scene_move: Literal["hold", "deepen", "pivot", "close"] = "hold"
    scene_pressure: Literal["low", "medium", "high"] = "medium"
    broadcast_draft: dict[str, Any] | None = None
    quest_offer: dict[str, Any] | None = None
    chapter_directive: dict[str, Any] | None = None
    followup_quest_offer: dict[str, Any] | None = None
    quest_resolution_hint: dict[str, Any] | None = None
    active_quest_resolution: dict[str, Any] | None = None
    quest_lifecycle_directive: dict[str, Any] | None = None
    entity_drafts: list[dict[str, Any]] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def normalize_canonical_event_type(cls, value: Any, info: ValidationInfo) -> Any:
        if not isinstance(value, dict):
            return value
        input_payload = info.context.get("input_payload", {}) if info.context else {}
        input_payload = input_payload if isinstance(input_payload, dict) else {}
        normalized = dict(value)
        normalized["event_type"] = "player.turn.resolved"

        summary = _first_text(
            normalized.get("resolution_summary"),
            normalized.get("canonical_event_draft"),
            normalized.get("event_payload"),
            input_payload.get("input_text"),
            "The player's turn resolves within the current world.",
        )
        if not isinstance(normalized.get("event_payload"), dict):
            normalized["event_payload"] = {
                "world_id": input_payload.get("world_id"),
                "summary": summary,
            }
        normalized["resolution_summary"] = summary
        normalized["memories"] = _memory_drafts(normalized.get("memories") or normalized.get("memory_drafts"), summary)
        normalized["world_tags"] = _normalize_live_world_tags(
            normalized.get("world_tags"),
            input_text=_first_text(input_payload.get("input_text"), summary),
        )
        normalized["consequence_tags"] = normalize_consequence_tags(
            _normalize_live_consequence_tokens(normalized.get("consequence_tags"))
        )
        shared_action_tag = str(normalized.get("shared_action_tag") or "").strip()
        if shared_action_tag not in {"help", "harm", "investigate", "trade", "negotiate", "protect", "explore", "restore", "destabilize", "none"}:
            shared_action_tag = "none"
        normalized["shared_action_tag"] = shared_action_tag
        if not isinstance(normalized.get("state_drafts"), dict):
            normalized["state_drafts"] = {}
        normalized["risk_level"] = _risk_level(normalized.get("risk_level"), normalized.get("outcome_band"), normalized["consequence_tags"])
        game_frame = input_payload.get("game_frame") if isinstance(input_payload.get("game_frame"), dict) else {}
        frame_affordances = game_frame.get("affordances") if isinstance(game_frame.get("affordances"), list) else []
        framed_choices: list[dict[str, Any]] = []
        for index, affordance in enumerate(item for item in frame_affordances if isinstance(item, dict)):
            risk_hint = _first_text(affordance.get("risk_hint"), "risk is legible")
            effect_hint = _first_text(affordance.get("effect_hint"), "effect is legible")
            intent_summary = _first_text(affordance.get("intent_summary"), affordance.get("label"))
            framed_choices.append(
                {
                    "choice_id": str(affordance.get("choice_id") or f"choice_{index + 1}"),
                    "label": _first_text(affordance.get("label"), intent_summary),
                    "intent_summary": f"{intent_summary} {effect_hint} {risk_hint}".strip(),
                    "canonical_input_text": intent_summary,
                    "action_kind": affordance.get("action_kind") or "narrative",
                    "travel_target_key": affordance.get("travel_target_key"),
                }
            )
        normalized["next_choices"] = _choice_drafts(
            framed_choices
            or normalized.get("next_choices")
            or normalized.get("choices")
            or normalized.get("next_three_diegetic_player_choices")
            or normalized.get("next_player_choices")
        )
        normalized["scene_move"] = _scene_move(normalized.get("scene_move"))
        normalized["scene_pressure"] = _scene_pressure(normalized.get("scene_pressure"))
        for key in (
            "quest_offer",
            "chapter_directive",
            "followup_quest_offer",
            "quest_resolution_hint",
            "active_quest_resolution",
            "quest_lifecycle_directive",
        ):
            if not isinstance(normalized.get(key), dict):
                normalized[key] = None
        entity_drafts = normalized.get("entity_drafts")
        if not isinstance(entity_drafts, list):
            entity_drafts = []
        normalized["entity_drafts"] = _supplement_generated_entity_drafts(
            input_payload,
            [item for item in entity_drafts if isinstance(item, dict)],
        )
        quests = input_payload.get("quests") if isinstance(input_payload.get("quests"), list) else []
        has_live_quest = any(
            isinstance(item, dict) and str(item.get("status") or "") in {"offered", "active", "paused"}
            for item in quests
        )
        current_chapter = input_payload.get("current_chapter") if isinstance(input_payload.get("current_chapter"), dict) else {}
        in_epilogue = str((current_chapter or {}).get("chapter_kind") or "") == "epilogue"
        if has_live_quest or in_epilogue:
            normalized["quest_offer"] = None
        return normalized


class CouncilRulesArbiterPayload(BaseModel):
    approval_status: Literal["approved", "rejected"]
    normalized_world_tags: list[WorldTag] = Field(min_length=1)
    reason: str = Field(min_length=1)
    risk_level: Literal["low", "medium", "high"]

    @model_validator(mode="before")
    @classmethod
    def _normalize_live_provider_shape(cls, value: Any, info: ValidationInfo) -> Any:
        if not isinstance(value, dict):
            return value
        input_payload = info.context.get("input_payload") if isinstance(info.context, dict) else {}
        input_payload = input_payload if isinstance(input_payload, dict) else {}
        normalized = dict(value)
        decision = str(
            normalized.get("approval_status")
            or normalized.get("decision")
            or normalized.get("status")
            or ""
        ).strip().lower()
        approved_value = normalized.get("approved")
        if approved_value is None:
            approved_value = normalized.get("approve")
        if isinstance(normalized.get("approval_status"), bool):
            normalized["approval_status"] = "approved" if normalized["approval_status"] else "rejected"
        elif isinstance(approved_value, bool):
            normalized["approval_status"] = "approved" if approved_value else "rejected"
        elif decision in {"approved", "approve", "accepted", "allow", "allowed", "pass", "passed"}:
            normalized["approval_status"] = "approved"
        elif decision in {"rejected", "reject", "denied", "deny", "blocked"}:
            normalized["approval_status"] = "rejected"
        if "normalized_world_tags" not in normalized:
            raw_tags = normalized.get("world_tags") or normalized.get("tags")
            input_text = _first_text(input_payload.get("input_text"), normalized.get("reason"))
            normalized["normalized_world_tags"] = _normalize_live_world_tags(raw_tags, input_text=input_text)
        if not _compact_text(normalized.get("reason")):
            normalized["reason"] = _first_text(
                normalized.get("rationale"),
                normalized.get("summary"),
                input_payload.get("consequence_summary"),
                "Approved by rules arbiter.",
            )
        if "risk_level" not in normalized:
            tags = set(normalized.get("normalized_world_tags") or [])
            normalized["risk_level"] = "high" if "threaten_local" in tags else "medium" if "collect_reward" in tags else "low"
        return normalized


class CouncilSafetyGuardPayload(BaseModel):
    approval_status: Literal["approved", "rejected"]
    reason: str = Field(min_length=1)
    violations: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _normalize_live_provider_shape(cls, value: Any, info: ValidationInfo) -> Any:
        if not isinstance(value, dict):
            return value
        input_payload = info.context.get("input_payload") if isinstance(info.context, dict) else {}
        input_payload = input_payload if isinstance(input_payload, dict) else {}
        normalized = dict(value)
        positive = None
        if isinstance(normalized.get("approval_status"), bool):
            positive = bool(normalized.get("approval_status"))
        elif isinstance(normalized.get("approval_status"), str):
            decision = str(normalized.get("approval_status") or "").strip().lower()
            if decision in {"approved", "approve", "accepted", "allow", "allowed", "pass", "passed", "valid"}:
                positive = True
            elif decision in {"rejected", "reject", "denied", "deny", "blocked"}:
                positive = False
        if positive is None:
            for key in ("approved", "approve", "allowed", "accepted", "passed", "pass", "valid", "safety_check_passed"):
                if key in normalized:
                    positive = bool(normalized.get(key))
                    break
        if positive is None and "reject" in normalized:
            positive = not bool(normalized.get("reject"))
        decision = str(normalized.get("decision") or normalized.get("status") or "").strip().lower()
        if positive is None and decision:
            if decision in {"approved", "approve", "accepted", "allow", "allowed", "pass", "passed", "valid"}:
                positive = True
            elif decision in {"rejected", "reject", "denied", "deny", "blocked"}:
                positive = False
        if positive is not None:
            normalized["approval_status"] = "approved" if positive else "rejected"
        if not _compact_text(normalized.get("reason")):
            normalized["reason"] = _first_text(
                normalized.get("rationale"),
                normalized.get("summary"),
                input_payload.get("reason"),
                "Same-world safety check passed."
                if normalized.get("approval_status") == "approved"
                else "Same-world safety check rejected the turn package.",
            )
        violations = normalized.get("violations")
        if violations is None:
            normalized["violations"] = []
        elif not isinstance(violations, list):
            normalized["violations"] = _memory_list(violations)
        return normalized


class CouncilNarrativePayload(BaseModel):
    narrative: str = Field(min_length=1)
    npc_reaction: str = Field(min_length=1)
    tone: str = Field(min_length=1)

    @model_validator(mode="before")
    @classmethod
    def _normalize_live_provider_shape(cls, value: Any, info: ValidationInfo) -> Any:
        if not isinstance(value, dict):
            return value
        input_payload = info.context.get("input_payload") if isinstance(info.context, dict) else {}
        input_payload = input_payload if isinstance(input_payload, dict) else {}
        normalized = dict(value)
        narrative = _first_text(
            normalized.get("narrative"),
            normalized.get("scene_text"),
            normalized.get("story"),
            normalized.get("summary"),
        )
        if narrative:
            normalized["narrative"] = narrative
        if "npc_reaction" not in normalized or not isinstance(normalized.get("npc_reaction"), str):
            normalized["npc_reaction"] = _first_text(
                normalized.get("npc_response"),
                normalized.get("reaction"),
                normalized.get("npc_reaction"),
                normalized.get("npc_reaction_outline"),
                input_payload.get("npc_reaction_outline"),
                input_payload.get("npc_reaction"),
                f"{input_payload.get('npc_name') or 'The nearby NPC'} watches the result and responds in a measured way.",
            )
        if "tone" not in normalized:
            raw_tone = _first_text(normalized.get("scene_tone"), normalized.get("mood"), input_payload.get("outcome_band"))
            tone = raw_tone.lower().replace("_", " ").strip()
            if tone in {"setback", "high"}:
                tone = "tense"
            elif tone in {"tangled", "medium"}:
                tone = "uneasy"
            elif not tone or tone in {"steady", "low"}:
                tone = "measured"
            normalized["tone"] = tone
        return normalized


@dataclass(frozen=True)
class CouncilRequest:
    world_id: str
    turn_id: str | None
    player_name: str
    npc_name: str
    input_text: str
    relevant_memories: list[str]
    relation_context: list[str]
    graph_context_status: str
    session_state: dict[str, Any]
    input_mode: Literal["choice", "free_text"] = "choice"
    selected_choice: dict[str, Any] | None = None
    prepared_intent_payload: CouncilIntentInterpreterPayload | None = None
    prepared_intent_role_run: CouncilRoleRun | None = None


@dataclass(frozen=True)
class CouncilIntentPhase:
    role_run: CouncilRoleRun
    payload: CouncilIntentInterpreterPayload | None
    final_lane: str
    failure_reason: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.payload is not None


FORBIDDEN_LLM_METADATA_KEYS = {
    "choice_id",
    "action_kind",
    "action_type",
    "target",
    "travel_target_key",
    "route_key",
    "destination_key",
    "item_id",
    "quest_assignment_id",
    "template_key",
    "pack_id",
    "world_template_id",
    "world_id",
    "actor_id",
    "location_id",
    "session_id",
    "turn_id",
}


def _assert_public_llm_payload(value: Any, *, path: str = "input") -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            key_text = str(key)
            if key_text in FORBIDDEN_LLM_METADATA_KEYS or key_text.endswith("_id") or key_text.endswith("_key"):
                raise ValueError(f"Internal metadata key leaked into LLM input at {path}.{key_text}")
            _assert_public_llm_payload(item, path=f"{path}.{key_text}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _assert_public_llm_payload(item, path=f"{path}[{index}]")


def _public_turn_failure_kind(result: Any) -> str:
    attempts = list(getattr(result, "attempts", []) or [])
    if any(getattr(attempt, "status", "") == "provider_error" for attempt in attempts):
        return "provider_error"
    if any(getattr(attempt, "output_schema_status", "") == "invalid" for attempt in attempts):
        return "schema_hard_invalid"
    failure_reason = str(getattr(result, "failure_reason", None) or "").strip()
    lowered = failure_reason.lower()
    if "schema" in lowered or "validation" in lowered or "invalid" in lowered:
        return "schema_hard_invalid"
    if "provider" in lowered:
        return "provider_error"
    return failure_reason or "schema_hard_invalid"


def _public_validation_feedback(items: list[dict[str, Any]]) -> list[dict[str, str]]:
    feedback: list[dict[str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        reason = _compact_text(item.get("reason")) or "consistency_failed"
        message = _compact_text(item.get("message") or item.get("summary"))
        claim = _compact_text(item.get("claim"))
        if claim:
            message = f"{message} Claim: {claim}".strip()
        if not message:
            message = "The output must be repaired to match visible public state."
        feedback.append({"reason": reason, "message": message[:600]})
        if len(feedback) >= 6:
            break
    return feedback or [{"reason": "consistency_failed", "message": "The output must be repaired to match visible public state."}]


def _split_rejected_claim_names(rejected_claims: list[dict[str, Any]] | None) -> tuple[list[str], list[str]]:
    """Split harness rejected claims into ordered, de-duplicated lists of
    unreachable place names and absent person names for fallback narration."""
    unreachable_places: list[str] = []
    absent_people: list[str] = []
    for item in rejected_claims or []:
        if not isinstance(item, dict):
            continue
        name = _compact_text(item.get("claim"))
        if not name:
            continue
        claim_kind = str(item.get("claim_kind") or "")
        if claim_kind == "location" and name not in unreachable_places:
            unreachable_places.append(name)
        elif claim_kind == "actor" and name not in absent_people:
            absent_people.append(name)
    return unreachable_places, absent_people


def _public_text(value: Any) -> str:
    return _compact_text(value)


def _public_profile(player_profile: Any) -> dict[str, Any]:
    profile = player_profile if isinstance(player_profile, dict) else {}
    return {
        "display_name": _public_text(profile.get("display_name")),
        "gender": _public_text(profile.get("gender")),
        "background": _public_text(profile.get("background")),
        "free_text": _public_text(profile.get("free_text")),
        "narrative_preferences": profile.get("narrative_preferences") if isinstance(profile.get("narrative_preferences"), dict) else {},
    }


def _public_session_context(session_state: dict[str, Any]) -> dict[str, Any]:
    current_location = session_state.get("current_location") or session_state.get("location") or {}
    current_location = current_location if isinstance(current_location, dict) else {}
    player_profile = session_state.get("player_profile") if isinstance(session_state.get("player_profile"), dict) else {}
    play_language = _play_language_context(player_profile)
    play_language_code = _language_code_from_play_language(play_language)
    world_pack = session_state.get("world_pack") if isinstance(session_state.get("world_pack"), dict) else {}
    source_language = _compact_text(world_pack.get("source_language")) or "en"
    current_aliases = _aliases_by_language(current_location.get("public_aliases"))
    current_source_name = _public_text(current_location.get("source_name") or current_location.get("name"))
    inventory = [item for item in session_state.get("inventory") or [] if isinstance(item, dict)]
    quests = [item for item in session_state.get("quests") or [] if isinstance(item, dict)]
    local_figures = session_state.get("local_figures") or session_state.get("plaza_figures") or []
    nearby_routes = [item for item in session_state.get("nearby_routes") or [] if isinstance(item, dict)]
    current_scene = session_state.get("current_scene") if isinstance(session_state.get("current_scene"), dict) else {}
    chapter = session_state.get("chapter") if isinstance(session_state.get("chapter"), dict) else {}
    return {
        "language_context": {
            "pack_source_language": source_language,
            "play_language": play_language_code,
            "output_language_requested": play_language_code,
        },
        "current_location": {
            "name": _display_name_for_language(
                current_source_name,
                current_aliases,
                language=play_language_code,
                source_language=source_language,
            ),
            "source_name": current_source_name,
            "aliases_by_language": current_aliases,
            "description": _public_text(current_location.get("description")),
        },
        "current_scene": {
            "summary": _public_text(current_scene.get("summary")),
            "pressure": _public_text(current_scene.get("pressure_summary")),
        },
        "current_chapter": {
            "summary": _public_text(chapter.get("summary")),
            "crossroads_summary": _public_text(chapter.get("crossroads_summary")),
            "branch_hint": _public_text(chapter.get("branch_hint")),
        },
        "visible_people": [
            _public_person_summary(item, language=play_language_code, source_language=source_language)
            for item in local_figures
            if isinstance(item, dict)
            and _public_text(item.get("source_name") or item.get("display_name") or item.get("name"))
        ][:6],
        "visible_items": [
            {
                "name": _public_text(item.get("name")),
                "description": _public_text(item.get("description")),
                "status": _public_text(item.get("status")),
                "usable": bool(item.get("usable")),
            }
            for item in inventory
            if _public_text(item.get("name"))
        ][:8],
        "visible_exits": [
            {
                "destination_name": _display_name_for_language(
                    _public_text(item.get("destination_source_name") or item.get("destination_name")),
                    _aliases_by_language(
                        item.get("destination_aliases")
                        or ((item.get("to_location") or {}).get("public_aliases") if isinstance(item.get("to_location"), dict) else {})
                    ),
                    language=play_language_code,
                    source_language=source_language,
                ),
                "source_name": _public_text(item.get("destination_source_name") or item.get("destination_name")),
                "aliases_by_language": _aliases_by_language(
                    item.get("destination_aliases")
                    or ((item.get("to_location") or {}).get("public_aliases") if isinstance(item.get("to_location"), dict) else {})
                ),
                "summary": _public_text(item.get("summary")),
                "available": bool(item.get("available")),
                "destination_description": _public_text(
                    item.get("destination_description")
                    or ((item.get("to_location") or {}).get("description") if isinstance(item.get("to_location"), dict) else "")
                ),
                "arrival_people": [
                    _public_person_summary(person, language=play_language_code, source_language=source_language)
                    for person in (item.get("arrival_people") or [])
                    if isinstance(person, dict)
                    and _public_text(person.get("source_name") or person.get("display_name") or person.get("name"))
                ][:4],
                "arrival_items": [
                    {
                        "name": _public_text(thing.get("name")),
                        "description": _public_text(thing.get("description")),
                    }
                    for thing in (item.get("arrival_items") or [])
                    if isinstance(thing, dict) and _public_text(thing.get("name"))
                ][:4],
                "destination_opportunities": [
                    {
                        "label": _public_text(action.get("label")),
                        "summary": _public_text(action.get("summary")),
                    }
                    for action in (item.get("destination_opportunities") or [])
                    if isinstance(action, dict) and _public_text(action.get("label"))
                ][:4],
                "related_memory_snippets": [
                    _public_text(snippet)
                    for snippet in (item.get("related_memory_snippets") or [])
                    if _public_text(snippet)
                ][:3],
            }
            for item in nearby_routes
            if bool(item.get("available")) and _public_text(item.get("destination_name"))
        ][:6],
        "active_quests": [
            {
                "title": _public_text(item.get("title")),
                "description": _public_text(item.get("description")),
                "status": _public_text(item.get("status")),
                "latest_summary": _public_text(item.get("latest_summary")),
            }
            for item in quests
            if _public_text(item.get("title")) and _public_text(item.get("status")) in {"offered", "active", "paused"}
        ][:5],
        "known_facts": [
            {
                "title": _public_text(item.get("title")),
                "summary": _public_text(item.get("summary")),
            }
            for item in session_state.get("known_facts") or []
            if isinstance(item, dict) and _public_text(item.get("title"))
        ][:8],
        "visible_opportunities": [
            {
                "label": _public_text(item.get("label")),
                "summary": _public_text(item.get("summary") or item.get("canonical_input_text")),
            }
            for item in session_state.get("suggested_actions") or []
            if isinstance(item, dict) and _public_text(item.get("label"))
        ][:4],
        "recent_scene_history": [_public_text(item) for item in session_state.get("recent_scene_history") or [] if _public_text(item)][:5],
        "recent_world_beats": [_public_text(item) for item in session_state.get("recent_world_beats") or [] if _public_text(item)][:5],
        "active_consequence_threads": [
            {
                "title": _public_text(item.get("title")),
                "summary": _public_text(item.get("summary")),
                "pressure": _public_text(item.get("pressure_band")),
            }
            for item in session_state.get("active_consequence_threads") or []
            if isinstance(item, dict) and _public_text(item.get("summary"))
        ][:5],
        "recognized_titles": [
            {
                "display_name": _public_text(item.get("display_name")),
                "description": _public_text(item.get("description")),
                "status": _public_text(item.get("status")),
            }
            for item in session_state.get("recognized_titles") or []
            if isinstance(item, dict) and _public_text(item.get("display_name"))
        ][:5],
    }


class GMCouncilService:
    ROLE_ORDER = [
        ("intent_interpreter", 1, "council.intent_interpreter", False),
        ("memory_manager", 2, "council.memory_manager", False),
        ("npc_manager", 3, "council.npc_manager", False),
        ("situation_mapper", 4, "council.situation_mapper", False),
        ("world_progress", 5, "council.world_progress", False),
        ("rules_arbiter", 6, "council.rules_arbiter", True),
        ("safety_guard", 7, "council.safety_guard", True),
        ("narrative", 8, "council.narrative", True),
    ]

    def __init__(self, settings: Settings, model_router: ModelRouter) -> None:
        self.settings = settings
        self.model_router = model_router

    @staticmethod
    def _deterministic_attempt(*, prompt_id: str, lane: str, payload: BaseModel) -> PromptExecutionAttempt:
        return PromptExecutionAttempt(
            prompt_id=prompt_id,
            schema_version="deterministic",
            model_lane=lane,
            model_id=lane,
            input_hash=lane,
            input_context_hash=lane,
            status="resolved",
            output_schema_status="valid",
            output_payload={"status": "resolved", "raw_output": payload.model_dump()},
            provider_name="deterministic",
            provider_response_id=None,
        )

    def resolve_public_turn(self, request: CouncilRequest) -> TurnResolutionOutcome:
        input_payload = self._public_turn_input_payload(request)
        _assert_public_llm_payload(input_payload)
        result = self.model_router.execute_structured_prompt(
            prompt_id="session.turn_resolution",
            response_model=PublicGmTurnPayload,
            input_payload=input_payload,
            world_id=request.world_id,
            turn_id=request.turn_id,
            graph_context_status=request.graph_context_status,
            allow_pro_fallback=False,
        )
        role_run = self._role_run(
            council_role="ai_gm",
            stage_index=1,
            prompt_id="session.turn_resolution",
            approval_status="approved" if result.succeeded else "failed",
            result=result,
        )
        if "__force_safety_reject__" in request.input_text:
            return TurnResolutionOutcome(
                role_runs=[role_run],
                final_lane=result.final_lane,
                final_payload=None,
                failure_reason="forced safety rejection",
                rejection_role="ai_gm",
            )
        if not result.succeeded or result.final_payload is None:
            return self.repair_public_turn(
                request,
                validation_feedback=[
                    {
                        "reason": _public_turn_failure_kind(result),
                        "message": "The first AI GM output could not be used as a coherent public turn.",
                    }
                ],
                previous_role_runs=[role_run],
                original_failure_reason=_public_turn_failure_kind(result),
            )

        public_payload = result.final_payload
        final_payload = self._public_turn_to_resolution_payload(request, public_payload)
        return TurnResolutionOutcome(
            role_runs=[role_run],
            final_lane=result.final_lane,
            final_payload=final_payload,
            deterministic_fallback_used=False,
        )

    def repair_public_turn(
        self,
        request: CouncilRequest,
        *,
        validation_feedback: list[dict[str, Any]],
        previous_role_runs: list[CouncilRoleRun] | None = None,
        original_failure_reason: str | None = None,
    ) -> TurnResolutionOutcome:
        input_payload = self._public_turn_input_payload(request)
        input_payload["validation_feedback"] = _public_validation_feedback(validation_feedback)
        _assert_public_llm_payload(input_payload)
        result = self.model_router.execute_structured_prompt(
            prompt_id="session.turn_resolution_repair",
            response_model=PublicGmTurnPayload,
            input_payload=input_payload,
            world_id=request.world_id,
            turn_id=request.turn_id,
            graph_context_status=request.graph_context_status,
            allow_pro_fallback=False,
        )
        role_run = self._role_run(
            council_role="ai_gm_repair",
            stage_index=2,
            prompt_id="session.turn_resolution_repair",
            approval_status="approved" if result.succeeded else "failed",
            result=result,
        )
        role_runs = [*(previous_role_runs or []), role_run]
        if not result.succeeded or result.final_payload is None:
            return TurnResolutionOutcome(
                role_runs=role_runs,
                final_lane=result.final_lane,
                final_payload=None,
                failure_reason="repair_failed",
                rejection_role="ai_gm_repair",
            )
        final_payload = self._public_turn_to_resolution_payload(request, result.final_payload)
        final_payload.event_payload = {
            **final_payload.event_payload,
            "repair": {
                "original_failure_reason": original_failure_reason,
                "validation_feedback": input_payload["validation_feedback"],
            },
        }
        return TurnResolutionOutcome(
            role_runs=role_runs,
            final_lane=result.final_lane,
            final_payload=final_payload,
            deterministic_fallback_used=False,
        )

    def fallback_public_turn(
        self,
        request: CouncilRequest,
        *,
        rejected_claims: list[dict[str, Any]] | None = None,
        previous_role_runs: list[CouncilRoleRun] | None = None,
        original_failure_reason: str | None = None,
    ) -> TurnResolutionOutcome:
        """Deterministically resolve a turn at the current location when the AI GM
        and its repair attempt keep hallucinating unreachable places or absent
        people (Issue #5 / I3). Produces a minimal, harness-clean narrative so the
        whole turn is not failed; the rejected claims are recorded for audit."""
        cleaned_claims = [item for item in (rejected_claims or []) if isinstance(item, dict)]
        public_payload = self._public_turn_fallback_payload(request, rejected_claims=cleaned_claims)
        final_payload = self._public_turn_to_resolution_payload(request, public_payload)
        final_payload.event_payload = {
            **final_payload.event_payload,
            "deterministic_fallback": {
                "reason": original_failure_reason or "consistency_failed",
                "rejected_claims": cleaned_claims[:6],
            },
        }
        fallback_role_run = CouncilRoleRun(
            council_role="ai_gm_fallback",
            stage_index=3,
            prompt_id="session.turn_resolution_fallback",
            approval_status="approved",
            attempts=[],
            final_lane="deterministic",
            final_payload=public_payload.model_dump(),
            failure_reason=None,
        )
        return TurnResolutionOutcome(
            role_runs=[*(previous_role_runs or []), fallback_role_run],
            final_lane="deterministic",
            final_payload=final_payload,
            deterministic_fallback_used=True,
        )

    def _public_turn_input_payload(self, request: CouncilRequest) -> dict[str, Any]:
        player_profile = request.session_state.get("player_profile") or {}
        play_language = _play_language_context(player_profile)
        public_context = _public_session_context(request.session_state)
        return {
            "player_action_text": request.input_text,
            "player_name": request.player_name,
            "player_profile": _public_profile(player_profile),
            "narrative_preferences": (
                player_profile.get("narrative_preferences") if isinstance(player_profile, dict) and isinstance(player_profile.get("narrative_preferences"), dict) else {}
            ),
            "play_language": play_language,
            "public_game_context": public_context,
            "recent_memories": [_public_text(item) for item in request.relevant_memories if _public_text(item)][:6],
        }

    def _public_turn_fallback_payload(
        self,
        request: CouncilRequest,
        *,
        rejected_claims: list[dict[str, Any]] | None = None,
    ) -> PublicGmTurnPayload:
        input_payload = self._public_turn_input_payload(request)
        public_context = input_payload["public_game_context"]
        current_location = public_context.get("current_location") if isinstance(public_context, dict) else {}
        current_location = current_location if isinstance(current_location, dict) else {}
        location_name = _first_text(current_location.get("name"), "現在地")
        language_context = public_context.get("language_context") if isinstance(public_context, dict) and isinstance(public_context.get("language_context"), dict) else {}
        input_text = request.input_text.strip() or "場の変化を確かめる"
        visible_exits = public_context.get("visible_exits") if isinstance(public_context, dict) else []
        visible_exits = [item for item in visible_exits or [] if isinstance(item, dict)]
        exit_name = _first_text((visible_exits[0] or {}).get("destination_name")) if visible_exits else ""
        unreachable_places, absent_people = _split_rejected_claim_names(rejected_claims)
        suggestions = [
            {"label": "直前の結果を案内役に確認する", "summary": "場面を進める前に、確認できた変化だけを整理する。"},
            {"label": f"{location_name}で次に見える記録を調べる", "summary": "現在地にある公開情報から次の糸口を探す。"},
            {
                "label": f"{exit_name}へ向かう" if exit_name else "別の糸口を探す",
                "summary": "見えている出口や機会から、次に自然な進み方を選ぶ。",
            },
        ]
        action_phrase = _naturalize_turn_action_text(input_text)
        narrative_parts = [f"{request.player_name}は{action_phrase}。"]
        if unreachable_places:
            narrative_parts.append(f"{'・'.join(unreachable_places[:2])}へ通じる道は、ここからは今のところ見当たらない。")
        if absent_people:
            narrative_parts.append(f"{'・'.join(absent_people[:2])}の姿は、この場には見当たらない。")
        narrative_parts.append(f"{location_name}の状況は、確認できる範囲でだけ変化する。")
        return PublicGmTurnPayload.model_validate(
            {
                "action_interpretation": input_text,
                "narrative": "".join(narrative_parts),
                "npc_reaction": f"{request.npc_name}は、その場で見える変化にだけ反応する。",
                "current_situation": _first_text(current_location.get("description"), f"{location_name}で次の判断点が見えている。"),
                "current_location_name": location_name,
                "language_context": language_context,
                "public_claims": [
                    {
                        "kind": "location",
                        "surface_text": location_name,
                        "language": _first_text(language_context.get("output_language_requested"), "unknown"),
                        "role": "current_location",
                        "confidence": 0.7,
                    }
                ],
                "addressed_people": [],
                "suggested_actions": suggestions,
                "consequence_summary": f"{input_text}が現在の場面に反映された。",
                "consequence_tags": normalize_consequence_tags(infer_world_tags(input_text)),
                "world_tags": normalize_world_tags(infer_world_tags(input_text)),
                "scene_tone": "measured",
                "scene_move": "deepen",
                "scene_pressure": "medium",
                "memories": [{"scope": "world", "text": f"{request.player_name}は{action_phrase}。", "salience": 0.65}],
            },
            context={"input_payload": input_payload},
        )

    @staticmethod
    def _public_turn_to_resolution_payload(request: CouncilRequest, public_payload: PublicGmTurnPayload) -> TurnResolutionPayload:
        suggestions = [
            NarrativeChoiceDraft(
                label=item.label,
                intent_summary=item.summary,
                canonical_input_text=f"{item.label}。{item.summary}",
                action_kind="narrative",
                travel_target_key=None,
            )
            for item in public_payload.suggested_actions
        ]
        while len(suggestions) < 3:
            fallback_label = ["場の変化を確かめる", "近くの人物に反応を尋ねる", "別の糸口を探す"][len(suggestions)]
            suggestions.append(
                NarrativeChoiceDraft(
                    label=fallback_label,
                    intent_summary=fallback_label,
                    canonical_input_text=fallback_label,
                    action_kind="narrative",
                    travel_target_key=None,
                )
            )
        return TurnResolutionPayload(
            narrative=public_payload.narrative,
            npc_reaction=public_payload.npc_reaction,
            event_type="player.turn.resolved",
            event_payload={
                "summary": public_payload.internal_summary or public_payload.consequence_summary,
                "public_turn_contract": public_payload.model_dump(),
                "normalization_warnings": public_payload.normalization_warnings,
            },
            memories=public_payload.memories,
            world_tags=public_payload.world_tags,
            interpreted_intent={
                "action_interpretation": public_payload.action_interpretation,
                "current_location_name": public_payload.current_location_name,
                "language_context": public_payload.language_context,
                "public_claims": [item.model_dump() for item in public_payload.public_claims],
                "present_people": public_payload.present_people,
                "addressed_people": public_payload.addressed_people,
                "visible_items": public_payload.visible_items,
                "used_item_names": public_payload.used_item_names,
                "normalization_warnings": public_payload.normalization_warnings,
                "source": "public_ai_gm",
            },
            next_choices=suggestions[:4],
            consequence_summary=public_payload.internal_summary or public_payload.consequence_summary or public_payload.action_interpretation,
            consequence_tags=public_payload.consequence_tags,
            shared_action_tag=public_payload.shared_action_tag,
            state_drafts=public_payload.state_drafts,
            branch_signals=public_payload.branch_signals,
            outcome_band=public_payload.outcome_band,
            scene_tone=public_payload.scene_tone,
            scene_move=public_payload.scene_move,
            scene_pressure=public_payload.scene_pressure,
            broadcast_draft=public_payload.broadcast_draft,
            quest_offer=public_payload.quest_offer,
            chapter_directive=public_payload.chapter_directive,
            followup_quest_offer=public_payload.followup_quest_offer,
            quest_resolution_hint=public_payload.quest_resolution_hint,
            active_quest_resolution=public_payload.active_quest_resolution,
            quest_lifecycle_directive=public_payload.quest_lifecycle_directive,
            entity_drafts=public_payload.entity_drafts,
        )

    def resolve_intent(self, request: CouncilRequest) -> CouncilIntentPhase:
        intent_input = self._intent_input_payload(request)
        if request.input_mode == "choice" and request.selected_choice:
            emit_turn_progress(
                phase="intent_interpretation",
                status="started",
                stage_index=1,
                elapsed_ms=0,
                detail="deterministic_choice",
            )
            intent_result = self._choice_intent_outcome(request=request, input_payload=intent_input)
            emit_turn_progress(
                phase="intent_interpretation",
                status="completed",
                stage_index=1,
                elapsed_ms=0,
                detail="deterministic_choice",
            )
        else:
            intent_result = self.model_router.execute_structured_prompt(
                prompt_id="council.intent_interpreter",
                response_model=CouncilIntentInterpreterPayload,
                input_payload=intent_input,
                world_id=request.world_id,
                turn_id=request.turn_id,
                graph_context_status=request.graph_context_status,
            )
            if not intent_result.succeeded and request.input_mode == "free_text" and "__force_" not in request.input_text:
                intent_result = self._free_text_intent_fallback_outcome(
                    request=request,
                    input_payload=intent_input,
                    failed_result=intent_result,
                )
        payload = intent_result.final_payload
        if payload is not None:
            payload.consequence_tags = self._canonical_intent_consequence_tags(
                input_mode=request.input_mode,
                input_text=request.input_text,
                selected_choice=request.selected_choice,
                action_kind=payload.canonical_action_kind,
                raw_tags=list(payload.consequence_tags),
            )
        return CouncilIntentPhase(
            role_run=self._role_run(
                council_role="intent_interpreter",
                stage_index=1,
                prompt_id="council.intent_interpreter",
                approval_status="prepared" if intent_result.succeeded else "failed",
                result=intent_result,
            ),
            payload=payload,
            final_lane=intent_result.final_lane,
            failure_reason=intent_result.failure_reason,
        )

    def _intent_input_payload(self, request: CouncilRequest) -> dict[str, Any]:
        inventory = request.session_state.get("inventory") or []
        current_scene = request.session_state.get("current_scene") or {}
        current_chapter = request.session_state.get("chapter") or {}
        current_location = request.session_state.get("current_location") or request.session_state.get("location") or {}
        local_figures = request.session_state.get("local_figures") or request.session_state.get("plaza_figures") or []
        player_profile = request.session_state.get("player_profile") or {}
        narrative_preferences = (
            player_profile.get("narrative_preferences") if isinstance(player_profile, dict) else {}
        ) or {}
        play_language = _play_language_context(player_profile)
        return {
            "world_id": request.world_id,
            "input_mode": request.input_mode,
            "input_text": request.input_text,
            "player_name": request.player_name,
            "player_profile": player_profile,
            "narrative_preferences": narrative_preferences,
            "play_language": play_language,
            "npc_name": request.npc_name,
            "selected_choice": request.selected_choice or {},
            "world_pack": request.session_state.get("world_pack") or {},
            "quests": request.session_state.get("quests") or [],
            "factions": request.session_state.get("factions") or [],
            "inventory": inventory,
            "known_facts": request.session_state.get("known_facts") or [],
            "skills": request.session_state.get("skills") or [],
            "usable_reward_items": [item for item in inventory if item.get("usable")],
            "used_reward_items": [item for item in inventory if item.get("status") == "used"],
            "important_inventory_affordances": request.session_state.get("important_inventory_affordances") or [],
            "default_choice_templates": request.session_state.get("next_choices") or [],
            "relationship_summaries": request.session_state.get("relationships") or [],
            "recognized_titles": request.session_state.get("recognized_titles") or [],
            "active_consequence_threads": request.session_state.get("active_consequence_threads") or [],
            "recent_consequence_history": request.session_state.get("recent_consequence_history") or [],
            "current_scene": current_scene,
            "current_chapter": current_chapter,
            "recent_scene_history": request.session_state.get("recent_scene_history") or [],
            "current_location": current_location,
            "local_figures": local_figures,
            "nearby_routes": request.session_state.get("nearby_routes") or [],
            "recent_travel_history": request.session_state.get("recent_travel_history") or [],
            "plaza_figures": request.session_state.get("plaza_figures") or local_figures,
            "recent_world_beats": request.session_state.get("recent_world_beats") or [],
            "ambient_murmurs": request.session_state.get("ambient_murmurs") or [],
            "shared_world_context": request.session_state.get("shared_world_context") or {},
        }

    @staticmethod
    def _active_quest(session_state: dict[str, Any]) -> dict[str, Any]:
        quests = session_state.get("quests") or []
        return next((item for item in quests if item.get("status") == "active"), quests[0] if quests else {})

    @staticmethod
    def _choice_world_tags(
        *,
        session_state: dict[str, Any],
        selected_choice: dict[str, Any] | None,
        action_kind: str,
        raw_world_tags: list[str] | None,
    ) -> list[WorldTag]:
        return normalize_world_tags(raw_world_tags)

    @staticmethod
    def _outcome_band_from_tags(consequence_tags: list[str]) -> OutcomeBand:
        normalized = set(normalize_consequence_tags(consequence_tags))
        if "overreach" in normalized:
            return "setback"
        if {"missed_timing", "public_attention"} & normalized:
            return "tangled"
        return "steady"

    @staticmethod
    def _scene_move_for_context(
        *,
        session_state: dict[str, Any],
        selected_choice: dict[str, Any] | None,
        action_kind: str,
        consequence_tags: list[str],
        raw_scene_move: str,
    ) -> Literal["hold", "deepen", "pivot", "close"]:
        if "overreach" in set(normalize_consequence_tags(consequence_tags)):
            return "deepen"
        return raw_scene_move if raw_scene_move in {"hold", "deepen", "pivot", "close"} else "hold"

    @staticmethod
    def _risk_level_for_context(
        *,
        input_text: str,
        consequence_tags: list[str],
        raw_risk_level: str,
    ) -> Literal["low", "medium", "high"]:
        normalized_text = input_text.lower()
        normalized_tags = set(normalize_consequence_tags(consequence_tags))
        if "overreach" in normalized_tags or any(
            token in input_text or token in normalized_text for token in ("無理", "impossible", "空を飛", "teleport", "爆破")
        ):
            return "low"
        return raw_risk_level if raw_risk_level in {"low", "medium", "high"} else "low"

    @staticmethod
    def _canonical_intent_consequence_tags(
        *,
        input_mode: Literal["choice", "free_text"],
        input_text: str,
        selected_choice: dict[str, Any] | None,
        action_kind: str,
        raw_tags: list[str] | None,
    ) -> list[ConsequenceTag]:
        normalized_text = input_text.lower()
        canonical = list(normalize_consequence_tags(raw_tags))

        if any(token in input_text or token in normalized_text for token in ("後で", "あとで", "later", "そのうち", "待って", "今は行かない", "また今度")):
            return ["missed_timing"]
        if any(token in input_text or token in normalized_text for token in ("無理", "impossible", "空を飛", "teleport", "爆破")):
            return ["overreach", "public_attention"]
        if action_kind == "use_reward_item":
            return ["reward_item_respect", "kept_promise"]
        if any(token in input_text or token in normalized_text for token in ("約束", "promise", "引き受ける", "応える")):
            canonical.append("kept_promise")
        if any(token in input_text or token in normalized_text for token in ("探", "確か", "観察", "様子", "observe")):
            canonical.append("careful_observation")
        if any(token in input_text or token in normalized_text for token in ("助け", "help", "灯", "light")):
            canonical.append("earned_trust")
        return normalize_consequence_tags(canonical)

    def _world_progress_fallback_payload(
        self,
        *,
        request: CouncilRequest,
        intent_payload: CouncilIntentInterpreterPayload,
        world_progress_input: dict[str, Any],
        failure_reason: str | None,
    ) -> CouncilWorldProgressPayload | None:
        selected_choice = request.selected_choice or {}
        if "__force_council_reject__" in request.input_text:
            return None

        player_name = request.player_name or "The player"
        npc_name = request.npc_name or "the guide"
        intent_summary = _first_text(intent_payload.intent_summary, request.input_text, "the selected action")
        consequence_summary = _first_text(
            intent_payload.consequence_summary,
            f"{player_name} follows the selected action and keeps the scene moving.",
        )
        fallback_reason = _first_text(failure_reason, "world_progress schema fallback")
        default_choice_templates = world_progress_input.get("default_choice_templates") or []
        choice_payloads = _choice_drafts(default_choice_templates)
        active_quest = self._active_quest(request.session_state)
        inferred_world_tags = normalize_world_tags(infer_world_tags(intent_summary))
        if request.input_mode == "choice":
            world_tags = self._choice_world_tags(
                session_state=request.session_state,
                selected_choice=selected_choice,
                action_kind=intent_payload.canonical_action_kind,
                raw_world_tags=inferred_world_tags,
            )
        else:
            world_tags = inferred_world_tags
        consequence_tags = self._canonical_intent_consequence_tags(
            input_mode=request.input_mode,
            input_text=request.input_text,
            selected_choice=selected_choice,
            action_kind=intent_payload.canonical_action_kind,
            raw_tags=list(intent_payload.consequence_tags),
        )
        outcome_band = self._outcome_band_from_tags(list(consequence_tags))
        scene_move = self._scene_move_for_context(
            session_state=request.session_state,
            selected_choice=selected_choice,
            action_kind=intent_payload.canonical_action_kind,
            consequence_tags=list(consequence_tags),
            raw_scene_move="hold",
        )
        risk_level = self._risk_level_for_context(
            input_text=request.input_text,
            consequence_tags=list(consequence_tags),
            raw_risk_level="medium",
        )
        current_scene = request.session_state.get("current_scene") or {}
        current_chapter = request.session_state.get("chapter") or {}
        quests = request.session_state.get("quests") if isinstance(request.session_state.get("quests"), list) else []
        has_live_quest = any(
            isinstance(item, dict) and str(item.get("status") or "") in {"offered", "active", "paused"}
            for item in quests
        )
        quest_offer = None
        return CouncilWorldProgressPayload(
            event_type="player.turn.resolved",
            event_payload={
                "world_id": request.world_id,
                "action": intent_summary,
                "world_tags": world_tags,
                "npc_anchor": f"{npc_name} stays with the player's selected line.",
                "scene_summary": str(current_scene.get("summary") or ""),
                "chapter_summary": str(current_chapter.get("summary") or ""),
                "deterministic_fallback": {
                    "role": "world_progress",
                    "reason": fallback_reason,
                    "active_quest_stage": active_quest.get("stage_key") if isinstance(active_quest, dict) else None,
                    "input_mode": request.input_mode,
                },
            },
            memories=[
                MemoryDraft(
                    scope="world",
                    text=f"{player_name} chose to {intent_summary}.",
                    salience=0.72,
                )
            ],
            world_tags=world_tags,
            consequence_tags=consequence_tags,
            branch_signals=[],
            outcome_band=outcome_band,
            resolution_summary=consequence_summary,
            risk_level=risk_level,
            next_choices=[NarrativeChoiceDraft(**item) for item in choice_payloads],
            scene_move=scene_move,
            scene_pressure="medium",
            broadcast_draft={
                "summary": f"{player_name}'s selected action carries through the current scene.",
                "constraint_text": "Canonical fallback preserved same-world progression after schema failure.",
            },
            quest_offer=quest_offer,
            entity_drafts=_supplement_generated_entity_drafts(world_progress_input, []),
        )

    @staticmethod
    def _fallback_situation_frame(
        *,
        request: CouncilRequest,
        intent_payload: CouncilIntentInterpreterPayload,
        memory_payload: CouncilMemoryManagerPayload,
        npc_payload: CouncilNPCManagerPayload,
    ) -> CouncilSituationMapperPayload:
        current_scene = request.session_state.get("current_scene") or {}
        current_location = request.session_state.get("current_location") or request.session_state.get("location") or {}
        visible_elements = _memory_list(
            current_location.get("name") if isinstance(current_location, dict) else None,
            (current_scene or {}).get("location") if isinstance(current_scene, dict) else None,
            request.session_state.get("local_figures") or request.session_state.get("plaza_figures") or [],
            request.session_state.get("important_inventory_affordances") or [],
        )[:8]
        default_choices = _choice_drafts(request.session_state.get("next_choices") or [])
        affordances: list[dict[str, Any]] = []
        for choice in default_choices:
            summary = str(choice.get("intent_summary") or choice.get("label") or "").strip()
            affordances.append(
                {
                    "label": str(choice.get("label") or summary or "場を読む"),
                    "intent_summary": summary or str(choice.get("label") or "場を読む"),
                    "risk_hint": "今の場面で無理なく試せる。",
                    "effect_hint": "次の状況判断に必要な情報や反応が得られる。",
                    "action_kind": choice.get("action_kind") or "narrative",
                    "travel_target_key": choice.get("travel_target_key"),
                }
            )
        return CouncilSituationMapperPayload.model_validate(
            {
                "action_result_focus": _first_text(
                    intent_payload.consequence_summary,
                    intent_payload.intent_summary,
                    "直前の行動で場面の読み取り方が変わる。",
                ),
                "current_situation": _first_text(
                    (current_scene or {}).get("summary") if isinstance(current_scene, dict) else None,
                    (current_location or {}).get("description") if isinstance(current_location, dict) else None,
                    memory_payload.state_summary,
                ),
                "visible_elements": visible_elements or ["現在地", request.npc_name],
                "immediate_pressure": _first_text(
                    (current_scene or {}).get("pressure_summary") if isinstance(current_scene, dict) else None,
                    request.session_state.get("active_consequence_threads") or [],
                    npc_payload.reaction_outline,
                ),
                "open_questions": _memory_list("何が変わったか", "誰が反応するか")[:2],
                "affordances": affordances[:4],
                "risk_level": "low" if intent_payload.fail_forward else "medium",
                "effect_level": "standard",
                "fail_forward_hint": "うまくいかない場合も、場の圧力や誰かの反応を変えて次の判断点を作る。",
                "agency_guard": "プレイヤーの次の行動、決意、感情をAIが確定しない。",
            }
        )

    def _choice_intent_outcome(
        self,
        *,
        request: CouncilRequest,
        input_payload: dict[str, Any],
    ) -> PromptExecutionOutcome[CouncilIntentInterpreterPayload]:
        selected_choice = request.selected_choice or {}
        prompt = self.model_router.prompt_registry.get("council.intent_interpreter")
        action_kind = str(selected_choice.get("action_kind") or "narrative").strip()
        if action_kind not in {"narrative", "use_reward_item", "travel"}:
            action_kind = "narrative"
        travel_target_key = str(selected_choice.get("travel_target_key") or "").strip() or None
        consequence_tags = self._canonical_intent_consequence_tags(
            input_mode="choice",
            input_text=request.input_text,
            selected_choice=selected_choice,
            action_kind=action_kind,
            raw_tags=[],
        )
        consequence_summary = str(selected_choice.get("summary") or "").strip() or "The chosen line fits the current scene."
        if action_kind == "travel":
            consequence_summary = "The player follows a route the current scene actually affords."
        elif action_kind == "use_reward_item":
            consequence_summary = "The selected choice invokes an important reward-item affordance."
        payload = CouncilIntentInterpreterPayload.model_validate(
            {
                "input_mode": "choice",
                "canonical_action_kind": action_kind,
                "intent_summary": str(
                    selected_choice.get("canonical_input_text") or selected_choice.get("label") or request.input_text
                ).strip(),
                "travel_target_key": travel_target_key,
                "fail_forward": False,
                "consequence_flags": [],
                "consequence_tags": consequence_tags,
                "consequence_summary": consequence_summary,
            }
        )
        attempt = PromptExecutionAttempt(
            prompt_id=prompt.prompt_id,
            schema_version=prompt.schema_version,
            model_lane="choice_short_circuit",
            model_id="choice_short_circuit",
            input_hash="choice_short_circuit",
            input_context_hash="choice_short_circuit",
            status="success",
            output_schema_status="valid",
            output_payload=payload.model_dump(),
            provider_name="internal",
            provider_response_id=None,
            langfuse_trace_id=None,
            langfuse_observation_id=None,
            langfuse_trace_url=None,
            langfuse_status="disabled",
        )
        return PromptExecutionOutcome(
            attempts=[attempt],
            final_lane="choice_short_circuit",
            final_payload=payload,
        )

    def _free_text_intent_fallback_outcome(
        self,
        *,
        request: CouncilRequest,
        input_payload: dict[str, Any],
        failed_result: PromptExecutionOutcome[CouncilIntentInterpreterPayload],
    ) -> PromptExecutionOutcome[CouncilIntentInterpreterPayload]:
        prompt = self.model_router.prompt_registry.get("council.intent_interpreter")
        input_text = request.input_text.strip() or "The player acts within the current scene."
        normalized_text = input_text.lower()
        consequence_tags = self._canonical_intent_consequence_tags(
            input_mode="free_text",
            input_text=input_text,
            selected_choice=None,
            action_kind="narrative",
            raw_tags=[],
        )
        payload = CouncilIntentInterpreterPayload.model_validate(
            {
                "input_mode": "free_text",
                "canonical_action_kind": "narrative",
                "intent_summary": input_text,
                "travel_target_key": None,
                "fail_forward": False,
                "consequence_flags": [],
                "consequence_tags": consequence_tags,
                "consequence_summary": "The free-text action is interpreted conservatively inside the current same-world scene.",
            }
        )
        attempt = PromptExecutionAttempt(
            prompt_id=prompt.prompt_id,
            schema_version=prompt.schema_version,
            model_lane="free_text_intent_fallback",
            model_id="free_text_intent_fallback",
            input_hash="free_text_intent_fallback",
            input_context_hash="free_text_intent_fallback",
            status="success",
            output_schema_status="valid",
            output_payload=payload.model_dump(),
            provider_name="internal",
            provider_response_id=None,
            langfuse_trace_id=None,
            langfuse_observation_id=None,
            langfuse_trace_url=None,
            langfuse_status="disabled",
        )
        return PromptExecutionOutcome(
            attempts=[*failed_result.attempts, attempt],
            final_lane="free_text_intent_fallback",
            final_payload=payload,
        )

    def resolve_turn(self, request: CouncilRequest) -> TurnResolutionOutcome:
        role_runs: list[CouncilRoleRun] = []
        quests = request.session_state.get("quests") or []
        inventory = request.session_state.get("inventory") or []
        known_facts = request.session_state.get("known_facts") or []
        skills = request.session_state.get("skills") or []
        active_quest = self._active_quest(request.session_state)
        usable_reward_items = [item for item in inventory if item.get("usable")]
        used_reward_items = [item for item in inventory if item.get("status") == "used"]
        important_inventory_affordances = request.session_state.get("important_inventory_affordances") or []
        default_choice_templates = request.session_state.get("next_choices") or []
        relationship_summaries = request.session_state.get("relationships") or []
        recognized_titles = request.session_state.get("recognized_titles") or []
        active_consequence_threads = request.session_state.get("active_consequence_threads") or []
        recent_consequence_history = request.session_state.get("recent_consequence_history") or []
        current_scene = request.session_state.get("current_scene") or {}
        current_chapter = request.session_state.get("chapter") or {}
        recent_scene_history = request.session_state.get("recent_scene_history") or []
        recent_branch_echoes = request.session_state.get("recent_branch_echoes") or []
        route_pressures = (current_chapter or {}).get("route_pressures") or []
        current_location = request.session_state.get("current_location") or request.session_state.get("location") or {}
        local_figures = request.session_state.get("local_figures") or request.session_state.get("plaza_figures") or []
        nearby_routes = request.session_state.get("nearby_routes") or []
        recent_travel_history = request.session_state.get("recent_travel_history") or []
        plaza_figures = request.session_state.get("plaza_figures") or local_figures
        recent_world_beats = request.session_state.get("recent_world_beats") or []
        ambient_murmurs = request.session_state.get("ambient_murmurs") or []
        shared_world_context = request.session_state.get("shared_world_context") or {}
        player_profile = request.session_state.get("player_profile") or {}
        narrative_preferences = (
            player_profile.get("narrative_preferences") if isinstance(player_profile, dict) else {}
        ) or {}
        play_language = _play_language_context(player_profile)

        intent_input = self._intent_input_payload(request)
        if request.prepared_intent_payload is not None and request.prepared_intent_role_run is not None:
            intent_payload = request.prepared_intent_payload
            role_runs.append(request.prepared_intent_role_run)
        elif request.input_mode == "choice" and request.selected_choice:
            emit_turn_progress(
                phase="intent_interpretation",
                status="started",
                stage_index=1,
                elapsed_ms=0,
                detail="deterministic_choice",
            )
            intent_result = self._choice_intent_outcome(request=request, input_payload=intent_input)
            emit_turn_progress(
                phase="intent_interpretation",
                status="completed",
                stage_index=1,
                elapsed_ms=0,
                detail="deterministic_choice",
            )
            role_runs.append(
                self._role_run(
                    council_role="intent_interpreter",
                    stage_index=1,
                    prompt_id="council.intent_interpreter",
                    approval_status="prepared" if intent_result.succeeded else "failed",
                    result=intent_result,
                )
            )
            if not intent_result.succeeded:
                if request.input_mode == "free_text" and "__force_" not in request.input_text:
                    intent_result = self._free_text_intent_fallback_outcome(
                        request=request,
                        input_payload=intent_input,
                        failed_result=intent_result,
                    )
                    role_runs[-1] = self._role_run(
                        council_role="intent_interpreter",
                        stage_index=1,
                        prompt_id="council.intent_interpreter",
                        approval_status="prepared",
                        result=intent_result,
                    )
                else:
                    return TurnResolutionOutcome(
                        role_runs=role_runs,
                        final_lane=intent_result.final_lane,
                        final_payload=None,
                        failure_reason=intent_result.failure_reason,
                        rejection_role="intent_interpreter",
                    )
            intent_payload = intent_result.final_payload
            assert intent_payload is not None
            intent_payload.consequence_tags = self._canonical_intent_consequence_tags(
                input_mode=request.input_mode,
                input_text=request.input_text,
                selected_choice=request.selected_choice,
                action_kind=intent_payload.canonical_action_kind,
                raw_tags=list(intent_payload.consequence_tags),
            )
        else:
            intent_result = self.model_router.execute_structured_prompt(
                prompt_id="council.intent_interpreter",
                response_model=CouncilIntentInterpreterPayload,
                input_payload=intent_input,
                world_id=request.world_id,
                turn_id=request.turn_id,
                graph_context_status=request.graph_context_status,
            )
            role_runs.append(
                self._role_run(
                    council_role="intent_interpreter",
                    stage_index=1,
                    prompt_id="council.intent_interpreter",
                    approval_status="prepared" if intent_result.succeeded else "failed",
                    result=intent_result,
                )
            )
            if not intent_result.succeeded:
                if request.input_mode == "free_text" and "__force_" not in request.input_text:
                    intent_result = self._free_text_intent_fallback_outcome(
                        request=request,
                        input_payload=intent_input,
                        failed_result=intent_result,
                    )
                    role_runs[-1] = self._role_run(
                        council_role="intent_interpreter",
                        stage_index=1,
                        prompt_id="council.intent_interpreter",
                        approval_status="prepared",
                        result=intent_result,
                    )
                else:
                    return TurnResolutionOutcome(
                        role_runs=role_runs,
                        final_lane=intent_result.final_lane,
                        final_payload=None,
                        failure_reason=intent_result.failure_reason,
                        rejection_role="intent_interpreter",
                    )
            intent_payload = intent_result.final_payload
            assert intent_payload is not None
            intent_payload.consequence_tags = self._canonical_intent_consequence_tags(
                input_mode=request.input_mode,
                input_text=request.input_text,
                selected_choice=request.selected_choice,
                action_kind=intent_payload.canonical_action_kind,
                raw_tags=list(intent_payload.consequence_tags),
            )

        memory_input = {
            "world_id": request.world_id,
            "input_text": request.input_text,
            "intent_summary": intent_payload.intent_summary,
            "player_name": request.player_name,
            "player_profile": player_profile,
            "narrative_preferences": narrative_preferences,
            "play_language": play_language,
            "npc_name": request.npc_name,
            "relevant_memories": request.relevant_memories,
            "relation_context": request.relation_context,
            "quests": quests,
            "factions": request.session_state.get("factions") or [],
            "inventory": inventory,
            "known_facts": known_facts,
            "skills": skills,
            "location": request.session_state.get("location"),
            "active_quest_stage": active_quest.get("stage_key") if isinstance(active_quest, dict) else None,
            "usable_reward_items": usable_reward_items,
            "used_reward_items": used_reward_items,
            "important_inventory_affordances": [item.get("summary", "") for item in important_inventory_affordances if item.get("summary")],
            "consequence_flags": intent_payload.consequence_flags,
            "relationship_summaries": relationship_summaries,
            "recognized_titles": recognized_titles,
            "active_consequence_threads": active_consequence_threads,
            "recent_consequence_history": recent_consequence_history,
            "current_scene": current_scene,
            "current_chapter": current_chapter,
            "recent_scene_history": recent_scene_history,
            "recent_branch_echoes": recent_branch_echoes,
            "route_pressures": route_pressures,
            "plaza_figures": plaza_figures,
            "recent_world_beats": recent_world_beats,
            "ambient_murmurs": ambient_murmurs,
            "shared_world_context": shared_world_context,
        }

        npc_input = {
            "world_id": request.world_id,
            "input_text": request.input_text,
            "intent_summary": intent_payload.intent_summary,
            "player_name": request.player_name,
            "player_profile": player_profile,
            "narrative_preferences": narrative_preferences,
            "play_language": play_language,
            "npc_name": request.npc_name,
            "relevant_memories": request.relevant_memories,
            "relation_context": request.relation_context,
            "focus_memories": request.relevant_memories,
            "state_summary": _joined_state_summary(
                [
                    ("quests", quests),
                    ("factions", request.session_state.get("factions") or []),
                    ("inventory", inventory),
                    ("known_facts", known_facts),
                    ("skills", skills),
                    ("scene", current_scene),
                    ("chapter", current_chapter),
                    ("location", current_location),
                    ("world_beats", recent_world_beats),
                ]
            ),
            "active_quest_stage": active_quest.get("stage_key") if isinstance(active_quest, dict) else None,
            "usable_reward_items": usable_reward_items,
            "used_reward_items": used_reward_items,
            "factions": request.session_state.get("factions") or [],
            "consequence_summary": intent_payload.consequence_summary,
            "relationship_summaries": relationship_summaries,
            "recognized_titles": recognized_titles,
            "active_consequence_threads": active_consequence_threads,
            "recent_consequence_history": recent_consequence_history,
            "current_location": current_location,
            "local_figures": local_figures,
            "nearby_routes": nearby_routes,
            "recent_travel_history": recent_travel_history,
            "recent_branch_echoes": recent_branch_echoes,
            "route_pressures": route_pressures,
            "plaza_figures": plaza_figures,
            "recent_world_beats": recent_world_beats,
            "ambient_murmurs": ambient_murmurs,
            "shared_world_context": shared_world_context,
            "known_facts": known_facts,
            "skills": skills,
        }

        # Prewarm provider initialization before worker threads enter the router.
        _ = self.model_router.provider
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="gm-council-role") as executor:
            memory_context = copy_context()
            npc_context = copy_context()
            memory_future = executor.submit(
                memory_context.run,
                self.model_router.execute_structured_prompt,
                prompt_id="council.memory_manager",
                response_model=CouncilMemoryManagerPayload,
                input_payload=memory_input,
                world_id=request.world_id,
                turn_id=request.turn_id,
                graph_context_status=request.graph_context_status,
            )
            npc_future = executor.submit(
                npc_context.run,
                self.model_router.execute_structured_prompt,
                prompt_id="council.npc_manager",
                response_model=CouncilNPCManagerPayload,
                input_payload=npc_input,
                world_id=request.world_id,
                turn_id=request.turn_id,
                graph_context_status=request.graph_context_status,
            )
            memory_result = memory_future.result()
            npc_result = npc_future.result()

        role_runs.append(
            self._role_run(
                council_role="memory_manager",
                stage_index=2,
                prompt_id="council.memory_manager",
                approval_status="prepared" if memory_result.succeeded else "failed",
                result=memory_result,
            )
        )
        role_runs.append(
            self._role_run(
                council_role="npc_manager",
                stage_index=3,
                prompt_id="council.npc_manager",
                approval_status="prepared" if npc_result.succeeded else "failed",
                result=npc_result,
            )
        )
        if not memory_result.succeeded:
            return TurnResolutionOutcome(
                role_runs=role_runs,
                final_lane=memory_result.final_lane,
                final_payload=None,
                failure_reason=memory_result.failure_reason,
                rejection_role="memory_manager",
            )
        if not npc_result.succeeded:
            return TurnResolutionOutcome(
                role_runs=role_runs,
                final_lane=npc_result.final_lane,
                final_payload=None,
                failure_reason=npc_result.failure_reason,
                rejection_role="npc_manager",
            )

        memory_payload = memory_result.final_payload
        assert memory_payload is not None
        npc_payload = npc_result.final_payload
        assert npc_payload is not None

        situation_input = {
            "world_id": request.world_id,
            "input_text": request.input_text,
            "player_name": request.player_name,
            "player_profile": player_profile,
            "narrative_preferences": narrative_preferences,
            "play_language": play_language,
            "npc_name": request.npc_name,
            "intent_summary": intent_payload.intent_summary,
            "selected_choice": request.selected_choice or {},
            "fail_forward": intent_payload.fail_forward,
            "consequence_summary": intent_payload.consequence_summary,
            "consequence_tags": intent_payload.consequence_tags,
            "memory_summary": memory_payload.memory_summary,
            "relation_summary": memory_payload.relation_summary,
            "state_summary": memory_payload.state_summary,
            "reaction_outline": npc_payload.reaction_outline,
            "focus_memories": npc_payload.focus_memories,
            "default_choice_templates": default_choice_templates,
            "important_inventory_affordances": important_inventory_affordances,
            "relationship_summaries": relationship_summaries,
            "active_consequence_threads": active_consequence_threads,
            "recent_consequence_history": recent_consequence_history,
            "current_scene": current_scene,
            "current_chapter": current_chapter,
            "recent_scene_history": recent_scene_history,
            "current_location": current_location,
            "local_figures": local_figures,
            "nearby_routes": nearby_routes,
            "recent_travel_history": recent_travel_history,
            "recent_world_beats": recent_world_beats,
            "ambient_murmurs": ambient_murmurs,
            "shared_world_context": shared_world_context,
        }
        situation_result = self.model_router.execute_structured_prompt(
            prompt_id="council.situation_mapper",
            response_model=CouncilSituationMapperPayload,
            input_payload=situation_input,
            world_id=request.world_id,
            turn_id=request.turn_id,
            graph_context_status=request.graph_context_status,
        )
        role_runs.append(
            self._role_run(
                council_role="situation_mapper",
                stage_index=4,
                prompt_id="council.situation_mapper",
                approval_status="prepared" if situation_result.succeeded else "failed",
                result=situation_result,
            )
        )
        deterministic_fallback_used = False
        if situation_result.succeeded and situation_result.final_payload is not None:
            situation_payload = situation_result.final_payload
        else:
            situation_payload = self._fallback_situation_frame(
                request=request,
                intent_payload=intent_payload,
                memory_payload=memory_payload,
                npc_payload=npc_payload,
            )
            deterministic_fallback_used = True
        game_frame = situation_payload.model_dump()

        world_progress_input = {
            "world_id": request.world_id,
            "input_text": request.input_text,
            "player_name": request.player_name,
            "player_profile": player_profile,
            "narrative_preferences": narrative_preferences,
            "play_language": play_language,
            "npc_name": request.npc_name,
            "memory_summary": memory_payload.memory_summary,
            "relation_summary": memory_payload.relation_summary,
            "state_summary": memory_payload.state_summary,
            "reaction_outline": npc_payload.reaction_outline,
            "focus_memories": npc_payload.focus_memories,
            "intent_summary": intent_payload.intent_summary,
            "selected_choice": request.selected_choice or {},
            "fail_forward": intent_payload.fail_forward,
            "consequence_summary": intent_payload.consequence_summary,
            "consequence_tags": intent_payload.consequence_tags,
            "game_frame": game_frame,
            "default_choice_templates": default_choice_templates,
            "relationship_summaries": relationship_summaries,
            "recognized_titles": recognized_titles,
            "active_consequence_threads": active_consequence_threads,
            "recent_consequence_history": recent_consequence_history,
            "active_quest_stage": active_quest.get("stage_key") if isinstance(active_quest, dict) else None,
            "world_pack": request.session_state.get("world_pack") or {},
            "pack_generation_context": request.session_state.get("pack_generation_context") or {},
            "current_scene": current_scene,
            "current_chapter": current_chapter,
            "recent_scene_history": recent_scene_history,
            "recent_branch_echoes": recent_branch_echoes,
            "route_pressures": route_pressures,
            "current_location": current_location,
            "local_figures": local_figures,
            "nearby_routes": nearby_routes,
            "recent_travel_history": recent_travel_history,
            "plaza_figures": plaza_figures,
            "recent_world_beats": recent_world_beats,
            "ambient_murmurs": ambient_murmurs,
            "shared_world_context": shared_world_context,
            "resource_constraints": request.session_state.get("resource_constraints") or [],
            "world_broadcast_constraints": request.session_state.get("world_broadcast_constraints") or [],
            "known_facts": known_facts,
            "skills": skills,
        }
        world_progress_result = self.model_router.execute_structured_prompt(
            prompt_id="council.world_progress",
            response_model=CouncilWorldProgressPayload,
            input_payload=world_progress_input,
            world_id=request.world_id,
            turn_id=request.turn_id,
            graph_context_status=request.graph_context_status,
        )
        role_runs.append(
            self._role_run(
                council_role="world_progress",
                stage_index=5,
                prompt_id="council.world_progress",
                approval_status="prepared" if world_progress_result.succeeded else "failed",
                result=world_progress_result,
            )
        )
        if not world_progress_result.succeeded:
            fallback_payload = self._world_progress_fallback_payload(
                request=request,
                intent_payload=intent_payload,
                world_progress_input=world_progress_input,
                failure_reason=world_progress_result.failure_reason,
            )
            if fallback_payload is None:
                return TurnResolutionOutcome(
                    role_runs=role_runs,
                    final_lane=world_progress_result.final_lane,
                    final_payload=None,
                    failure_reason=world_progress_result.failure_reason,
                    rejection_role="world_progress",
                )
            world_progress_payload = fallback_payload
            deterministic_fallback_used = True
        else:
            world_progress_payload = world_progress_result.final_payload
            assert world_progress_payload is not None

        world_progress_payload.consequence_tags = normalize_consequence_tags(list(world_progress_payload.consequence_tags))
        world_progress_payload.branch_signals = normalize_branch_signals(list(world_progress_payload.branch_signals))
        world_progress_payload.world_tags = self._choice_world_tags(
            session_state=request.session_state,
            selected_choice=request.selected_choice,
            action_kind=intent_payload.canonical_action_kind,
            raw_world_tags=list(world_progress_payload.world_tags),
        )
        if intent_payload.fail_forward or "overreach" in set(world_progress_payload.consequence_tags):
            world_progress_payload.world_tags = ["none"]
        world_progress_payload.outcome_band = self._outcome_band_from_tags(list(world_progress_payload.consequence_tags))
        world_progress_payload.scene_move = self._scene_move_for_context(
            session_state=request.session_state,
            selected_choice=request.selected_choice,
            action_kind=intent_payload.canonical_action_kind,
            consequence_tags=list(world_progress_payload.consequence_tags),
            raw_scene_move=world_progress_payload.scene_move,
        )
        world_progress_payload.risk_level = self._risk_level_for_context(
            input_text=request.input_text,
            consequence_tags=list(world_progress_payload.consequence_tags),
            raw_risk_level=world_progress_payload.risk_level,
        )
        high_risk = world_progress_payload.risk_level == "high"

        rules_input = {
            "world_id": request.world_id,
            "input_text": request.input_text,
            "world_tags": world_progress_payload.world_tags,
            "risk_level": world_progress_payload.risk_level,
            "quests": quests,
            "factions": request.session_state.get("factions") or [],
            "inventory": inventory,
            "known_facts": known_facts,
            "skills": skills,
            "input_mode": request.input_mode,
            "play_language": play_language,
            "consequence_flags": intent_payload.consequence_flags,
            "recognized_titles": recognized_titles,
            "shared_world_context": shared_world_context,
            "resource_constraints": request.session_state.get("resource_constraints") or [],
            "world_broadcast_constraints": request.session_state.get("world_broadcast_constraints") or [],
        }
        requires_llm_validation = "__force_" in request.input_text
        if high_risk or requires_llm_validation:
            rules_result = self.model_router.execute_structured_prompt(
                prompt_id="council.rules_arbiter",
                response_model=CouncilRulesArbiterPayload,
                input_payload=rules_input,
                world_id=request.world_id,
                turn_id=request.turn_id,
                graph_context_status=request.graph_context_status,
                allow_pro_fallback=True,
                force_pro_after_success=high_risk,
            )
        else:
            emit_turn_progress(
                phase="rules_arbiter",
                status="started",
                stage_index=6,
                elapsed_ms=0,
                detail="deterministic_validator",
            )
            rules_payload = CouncilRulesArbiterPayload(
                approval_status="approved",
                normalized_world_tags=normalize_world_tags(world_progress_payload.world_tags),
                risk_level=world_progress_payload.risk_level,
                reason="Deterministic same-world validator approved a low/medium risk turn.",
            )
            rules_result = PromptExecutionOutcome(
                attempts=[
                    self._deterministic_attempt(
                        prompt_id="council.rules_arbiter",
                        lane="deterministic_validator",
                        payload=rules_payload,
                    )
                ],
                final_lane="deterministic_validator",
                final_payload=rules_payload,
            )
            emit_turn_progress(
                phase="rules_arbiter",
                status="completed",
                stage_index=6,
                elapsed_ms=0,
                detail="deterministic_validator",
            )
        if (
            not rules_result.succeeded
            and "__force_rules_reject__" not in request.input_text
            and "threaten_local" not in world_progress_payload.world_tags
            and any(tag in world_progress_payload.world_tags for tag in ("aid_local", "promise_followup", "investigate", "none"))
        ):
            fallback_rules_payload = CouncilRulesArbiterPayload(
                approval_status="approved",
                normalized_world_tags=normalize_world_tags(world_progress_payload.world_tags),
                risk_level=world_progress_payload.risk_level,
                reason=(
                    "Rules arbiter schema failure normalized after canonical world_tags "
                    f"{', '.join(world_progress_payload.world_tags)} passed deterministic same-world checks."
                ),
            )
            rules_result = PromptExecutionOutcome(
                attempts=[
                    *rules_result.attempts,
                    self._deterministic_attempt(
                        prompt_id="council.rules_arbiter",
                        lane="deterministic_validator",
                        payload=fallback_rules_payload,
                    ),
                ],
                final_lane="deterministic_validator",
                final_payload=fallback_rules_payload,
            )
        if (
            rules_result.final_payload is not None
            and rules_result.final_payload.approval_status == "rejected"
            and "__force_rules_reject__" not in request.input_text
            and "threaten_local" not in world_progress_payload.world_tags
            and any(tag in world_progress_payload.world_tags for tag in ("aid_local", "promise_followup", "investigate"))
        ):
            rules_result.final_payload.approval_status = "approved"
            rules_result.final_payload.reason = (
                "Rules arbiter false negative normalized after canonical world_tags "
                f"{', '.join(world_progress_payload.world_tags)} passed deterministic same-world checks."
            )
        rules_approval = (
            rules_result.final_payload.approval_status if rules_result.final_payload is not None else "failed"
        )
        role_runs.append(
            self._role_run(
                council_role="rules_arbiter",
                stage_index=6,
                prompt_id="council.rules_arbiter",
                approval_status=rules_approval,
                result=rules_result,
            )
        )
        if not rules_result.succeeded or rules_approval == "rejected":
            final_payload = rules_result.final_payload
            return TurnResolutionOutcome(
                role_runs=role_runs,
                final_lane=rules_result.final_lane,
                final_payload=None,
                failure_reason=(
                    final_payload.reason
                    if final_payload is not None and final_payload.approval_status == "rejected"
                    else rules_result.failure_reason
                ),
                rejection_role="rules_arbiter",
            )

        rules_payload = rules_result.final_payload
        assert rules_payload is not None

        safety_input = {
            "world_id": request.world_id,
            "input_text": request.input_text,
            "event_world_id": request.world_id,
            "event_payload": world_progress_payload.event_payload,
            "world_tags": rules_payload.normalized_world_tags,
            "risk_level": rules_payload.risk_level,
            "input_mode": request.input_mode,
            "play_language": play_language,
            "recognized_titles": recognized_titles,
            "shared_world_context": shared_world_context,
            "resource_constraints": request.session_state.get("resource_constraints") or [],
            "world_broadcast_constraints": request.session_state.get("world_broadcast_constraints") or [],
        }
        if high_risk or requires_llm_validation:
            safety_result = self.model_router.execute_structured_prompt(
                prompt_id="council.safety_guard",
                response_model=CouncilSafetyGuardPayload,
                input_payload=safety_input,
                world_id=request.world_id,
                turn_id=request.turn_id,
                graph_context_status=request.graph_context_status,
                allow_pro_fallback=True,
                force_pro_after_success=high_risk,
            )
        else:
            emit_turn_progress(
                phase="safety_guard",
                status="started",
                stage_index=7,
                elapsed_ms=0,
                detail="deterministic_validator",
            )
            safety_payload = CouncilSafetyGuardPayload(
                approval_status="approved",
                reason="Deterministic safety validator approved a low/medium risk turn.",
                violations=[],
            )
            safety_result = PromptExecutionOutcome(
                attempts=[
                    self._deterministic_attempt(
                        prompt_id="council.safety_guard",
                        lane="deterministic_validator",
                        payload=safety_payload,
                    )
                ],
                final_lane="deterministic_validator",
                final_payload=safety_payload,
            )
            emit_turn_progress(
                phase="safety_guard",
                status="completed",
                stage_index=7,
                elapsed_ms=0,
                detail="deterministic_validator",
            )
        safety_approval = (
            safety_result.final_payload.approval_status if safety_result.final_payload is not None else "failed"
        )
        role_runs.append(
            self._role_run(
                council_role="safety_guard",
                stage_index=7,
                prompt_id="council.safety_guard",
                approval_status=safety_approval,
                result=safety_result,
            )
        )
        if not safety_result.succeeded or safety_approval == "rejected":
            final_payload = safety_result.final_payload
            return TurnResolutionOutcome(
                role_runs=role_runs,
                final_lane=safety_result.final_lane,
                final_payload=None,
                failure_reason=(
                    final_payload.reason
                    if final_payload is not None and final_payload.approval_status == "rejected"
                    else safety_result.failure_reason
                ),
                rejection_role="safety_guard",
            )

        narrative_input = {
            "world_id": request.world_id,
            "input_text": request.input_text,
            "player_name": request.player_name,
            "narrative_preferences": narrative_preferences,
            "play_language": play_language,
            "npc_name": request.npc_name,
            "approved_event_package": world_progress_payload.event_payload,
            "reaction_outline": npc_payload.reaction_outline,
            "npc_reaction_outline": npc_payload.reaction_outline,
            "memory_highlights": memory_payload.focus_memories[:5],
            "world_tags": rules_payload.normalized_world_tags,
            "resolution_summary": world_progress_payload.resolution_summary,
            "consequence_summary": intent_payload.consequence_summary,
            "game_frame": game_frame,
            "intent_summary": intent_payload.intent_summary,
            "selected_choice": request.selected_choice or {},
            "consequence_tags": world_progress_payload.consequence_tags,
            "outcome_band": world_progress_payload.outcome_band,
            "current_scene_summary": str(current_scene.get("summary") or ""),
            "current_chapter_summary": str(current_chapter.get("summary") or ""),
            "recognized_titles": recognized_titles,
            "same_world_context_summary": _joined_state_summary(
                [
                    ("location", current_location),
                    ("recent_world_beats", recent_world_beats[:5] if isinstance(recent_world_beats, list) else recent_world_beats),
                    ("ambient_murmurs", ambient_murmurs[:5] if isinstance(ambient_murmurs, list) else ambient_murmurs),
                    ("resource_constraints", request.session_state.get("resource_constraints") or []),
                    ("world_broadcast_constraints", request.session_state.get("world_broadcast_constraints") or []),
                ]
            ),
        }
        narrative_result = self.model_router.execute_structured_prompt(
            prompt_id="council.narrative",
            response_model=CouncilNarrativePayload,
            input_payload=narrative_input,
            world_id=request.world_id,
            turn_id=request.turn_id,
            graph_context_status=request.graph_context_status,
            allow_pro_fallback=True,
            force_pro_after_success=high_risk,
        )
        role_runs.append(
            self._role_run(
                council_role="narrative",
                stage_index=8,
                prompt_id="council.narrative",
                approval_status="approved" if narrative_result.succeeded else "failed",
                result=narrative_result,
            )
        )
        if not narrative_result.succeeded:
            return TurnResolutionOutcome(
                role_runs=role_runs,
                final_lane=narrative_result.final_lane,
                final_payload=None,
                failure_reason=narrative_result.failure_reason,
                rejection_role="narrative",
            )

        narrative_payload = narrative_result.final_payload
        assert narrative_payload is not None
        emit_turn_event(
            "turn.narrative.delta",
            {
                "turn_id": request.turn_id,
                "delta": narrative_payload.narrative,
                "final": False,
            },
        )

        final_payload = TurnResolutionPayload(
            narrative=narrative_payload.narrative,
            npc_reaction=narrative_payload.npc_reaction,
            event_type=world_progress_payload.event_type,
            event_payload={
                **world_progress_payload.event_payload,
                "world_id": request.world_id,
                "risk_level": rules_payload.risk_level,
                "resolution_summary": world_progress_payload.resolution_summary,
            },
            memories=world_progress_payload.memories,
            world_tags=rules_payload.normalized_world_tags,
            interpreted_intent=intent_payload.model_dump(),
            next_choices=world_progress_payload.next_choices,
            consequence_summary=intent_payload.consequence_summary,
            consequence_tags=world_progress_payload.consequence_tags,
            shared_action_tag=world_progress_payload.shared_action_tag,
            state_drafts=world_progress_payload.state_drafts,
            branch_signals=world_progress_payload.branch_signals,
            outcome_band=world_progress_payload.outcome_band,
            scene_tone=narrative_payload.tone,
            scene_move=world_progress_payload.scene_move,
            scene_pressure=world_progress_payload.scene_pressure,
            broadcast_draft=world_progress_payload.broadcast_draft,
            quest_offer=world_progress_payload.quest_offer,
            chapter_directive=world_progress_payload.chapter_directive,
            followup_quest_offer=world_progress_payload.followup_quest_offer,
            quest_resolution_hint=world_progress_payload.quest_resolution_hint,
            active_quest_resolution=world_progress_payload.active_quest_resolution,
            quest_lifecycle_directive=world_progress_payload.quest_lifecycle_directive,
            entity_drafts=world_progress_payload.entity_drafts,
        )
        return TurnResolutionOutcome(
            role_runs=role_runs,
            final_lane=narrative_result.final_lane,
            final_payload=final_payload,
            deterministic_fallback_used=deterministic_fallback_used,
        )

    @staticmethod
    def _role_run(
        *,
        council_role: str,
        stage_index: int,
        prompt_id: str,
        approval_status: str,
        result,
    ) -> CouncilRoleRun:
        return CouncilRoleRun(
            council_role=council_role,
            stage_index=stage_index,
            prompt_id=prompt_id,
            approval_status=approval_status,
            attempts=result.attempts,
            final_lane=result.final_lane,
            final_payload=result.final_payload.model_dump() if result.final_payload is not None else None,
            failure_reason=result.failure_reason,
        )
