from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Actor, ChapterTrack, Location, SceneFrame, new_id
from app.modules.world_pack.service import resolve_world_pack
from app.modules.world_state.branch import branch_label


SceneMove = Literal["hold", "deepen", "pivot", "close"]
ScenePressure = Literal["low", "medium", "high"]
ScenePhase = Literal["establish", "pressure", "reveal", "settle"]
ChapterStatus = Literal["active", "cooling", "resolved"]
SceneStatus = Literal["active", "cooling", "closed"]


@dataclass(frozen=True)
class SceneFrameUpdateResult:
    chapter_updates: list[dict[str, Any]]
    scene_updates: list[dict[str, Any]]
    scene_summary: str


def _active_quest(state: dict[str, Any]) -> dict[str, Any]:
    quests = state.get("quests") or []
    return next((item for item in quests if item.get("status") == "active"), quests[0] if quests else {})


def _followup_quest(state: dict[str, Any]) -> dict[str, Any]:
    quests = state.get("quests") or []
    followup_stage_key = str((state.get("world_pack") or {}).get("followup_stage_key") or "followup_stage")
    return next((item for item in quests if item.get("stage_key") == followup_stage_key), {})


def _thread_summary(state: dict[str, Any]) -> str | None:
    threads = state.get("active_consequence_threads") or []
    if not threads:
        return None
    summary = str(threads[0].get("summary") or "").strip()
    return summary or None


def _chapter_key_for_state(state: dict[str, Any]) -> str:
    world_pack = state.get("world_pack") or {}
    followup_chapter_key = str(world_pack.get("followup_chapter_key") or "followup_chapter")
    opening_chapter_key = str(world_pack.get("opening_chapter_key") or "opening_chapter")
    reward_effect_kind = str(world_pack.get("reward_effect_kind") or "unlock_followup_route")
    followup = _followup_quest(state)
    inventory = state.get("inventory") or []
    if followup:
        return followup_chapter_key
    if any(str(item.get("effect_kind") or "") == reward_effect_kind and str(item.get("status") or "") == "used" for item in inventory):
        return followup_chapter_key
    return opening_chapter_key


def _chapter_status_for_state(chapter_key: str, state: dict[str, Any]) -> ChapterStatus:
    followup_chapter_key = str((state.get("world_pack") or {}).get("followup_chapter_key") or "followup_chapter")
    if chapter_key == followup_chapter_key:
        followup = _followup_quest(state)
        if followup and str(followup.get("status") or "") == "completed":
            return "cooling"
    return "active"


def chapter_summary_for_state(chapter_key: str, chapter_status: ChapterStatus, state: dict[str, Any]) -> str:
    world_pack = state.get("world_pack") or {}
    followup_chapter_key = str(world_pack.get("followup_chapter_key") or "followup_chapter")
    followup_location_name = str(world_pack.get("followup_location_name") or "the next route")
    starter_location_name = str(world_pack.get("starter_location_name") or "the starting place")
    world_name = str(world_pack.get("world_name") or "the current world")
    reward_name = str(world_pack.get("reward_name") or "the seal")
    branch_labels = dict(world_pack.get("branch_labels") or {})
    watch_branch_label = str(branch_labels.get("watch_oath") or branch_label("watch_oath"))
    whisper_branch_label = str(branch_labels.get("lantern_whispers") or branch_label("lantern_whispers"))
    chapter_state = state.get("chapter") or {}
    current_branch = str(chapter_state.get("current_branch") or "")
    crossroads_summary = str(chapter_state.get("crossroads_summary") or "").strip()
    if chapter_key == followup_chapter_key:
        if current_branch == "watch_oath":
            base = (
                f"The next chapter follows {followup_location_name} through {watch_branch_label}, leaning toward formal trust, "
                "kept promises, and the watch's visible order."
            )
        elif current_branch == "lantern_whispers":
            base = (
                f"The next chapter follows {followup_location_name} through {whisper_branch_label}, leaning toward rumor, "
                "lampglow, and the city's offstage pull."
            )
        elif crossroads_summary:
            base = crossroads_summary
        else:
            base = f"The next chapter follows {followup_location_name}, the route {reward_name} opened beyond {starter_location_name}."
        if chapter_status == "cooling":
            return f"{base} Its main beat has landed, and the chapter is cooling into aftermath."
        if chapter_status == "resolved":
            return f"{base} Its central turn has already resolved."
        return base

    active_quest = _active_quest(state)
    progress = int(active_quest.get("progress") or 0)
    if progress >= 1:
        base = f"The opening chapter of {world_name} now turns on whether the first promise will be carried through."
    else:
        base = f"The opening chapter of {world_name} is still gathering the first trust the world asks for."
    if chapter_status == "cooling":
        return f"{base} It has started to cool into its next shape."
    if chapter_status == "resolved":
        return f"{base} Its opening movement is already complete."
    return base


def _stakes_summary_for_state(chapter_key: str, state: dict[str, Any]) -> str:
    world_pack = state.get("world_pack") or {}
    followup_chapter_key = str(world_pack.get("followup_chapter_key") or "followup_chapter")
    followup_location_name = str(world_pack.get("followup_location_name") or "the next route")
    location = state.get("location") or {}
    location_name = str(location.get("name") or "the current district")
    chapter_state = state.get("chapter") or {}
    current_branch = str(chapter_state.get("current_branch") or "")
    active_quest = _active_quest(state)
    progress = int(active_quest.get("progress") or 0)
    if chapter_key == followup_chapter_key:
        if current_branch == "watch_oath":
            return f"The route toward {followup_location_name} is asking whether formal trust can actually hold."
        if current_branch == "lantern_whispers":
            return f"The route toward {followup_location_name} is listening for rumor, undertow, and what the city keeps half-hidden."
        followup = _followup_quest(state)
        if followup and str(followup.get("status") or "") == "completed":
            return f"The newly opened route toward {followup_location_name} is settling after the reward token's passage."
        return f"The newly opened route toward {followup_location_name} is asking to be read carefully."
    if progress >= 1:
        return f"{location_name} is waiting to see whether the first promise will be honored."
    return f"{location_name} is still establishing who can be trusted with the first request."


def _pressure_summary_for_state(
    *,
    state: dict[str, Any],
    requested_pressure: ScenePressure | None,
    outcome_band: str,
) -> str:
    thread_summary = _thread_summary(state)
    if thread_summary:
        return thread_summary
    pressure = requested_pressure or _derived_scene_pressure(state=state, outcome_band=outcome_band)
    if pressure == "high":
        return "The air around the scene has tightened, and every move is being read a little harder."
    if pressure == "medium":
        return "The scene carries a taut expectation and asks for a careful next line."
    return "The scene has room to breathe, but it still remembers what was just set in motion."


def _derived_scene_pressure(*, state: dict[str, Any], outcome_band: str) -> ScenePressure:
    active_threads = state.get("active_consequence_threads") or []
    if any(str(item.get("pressure_band") or "") == "high" for item in active_threads):
        return "high"
    if outcome_band == "setback":
        return "high"
    if outcome_band == "tangled" or active_threads:
        return "medium"
    return "low"


def _initial_scene_phase(chapter_key: str, chapter_status: ChapterStatus, state: dict[str, Any]) -> ScenePhase:
    if chapter_status == "cooling":
        return "settle"
    if chapter_key == str((state.get("world_pack") or {}).get("followup_chapter_key") or "followup_chapter"):
        return "reveal"
    return "establish"


def _phase_after_move(current_phase: str | None, move: SceneMove, chapter_status: ChapterStatus) -> ScenePhase:
    if chapter_status == "cooling":
        return "settle"
    if move == "deepen":
        if current_phase == "establish":
            return "pressure"
        if current_phase == "pressure":
            return "reveal"
        return "reveal"
    if move == "close":
        return "settle"
    if move == "pivot":
        return "reveal"
    if current_phase in {"establish", "pressure", "reveal", "settle"}:
        return current_phase  # type: ignore[return-value]
    return "establish"


def _scene_move_for_state(
    *,
    requested_move: SceneMove | None,
    chapter_switched: bool,
    chapter_status: ChapterStatus,
    action_kind: str,
    outcome_band: str,
    state: dict[str, Any],
) -> SceneMove:
    if action_kind == "use_reward_item":
        return "pivot"
    if chapter_switched:
        return "pivot"
    if requested_move in {"hold", "deepen", "pivot", "close"}:
        return requested_move
    if chapter_status == "cooling":
        return "close"
    if outcome_band == "setback":
        return "deepen"
    if outcome_band == "tangled" or (state.get("active_consequence_threads") or []):
        return "deepen"
    return "hold"


def scene_summary_text(stakes_summary: str, pressure_summary: str) -> str:
    return " ".join(part.strip() for part in (stakes_summary, pressure_summary) if str(part).strip()).strip()


def chapter_track_to_dict(chapter: ChapterTrack, *, include_internal: bool = False) -> dict[str, Any]:
    payload = {
        "id": chapter.id,
        "key": chapter.chapter_key,
        "status": chapter.status,
        "summary": chapter.summary,
        "crossroads_summary": chapter.crossroads_summary,
        "branch_hint": (
            f"The chapter now leans toward {branch_label(chapter.branch_key)}."
            if chapter.branch_key
            else (chapter.crossroads_summary or "")
        ),
    }
    if include_internal:
        payload["branch_status"] = chapter.crossroads_status
        payload["current_branch"] = chapter.branch_key
    return payload


def _location_summary(db: Session, scene: SceneFrame) -> dict[str, Any] | None:
    if scene.location_id is None:
        return None
    location = db.execute(
        select(Location).where(Location.world_id == scene.world_id, Location.id == scene.location_id)
    ).scalar_one_or_none()
    if location is None:
        return None
    return {
        "id": location.id,
        "name": location.name,
        "description": location.description,
    }


def _focus_actor_summary(db: Session, scene: SceneFrame) -> dict[str, Any] | None:
    if scene.focus_actor_id is None:
        return None
    actor = db.execute(
        select(Actor).where(Actor.world_id == scene.world_id, Actor.id == scene.focus_actor_id)
    ).scalar_one_or_none()
    if actor is None:
        return None
    return {
        "actor_id": actor.id,
        "display_name": actor.display_name,
    }


def scene_frame_to_state(db: Session, scene: SceneFrame) -> dict[str, Any]:
    return {
        "id": scene.id,
        "summary": scene_summary_text(scene.stakes_summary, scene.pressure_summary),
        "pressure_summary": scene.pressure_summary,
        "location": _location_summary(db, scene),
        "focus_actor": _focus_actor_summary(db, scene),
    }


def _current_chapter(db: Session, world_id: str, actor_id: str) -> ChapterTrack | None:
    rows = list(
        db.execute(
            select(ChapterTrack)
            .where(
                ChapterTrack.world_id == world_id,
                ChapterTrack.owner_actor_id == actor_id,
                ChapterTrack.status.in_(("active", "cooling", "resolved")),
            )
            .order_by(
                (ChapterTrack.status == "active").desc(),
                (ChapterTrack.status == "cooling").desc(),
                ChapterTrack.updated_at.desc(),
                ChapterTrack.id.desc(),
            )
        ).scalars()
    )
    return rows[0] if rows else None


def _chapter_by_key(db: Session, world_id: str, actor_id: str, chapter_key: str) -> ChapterTrack | None:
    return db.execute(
        select(ChapterTrack).where(
            ChapterTrack.world_id == world_id,
            ChapterTrack.owner_actor_id == actor_id,
            ChapterTrack.chapter_key == chapter_key,
        )
    ).scalar_one_or_none()


def _current_scene(db: Session, world_id: str, actor_id: str) -> SceneFrame | None:
    rows = list(
        db.execute(
            select(SceneFrame)
            .where(
                SceneFrame.world_id == world_id,
                SceneFrame.owner_actor_id == actor_id,
                SceneFrame.status.in_(("active", "cooling")),
            )
            .order_by(
                (SceneFrame.status == "active").desc(),
                SceneFrame.updated_at.desc(),
                SceneFrame.id.desc(),
            )
        ).scalars()
    )
    return rows[0] if rows else None


def get_current_chapter_summary(
    db: Session,
    world_id: str,
    actor_id: str,
    *,
    include_internal: bool = False,
) -> dict[str, Any] | None:
    chapter = _current_chapter(db, world_id, actor_id)
    if chapter is None:
        return None
    return chapter_track_to_dict(chapter, include_internal=include_internal)


def get_current_scene_summary(db: Session, world_id: str, actor_id: str) -> dict[str, Any] | None:
    scene = _current_scene(db, world_id, actor_id)
    if scene is None:
        return None
    return scene_frame_to_state(db, scene)


def ensure_narrative_frame_seed(
    db: Session,
    *,
    world_id: str,
    actor_id: str,
    location_id: str | None,
    focus_actor_id: str | None,
) -> None:
    existing_chapter = _current_chapter(db, world_id, actor_id)
    existing_scene = _current_scene(db, world_id, actor_id)
    if existing_chapter is not None and existing_scene is not None:
        return

    state = {
        "location": _location_summary(
            db,
            SceneFrame(
                id="seed",
                world_id=world_id,
                owner_actor_id=actor_id,
                chapter_track_id="seed",
                location_id=location_id,
                focus_actor_id=focus_actor_id,
                stakes_summary="",
                pressure_summary="",
            ),
        )
        if location_id is not None
        else None,
        "quests": [],
        "inventory": [],
        "active_consequence_threads": [],
    }
    _, template = resolve_world_pack(db, world_id)
    followup_location_name = (
        str(template.locations[template.roles.followup_location_key].name)
        if template.roles.followup_location_key in template.locations
        else "the next route"
    )
    state["world_pack"] = {
        "opening_chapter_key": str(template.roles.opening_chapter_key or "opening_chapter"),
        "followup_chapter_key": str(template.roles.followup_chapter_key or "followup_chapter"),
        "followup_stage_key": str(template.roles.followup_stage_key or "followup_stage"),
        "reward_effect_kind": str(template.roles.reward_effect_kind or "unlock_followup_route"),
        "starter_location_name": str(
            template.locations[template.roles.starter_location_key].name
            if template.roles.starter_location_key in template.locations
            else template.display_name
        ),
        "followup_location_name": followup_location_name,
        "world_name": str((template.world or {}).get("default_name") or template.display_name),
        "reward_name": str(template.quest.reward_name or ""),
        "branch_labels": dict(template.roles.branch_labels),
    }
    chapter_key = str(template.roles.opening_chapter_key or "opening_chapter")
    chapter_status: ChapterStatus = "active"
    summary = chapter_summary_for_state(chapter_key, chapter_status, state)
    stakes_summary = _stakes_summary_for_state(chapter_key, state)
    pressure_summary = _pressure_summary_for_state(
        state=state,
        requested_pressure="low",
        outcome_band="steady",
    )
    chapter = existing_chapter or ChapterTrack(
        world_id=world_id,
        owner_actor_id=actor_id,
        chapter_key=chapter_key,
        status=chapter_status,
        summary=summary,
        opened_at=datetime.now(timezone.utc),
    )
    if existing_chapter is None:
        db.add(chapter)
        db.flush()
    else:
        chapter.chapter_key = chapter_key
        chapter.status = chapter_status
        chapter.summary = summary
        db.flush()

    if existing_scene is None:
        scene = SceneFrame(
            world_id=world_id,
            owner_actor_id=actor_id,
            chapter_track_id=chapter.id,
            scene_phase=_initial_scene_phase(chapter_key, chapter_status, state),
            status="active",
            location_id=location_id,
            focus_actor_id=focus_actor_id,
            stakes_summary=stakes_summary,
            pressure_summary=pressure_summary,
            opened_at=datetime.now(timezone.utc),
        )
        db.add(scene)
        db.flush()


def list_recent_scene_history(db: Session, world_id: str, actor_id: str) -> list[str]:
    rows = list(
        db.execute(
            select(SceneFrame)
            .where(SceneFrame.world_id == world_id, SceneFrame.owner_actor_id == actor_id)
            .order_by(SceneFrame.updated_at.desc(), SceneFrame.id.desc())
            .limit(8)
        ).scalars()
    )
    history: list[str] = []
    seen: set[str] = set()
    for row in rows:
        summary = scene_summary_text(row.stakes_summary, row.pressure_summary)
        if not summary or summary in seen:
            continue
        seen.add(summary)
        history.append(summary)
        if len(history) >= 3:
            break
    return history


def list_chapter_tracks_debug(db: Session, world_id: str) -> list[dict[str, Any]]:
    rows = list(
        db.execute(
            select(ChapterTrack, Actor)
            .join(Actor, (Actor.id == ChapterTrack.owner_actor_id) & (Actor.world_id == ChapterTrack.world_id))
            .where(ChapterTrack.world_id == world_id)
            .order_by(ChapterTrack.updated_at.desc(), ChapterTrack.id.desc())
        ).all()
    )
    return [
        {
            "id": chapter.id,
            "world_id": chapter.world_id,
            "owner_actor_id": actor.id,
            "owner_actor_name": actor.display_name,
            "chapter_key": chapter.chapter_key,
            "status": chapter.status,
            "summary": chapter.summary,
            "branch_key": chapter.branch_key,
            "crossroads_status": chapter.crossroads_status,
            "crossroads_summary": chapter.crossroads_summary,
            "committed_at": chapter.committed_at.isoformat() if chapter.committed_at is not None else None,
            "updated_at": chapter.updated_at.isoformat(),
            "resolved_at": chapter.resolved_at.isoformat() if chapter.resolved_at is not None else None,
        }
        for chapter, actor in rows
    ]


def list_scene_frames_debug(db: Session, world_id: str) -> list[dict[str, Any]]:
    rows = list(
        db.execute(
            select(SceneFrame, Actor)
            .join(Actor, (Actor.id == SceneFrame.owner_actor_id) & (Actor.world_id == SceneFrame.world_id))
            .where(SceneFrame.world_id == world_id)
            .order_by(SceneFrame.updated_at.desc(), SceneFrame.id.desc())
        ).all()
    )
    return [
        {
            "id": scene.id,
            "world_id": scene.world_id,
            "owner_actor_id": actor.id,
            "owner_actor_name": actor.display_name,
            "chapter_track_id": scene.chapter_track_id,
            "scene_phase": scene.scene_phase,
            "status": scene.status,
            "stakes_summary": scene.stakes_summary,
            "pressure_summary": scene.pressure_summary,
            "updated_at": scene.updated_at.isoformat(),
            "closed_at": scene.closed_at.isoformat() if scene.closed_at is not None else None,
        }
        for scene, actor in rows
    ]


class SceneFrameEngine:
    @staticmethod
    def apply(
        db: Session,
        *,
        world_id: str,
        actor_id: str,
        location_id: str | None,
        focus_actor_id: str | None,
        source_event_id: str,
        action_kind: str,
        session_state: dict[str, Any],
        outcome_band: str,
        requested_scene_move: SceneMove | None,
        requested_scene_pressure: ScenePressure | None,
    ) -> SceneFrameUpdateResult:
        ensure_narrative_frame_seed(
            db,
            world_id=world_id,
            actor_id=actor_id,
            location_id=location_id,
            focus_actor_id=focus_actor_id,
        )

        now = datetime.now(timezone.utc)
        current_chapter = _current_chapter(db, world_id, actor_id)
        current_scene = _current_scene(db, world_id, actor_id)

        target_chapter_key = _chapter_key_for_state(session_state)
        target_chapter_status = _chapter_status_for_state(target_chapter_key, session_state)
        target_chapter_summary = chapter_summary_for_state(target_chapter_key, target_chapter_status, session_state)

        chapter_switched = current_chapter is None or current_chapter.chapter_key != target_chapter_key
        scene_move = _scene_move_for_state(
            requested_move=requested_scene_move,
            chapter_switched=chapter_switched,
            chapter_status=target_chapter_status,
            action_kind=action_kind,
            outcome_band=outcome_band,
            state=session_state,
        )
        scene_pressure = requested_scene_pressure or _derived_scene_pressure(state=session_state, outcome_band=outcome_band)
        stakes_summary = _stakes_summary_for_state(target_chapter_key, session_state)
        pressure_summary = _pressure_summary_for_state(
            state=session_state,
            requested_pressure=scene_pressure,
            outcome_band=outcome_band,
        )

        chapter_updates: list[dict[str, Any]] = []
        if current_chapter is not None and current_chapter.chapter_key != target_chapter_key and current_chapter.status == "active":
            current_chapter.status = "resolved"
            current_chapter.closing_event_id = source_event_id
            current_chapter.resolved_at = now
            current_chapter.updated_at = now
            chapter_updates.append(chapter_track_to_dict(current_chapter))

        target_chapter = _chapter_by_key(db, world_id, actor_id, target_chapter_key)
        if target_chapter is None:
            target_chapter = ChapterTrack(
                id=new_id(),
                world_id=world_id,
                owner_actor_id=actor_id,
                chapter_key=target_chapter_key,
                status=target_chapter_status,
                summary=target_chapter_summary,
                opening_event_id=source_event_id if chapter_switched else None,
                opened_at=now,
            )
            db.add(target_chapter)
            db.flush()
            chapter_updates.append(chapter_track_to_dict(target_chapter))
        else:
            if target_chapter.status != target_chapter_status or target_chapter.summary != target_chapter_summary:
                target_chapter.status = target_chapter_status
                target_chapter.summary = target_chapter_summary
                if target_chapter_status in {"cooling", "resolved"}:
                    target_chapter.closing_event_id = source_event_id
                    target_chapter.resolved_at = now
                target_chapter.updated_at = now
                db.flush()
                chapter_updates.append(chapter_track_to_dict(target_chapter))

        scene_updates: list[dict[str, Any]] = []
        needs_new_scene = current_scene is None or chapter_switched or scene_move in {"pivot", "close"}
        if current_scene is not None and needs_new_scene:
            current_scene.status = "closed"
            current_scene.closing_event_id = source_event_id
            current_scene.closed_at = now
            current_scene.updated_at = now
            db.flush()

        if needs_new_scene:
            scene_status: SceneStatus = "cooling" if target_chapter_status == "cooling" and scene_move == "close" else "active"
            scene = SceneFrame(
                id=new_id(),
                world_id=world_id,
                owner_actor_id=actor_id,
                chapter_track_id=target_chapter.id,
                scene_phase=_initial_scene_phase(target_chapter_key, target_chapter_status, session_state)
                if chapter_switched or current_scene is None
                else _phase_after_move(current_scene.scene_phase, scene_move, target_chapter_status),
                status=scene_status,
                location_id=location_id,
                focus_actor_id=focus_actor_id,
                stakes_summary=stakes_summary,
                pressure_summary=pressure_summary,
                opening_event_id=source_event_id,
                opened_at=now,
            )
            db.add(scene)
            db.flush()
            current_scene = scene
        elif current_scene is not None:
            current_scene.chapter_track_id = target_chapter.id
            current_scene.scene_phase = _phase_after_move(current_scene.scene_phase, scene_move, target_chapter_status)
            current_scene.status = "cooling" if target_chapter_status == "cooling" and scene_move == "close" else "active"
            current_scene.location_id = location_id
            current_scene.focus_actor_id = focus_actor_id
            current_scene.stakes_summary = stakes_summary
            current_scene.pressure_summary = pressure_summary
            current_scene.updated_at = now
            db.flush()

        if current_scene is not None:
            scene_updates.append(
                {
                    **scene_frame_to_state(db, current_scene),
                    "action": scene_move,
                }
            )

        return SceneFrameUpdateResult(
            chapter_updates=chapter_updates,
            scene_updates=scene_updates,
            scene_summary=scene_summary_text(stakes_summary, pressure_summary),
        )
