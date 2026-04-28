from __future__ import annotations

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
    TurnResolutionOutcome,
    TurnResolutionPayload,
)
from app.modules.world_state.branch import BranchSignal, normalize_branch_signals
from app.modules.world_state.consequence import ConsequenceTag, OutcomeBand, normalize_consequence_tags
from app.modules.world_state.rules import WorldTag, infer_world_tags, normalize_world_tags


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
        posture_by_key = {
            "safe": "safe",
            "progress": "progress",
            "forward_progress": "progress",
            "explore": "explore",
            "exploration_relationship": "explore",
        }
        for key, value in raw_choices.items():
            if isinstance(value, dict):
                source_items.append({"posture": posture_by_key.get(str(key), str(key)), **value})
    elif isinstance(raw_choices, list):
        source_items = [item for item in raw_choices if isinstance(item, dict)]
    else:
        source_items = []

    drafts: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in source_items:
        posture = str(item.get("posture") or "").strip()
        if posture not in {"safe", "progress", "explore"} or posture in seen:
            continue
        label = _first_text(item.get("label"), item.get("intent_summary"), item.get("summary"), posture)
        action_kind = str(item.get("action_kind") or "narrative")
        if action_kind not in {"narrative", "use_reward_item", "travel"}:
            action_kind = "narrative"
        drafts.append(
            {
                "posture": posture,
                "label": label,
                "intent_summary": _first_text(item.get("intent_summary"), item.get("summary"), label),
                "action_kind": action_kind,
                "travel_target_key": item.get("travel_target_key"),
            }
        )
        seen.add(posture)

    defaults = {
        "safe": "Hold position and read the room before acting again.",
        "progress": "Take the clearest available step toward the current request.",
        "explore": "Ask a grounded question about the current place or relationship.",
    }
    for posture, label in defaults.items():
        if posture not in seen:
            drafts.append(
                {
                    "posture": posture,
                    "label": label,
                    "intent_summary": label,
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


class CouncilWorldProgressPayload(BaseModel):
    event_type: Literal["player.turn.resolved"]
    event_payload: dict[str, Any]
    memories: list[MemoryDraft] = Field(min_length=1)
    world_tags: list[WorldTag] = Field(min_length=1)
    consequence_tags: list[ConsequenceTag] = Field(default_factory=list)
    branch_signals: list[BranchSignal] = Field(default_factory=list)
    outcome_band: OutcomeBand = "steady"
    resolution_summary: str = Field(min_length=1)
    risk_level: Literal["low", "medium", "high"]
    next_choices: list[NarrativeChoiceDraft] = Field(min_length=3, max_length=3)
    scene_move: Literal["hold", "deepen", "pivot", "close"] = "hold"
    scene_pressure: Literal["low", "medium", "high"] = "medium"
    broadcast_draft: dict[str, Any] | None = None

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
        normalized["risk_level"] = _risk_level(normalized.get("risk_level"), normalized.get("outcome_band"), normalized["consequence_tags"])
        normalized["next_choices"] = _choice_drafts(
            normalized.get("next_choices")
            or normalized.get("choices")
            or normalized.get("next_three_diegetic_player_choices")
            or normalized.get("next_player_choices")
        )
        normalized["scene_move"] = _scene_move(normalized.get("scene_move"))
        normalized["scene_pressure"] = _scene_pressure(normalized.get("scene_pressure"))
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


class GMCouncilService:
    ROLE_ORDER = [
        ("intent_interpreter", 1, "council.intent_interpreter", False),
        ("memory_manager", 2, "council.memory_manager", False),
        ("npc_manager", 3, "council.npc_manager", False),
        ("world_progress", 4, "council.world_progress", False),
        ("rules_arbiter", 5, "council.rules_arbiter", True),
        ("safety_guard", 6, "council.safety_guard", True),
        ("narrative", 7, "council.narrative", True),
    ]

    def __init__(self, settings: Settings, model_router: ModelRouter) -> None:
        self.settings = settings
        self.model_router = model_router

    def resolve_intent(self, request: CouncilRequest) -> CouncilIntentPhase:
        intent_input = self._intent_input_payload(request)
        if request.input_mode == "choice" and request.selected_choice:
            intent_result = self._choice_intent_outcome(request=request, input_payload=intent_input)
        else:
            intent_result = self.model_router.execute_structured_prompt(
                prompt_id="council.intent_interpreter",
                response_model=CouncilIntentInterpreterPayload,
                input_payload=intent_input,
                world_id=request.world_id,
                turn_id=request.turn_id,
                graph_context_status=request.graph_context_status,
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
        return {
            "world_id": request.world_id,
            "input_mode": request.input_mode,
            "input_text": request.input_text,
            "player_name": request.player_name,
            "player_profile": player_profile,
            "narrative_preferences": narrative_preferences,
            "npc_name": request.npc_name,
            "selected_choice": request.selected_choice or {},
            "world_pack": request.session_state.get("world_pack") or {},
            "quests": request.session_state.get("quests") or [],
            "factions": request.session_state.get("factions") or [],
            "inventory": inventory,
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
        normalized = normalize_world_tags(raw_world_tags)
        if action_kind != "narrative":
            return normalized
        posture = str((selected_choice or {}).get("posture") or "")
        if posture != "progress":
            return normalized

        active_quest = GMCouncilService._active_quest(session_state)
        world_pack = session_state.get("world_pack") or {}
        starter_stage_key = str(world_pack.get("starter_stage_key") or "starter_stage")
        followup_stage_key = str(world_pack.get("followup_stage_key") or "followup_stage")
        stage_key = str(active_quest.get("stage_key") or starter_stage_key)
        progress = int(active_quest.get("progress") or 0)

        if stage_key == starter_stage_key:
            return ["aid_local"] if progress < 1 else ["promise_followup"]
        if stage_key == followup_stage_key:
            return ["investigate"]
        return normalized

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
        if action_kind != "narrative":
            return raw_scene_move if raw_scene_move in {"hold", "deepen", "pivot", "close"} else "hold"
        posture = str((selected_choice or {}).get("posture") or "")
        if posture != "progress":
            return raw_scene_move if raw_scene_move in {"hold", "deepen", "pivot", "close"} else "hold"
        active_quest = GMCouncilService._active_quest(session_state)
        world_pack = session_state.get("world_pack") or {}
        starter_stage_key = str(world_pack.get("starter_stage_key") or "starter_stage")
        stage_key = str(active_quest.get("stage_key") or starter_stage_key)
        if stage_key == starter_stage_key:
            return "hold"
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

        if input_mode == "choice":
            posture = str((selected_choice or {}).get("posture") or "")
            if posture == "progress" and "earned_trust" not in canonical:
                canonical.append("earned_trust")
            elif posture in {"safe", "explore"} and "careful_observation" not in canonical:
                canonical.append("careful_observation")
            return normalize_consequence_tags(canonical)

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
        posture = str(selected_choice.get("posture") or "none").strip()
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
                "requested_choice_posture": posture if posture in {"safe", "progress", "explore"} else "none",
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

    def resolve_turn(self, request: CouncilRequest) -> TurnResolutionOutcome:
        role_runs: list[CouncilRoleRun] = []
        quests = request.session_state.get("quests") or []
        inventory = request.session_state.get("inventory") or []
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

        intent_input = self._intent_input_payload(request)
        if request.prepared_intent_payload is not None and request.prepared_intent_role_run is not None:
            intent_payload = request.prepared_intent_payload
            role_runs.append(request.prepared_intent_role_run)
        elif request.input_mode == "choice" and request.selected_choice:
            intent_result = self._choice_intent_outcome(request=request, input_payload=intent_input)
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
            "npc_name": request.npc_name,
            "relevant_memories": request.relevant_memories,
            "relation_context": request.relation_context,
            "quests": quests,
            "factions": request.session_state.get("factions") or [],
            "inventory": inventory,
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
        memory_result = self.model_router.execute_structured_prompt(
            prompt_id="council.memory_manager",
            response_model=CouncilMemoryManagerPayload,
            input_payload=memory_input,
            world_id=request.world_id,
            turn_id=request.turn_id,
            graph_context_status=request.graph_context_status,
        )
        role_runs.append(
            self._role_run(
                council_role="memory_manager",
                stage_index=2,
                prompt_id="council.memory_manager",
                approval_status="prepared" if memory_result.succeeded else "failed",
                result=memory_result,
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

        memory_payload = memory_result.final_payload
        assert memory_payload is not None

        npc_input = {
            "world_id": request.world_id,
            "input_text": request.input_text,
            "player_name": request.player_name,
            "player_profile": player_profile,
            "narrative_preferences": narrative_preferences,
            "npc_name": request.npc_name,
            "memory_summary": memory_payload.memory_summary,
            "focus_memories": memory_payload.focus_memories,
            "relation_summary": memory_payload.relation_summary,
            "state_summary": memory_payload.state_summary,
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
        }
        npc_result = self.model_router.execute_structured_prompt(
            prompt_id="council.npc_manager",
            response_model=CouncilNPCManagerPayload,
            input_payload=npc_input,
            world_id=request.world_id,
            turn_id=request.turn_id,
            graph_context_status=request.graph_context_status,
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
        if not npc_result.succeeded:
            return TurnResolutionOutcome(
                role_runs=role_runs,
                final_lane=npc_result.final_lane,
                final_payload=None,
                failure_reason=npc_result.failure_reason,
                rejection_role="npc_manager",
            )

        npc_payload = npc_result.final_payload
        assert npc_payload is not None

        world_progress_input = {
            "world_id": request.world_id,
            "input_text": request.input_text,
            "player_name": request.player_name,
            "player_profile": player_profile,
            "narrative_preferences": narrative_preferences,
            "npc_name": request.npc_name,
            "memory_summary": memory_payload.memory_summary,
            "relation_summary": memory_payload.relation_summary,
            "state_summary": memory_payload.state_summary,
            "reaction_outline": npc_payload.reaction_outline,
            "focus_memories": npc_payload.focus_memories,
            "intent_summary": intent_payload.intent_summary,
            "fail_forward": intent_payload.fail_forward,
            "consequence_summary": intent_payload.consequence_summary,
            "consequence_tags": intent_payload.consequence_tags,
            "default_choice_templates": default_choice_templates,
            "relationship_summaries": relationship_summaries,
            "recognized_titles": recognized_titles,
            "active_consequence_threads": active_consequence_threads,
            "recent_consequence_history": recent_consequence_history,
            "active_quest_stage": active_quest.get("stage_key") if isinstance(active_quest, dict) else None,
            "world_pack": request.session_state.get("world_pack") or {},
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
                stage_index=4,
                prompt_id="council.world_progress",
                approval_status="prepared" if world_progress_result.succeeded else "failed",
                result=world_progress_result,
            )
        )
        if not world_progress_result.succeeded:
            return TurnResolutionOutcome(
                role_runs=role_runs,
                final_lane=world_progress_result.final_lane,
                final_payload=None,
                failure_reason=world_progress_result.failure_reason,
                rejection_role="world_progress",
            )

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
            "input_mode": request.input_mode,
            "consequence_flags": intent_payload.consequence_flags,
            "recognized_titles": recognized_titles,
            "shared_world_context": shared_world_context,
            "resource_constraints": request.session_state.get("resource_constraints") or [],
            "world_broadcast_constraints": request.session_state.get("world_broadcast_constraints") or [],
        }
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
                stage_index=5,
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
            "recognized_titles": recognized_titles,
            "shared_world_context": shared_world_context,
            "resource_constraints": request.session_state.get("resource_constraints") or [],
            "world_broadcast_constraints": request.session_state.get("world_broadcast_constraints") or [],
        }
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
        safety_approval = (
            safety_result.final_payload.approval_status if safety_result.final_payload is not None else "failed"
        )
        role_runs.append(
            self._role_run(
                council_role="safety_guard",
                stage_index=6,
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
            "player_profile": player_profile,
            "narrative_preferences": narrative_preferences,
            "npc_name": request.npc_name,
            "memory_summary": memory_payload.memory_summary,
            "reaction_outline": npc_payload.reaction_outline,
            "world_tags": rules_payload.normalized_world_tags,
            "resolution_summary": world_progress_payload.resolution_summary,
            "consequence_summary": intent_payload.consequence_summary,
            "outcome_band": world_progress_payload.outcome_band,
            "current_scene_summary": str(current_scene.get("summary") or ""),
            "current_chapter_summary": str(current_chapter.get("summary") or ""),
            "recognized_titles": recognized_titles,
            "shared_world_context": shared_world_context,
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
                stage_index=7,
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
            branch_signals=world_progress_payload.branch_signals,
            outcome_band=world_progress_payload.outcome_band,
            scene_tone=narrative_payload.tone,
            scene_move=world_progress_payload.scene_move,
            scene_pressure=world_progress_payload.scene_pressure,
            broadcast_draft=world_progress_payload.broadcast_draft,
        )
        return TurnResolutionOutcome(
            role_runs=role_runs,
            final_lane=narrative_result.final_lane,
            final_payload=final_payload,
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
