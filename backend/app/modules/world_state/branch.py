from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Actor, ChapterTrack, Event, RoutePressure, new_id


BranchKey = Literal["watch_oath", "lantern_whispers"]
BranchSignal = Literal[
    "formal_trust",
    "kept_watch_promise",
    "rumor_curiosity",
    "street_pull",
    "public_scrutiny",
    "sigil_duty",
]

ROUTE_KEYS: tuple[BranchKey, BranchKey] = ("watch_oath", "lantern_whispers")


@dataclass(frozen=True)
class BranchCommitDraft:
    route_key: BranchKey
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
    current_branch: BranchKey | None
    commit: BranchCommitDraft | None


def branch_label(route_key: BranchKey | str | None) -> str:
    if route_key == "watch_oath":
        return "Watch Oath"
    if route_key == "lantern_whispers":
        return "Lantern Whispers"
    return "Uncommitted"


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


def ensure_route_pressures(db: Session, *, world_id: str, actor_id: str, chapter_key: str) -> dict[BranchKey, RoutePressure]:
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
    if chapter_key != "watch_path_followup":
        return {
            route_key: indexed[route_key]  # type: ignore[index]
            for route_key in ROUTE_KEYS
            if route_key in indexed
        }

    for route_key in ROUTE_KEYS:
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
    return {route_key: indexed[route_key] for route_key in ROUTE_KEYS}


def list_route_pressures(db: Session, *, world_id: str, actor_id: str, chapter_key: str = "watch_path_followup") -> list[dict[str, Any]]:
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
            "label": branch_label(route_key),
            "pressure": round(float(rows.get(route_key).pressure), 3) if rows.get(route_key) is not None else 0.0,
            "band": rows.get(route_key).band if rows.get(route_key) is not None else "low",
            "last_signal": rows.get(route_key).last_signal if rows.get(route_key) is not None else "none",
        }
        for route_key in ROUTE_KEYS
    ]


def list_route_pressures_debug(db: Session, world_id: str) -> list[dict[str, Any]]:
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
            "label": branch_label(row.route_key),
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
    current_branch: BranchKey | None,
    pressures: dict[BranchKey, float],
    crossroads_status: str,
) -> str:
    if current_branch == "watch_oath":
        return "The chapter now leans toward formal trust, duty, and the watch's visible oath."
    if current_branch == "lantern_whispers":
        return "The chapter now leans toward rumor, lampglow, and the city's quieter undercurrent."
    if crossroads_status != "open":
        return ""
    watch = pressures["watch_oath"]
    lantern = pressures["lantern_whispers"]
    if watch >= lantern + 0.1:
        return "The chapter is beginning to favor the watch's formal path, though the street still has something to say."
    if lantern >= watch + 0.1:
        return "The chapter is beginning to favor the city's whispers, though the oath-bound path is not gone."
    return "The chapter stands at a crossroads between the watch's formal oath and the city's quieter whispers."


def crossroads_summary_text(
    *,
    current_branch: BranchKey | None,
    crossroads_status: str,
    pressures: dict[BranchKey, float],
) -> str:
    if current_branch == "watch_oath":
        return "The watch path has committed to Watch Oath, drawing the scene toward promises kept, order, and formal trust."
    if current_branch == "lantern_whispers":
        return "The watch path has committed to Lantern Whispers, drawing the scene toward rumor, lampglow, and offstage echoes."
    if crossroads_status != "open":
        return ""
    watch = pressures["watch_oath"]
    lantern = pressures["lantern_whispers"]
    if watch >= lantern + 0.1:
        return "The watch path is splitting toward a more formal oath, though the city's whispers still pull at its edge."
    if lantern >= watch + 0.1:
        return "The watch path is splitting toward whispers and rumor, though the formal oath has not fully released its hold."
    return "The watch path now stands at a crossroads between Watch Oath and Lantern Whispers."


def dominant_branch_key(pressures: list[dict[str, Any]] | None) -> BranchKey | None:
    if not pressures:
        return None
    indexed = {str(item.get("route_key") or ""): float(item.get("pressure") or 0.0) for item in pressures}
    watch = indexed.get("watch_oath", 0.0)
    lantern = indexed.get("lantern_whispers", 0.0)
    if watch == lantern:
        return None
    return "watch_oath" if watch > lantern else "lantern_whispers"


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


def _offstage_texts(session_state: dict[str, Any]) -> list[str]:
    return [
        *[str(item) for item in (session_state.get("recent_offstage_beats") or []) if str(item).strip()],
        *[str(item) for item in (session_state.get("offstage_murmurs") or []) if str(item).strip()],
        *[str(item) for item in (session_state.get("recent_world_beats") or []) if str(item).strip()],
        *[str(item) for item in (session_state.get("ambient_murmurs") or []) if str(item).strip()],
    ][:8]


ROUTE_SIGNAL_WEIGHTS: dict[BranchSignal, dict[BranchKey, float]] = {
    "formal_trust": {"watch_oath": 0.12, "lantern_whispers": -0.02},
    "kept_watch_promise": {"watch_oath": 0.15, "lantern_whispers": -0.03},
    "rumor_curiosity": {"watch_oath": -0.02, "lantern_whispers": 0.12},
    "street_pull": {"watch_oath": -0.02, "lantern_whispers": 0.12},
    "public_scrutiny": {"watch_oath": 0.03, "lantern_whispers": 0.08},
    "sigil_duty": {"watch_oath": 0.1, "lantern_whispers": 0.02},
}


def infer_branch_signals(
    *,
    world_tags: list[str],
    consequence_tags: list[str],
    session_state: dict[str, Any],
) -> list[BranchSignal]:
    signals: list[BranchSignal] = []
    thread_types = _thread_types(session_state)
    location_key = _location_key(session_state)
    relationship_summaries = session_state.get("relationships") or []
    offstage_text = " ".join(_offstage_texts(session_state)).lower()

    if any(tag in consequence_tags for tag in ("earned_trust", "kept_promise", "sigil_respect")):
        signals.extend(["formal_trust", "sigil_duty"])
    if any(tag in consequence_tags for tag in ("careful_observation", "public_attention", "missed_timing")):
        signals.extend(["rumor_curiosity"])
    if any(tag in world_tags for tag in ("aid_local", "promise_followup", "collect_reward")):
        signals.append("kept_watch_promise")
    if "investigate" in world_tags:
        signals.extend(["rumor_curiosity", "street_pull"])
    if "scrutiny" in thread_types:
        signals.append("public_scrutiny")
    if "rumor" in thread_types:
        signals.append("street_pull")
    if location_key == "archive_steps":
        signals.append("formal_trust")
    if location_key == "watch_path":
        signals.append("sigil_duty")
    if location_key == "square":
        signals.append("street_pull")
    if any(_band_is_warm(item) and "Archivist Nera" in str(item.get("display_name") or "") for item in relationship_summaries):
        signals.append("formal_trust")
    if any(
        _band_is_warm(item) and str(item.get("display_name") or "") in {"Courier Pell", "Lamplighter Sera"}
        for item in relationship_summaries
    ):
        signals.append("rumor_curiosity")
    if any(token in offstage_text for token in ("courier pell", "lamplighter sera", "rumor", "whisper", "lamp")):
        signals.append("street_pull")
    if any(token in offstage_text for token in ("archivist nera", "watch", "oath", "promise")):
        signals.append("kept_watch_promise")

    normalized: list[BranchSignal] = []
    for signal in signals:
        if signal not in normalized:
            normalized.append(signal)
    return normalized


def _top_signal(signals: list[BranchSignal]) -> str:
    return signals[0] if signals else "none"


def _clamp(value: float, *, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _dominant_row(rows: dict[BranchKey, RoutePressure]) -> tuple[BranchKey, RoutePressure]:
    if float(rows["watch_oath"].pressure) >= float(rows["lantern_whispers"].pressure):
        return "watch_oath", rows["watch_oath"]
    return "lantern_whispers", rows["lantern_whispers"]


def _commit_ready(rows: dict[BranchKey, RoutePressure]) -> BranchKey | None:
    watch = float(rows["watch_oath"].pressure)
    lantern = float(rows["lantern_whispers"].pressure)
    if watch >= 0.6 and watch - lantern >= 0.2:
        return "watch_oath"
    if lantern >= 0.6 and lantern - watch >= 0.2:
        return "lantern_whispers"
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
        if chapter is None or chapter.chapter_key != "watch_path_followup":
            return BranchPressureResult(updates=[], crossroads_summary="", branch_hint="", current_branch=None, commit=None)

        rows = ensure_route_pressures(db, world_id=world_id, actor_id=actor_id, chapter_key=chapter.chapter_key)
        if chapter.branch_key in ROUTE_KEYS:
            pressures = {route_key: round(float(row.pressure), 3) for route_key, row in rows.items()}
            chapter.crossroads_status = "committed"
            chapter.crossroads_summary = crossroads_summary_text(
                current_branch=chapter.branch_key,  # type: ignore[arg-type]
                crossroads_status=chapter.crossroads_status,
                pressures=pressures,  # type: ignore[arg-type]
            )
            db.flush()
            return BranchPressureResult(
                updates=[],
                crossroads_summary=chapter.crossroads_summary,
                branch_hint=player_visible_branch_hint(
                    current_branch=chapter.branch_key,  # type: ignore[arg-type]
                    pressures=pressures,  # type: ignore[arg-type]
                    crossroads_status=chapter.crossroads_status,
                ),
                current_branch=chapter.branch_key,  # type: ignore[return-value]
                commit=None,
            )

        signals = normalize_branch_signals(branch_signals) or infer_branch_signals(
            world_tags=world_tags,
            consequence_tags=consequence_tags,
            session_state=session_state,
        )
        now = datetime.now(timezone.utc)
        deltas: dict[BranchKey, float] = {"watch_oath": 0.0, "lantern_whispers": 0.0}
        for signal in signals:
            weights = ROUTE_SIGNAL_WEIGHTS.get(signal)
            if weights is None:
                continue
            for route_key, delta in weights.items():
                deltas[route_key] += delta
        deltas["watch_oath"] += 0.04 if "promise" in _thread_types(session_state) else 0.0
        deltas["lantern_whispers"] += 0.04 if {"rumor", "scrutiny"} & _thread_types(session_state) else 0.0
        if outcome_band == "setback":
            deltas["watch_oath"] = min(deltas["watch_oath"], 0.05)
            deltas["lantern_whispers"] += 0.03
        elif outcome_band == "tangled":
            deltas["lantern_whispers"] += 0.02

        if deltas["watch_oath"] > deltas["lantern_whispers"]:
            deltas["lantern_whispers"] -= 0.03
        elif deltas["lantern_whispers"] > deltas["watch_oath"]:
            deltas["watch_oath"] -= 0.03

        updates: list[dict[str, Any]] = []
        for route_key, row in rows.items():
            delta = _clamp(deltas[route_key], minimum=-0.15, maximum=0.15)
            row.pressure = round(_clamp(float(row.pressure) + delta, minimum=0.0, maximum=1.0), 3)
            row.band = branch_pressure_band(float(row.pressure))
            row.last_signal = _top_signal(signals)
            row.updated_at = now
            updates.append(
                {
                    "action": "pressure_shifted",
                    "summary": (
                        f"The chapter leans a little more toward {branch_label(route_key)}."
                        if abs(delta) >= 0.01
                        else f"The pressure around {branch_label(route_key)} holds in place."
                    ),
                    "branch_hint": "",
                    "crossroads_summary": "",
                }
            )

        commit: BranchCommitDraft | None = None
        committed_key = _commit_ready(rows) if outcome_band != "setback" else None
        if committed_key is not None:
            chapter.branch_key = committed_key
            chapter.crossroads_status = "committed"
            chapter.committed_at = now
        else:
            chapter.crossroads_status = "open"
        pressures = {route_key: round(float(row.pressure), 3) for route_key, row in rows.items()}
        current_branch: BranchKey | None = chapter.branch_key if chapter.branch_key in ROUTE_KEYS else None  # type: ignore[assignment]
        chapter.crossroads_summary = crossroads_summary_text(
            current_branch=current_branch,
            crossroads_status=chapter.crossroads_status,
            pressures=pressures,  # type: ignore[arg-type]
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
                    "label": branch_label(committed_key),
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
                        current_branch=committed_key,
                        pressures=pressures,  # type: ignore[arg-type]
                        crossroads_status="committed",
                    ),
                    "crossroads_summary": visible_summary,
                }
            ]
        else:
            hint = player_visible_branch_hint(
                current_branch=None,
                pressures=pressures,  # type: ignore[arg-type]
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
                current_branch=current_branch,
                pressures=pressures,  # type: ignore[arg-type]
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
        beat_updates: list[dict[str, Any]],
    ) -> BranchPressureResult:
        chapter = _current_chapter(db, world_id=world_id, actor_id=actor_id)
        if chapter is None or chapter.chapter_key != "watch_path_followup":
            return BranchPressureResult(updates=[], crossroads_summary="", branch_hint="", current_branch=None, commit=None)
        if chapter.branch_key in ROUTE_KEYS:
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
                    current_branch=chapter.branch_key,  # type: ignore[arg-type]
                    pressures=pressures,  # type: ignore[arg-type]
                    crossroads_status=chapter.crossroads_status,
                ),
                current_branch=chapter.branch_key,  # type: ignore[return-value]
                commit=None,
            )

        rows = ensure_route_pressures(db, world_id=world_id, actor_id=actor_id, chapter_key=chapter.chapter_key)
        deltas: dict[BranchKey, float] = {"watch_oath": 0.0, "lantern_whispers": 0.0}
        for update in beat_updates:
            actor_name = str(update.get("display_name") or "")
            beat_kind = str(update.get("beat_kind") or "")
            summary = str(update.get("summary") or "").lower()
            if actor_name == "Archivist Nera":
                if beat_kind == "reassure":
                    deltas["watch_oath"] += 0.05
                elif beat_kind in {"observe", "question"}:
                    deltas["watch_oath"] += 0.03
            elif actor_name in {"Courier Pell", "Lamplighter Sera"}:
                if beat_kind in {"murmur", "question", "relocate"}:
                    deltas["lantern_whispers"] += 0.05
                elif beat_kind == "reassure":
                    deltas["lantern_whispers"] += 0.02
            if "rumor" in summary or "whisper" in summary:
                deltas["lantern_whispers"] += 0.02
            if "promise" in summary or "watch" in summary:
                deltas["watch_oath"] += 0.02

        now = datetime.now(timezone.utc)
        for route_key, row in rows.items():
            delta = _clamp(deltas[route_key], minimum=-0.05, maximum=0.05)
            row.pressure = round(_clamp(float(row.pressure) + delta, minimum=0.0, maximum=1.0), 3)
            row.band = branch_pressure_band(float(row.pressure))
            row.last_signal = "idle_world_pass"
            row.updated_at = now
        pressures = {route_key: round(float(row.pressure), 3) for route_key, row in rows.items()}
        chapter.crossroads_status = "open"
        chapter.crossroads_summary = crossroads_summary_text(
            current_branch=None,
            crossroads_status="open",
            pressures=pressures,  # type: ignore[arg-type]
        )
        chapter.updated_at = now
        db.flush()
        return BranchPressureResult(
            updates=[],
            crossroads_summary=chapter.crossroads_summary,
            branch_hint=player_visible_branch_hint(
                current_branch=None,
                pressures=pressures,  # type: ignore[arg-type]
                crossroads_status="open",
            ),
            current_branch=None,
            commit=None,
        )
