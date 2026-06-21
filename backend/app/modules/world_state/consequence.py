from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.modules.world_state.rules import WorldTag


ConsequenceTag = Literal[
    "earned_trust",
    "kept_promise",
    "missed_timing",
    "public_attention",
    "overreach",
    "careful_observation",
    "reward_item_respect",
]
CONSEQUENCE_TAG_VALUES = {
    "earned_trust",
    "kept_promise",
    "missed_timing",
    "public_attention",
    "overreach",
    "careful_observation",
    "reward_item_respect",
}
OutcomeBand = Literal["steady", "tangled", "setback"]
RelationshipBand = Literal["estranged", "wary", "neutral", "warm", "trusted"]
ThreadType = Literal["promise", "rumor", "scrutiny", "debt"]
ThreadStatus = Literal["active", "cooling", "resolved"]
PressureBand = Literal["low", "medium", "high"]
ThreadAction = Literal["none", "opened", "raised", "cooled", "resolved"]


def normalize_consequence_tags(tags: list[str] | None) -> list[ConsequenceTag]:
    if not tags:
        return []
    normalized: list[ConsequenceTag] = []
    seen: set[str] = set()
    for tag in tags:
        if tag not in CONSEQUENCE_TAG_VALUES or tag in seen:
            continue
        normalized.append(tag)  # type: ignore[arg-type]
        seen.add(tag)
    # Choice/free-text parity depends on progress/help intent not being randomly
    # downgraded into public suspicion when the same turn is also clearly trust-building.
    if "overreach" not in seen and "public_attention" in seen and (
        "earned_trust" in seen or "kept_promise" in seen or "reward_item_respect" in seen
    ):
        normalized = [tag for tag in normalized if tag != "public_attention"]
    return normalized


def relationship_band(strength: float) -> RelationshipBand:
    if strength < 0.2:
        return "estranged"
    if strength < 0.45:
        return "wary"
    if strength < 0.65:
        return "neutral"
    if strength < 0.85:
        return "warm"
    return "trusted"


def scene_tone_for_band(outcome_band: OutcomeBand) -> str:
    if outcome_band == "steady":
        return "steady"
    if outcome_band == "tangled":
        return "uneasy"
    return "tense"


def thread_title(thread_type: ThreadType) -> str:
    return {
        "promise": "A promise remains unresolved",
        "rumor": "A rumor keeps moving through the district",
        "scrutiny": "Watchful eyes linger",
        "debt": "An unpaid kindness remains",
    }[thread_type]


def thread_summary(thread_type: ThreadType, pressure_band: PressureBand, *, counterpart_name: str | None = None) -> str:
    subject = counterpart_name or "The district"
    if thread_type == "promise":
        if pressure_band == "high":
            return f"{subject} still holds you to words that have not yet been answered."
        if pressure_band == "medium":
            return f"{subject} carries the feeling of a promise that should soon be met."
        return f"{subject} remembers a promise that has begun to settle back into place."
    if thread_type == "rumor":
        if pressure_band == "high":
            return f"Whispers around {subject} are moving faster than you would like."
        if pressure_band == "medium":
            return f"People around {subject} are starting to trade a version of what happened."
        return f"A small rumor still trails behind the scene around {subject}."
    if thread_type == "scrutiny":
        if pressure_band == "high":
            return f"{subject} watches your next move with narrowed patience."
        if pressure_band == "medium":
            return f"{subject} keeps a careful eye on what you will do next."
        return f"{subject}'s caution has not fully faded."
    if pressure_band == "high":
        return f"{subject} remembers a kindness that now feels pressing."
    if pressure_band == "medium":
        return f"{subject} carries an unpaid kindness in the back of the scene."
    return f"{subject} still remembers a kindness that may yet be returned."


def relationship_summary(display_name: str, band: RelationshipBand, *, thread_summary_text: str | None = None) -> str:
    if thread_summary_text:
        return thread_summary_text
    if band == "trusted":
        return f"{display_name} now treats you as someone whose word has weight."
    if band == "warm":
        return f"{display_name} has begun to lean toward you with visible trust."
    if band == "neutral":
        return f"{display_name} keeps you within the circle of ordinary trust."
    if band == "wary":
        return f"{display_name} keeps some distance, waiting to see your next move."
    return f"{display_name} has turned cold enough that every next move matters."


def fallback_consequence_tags(
    *,
    world_tags: list[WorldTag],
    action_kind: str,
    fail_forward: bool,
) -> list[ConsequenceTag]:
    tags: list[ConsequenceTag] = []
    if action_kind == "use_reward_item":
        tags.extend(["reward_item_respect", "kept_promise"])
    if "aid_local" in world_tags:
        tags.append("earned_trust")
    if "promise_followup" in world_tags:
        tags.append("kept_promise")
    if "investigate" in world_tags:
        tags.append("careful_observation")
    if "threaten_local" in world_tags:
        tags.append("public_attention")
    if fail_forward:
        tags.append("overreach")
    return normalize_consequence_tags(tags)


@dataclass(frozen=True)
class ConsequenceThreadSnapshot:
    thread_type: ThreadType
    status: ThreadStatus
    pressure_band: PressureBand


@dataclass(frozen=True)
class ConsequenceRuleInput:
    world_tags: list[WorldTag]
    consequence_tags: list[ConsequenceTag]
    relationship_strength: float
    active_threads: list[ConsequenceThreadSnapshot]


@dataclass(frozen=True)
class ConsequenceRuleOutcome:
    outcome_band: OutcomeBand
    relationship_delta: float
    faction_delta: float
    thread_action: ThreadAction
    thread_type: ThreadType | None
    thread_status: ThreadStatus | None
    pressure_band: PressureBand | None
    scene_tone: str
    summary: str


class ConsequenceRuleEngine:
    @staticmethod
    def evaluate(rule_input: ConsequenceRuleInput) -> ConsequenceRuleOutcome:
        world_tags = list(rule_input.world_tags)
        consequence_tags = normalize_consequence_tags(rule_input.consequence_tags)
        thread_types = {item.thread_type: item for item in rule_input.active_threads if item.status in {"active", "cooling"}}

        if "overreach" in consequence_tags:
            return ConsequenceRuleOutcome(
                outcome_band="setback",
                relationship_delta=-0.10,
                faction_delta=-0.05,
                thread_action="raised" if "scrutiny" in thread_types else "opened",
                thread_type="scrutiny",
                thread_status="active",
                pressure_band="high",
                scene_tone=scene_tone_for_band("setback"),
                summary="The scene turns on your overreach and leaves a sharper watch upon you.",
            )

        if "missed_timing" in consequence_tags:
            return ConsequenceRuleOutcome(
                outcome_band="tangled",
                relationship_delta=-0.04,
                faction_delta=0.0,
                thread_action="raised" if "promise" in thread_types else "opened",
                thread_type="promise",
                thread_status="active",
                pressure_band="medium" if "promise" not in thread_types else "high",
                scene_tone=scene_tone_for_band("tangled"),
                summary="What you promised does not break, but it does not land cleanly either.",
            )

        if "public_attention" in consequence_tags:
            return ConsequenceRuleOutcome(
                outcome_band="tangled",
                relationship_delta=-0.02,
                faction_delta=-0.03,
                thread_action="raised" if "rumor" in thread_types else "opened",
                thread_type="rumor",
                thread_status="active",
                pressure_band="medium" if "rumor" not in thread_types else "high",
                scene_tone=scene_tone_for_band("tangled"),
                summary="The scene keeps moving, but people are now carrying a version of it with them.",
            )

        if "reward_item_respect" in consequence_tags:
            thread_action: ThreadAction = "none"
            thread_type: ThreadType | None = None
            thread_status: ThreadStatus | None = None
            pressure_band: PressureBand | None = None
            if "promise" in thread_types:
                thread_action, thread_type, thread_status, pressure_band = "resolved", "promise", "resolved", "low"
            elif "rumor" in thread_types:
                thread_action, thread_type, thread_status, pressure_band = "cooled", "rumor", "cooling", "low"
            elif "scrutiny" in thread_types:
                thread_action, thread_type, thread_status, pressure_band = "cooled", "scrutiny", "cooling", "low"
            return ConsequenceRuleOutcome(
                outcome_band="steady",
                relationship_delta=0.10,
                faction_delta=0.02,
                thread_action=thread_action,
                thread_type=thread_type,
                thread_status=thread_status,
                pressure_band=pressure_band,
                scene_tone=scene_tone_for_band("steady"),
                summary="The reward item is taken seriously, and the scene answers with a steadier kind of trust.",
            )

        if "kept_promise" in consequence_tags:
            thread_action: ThreadAction = "none"
            thread_type: ThreadType | None = None
            thread_status: ThreadStatus | None = None
            pressure_band: PressureBand | None = None
            if "promise" in thread_types:
                thread_action, thread_type, thread_status, pressure_band = "resolved", "promise", "resolved", "low"
            return ConsequenceRuleOutcome(
                outcome_band="steady",
                relationship_delta=0.08,
                faction_delta=0.04,
                thread_action=thread_action,
                thread_type=thread_type,
                thread_status=thread_status,
                pressure_band=pressure_band,
                scene_tone=scene_tone_for_band("steady"),
                summary="The turn lands as an answer rather than another loose edge.",
            )

        if "earned_trust" in consequence_tags:
            return ConsequenceRuleOutcome(
                outcome_band="steady",
                relationship_delta=0.08,
                faction_delta=0.05,
                thread_action="none",
                thread_type=None,
                thread_status=None,
                pressure_band=None,
                scene_tone=scene_tone_for_band("steady"),
                summary="The scene leaves behind a little more trust than it had before.",
            )

        if "careful_observation" in consequence_tags or "investigate" in world_tags:
            thread_action: ThreadAction = "none"
            thread_type: ThreadType | None = None
            thread_status: ThreadStatus | None = None
            pressure_band: PressureBand | None = None
            if "scrutiny" in thread_types:
                thread_action, thread_type, thread_status, pressure_band = "cooled", "scrutiny", "cooling", "low"
            return ConsequenceRuleOutcome(
                outcome_band="steady",
                relationship_delta=0.04,
                faction_delta=0.0,
                thread_action=thread_action,
                thread_type=thread_type,
                thread_status=thread_status,
                pressure_band=pressure_band,
                scene_tone=scene_tone_for_band("steady"),
                summary="The turn does not force the scene forward, but it does settle the room around you.",
            )

        return ConsequenceRuleOutcome(
            outcome_band="steady",
            relationship_delta=0.0,
            faction_delta=0.0,
            thread_action="none",
            thread_type=None,
            thread_status=None,
            pressure_band=None,
            scene_tone=scene_tone_for_band("steady"),
            summary="The scene moves without opening a new wound in the world.",
        )
