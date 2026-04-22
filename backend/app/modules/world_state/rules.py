from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


WorldTag = Literal["aid_local", "investigate", "promise_followup", "threaten_local", "collect_reward", "none"]
WORLD_TAG_VALUES = {"aid_local", "investigate", "promise_followup", "threaten_local", "collect_reward", "none"}


def standing_band(value: float) -> str:
    if value >= 0.75:
        return "trusted"
    if value >= 0.35:
        return "favored"
    if value <= -0.6:
        return "hostile"
    if value <= -0.2:
        return "strained"
    return "neutral"


def infer_world_tags(input_text: str) -> list[WorldTag]:
    normalized = input_text.lower()
    tags: list[WorldTag] = []

    if any(keyword in normalized for keyword in ("助", "救", "援", "手伝", "灯をとも", "支え", "守")):
        tags.append("aid_local")
    if any(keyword in normalized for keyword in ("調", "探", "見回", "確か", "観察", "様子")):
        tags.append("investigate")
    if any(keyword in normalized for keyword in ("報告", "約束", "届け", "追う", "続け", "戻", "follow")):
        tags.append("promise_followup")
    if any(keyword in normalized for keyword in ("脅", "威圧", "怒鳴", "恫喝", "強要")):
        tags.append("threaten_local")
    if any(keyword in normalized for keyword in ("報酬", "受け取", "受取", "reward", "受領")):
        tags.append("collect_reward")

    if not tags:
        return ["none"]

    seen: set[str] = set()
    deduplicated: list[WorldTag] = []
    for tag in tags:
        if tag not in seen:
            deduplicated.append(tag)
            seen.add(tag)
    return deduplicated


def normalize_world_tags(tags: list[str] | None) -> list[WorldTag]:
    if not tags:
        return ["none"]
    normalized: list[WorldTag] = []
    seen: set[str] = set()
    for tag in tags:
        if tag not in WORLD_TAG_VALUES:
            continue
        if tag in seen:
            continue
        normalized.append(tag)  # type: ignore[arg-type]
        seen.add(tag)
    return normalized or ["none"]


@dataclass(frozen=True)
class QuestRuleInput:
    world_tags: list[WorldTag]
    current_progress: int
    progress_target: int
    current_standing: float
    reward_already_issued: bool


@dataclass(frozen=True)
class QuestRuleOutcome:
    world_tags: list[WorldTag]
    quest_progress_delta: int
    lore_progress_delta: int
    next_progress: int
    standing_delta: float
    next_standing: float
    next_band: str
    completed: bool
    should_issue_reward: bool
    summary: str


class QuestRuleEngine:
    @staticmethod
    def evaluate(rule_input: QuestRuleInput) -> QuestRuleOutcome:
        tags = normalize_world_tags(rule_input.world_tags)

        progress_delta = 0
        lore_progress_delta = 0
        standing_delta = 0.0

        if "aid_local" in tags or "promise_followup" in tags:
            progress_delta += 1
            standing_delta += 0.15
        if "investigate" in tags:
            lore_progress_delta += 1
        if "threaten_local" in tags:
            standing_delta -= 0.3
        if "collect_reward" in tags and rule_input.current_progress >= rule_input.progress_target:
            standing_delta += 0.0

        next_progress = min(rule_input.progress_target, rule_input.current_progress + progress_delta)
        next_standing = max(-1.0, min(1.0, round(rule_input.current_standing + standing_delta, 3)))
        completed = next_progress >= rule_input.progress_target
        should_issue_reward = completed and not rule_input.reward_already_issued

        summary_parts: list[str] = []
        if progress_delta:
            summary_parts.append(f"quest+{progress_delta}")
        if lore_progress_delta:
            summary_parts.append(f"lore+{lore_progress_delta}")
        if standing_delta:
            summary_parts.append(f"standing {standing_delta:+.2f}")
        if should_issue_reward:
            summary_parts.append("reward issued")
        if not summary_parts:
            summary_parts.append("no state change")

        return QuestRuleOutcome(
            world_tags=tags,
            quest_progress_delta=progress_delta,
            lore_progress_delta=lore_progress_delta,
            next_progress=next_progress,
            standing_delta=standing_delta,
            next_standing=next_standing,
            next_band=standing_band(next_standing),
            completed=completed,
            should_issue_reward=should_issue_reward,
            summary=", ".join(summary_parts),
        )
