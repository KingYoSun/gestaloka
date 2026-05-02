from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import hashlib
from typing import Any

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.models.entities import PlayLocalizedTextCache
from app.modules.llm_harness.service import ModelRouter


PROMPT_ID = "play.localization"


class PlayLocalizationItem(BaseModel):
    key: str = Field(min_length=1, max_length=180)
    localized_text: str = Field(min_length=1)


class PlayLocalizationPayload(BaseModel):
    items: list[PlayLocalizationItem] = Field(min_length=1)

    @model_validator(mode="after")
    def keep_first_item_per_key(self) -> "PlayLocalizationPayload":
        seen: set[str] = set()
        items: list[PlayLocalizationItem] = []
        for item in self.items:
            if item.key in seen:
                continue
            seen.add(item.key)
            items.append(item)
        self.items = items
        return self


@dataclass(frozen=True)
class _TextTarget:
    path: tuple[Any, ...]
    source_kind: str
    source_key: str
    source_text: str
    source_hash: str


def localize_session_state(db: Session, model_router: ModelRouter, state: dict[str, Any]) -> dict[str, Any]:
    payload = deepcopy(state)
    player_profile = payload.get("player_profile") if isinstance(payload.get("player_profile"), dict) else {}
    actor_id = str((player_profile or {}).get("actor_id") or payload.get("actor_id") or "").strip()
    play_language = (player_profile or {}).get("play_language") if isinstance(player_profile, dict) else {}
    context = _localization_context(
        world_id=str(payload.get("world_id") or ""),
        actor_id=actor_id,
        play_language=play_language if isinstance(play_language, dict) else {},
    )
    if context is None:
        return payload

    targets: list[_TextTarget] = []
    _collect_session_state_targets(payload, targets)
    return _apply_localization(db, model_router, payload, context, targets)


def localize_turn_payload(
    db: Session,
    model_router: ModelRouter,
    payload: dict[str, Any],
    *,
    world_id: str,
    actor_id: str,
    play_language: dict[str, Any],
    generate_missing: bool = True,
) -> dict[str, Any]:
    localized = deepcopy(payload)
    context = _localization_context(world_id=world_id, actor_id=actor_id, play_language=play_language)
    if context is None:
        return localized

    targets: list[_TextTarget] = []
    _collect_turn_payload_targets(localized, targets)
    return _apply_localization(db, model_router, localized, context, targets, generate_missing=generate_missing)


def _localization_context(
    *,
    world_id: str,
    actor_id: str,
    play_language: dict[str, Any],
) -> dict[str, str] | None:
    target_language = str(play_language.get("prompt_name") or play_language.get("custom") or "").strip()
    if not world_id or not actor_id or not target_language:
        return None
    preset = str(play_language.get("preset") or "").strip().lower()
    if preset == "en" or target_language.lower() == "english":
        return None
    return {"world_id": world_id, "actor_id": actor_id, "target_language": target_language}


def _apply_localization(
    db: Session,
    model_router: ModelRouter,
    payload: dict[str, Any],
    context: dict[str, str],
    targets: list[_TextTarget],
    *,
    generate_missing: bool = True,
) -> dict[str, Any]:
    deduped = _dedupe_targets(targets)
    if not deduped:
        return payload

    cached = _cached_texts(db, context=context, targets=deduped)
    missing = [target for target in deduped if target.source_key not in cached]
    generated: dict[str, str] = {}
    model_id = ""
    if missing and generate_missing:
        generated, model_id = _generate_missing(db, model_router, context=context, targets=missing)
        if generated:
            _store_generated(db, context=context, targets=missing, generated=generated, model_id=model_id)

    translations = {**cached, **generated}
    for target in targets:
        localized = translations.get(target.source_key)
        if localized:
            _set_path(payload, target.path, localized)
    return payload


def _dedupe_targets(targets: list[_TextTarget]) -> list[_TextTarget]:
    seen: set[str] = set()
    deduped: list[_TextTarget] = []
    for target in targets:
        if target.source_key in seen:
            continue
        seen.add(target.source_key)
        deduped.append(target)
    return deduped


def _cached_texts(
    db: Session,
    *,
    context: dict[str, str],
    targets: list[_TextTarget],
) -> dict[str, str]:
    keys = {target.source_key for target in targets}
    hashes = {target.source_hash for target in targets}
    rows = list(
        db.execute(
            select(PlayLocalizedTextCache).where(
                PlayLocalizedTextCache.world_id == context["world_id"],
                PlayLocalizedTextCache.actor_id_scope == context["actor_id"],
                PlayLocalizedTextCache.target_language == context["target_language"],
                PlayLocalizedTextCache.source_key.in_(keys),
                PlayLocalizedTextCache.source_hash.in_(hashes),
            )
        ).scalars()
    )
    return {
        row.source_key: row.localized_text
        for row in rows
        if row.source_key in keys and row.source_hash in hashes and row.localized_text
    }


def _generate_missing(
    db: Session,
    model_router: ModelRouter,
    *,
    context: dict[str, str],
    targets: list[_TextTarget],
) -> tuple[dict[str, str], str]:
    glossary = _glossary(db, context=context)
    input_payload = {
        "target_language": context["target_language"],
        "items": [
            {
                "key": target.source_key,
                "kind": target.source_kind,
                "text": target.source_text,
            }
            for target in targets
        ],
        "glossary": glossary,
    }
    try:
        outcome = model_router.execute_structured_prompt(
            prompt_id=PROMPT_ID,
            response_model=PlayLocalizationPayload,
            input_payload=input_payload,
            world_id=context["world_id"],
            turn_id=None,
            graph_context_status="localization",
            allow_pro_fallback=True,
        )
    except Exception:
        return {}, ""
    if outcome.final_payload is None:
        return {}, ""
    allowed_keys = {target.source_key for target in targets}
    localized = {
        item.key: item.localized_text.strip()
        for item in outcome.final_payload.items
        if item.key in allowed_keys and item.localized_text.strip()
    }
    model_id = outcome.attempts[-1].model_id if outcome.attempts else ""
    return localized, model_id


def _store_generated(
    db: Session,
    *,
    context: dict[str, str],
    targets: list[_TextTarget],
    generated: dict[str, str],
    model_id: str,
) -> None:
    target_by_key = {target.source_key: target for target in targets}
    for key, localized_text in generated.items():
        target = target_by_key.get(key)
        if target is None:
            continue
        db.add(
            PlayLocalizedTextCache(
                world_id=context["world_id"],
                actor_id_scope=context["actor_id"],
                target_language=context["target_language"],
                source_kind=target.source_kind,
                source_key=target.source_key,
                source_hash=target.source_hash,
                source_text=target.source_text,
                localized_text=localized_text,
                model_id=model_id or "unknown",
                prompt_id=PROMPT_ID,
            )
        )
    try:
        db.commit()
    except (IntegrityError, OperationalError):
        db.rollback()


def _glossary(db: Session, *, context: dict[str, str], limit: int = 80) -> list[dict[str, str]]:
    rows = list(
        db.execute(
            select(PlayLocalizedTextCache)
            .where(
                PlayLocalizedTextCache.world_id == context["world_id"],
                PlayLocalizedTextCache.actor_id_scope == context["actor_id"],
                PlayLocalizedTextCache.target_language == context["target_language"],
            )
            .order_by(PlayLocalizedTextCache.updated_at.desc(), PlayLocalizedTextCache.id.desc())
            .limit(limit)
        ).scalars()
    )
    return [
        {
            "kind": row.source_kind,
            "source_text": row.source_text,
            "localized_text": row.localized_text,
        }
        for row in rows
        if row.source_text and row.localized_text
    ]


def _collect_session_state_targets(payload: dict[str, Any], targets: list[_TextTarget]) -> None:
    _register_object_fields(payload, targets, ("current_location",), "location", ("id", "key"), ("name", "description"))
    _register_object_fields(payload, targets, ("location",), "location", ("id", "key"), ("name", "description"))
    _register_object_fields(payload, targets, ("chapter",), "chapter", ("id", "key"), ("summary", "crossroads_summary", "branch_hint"))
    _register_object_fields(payload, targets, ("quest_display_state",), "quest_display_state", ("mode",), ("label",))
    _register_object_fields(payload, targets, ("current_scene",), "scene", ("id",), ("summary", "pressure_summary"))
    _register_object_fields(payload, targets, ("current_scene", "location"), "scene.location", ("id",), ("name", "description"))
    _register_object_fields(payload, targets, ("current_scene", "focus_actor"), "scene.focus_actor", ("actor_id",), ("display_name",))
    _register_list_fields(payload, targets, ("quests",), "quest", ("assignment_id", "quest_template_id"), ("title", "description", "latest_summary"))
    _register_list_fields(payload, targets, ("quest_journal",), "quest_journal", ("assignment_id", "quest_template_id"), ("title", "description", "latest_summary"))
    _register_list_fields(payload, targets, ("factions",), "faction", ("faction_id",), ("name", "description"))
    _register_list_fields(payload, targets, ("inventory",), "inventory", ("id", "template_key"), ("name", "description"))
    _register_list_fields(payload, targets, ("local_figures",), "local_figure", ("actor_id",), ("display_name", "summary"))
    _register_list_fields(payload, targets, ("plaza_figures",), "local_figure", ("actor_id",), ("display_name", "summary"))
    _register_list_fields(payload, targets, ("nearby_routes",), "route", ("route_key", "destination_key"), ("summary", "destination_name"))
    _register_list_fields(payload, targets, ("npc_locations",), "npc_location", ("actor_id",), ("display_name", "location_name", "summary"))
    _register_list_fields(payload, targets, ("relationships",), "relationship", ("actor_id",), ("display_name", "summary"))
    _register_list_fields(payload, targets, ("active_consequence_threads",), "consequence_thread", ("id",), ("title", "summary", "counterpart_name"))
    _register_list_fields(payload, targets, ("important_inventory_affordances",), "inventory_affordance", ("item_id",), ("name", "summary"))
    _register_list_fields(payload, targets, ("next_choices",), "choice", ("choice_id", "posture"), ("label", "summary"))
    for field in (
        "recent_scene_history",
        "recent_branch_echoes",
        "recent_world_beats",
        "ambient_murmurs",
        "recent_travel_history",
        "recent_offstage_beats",
        "offstage_murmurs",
        "recent_consequence_history",
    ):
        _register_string_list(payload, targets, (field,), field)


def _collect_turn_payload_targets(payload: dict[str, Any], targets: list[_TextTarget]) -> None:
    for field in (
        "narrative",
        "npc_reaction",
        "consequence_summary",
        "scene_summary",
        "crossroads_summary",
        "travel_summary",
    ):
        _register_field(payload, targets, (field,), f"turn.{field}", field)
    _register_list_fields(payload, targets, ("next_choices",), "choice", ("choice_id", "posture"), ("label", "summary"))
    _register_object_fields(payload, targets, ("current_location",), "location", ("id", "key"), ("name", "description"))
    _register_list_fields(payload, targets, ("quest_updates",), "quest_update", ("assignment_id", "quest_template_id"), ("title", "description", "latest_summary", "summary"))
    _register_list_fields(payload, targets, ("faction_updates",), "faction_update", ("faction_id",), ("name", "description"))
    _register_list_fields(payload, targets, ("inventory_updates",), "inventory_update", ("id", "template_key"), ("name", "description"))
    _register_list_fields(payload, targets, ("location_updates",), "location_update", ("actor_id", "location_id"), ("name", "summary"))
    _register_list_fields(payload, targets, ("relationship_updates",), "relationship_update", ("actor_id",), ("display_name", "summary"))
    _register_list_fields(payload, targets, ("consequence_updates",), "consequence_update", ("id", "counterpart_actor_id"), ("title", "summary", "counterpart_name"))
    _register_list_fields(payload, targets, ("scene_updates",), "scene_update", ("id", "location_id"), ("summary", "pressure_summary"))
    _register_list_fields(payload, targets, ("chapter_updates",), "chapter_update", ("id", "key"), ("summary", "crossroads_summary", "branch_hint"))
    _register_list_fields(payload, targets, ("branch_updates",), "branch_update", ("route_key", "action"), ("label", "summary", "branch_hint", "crossroads_summary"))
    _register_list_fields(payload, targets, ("ambient_updates",), "ambient_update", ("event_id", "actor_id"), ("display_name", "summary"))
    _register_list_fields(payload, targets, ("idle_updates",), "idle_update", ("event_id", "actor_id"), ("display_name", "summary"))
    for field in ("recent_world_beats", "recent_offstage_beats"):
        _register_string_list(payload, targets, (field,), field)


def _register_object_fields(
    root: dict[str, Any],
    targets: list[_TextTarget],
    path: tuple[Any, ...],
    kind: str,
    key_fields: tuple[str, ...],
    text_fields: tuple[str, ...],
) -> None:
    value = _get_path(root, path)
    if not isinstance(value, dict):
        return
    object_key = _object_key(value, key_fields) or ".".join(str(part) for part in path)
    for field in text_fields:
        _register_field(root, targets, (*path, field), f"{kind}.{field}", f"{kind}:{object_key}:{field}")


def _register_list_fields(
    root: dict[str, Any],
    targets: list[_TextTarget],
    path: tuple[Any, ...],
    kind: str,
    key_fields: tuple[str, ...],
    text_fields: tuple[str, ...],
) -> None:
    values = _get_path(root, path)
    if not isinstance(values, list):
        return
    for index, value in enumerate(values):
        if not isinstance(value, dict):
            continue
        object_key = _object_key(value, key_fields) or f"{'.'.join(str(part) for part in path)}.{index}"
        for field in text_fields:
            _register_field(root, targets, (*path, index, field), f"{kind}.{field}", f"{kind}:{object_key}:{field}")


def _register_string_list(root: dict[str, Any], targets: list[_TextTarget], path: tuple[Any, ...], kind: str) -> None:
    values = _get_path(root, path)
    if not isinstance(values, list):
        return
    for index, value in enumerate(values):
        if isinstance(value, str):
            _register_field(root, targets, (*path, index), kind, f"{kind}:{index}:{_source_hash(value)[:12]}")


def _register_field(
    root: dict[str, Any],
    targets: list[_TextTarget],
    path: tuple[Any, ...],
    source_kind: str,
    source_key: str,
) -> None:
    value = _get_path(root, path)
    if not isinstance(value, str):
        return
    source_text = value.strip()
    if not source_text:
        return
    source_hash = _source_hash(source_text)
    stable_key = f"{source_key[:160]}:{source_hash[:12]}"
    targets.append(
        _TextTarget(
            path=path,
            source_kind=source_kind[:64],
            source_key=stable_key[:180],
            source_text=source_text,
            source_hash=source_hash,
        )
    )


def _object_key(value: dict[str, Any], fields: tuple[str, ...]) -> str:
    for field in fields:
        raw = value.get(field)
        if raw is None:
            continue
        text = str(raw).strip()
        if text:
            return text
    return ""


def _source_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _get_path(root: Any, path: tuple[Any, ...]) -> Any:
    value = root
    for part in path:
        if isinstance(part, int):
            if not isinstance(value, list) or part >= len(value):
                return None
            value = value[part]
        else:
            if not isinstance(value, dict):
                return None
            value = value.get(part)
    return value


def _set_path(root: Any, path: tuple[Any, ...], replacement: str) -> None:
    value = root
    for part in path[:-1]:
        value = value[part]
    value[path[-1]] = replacement
