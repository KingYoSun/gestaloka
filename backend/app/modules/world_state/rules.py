from __future__ import annotations

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
