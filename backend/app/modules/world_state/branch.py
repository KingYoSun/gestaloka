from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal, Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Actor, ChapterTrack, Event, RoutePressure, new_id
from app.modules.world_pack.service import FOLLOWUP_BRANCH_SLOTS, resolve_world_pack, serialize_followup_branches


BranchSlot = Literal["formal_path", "undercurrent_path"]
BranchSignal = Literal[
    "formal_trust",
    "kept_formal_promise",
    "rumor_curiosity",
    "street_pull",
    "public_scrutiny",
    "sigil_duty",
]

FORMAL_PATH_SLOT: BranchSlot = "formal_path"
UNDERCURRENT_PATH_SLOT: BranchSlot = "undercurrent_path"
LEGACY_FOLLOWUP_BRANCHES: dict[BranchSlot, dict[str, Any]] = {
    FORMAL_PATH_SLOT: {
        "slot": FORMAL_PATH_SLOT,
        "branch_key": "watch_oath",
        "label": "Watch Oath",
        "anchor_npcs": [],
    },
    UNDERCURRENT_PATH_SLOT: {
        "slot": UNDERCURRENT_PATH_SLOT,
        "branch_key": "lantern_whispers",
        "label": "Lantern Whispers",
        "anchor_npcs": [],
    },
}


@dataclass(frozen=True)
class BranchCommitDraft:
    route_key: str
    event_type: str
    narrative: str
    payload: dict[str, Any]
    memory_drafts: list[dict[str, Any]]
    forced_scene_move: Literal["pivot"] = "pivot"


@dataclass(frozen=True)
class BranchPressureResult:
    updates: list[dict[str, Any]]
    crossroads_summary: str
    branch_hint: str
    current_branch: str | None
    commit: BranchCommitDraft | None


def _deduplicated_tokens(text: str) -> list[str]:
    lowered = str(text or "").strip().lower()
    if not lowered:
        return []
    normalized = lowered.replace("-", " ").replace("_", " ")
    candidates = {lowered, normalized}
    return [token for token in candidates if token]


def _followup_branches_from_world_pack(world_pack: Mapping[str, Any] | None) -> dict[BranchSlot, dict[str, Any]]:
    raw = dict(world_pack or {})
    serialized = raw.get("followup_branches")
    candidate_mapping: Mapping[str, Any] | None = None
    if isinstance(serialized, dict):
        candidate_mapping = serialized
    elif all(isinstance(raw.get(slot), dict) for slot in FOLLOWUP_BRANCH_SLOTS):
        candidate_mapping = raw
    if candidate_mapping is not None:
        normalized: dict[BranchSlot, dict[str, Any]] = {}
        for slot in FOLLOWUP_BRANCH_SLOTS:
            item = candidate_mapping.get(slot)
            if not isinstance(item, dict):
                continue
            branch_key = str(item.get("branch_key") or "").strip()
            label = str(item.get("label") or "").strip() or branch_key.replace("_", " ").title()
            anchor_npcs = [str(name).strip() for name in item.get("anchor_npcs") or [] if str(name).strip()]
            if branch_key:
                normalized[slot] = {
                    "slot": slot,
                    "branch_key": branch_key,
                    "label": label,
                    "anchor_npcs": anchor_npcs,
                }
        if len(normalized) == len(FOLLOWUP_BRANCH_SLOTS):
            return normalized

    labels = dict(raw.get("branch_labels") or {})
    return {
        FORMAL_PATH_SLOT: {
            **LEGACY_FOLLOWUP_BRANCHES[FORMAL_PATH_SLOT],
            "label": str(labels.get("watch_oath") or LEGACY_FOLLOWUP_BRANCHES[FORMAL_PATH_SLOT]["label"]),
        },
        UNDERCURRENT_PATH_SLOT: {
            **LEGACY_FOLLOWUP_BRANCHES[UNDERCURRENT_PATH_SLOT],
            "label": str(
                labels.get("lantern_whispers") or LEGACY_FOLLOWUP_BRANCHES[UNDERCURRENT_PATH_SLOT]["label"]
            ),
        },
    }


def _followup_branches_for_world(db: Session, world_id: str) -> dict[BranchSlot, dict[str, Any]]:
    _, template = resolve_world_pack(db, world_id)
    return _followup_branches_from_world_pack(
        {
            "followup_branches": serialize_followup_branches(template.roles.followup_branches),
        }
    )


def _branch_entry_for_slot(world_pack: Mapping[str, Any] | None, slot: BranchSlot) -> dict[str, Any]:
    return _followup_branches_from_world_pack(world_pack)[slot]


def branch_key_for_slot(world_pack: Mapping[str, Any] | None, slot: BranchSlot) -> str:
    return str(_branch_entry_for_slot(world_pack, slot).get("branch_key") or "")


def branch_slot_for_key(world_pack: Mapping[str, Any] | None, branch_key: str | None) -> BranchSlot | None:
    candidate = str(branch_key or "").strip()
    if not candidate:
        return None
    for slot, entry in _followup_branches_from_world_pack(world_pack).items():
        if str(entry.get("branch_key") or "") == candidate:
            return slot
    return None


def _branch_entry_for_key(world_pack: Mapping[str, Any] | None, branch_key: str | None) -> dict[str, Any] | None:
    slot = branch_slot_for_key(world_pack, branch_key)
    if slot is None:
        return None
    return _branch_entry_for_slot(world_pack, slot)


def _branch_anchor_names(world_pack: Mapping[str, Any] | None, slot: BranchSlot) -> set[str]:
    entry = _branch_entry_for_slot(world_pack, slot)
    return {str(name).strip().lower() for name in entry.get("anchor_npcs") or [] if str(name).strip()}


def _branch_text_tokens(world_pack: Mapping[str, Any] | None, slot: BranchSlot) -> set[str]:
    entry = _branch_entry_for_slot(world_pack, slot)
    values = [
        str(entry.get("label") or ""),
        str(entry.get("branch_key") or ""),
        *[str(name) for name in entry.get("anchor_npcs") or []],
    ]
    tokens: set[str] = set()
    for value in values:
        tokens.update(_deduplicated_tokens(value))
    return tokens


def _pressure_value(pressures: Mapping[str, float], route_key: str) -> float:
    return float(pressures.get(route_key) or 0.0)


def branch_label(route_key: str | None, *, world_pack: Mapping[str, Any] | None = None) -> str:
    candidate = str(route_key or "").strip()
    if not candidate:
        return "Uncommitted"
    entry = _branch_entry_for_key(world_pack, candidate)
    if entry is not None:
        return str(entry.get("label") or candidate.replace("_", " ").title())
    return candidate.replace("_", " ").title()


def branch_pressure_band(value: float) -> str:
    if value >= 0.6:
        return "high"
    if value >= 0.3:
        return "medium"
    return "low"


def normalize_branch_signals(raw_signals: list[str] | None) -> list[BranchSignal]:
    allowed = set(ROUTE_SIGNAL_WEIGHTS)
    normalized: list[BranchSignal] = []
    for item in raw_signals or []:
        candidate = str(item or "").strip()
        if candidate in allowed and candidate not in normalized:
            normalized.append(candidate)  # type: ignore[arg-type]
    return normalized


def ensure_route_pressures(db: Session, *, world_id: str, actor_id: str, chapter_key: str) -> dict[str, RoutePressure]:
    followup_branches = _followup_branches_for_world(db, world_id)
    route_keys = tuple(str(followup_branches[slot]["branch_key"]) for slot in FOLLOWUP_BRANCH_SLOTS)
    rows = list(
        db.execute(
            select(RoutePressure).where(
                RoutePressure.world_id == world_id,
                RoutePressure.owner_actor_id == actor_id,
                RoutePressure.chapter_key == chapter_key,
            )
        ).scalars()
    )
    indexed = {str(row.route_key): row for row in rows}
    for route_key in route_keys:
        if route_key in indexed:
            continue
        row = RoutePressure(
            id=new_id(),
            world_id=world_id,
            owner_actor_id=actor_id,
            chapter_key=chapter_key,
            route_key=route_key,
            pressure=0.0,
            band="low",
            last_signal="none",
        )
        db.add(row)
        db.flush()
        indexed[route_key] = row
    return {route_key: indexed[route_key] for route_key in route_keys}


def list_route_pressures(db: Session, *, world_id: str, actor_id: str, chapter_key: str) -> list[dict[str, Any]]:
    followup_branches = _followup_branches_for_world(db, world_id)
    route_keys = tuple(str(followup_branches[slot]["branch_key"]) for slot in FOLLOWUP_BRANCH_SLOTS)
    rows = {
        str(row.route_key): row
        for row in db.execute(
            select(RoutePressure).where(
                RoutePressure.world_id == world_id,
                RoutePressure.owner_actor_id == actor_id,
                RoutePressure.chapter_key == chapter_key,
            )
        ).scalars()
    }
    return [
        {
            "route_key": route_key,
            "label": branch_label(route_key, world_pack=followup_branches),
            "pressure": round(float(rows.get(route_key).pressure), 3) if rows.get(route_key) is not None else 0.0,
            "band": rows.get(route_key).band if rows.get(route_key) is not None else "low",
            "last_signal": rows.get(route_key).last_signal if rows.get(route_key) is not None else "none",
        }
        for route_key in route_keys
    ]


def list_route_pressures_debug(db: Session, world_id: str) -> list[dict[str, Any]]:
    followup_branches = _followup_branches_for_world(db, world_id)
    rows = list(
        db.execute(
            select(RoutePressure, Actor)
            .join(Actor, (Actor.id == RoutePressure.owner_actor_id) & (Actor.world_id == RoutePressure.world_id))
            .where(RoutePressure.world_id == world_id)
            .order_by(RoutePressure.updated_at.desc(), RoutePressure.id.desc())
        ).all()
    )
    return [
        {
            "id": row.id,
            "world_id": row.world_id,
            "owner_actor_id": actor.id,
            "owner_actor_name": actor.display_name,
            "chapter_key": row.chapter_key,
            "route_key": row.route_key,
            "label": branch_label(row.route_key, world_pack=followup_branches),
            "pressure": round(float(row.pressure), 3),
            "band": row.band,
            "last_signal": row.last_signal,
            "updated_at": row.updated_at.isoformat(),
        }
        for row, actor in rows
    ]


def list_recent_branch_echoes(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    current_chapter: dict[str, Any] | None = None,
    limit: int = 3,
) -> list[str]:
    actor = db.execute(select(Actor).where(Actor.world_id == world_id, Actor.id == actor_id)).scalar_one_or_none()
    rows = list(
        db.execute(
            select(Event)
            .where(
                Event.world_id == world_id,
                Event.source_actor_id == actor_id,
                Event.event_type == "chapter.branch_committed",
            )
            .order_by(Event.created_at.desc(), Event.id.desc())
            .limit(limit)
        ).scalars()
    )
    echoes: list[str] = []
    for event in rows:
        summary = str((event.payload or {}).get("visible_summary") or event.narrative or "").strip()
        if summary:
            echoes.append(summary)
    if not echoes and current_chapter is not None:
        crossroads = str(current_chapter.get("crossroads_summary") or "").strip()
        if crossroads:
            prefix = actor.display_name if actor is not None else "The chapter"
            echoes.append(f"{prefix}: {crossroads}")
    return echoes[:limit]


def player_visible_branch_hint(
    *,
    world_pack: Mapping[str, Any] | None,
    current_branch: str | None,
    pressures: Mapping[str, float],
    crossroads_status: str,
) -> str:
    formal_key = branch_key_for_slot(world_pack, FORMAL_PATH_SLOT)
    undercurrent_key = branch_key_for_slot(world_pack, UNDERCURRENT_PATH_SLOT)
    formal_label = branch_label(formal_key, world_pack=world_pack)
    undercurrent_label = branch_label(undercurrent_key, world_pack=world_pack)
    current_slot = branch_slot_for_key(world_pack, current_branch)
    if current_slot == FORMAL_PATH_SLOT:
        return f"The chapter now leans toward {formal_label}, formal trust, and the world's more visible order."
    if current_slot == UNDERCURRENT_PATH_SLOT:
        return f"The chapter now leans toward {undercurrent_label}, rumor, undertow, and the world's quieter pull."
    if crossroads_status != "open":
        return ""
    formal = _pressure_value(pressures, formal_key)
    undercurrent = _pressure_value(pressures, undercurrent_key)
    if formal >= undercurrent + 0.1:
        return f"The chapter is beginning to favor {formal_label}, though the quieter route still has something to say."
    if undercurrent >= formal + 0.1:
        return f"The chapter is beginning to favor {undercurrent_label}, though the more formal route is not gone."
    return f"The chapter stands at a crossroads between {formal_label} and {undercurrent_label}."


def crossroads_summary_text(
    *,
    world_pack: Mapping[str, Any] | None,
    current_branch: str | None,
    crossroads_status: str,
    pressures: Mapping[str, float],
) -> str:
    formal_key = branch_key_for_slot(world_pack, FORMAL_PATH_SLOT)
    undercurrent_key = branch_key_for_slot(world_pack, UNDERCURRENT_PATH_SLOT)
    formal_label = branch_label(formal_key, world_pack=world_pack)
    undercurrent_label = branch_label(undercurrent_key, world_pack=world_pack)
    current_slot = branch_slot_for_key(world_pack, current_branch)
    if current_slot == FORMAL_PATH_SLOT:
        return (
            f"The follow-up route has committed to {formal_label}, drawing the scene toward promises kept, "
            "public trust, and the world's visible order."
        )
    if current_slot == UNDERCURRENT_PATH_SLOT:
        return (
            f"The follow-up route has committed to {undercurrent_label}, drawing the scene toward rumor, "
            "undertow, and offstage echoes."
        )
    if crossroads_status != "open":
        return ""
    formal = _pressure_value(pressures, formal_key)
    undercurrent = _pressure_value(pressures, undercurrent_key)
    if formal >= undercurrent + 0.1:
        return f"The follow-up route is splitting toward {formal_label}, though the quieter route still pulls at its edge."
    if undercurrent >= formal + 0.1:
        return (
            f"The follow-up route is splitting toward {undercurrent_label}, "
            "though the more formal route has not fully released its hold."
        )
    return f"The follow-up route now stands at a crossroads between {formal_label} and {undercurrent_label}."


def dominant_branch_key(pressures: list[dict[str, Any]] | None, *, world_pack: Mapping[str, Any] | None = None) -> str | None:
    if not pressures:
        return None
    indexed = {str(item.get("route_key") or ""): float(item.get("pressure") or 0.0) for item in pressures}
    formal_key = branch_key_for_slot(world_pack, FORMAL_PATH_SLOT)
    undercurrent_key = branch_key_for_slot(world_pack, UNDERCURRENT_PATH_SLOT)
    formal = indexed.get(formal_key, 0.0)
    undercurrent = indexed.get(undercurrent_key, 0.0)
    if formal == undercurrent:
        return None
    return formal_key if formal > undercurrent else undercurrent_key


def _current_chapter(db: Session, *, world_id: str, actor_id: str) -> ChapterTrack | None:
    rows = list(
        db.execute(
            select(ChapterTrack)
            .where(
                ChapterTrack.world_id == world_id,
                ChapterTrack.owner_actor_id == actor_id,
                ChapterTrack.status.in_(("active", "cooling")),
            )
            .order_by((ChapterTrack.status == "active").desc(), ChapterTrack.updated_at.desc(), ChapterTrack.id.desc())
        ).scalars()
    )
    return rows[0] if rows else None


def _band_is_warm(summary: dict[str, Any]) -> bool:
    return str(summary.get("band") or "") in {"warm", "trusted"}


def _thread_types(session_state: dict[str, Any]) -> set[str]:
    return {str(item.get("thread_type") or "") for item in (session_state.get("active_consequence_threads") or [])}


def _location_key(session_state: dict[str, Any]) -> str:
    current_location = session_state.get("current_location") or session_state.get("location") or {}
    return str(current_location.get("key") or "")


def _world_pack(session_state: dict[str, Any]) -> dict[str, Any]:
    return dict(session_state.get("world_pack") or {})


def _followup_chapter_key(session_state: dict[str, Any]) -> str:
    return str(_world_pack(session_state).get("followup_chapter_key") or "followup_chapter")


def _offstage_texts(session_state: dict[str, Any]) -> list[str]:
    return [
        *[str(item) for item in (session_state.get("recent_offstage_beats") or []) if str(item).strip()],
        *[str(item) for item in (session_state.get("offstage_murmurs") or []) if str(item).strip()],
        *[str(item) for item in (session_state.get("recent_world_beats") or []) if str(item).strip()],
        *[str(item) for item in (session_state.get("ambient_murmurs") or []) if str(item).strip()],
    ][:8]


ROUTE_SIGNAL_WEIGHTS: dict[BranchSignal, dict[BranchSlot, float]] = {
    "formal_trust": {FORMAL_PATH_SLOT: 0.12, UNDERCURRENT_PATH_SLOT: -0.02},
    "kept_formal_promise": {FORMAL_PATH_SLOT: 0.15, UNDERCURRENT_PATH_SLOT: -0.03},
    "rumor_curiosity": {FORMAL_PATH_SLOT: -0.02, UNDERCURRENT_PATH_SLOT: 0.12},
    "street_pull": {FORMAL_PATH_SLOT: -0.02, UNDERCURRENT_PATH_SLOT: 0.12},
    "public_scrutiny": {FORMAL_PATH_SLOT: 0.03, UNDERCURRENT_PATH_SLOT: 0.08},
    "sigil_duty": {FORMAL_PATH_SLOT: 0.1, UNDERCURRENT_PATH_SLOT: 0.02},
}


def infer_branch_signals(
    *,
    world_tags: list[str],
    consequence_tags: list[str],
    session_state: dict[str, Any],
) -> list[BranchSignal]:
    signals: list[BranchSignal] = []
    world_pack = _world_pack(session_state)
    thread_types = _thread_types(session_state)
    location_key = _location_key(session_state)
    relationship_summaries = session_state.get("relationships") or []
    offstage_text = " ".join(_offstage_texts(session_state)).lower()
    starter_location_key = str(world_pack.get("starter_location_key") or "")
    lore_location_key = str(world_pack.get("lore_location_key") or "")
    followup_location_key = str(world_pack.get("followup_location_key") or "")
    formal_anchor_names = _branch_anchor_names(world_pack, FORMAL_PATH_SLOT)
    undercurrent_anchor_names = _branch_anchor_names(world_pack, UNDERCURRENT_PATH_SLOT)
    formal_tokens = _branch_text_tokens(world_pack, FORMAL_PATH_SLOT) | {"promise", "oath", "duty", "order"}
    undercurrent_tokens = _branch_text_tokens(world_pack, UNDERCURRENT_PATH_SLOT) | {
        "rumor",
        "whisper",
        "street",
        "undertow",
    }

    if any(tag in consequence_tags for tag in ("earned_trust", "kept_promise", "sigil_respect")):
        signals.extend(["formal_trust", "sigil_duty"])
    if any(tag in consequence_tags for tag in ("careful_observation", "public_attention", "missed_timing")):
        signals.extend(["rumor_curiosity"])
    if any(tag in world_tags for tag in ("aid_local", "promise_followup", "collect_reward")):
        signals.append("kept_formal_promise")
    if "investigate" in world_tags:
        signals.extend(["rumor_curiosity", "street_pull"])
    if "scrutiny" in thread_types:
        signals.append("public_scrutiny")
    if "rumor" in thread_types:
        signals.append("street_pull")
    if lore_location_key and location_key == lore_location_key:
        signals.append("formal_trust")
    if followup_location_key and location_key == followup_location_key:
        signals.append("sigil_duty")
    if starter_location_key and location_key == starter_location_key:
        signals.append("street_pull")
    if any(
        _band_is_warm(item) and str(item.get("display_name") or "").strip().lower() in formal_anchor_names
        for item in relationship_summaries
    ):
        signals.append("formal_trust")
    if any(
        _band_is_warm(item) and str(item.get("display_name") or "").strip().lower() in undercurrent_anchor_names
        for item in relationship_summaries
    ):
        signals.append("rumor_curiosity")
    if any(token in offstage_text for token in undercurrent_tokens):
        signals.append("street_pull")
    if any(token in offstage_text for token in formal_tokens):
        signals.append("kept_formal_promise")

    normalized: list[BranchSignal] = []
    for signal in signals:
        if signal not in normalized:
            normalized.append(signal)
    return normalized


def _top_signal(signals: list[BranchSignal]) -> str:
    return signals[0] if signals else "none"


def _clamp(value: float, *, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _dominant_row(rows: dict[str, RoutePressure], *, world_pack: Mapping[str, Any] | None) -> tuple[str, RoutePressure]:
    formal_key = branch_key_for_slot(world_pack, FORMAL_PATH_SLOT)
    undercurrent_key = branch_key_for_slot(world_pack, UNDERCURRENT_PATH_SLOT)
    formal = rows[formal_key]
    undercurrent = rows[undercurrent_key]
    if float(formal.pressure) >= float(undercurrent.pressure):
        return formal_key, formal
    return undercurrent_key, undercurrent


def _commit_ready(rows: dict[str, RoutePressure], *, world_pack: Mapping[str, Any] | None) -> str | None:
    formal_key = branch_key_for_slot(world_pack, FORMAL_PATH_SLOT)
    undercurrent_key = branch_key_for_slot(world_pack, UNDERCURRENT_PATH_SLOT)
    formal = float(rows[formal_key].pressure)
    undercurrent = float(rows[undercurrent_key].pressure)
    if formal >= 0.6 and formal - undercurrent >= 0.2:
        return formal_key
    if undercurrent >= 0.6 and undercurrent - formal >= 0.2:
        return undercurrent_key
    return None


class BranchPressureEngine:
    @staticmethod
    def apply_player_turn(
        db: Session,
        *,
        world_id: str,
        actor_id: str,
        source_event_id: str,
        location_id: str | None,
        session_state: dict[str, Any],
        outcome_band: str,
        world_tags: list[str],
        consequence_tags: list[str],
        branch_signals: list[str] | None,
    ) -> BranchPressureResult:
        chapter = _current_chapter(db, world_id=world_id, actor_id=actor_id)
        if chapter is None or chapter.chapter_key != _followup_chapter_key(session_state):
            return BranchPressureResult(updates=[], crossroads_summary="", branch_hint="", current_branch=None, commit=None)

        world_pack = _world_pack(session_state)
        followup_branches = _followup_branches_from_world_pack(world_pack)
        rows = ensure_route_pressures(db, world_id=world_id, actor_id=actor_id, chapter_key=chapter.chapter_key)
        if branch_slot_for_key(world_pack, chapter.branch_key) is not None:
            pressures = {route_key: round(float(row.pressure), 3) for route_key, row in rows.items()}
            chapter.crossroads_status = "committed"
            chapter.crossroads_summary = crossroads_summary_text(
                world_pack=followup_branches,
                current_branch=chapter.branch_key,
                crossroads_status=chapter.crossroads_status,
                pressures=pressures,
            )
            db.flush()
            return BranchPressureResult(
                updates=[],
                crossroads_summary=chapter.crossroads_summary,
                branch_hint=player_visible_branch_hint(
                    world_pack=followup_branches,
                    current_branch=chapter.branch_key,
                    pressures=pressures,
                    crossroads_status=chapter.crossroads_status,
                ),
                current_branch=chapter.branch_key,
                commit=None,
            )

        signals = normalize_branch_signals(branch_signals) or infer_branch_signals(
            world_tags=world_tags,
            consequence_tags=consequence_tags,
            session_state=session_state,
        )
        now = datetime.now(timezone.utc)
        deltas_by_slot: dict[BranchSlot, float] = {
            FORMAL_PATH_SLOT: 0.0,
            UNDERCURRENT_PATH_SLOT: 0.0,
        }
        for signal in signals:
            weights = ROUTE_SIGNAL_WEIGHTS.get(signal)
            if weights is None:
                continue
            for slot, delta in weights.items():
                deltas_by_slot[slot] += delta
        deltas_by_slot[FORMAL_PATH_SLOT] += 0.04 if "promise" in _thread_types(session_state) else 0.0
        deltas_by_slot[UNDERCURRENT_PATH_SLOT] += 0.04 if {"rumor", "scrutiny"} & _thread_types(session_state) else 0.0
        if outcome_band == "setback":
            deltas_by_slot[FORMAL_PATH_SLOT] = min(deltas_by_slot[FORMAL_PATH_SLOT], 0.05)
            deltas_by_slot[UNDERCURRENT_PATH_SLOT] += 0.03
        elif outcome_band == "tangled":
            deltas_by_slot[UNDERCURRENT_PATH_SLOT] += 0.02

        if deltas_by_slot[FORMAL_PATH_SLOT] > deltas_by_slot[UNDERCURRENT_PATH_SLOT]:
            deltas_by_slot[UNDERCURRENT_PATH_SLOT] -= 0.03
        elif deltas_by_slot[UNDERCURRENT_PATH_SLOT] > deltas_by_slot[FORMAL_PATH_SLOT]:
            deltas_by_slot[FORMAL_PATH_SLOT] -= 0.03

        updates: list[dict[str, Any]] = []
        for slot in FOLLOWUP_BRANCH_SLOTS:
            route_key = str(followup_branches[slot]["branch_key"])
            row = rows[route_key]
            delta = _clamp(deltas_by_slot[slot], minimum=-0.15, maximum=0.15)
            row.pressure = round(_clamp(float(row.pressure) + delta, minimum=0.0, maximum=1.0), 3)
            row.band = branch_pressure_band(float(row.pressure))
            row.last_signal = _top_signal(signals)
            row.updated_at = now
            updates.append(
                {
                    "action": "pressure_shifted",
                    "summary": (
                        f"The chapter leans a little more toward {branch_label(route_key, world_pack=followup_branches)}."
                        if abs(delta) >= 0.01
                        else f"The pressure around {branch_label(route_key, world_pack=followup_branches)} holds in place."
                    ),
                    "branch_hint": "",
                    "crossroads_summary": "",
                }
            )

        commit: BranchCommitDraft | None = None
        committed_key = _commit_ready(rows, world_pack=followup_branches) if outcome_band != "setback" else None
        if committed_key is not None:
            chapter.branch_key = committed_key
            chapter.crossroads_status = "committed"
            chapter.committed_at = now
        else:
            chapter.crossroads_status = "open"
        pressures = {route_key: round(float(row.pressure), 3) for route_key, row in rows.items()}
        current_branch = chapter.branch_key if branch_slot_for_key(followup_branches, chapter.branch_key) is not None else None
        chapter.crossroads_summary = crossroads_summary_text(
            world_pack=followup_branches,
            current_branch=current_branch,
            crossroads_status=chapter.crossroads_status,
            pressures=pressures,
        )
        chapter.updated_at = now

        if committed_key is not None:
            visible_summary = chapter.crossroads_summary
            commit = BranchCommitDraft(
                route_key=committed_key,
                event_type="chapter.branch_committed",
                narrative=visible_summary,
                payload={
                    "route_key": committed_key,
                    "label": branch_label(committed_key, world_pack=followup_branches),
                    "visible_summary": visible_summary,
                    "crossroads_summary": visible_summary,
                },
                memory_drafts=[
                    {
                        "scope": "world",
                        "text": visible_summary,
                        "salience": 0.91,
                        "location_id": location_id,
                        "actor_id": None,
                    }
                ],
            )
            updates = [
                {
                    "action": "committed",
                    "summary": visible_summary,
                    "branch_hint": player_visible_branch_hint(
                        world_pack=followup_branches,
                        current_branch=committed_key,
                        pressures=pressures,
                        crossroads_status="committed",
                    ),
                    "crossroads_summary": visible_summary,
                }
            ]
        else:
            hint = player_visible_branch_hint(
                world_pack=followup_branches,
                current_branch=None,
                pressures=pressures,
                crossroads_status=chapter.crossroads_status,
            )
            updates = [
                {
                    "action": "crossroads_opened" if chapter.crossroads_status == "open" else "pressure_shifted",
                    "summary": chapter.crossroads_summary,
                    "branch_hint": hint,
                    "crossroads_summary": chapter.crossroads_summary,
                }
            ]

        db.flush()
        return BranchPressureResult(
            updates=updates,
            crossroads_summary=chapter.crossroads_summary,
            branch_hint=player_visible_branch_hint(
                world_pack=followup_branches,
                current_branch=current_branch,
                pressures=pressures,
                crossroads_status=chapter.crossroads_status,
            ),
            current_branch=current_branch,
            commit=commit,
        )

    @staticmethod
    def apply_idle_pass(
        db: Session,
        *,
        world_id: str,
        actor_id: str,
        session_state: dict[str, Any],
        beat_updates: list[dict[str, Any]],
    ) -> BranchPressureResult:
        chapter = _current_chapter(db, world_id=world_id, actor_id=actor_id)
        if chapter is None or chapter.chapter_key != _followup_chapter_key(session_state):
            return BranchPressureResult(updates=[], crossroads_summary="", branch_hint="", current_branch=None, commit=None)

        world_pack = _world_pack(session_state)
        followup_branches = _followup_branches_from_world_pack(world_pack)
        if branch_slot_for_key(world_pack, chapter.branch_key) is not None:
            pressures = {
                route_key: round(float(row.pressure), 3)
                for route_key, row in ensure_route_pressures(
                    db,
                    world_id=world_id,
                    actor_id=actor_id,
                    chapter_key=chapter.chapter_key,
                ).items()
            }
            return BranchPressureResult(
                updates=[],
                crossroads_summary=chapter.crossroads_summary,
                branch_hint=player_visible_branch_hint(
                    world_pack=followup_branches,
                    current_branch=chapter.branch_key,
                    pressures=pressures,
                    crossroads_status=chapter.crossroads_status,
                ),
                current_branch=chapter.branch_key,
                commit=None,
            )

        rows = ensure_route_pressures(db, world_id=world_id, actor_id=actor_id, chapter_key=chapter.chapter_key)
        formal_anchor_names = _branch_anchor_names(world_pack, FORMAL_PATH_SLOT)
        undercurrent_anchor_names = _branch_anchor_names(world_pack, UNDERCURRENT_PATH_SLOT)
        formal_tokens = _branch_text_tokens(world_pack, FORMAL_PATH_SLOT) | {"promise", "oath", "order", "duty"}
        undercurrent_tokens = _branch_text_tokens(world_pack, UNDERCURRENT_PATH_SLOT) | {
            "rumor",
            "whisper",
            "street",
            "undertow",
        }
        deltas_by_slot: dict[BranchSlot, float] = {
            FORMAL_PATH_SLOT: 0.0,
            UNDERCURRENT_PATH_SLOT: 0.0,
        }
        for update in beat_updates:
            actor_name = str(update.get("display_name") or "").strip().lower()
            beat_kind = str(update.get("beat_kind") or "")
            summary = str(update.get("summary") or "").lower()
            if actor_name in formal_anchor_names:
                if beat_kind == "reassure":
                    deltas_by_slot[FORMAL_PATH_SLOT] += 0.05
                elif beat_kind in {"observe", "question"}:
                    deltas_by_slot[FORMAL_PATH_SLOT] += 0.03
            elif actor_name in undercurrent_anchor_names:
                if beat_kind in {"murmur", "question", "relocate"}:
                    deltas_by_slot[UNDERCURRENT_PATH_SLOT] += 0.05
                elif beat_kind == "reassure":
                    deltas_by_slot[UNDERCURRENT_PATH_SLOT] += 0.02
            if any(token in summary for token in undercurrent_tokens):
                deltas_by_slot[UNDERCURRENT_PATH_SLOT] += 0.02
            if any(token in summary for token in formal_tokens):
                deltas_by_slot[FORMAL_PATH_SLOT] += 0.02

        now = datetime.now(timezone.utc)
        for slot in FOLLOWUP_BRANCH_SLOTS:
            route_key = str(followup_branches[slot]["branch_key"])
            row = rows[route_key]
            delta = _clamp(deltas_by_slot[slot], minimum=-0.05, maximum=0.05)
            row.pressure = round(_clamp(float(row.pressure) + delta, minimum=0.0, maximum=1.0), 3)
            row.band = branch_pressure_band(float(row.pressure))
            row.last_signal = "idle_world_pass"
            row.updated_at = now
        pressures = {route_key: round(float(row.pressure), 3) for route_key, row in rows.items()}
        chapter.crossroads_status = "open"
        chapter.crossroads_summary = crossroads_summary_text(
            world_pack=followup_branches,
            current_branch=None,
            crossroads_status="open",
            pressures=pressures,
        )
        chapter.updated_at = now
        db.flush()
        return BranchPressureResult(
            updates=[],
            crossroads_summary=chapter.crossroads_summary,
            branch_hint=player_visible_branch_hint(
                world_pack=followup_branches,
                current_branch=None,
                pressures=pressures,
                crossroads_status="open",
            ),
            current_branch=None,
            commit=None,
        )
