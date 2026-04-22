from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.core.config import Settings
from app.modules.llm_harness.service import (
    CouncilIntentInterpreterPayload,
    CouncilRoleRun,
    MemoryDraft,
    ModelRouter,
    NarrativeChoiceDraft,
    TurnResolutionOutcome,
    TurnResolutionPayload,
)
from app.modules.world_state.consequence import ConsequenceTag, OutcomeBand, normalize_consequence_tags
from app.modules.world_state.rules import WorldTag, normalize_world_tags


class CouncilMemoryManagerPayload(BaseModel):
    memory_summary: str = Field(min_length=1)
    focus_memories: list[str] = Field(default_factory=list)
    relation_summary: str = Field(min_length=1)
    state_summary: str = Field(min_length=1)


class CouncilNPCManagerPayload(BaseModel):
    npc_intent: str = Field(min_length=1)
    reaction_style: str = Field(min_length=1)
    focus_memories: list[str] = Field(default_factory=list)
    reaction_outline: str = Field(min_length=1)


class CouncilWorldProgressPayload(BaseModel):
    event_type: Literal["player.turn.resolved"]
    event_payload: dict[str, Any]
    memories: list[MemoryDraft] = Field(min_length=1)
    world_tags: list[WorldTag] = Field(min_length=1)
    consequence_tags: list[ConsequenceTag] = Field(default_factory=list)
    outcome_band: OutcomeBand = "steady"
    resolution_summary: str = Field(min_length=1)
    risk_level: Literal["low", "medium", "high"]
    next_choices: list[NarrativeChoiceDraft] = Field(min_length=3, max_length=3)

    @model_validator(mode="before")
    @classmethod
    def normalize_canonical_event_type(cls, value: Any) -> Any:
        if isinstance(value, dict):
            normalized = dict(value)
            normalized["event_type"] = "player.turn.resolved"
            return normalized
        return value


class CouncilRulesArbiterPayload(BaseModel):
    approval_status: Literal["approved", "rejected"]
    normalized_world_tags: list[WorldTag] = Field(min_length=1)
    reason: str = Field(min_length=1)
    risk_level: Literal["low", "medium", "high"]


class CouncilSafetyGuardPayload(BaseModel):
    approval_status: Literal["approved", "rejected"]
    reason: str = Field(min_length=1)
    violations: list[str] = Field(default_factory=list)


class CouncilNarrativePayload(BaseModel):
    narrative: str = Field(min_length=1)
    npc_reaction: str = Field(min_length=1)
    tone: str = Field(min_length=1)


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
        stage_key = str(active_quest.get("stage_key") or "starter_watch")
        progress = int(active_quest.get("progress") or 0)

        if stage_key == "starter_watch":
            return ["aid_local"] if progress < 1 else ["promise_followup"]
        if stage_key == "watch_path_followup":
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
            return ["sigil_respect", "kept_promise"]
        if any(token in input_text or token in normalized_text for token in ("約束", "promise", "引き受ける", "応える")):
            canonical.append("kept_promise")
        if any(token in input_text or token in normalized_text for token in ("探", "observe", "watch path", "巡回路")):
            canonical.append("careful_observation")
        if any(token in input_text or token in normalized_text for token in ("助け", "help", "灯", "light")):
            canonical.append("earned_trust")
        return normalize_consequence_tags(canonical)

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
        active_consequence_threads = request.session_state.get("active_consequence_threads") or []
        recent_consequence_history = request.session_state.get("recent_consequence_history") or []

        intent_input = {
            "world_id": request.world_id,
            "input_mode": request.input_mode,
            "input_text": request.input_text,
            "player_name": request.player_name,
            "npc_name": request.npc_name,
            "selected_choice": request.selected_choice or {},
            "quests": quests,
            "factions": request.session_state.get("factions") or [],
            "inventory": inventory,
            "usable_reward_items": usable_reward_items,
            "used_reward_items": used_reward_items,
            "important_inventory_affordances": important_inventory_affordances,
            "default_choice_templates": default_choice_templates,
            "relationship_summaries": relationship_summaries,
            "active_consequence_threads": active_consequence_threads,
            "recent_consequence_history": recent_consequence_history,
        }
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
            "active_consequence_threads": active_consequence_threads,
            "recent_consequence_history": recent_consequence_history,
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
            "active_consequence_threads": active_consequence_threads,
            "recent_consequence_history": recent_consequence_history,
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
            "active_consequence_threads": active_consequence_threads,
            "recent_consequence_history": recent_consequence_history,
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
        world_progress_payload.world_tags = self._choice_world_tags(
            session_state=request.session_state,
            selected_choice=request.selected_choice,
            action_kind=intent_payload.canonical_action_kind,
            raw_world_tags=list(world_progress_payload.world_tags),
        )
        world_progress_payload.outcome_band = self._outcome_band_from_tags(list(world_progress_payload.consequence_tags))
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
            "npc_name": request.npc_name,
            "memory_summary": memory_payload.memory_summary,
            "reaction_outline": npc_payload.reaction_outline,
            "world_tags": rules_payload.normalized_world_tags,
            "resolution_summary": world_progress_payload.resolution_summary,
            "consequence_summary": intent_payload.consequence_summary,
            "outcome_band": world_progress_payload.outcome_band,
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
            outcome_band=world_progress_payload.outcome_band,
            scene_tone=narrative_payload.tone,
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
