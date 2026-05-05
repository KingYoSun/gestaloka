from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import hashlib
import logging
import re
from typing import Any

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.models.entities import PlayLocalizedTextCache
from app.modules.llm_harness.service import ModelRouter
from app.modules.world_pack.service import get_pack_registry, template_world_id


PROMPT_ID = "play.localization"

logger = logging.getLogger(__name__)

_PLAYER_VISIBLE_CONTROL_TOKEN_RE = re.compile(r"\s*\[(?:[a-z][a-z0-9_]*(?:\s*,\s*)?)+\]\s*", re.IGNORECASE)


class PlayLocalizationItem(BaseModel):
    key: str = Field(min_length=1, max_length=180)
    localized_text: str = Field(min_length=1)

    @model_validator(mode="before")
    @classmethod
    def accept_live_provider_aliases(cls, value: Any) -> Any:
        if isinstance(value, dict) and "localized_text" not in value and isinstance(value.get("text"), str):
            normalized = dict(value)
            normalized["localized_text"] = normalized["text"]
            return normalized
        return value


class PlayLocalizationPayload(BaseModel):
    items: list[PlayLocalizationItem] = Field(min_length=1)

    @model_validator(mode="before")
    @classmethod
    def accept_live_provider_payload_shapes(cls, value: Any) -> Any:
        if isinstance(value, list):
            return {"items": value}
        return value

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

    glossary = _glossary(db, context=context)
    cached = {
        key: _apply_glossary_replacements(value, glossary)
        for key, value in _cached_texts(db, context=context, targets=deduped).items()
    }
    missing = [target for target in deduped if target.source_key not in cached]
    generated: dict[str, str] = {}
    model_id = ""
    if missing and generate_missing:
        generated, model_id = _generate_missing(db, model_router, context=context, targets=missing, glossary=glossary)
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
    glossary: list[dict[str, str]] | None = None,
) -> tuple[dict[str, str], str]:
    if glossary is None:
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
        logger.warning(
            "play.localization prompt raised before returning an outcome: world_id=%s target_language=%s targets=%s",
            context["world_id"],
            context["target_language"],
            len(targets),
            exc_info=True,
        )
        return {}, ""
    if outcome.final_payload is None:
        logger.warning(
            "play.localization prompt returned no valid payload: world_id=%s target_language=%s targets=%s "
            "failure_reason=%s attempts=%s",
            context["world_id"],
            context["target_language"],
            len(targets),
            outcome.failure_reason or "",
            _attempt_diagnostics(outcome.attempts),
        )
        return {}, ""
    allowed_keys = {target.source_key for target in targets}
    localized = {
        item.key: _apply_glossary_replacements(item.localized_text.strip(), glossary)
        for item in outcome.final_payload.items
        if item.key in allowed_keys and item.localized_text.strip()
    }
    if not localized:
        logger.warning(
            "play.localization prompt returned no usable translations: world_id=%s target_language=%s targets=%s "
            "items=%s attempts=%s",
            context["world_id"],
            context["target_language"],
            len(targets),
            len(outcome.final_payload.items),
            _attempt_diagnostics(outcome.attempts),
        )
    model_id = outcome.attempts[-1].model_id if outcome.attempts else ""
    return localized, model_id


def _apply_glossary_replacements(value: str, glossary: list[dict[str, str]]) -> str:
    localized = value
    entries = sorted(
        (
            (
                str(entry.get("source_text") or "").strip(),
                str(entry.get("localized_text") or "").strip(),
            )
            for entry in glossary
            if isinstance(entry, dict)
        ),
        key=lambda item: len(item[0]),
        reverse=True,
    )
    for source_text, localized_text in entries:
        if not source_text or not localized_text or source_text == localized_text:
            continue
        localized = localized.replace(source_text, localized_text)
    return _strip_player_visible_control_tokens(_collapse_glossary_prefix_duplication(localized, entries))


def _collapse_glossary_prefix_duplication(value: str, entries: list[tuple[str, str]]) -> str:
    collapsed = value
    for _source_text, localized_text in entries:
        if not localized_text:
            continue
        for split_at in range(1, len(localized_text)):
            prefix = localized_text[:split_at]
            if not prefix or not localized_text[split_at:]:
                continue
            collapsed = collapsed.replace(f"{prefix}{localized_text}", localized_text)
    return collapsed


def _strip_player_visible_control_tokens(value: str) -> str:
    return _PLAYER_VISIBLE_CONTROL_TOKEN_RE.sub("", value).strip()


def _attempt_diagnostics(attempts: list[Any]) -> list[dict[str, str]]:
    return [
        {
            "lane": str(getattr(attempt, "model_lane", "")),
            "model_id": str(getattr(attempt, "model_id", "")),
            "status": str(getattr(attempt, "status", "")),
            "schema": str(getattr(attempt, "output_schema_status", "")),
        }
        for attempt in attempts
    ]


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
    pack_entries = _pack_glossary(context=context)
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
    cache_entries = [
        {
            "kind": row.source_kind,
            "source_text": row.source_text,
            "localized_text": row.localized_text,
        }
        for row in rows
        if row.source_text and row.localized_text
    ]
    return [*pack_entries, *cache_entries]


def _pack_glossary(*, context: dict[str, str]) -> list[dict[str, str]]:
    world_id = context["world_id"]
    target_language = context["target_language"]
    target_key = _language_key(target_language)
    try:
        registry = get_pack_registry()
    except Exception:
        return []

    entries: list[dict[str, str]] = []
    for pack in registry.list_packs():
        if not any(template_world_id(template) == world_id for template in pack.templates.values()):
            continue
        for item in pack.localization.glossary:
            if _language_key(item.target_language) != target_key:
                continue
            entries.append(
                {
                    "kind": item.source_kind,
                    "source_text": item.source_text,
                    "localized_text": item.localized_text,
                }
            )
    return entries


def _language_key(value: str) -> str:
    normalized = value.strip().lower().replace("_", "-")
    return {
        "ja": "japanese",
        "jp": "japanese",
        "日本語": "japanese",
    }.get(normalized, normalized)


def _collect_session_state_targets(payload: dict[str, Any], targets: list[_TextTarget]) -> None:
    _register_object_fields(payload, targets, ("current_location",), "location", ("id", "key"), ("name", "description"))
    _register_object_fields(payload, targets, ("location",), "location", ("id", "key"), ("name", "description"))
    _register_object_fields(payload, targets, ("chapter",), "chapter", ("id", "key"), ("summary", "crossroads_summary", "branch_hint"))
    _register_object_fields(payload, targets, ("quest_display_state",), "quest_display_state", ("mode",), ("label",))
    _register_object_fields(payload, targets, ("current_scene",), "scene", ("id",), ("summary", "pressure_summary"))
    _register_object_fields(payload, targets, ("current_scene", "location"), "scene.location", ("id",), ("name", "description"))
    _register_object_fields(payload, targets, ("current_scene", "focus_actor"), "scene.focus_actor", ("actor_id",), ("display_name",))
    _register_list_fields(payload, targets, ("quests",), "quest", ("assignment_id", "quest_template_id"), ("title", "description", "latest_summary"))
    _register_nested_list_fields(
        payload,
        targets,
        ("quests",),
        ("chapters",),
        "quest_chapter",
        ("assignment_id", "quest_template_id"),
        ("id", "key"),
        ("summary",),
    )
    _register_list_fields(payload, targets, ("quest_journal",), "quest_journal", ("assignment_id", "quest_template_id"), ("title", "description", "latest_summary"))
    _register_nested_list_fields(
        payload,
        targets,
        ("quest_journal",),
        ("chapters",),
        "quest_chapter",
        ("assignment_id", "quest_template_id"),
        ("id", "key"),
        ("summary",),
    )
    _register_list_fields(payload, targets, ("factions",), "faction", ("faction_id",), ("name", "description"))
    _register_list_fields(payload, targets, ("inventory",), "inventory", ("id", "template_key"), ("name", "description"))
    _register_list_fields(payload, targets, ("known_facts",), "known_fact", ("id",), ("title", "summary"))
    _register_list_fields(payload, targets, ("skills",), "skill", ("id",), ("title", "summary"))
    _register_list_fields(payload, targets, ("local_figures",), "local_figure", ("actor_id",), ("display_name", "summary"))
    _register_list_fields(payload, targets, ("plaza_figures",), "local_figure", ("actor_id",), ("display_name", "summary"))
    _register_list_fields(payload, targets, ("nearby_routes",), "route", ("route_key", "destination_key"), ("summary", "destination_name"))
    _register_list_fields(payload, targets, ("npc_locations",), "npc_location", ("actor_id",), ("display_name", "location_name", "summary"))
    _register_list_fields(payload, targets, ("relationships",), "relationship", ("actor_id",), ("display_name", "summary"))
    _register_list_fields(payload, targets, ("active_consequence_threads",), "consequence_thread", ("id",), ("title", "summary", "counterpart_name"))
    _register_list_fields(payload, targets, ("important_inventory_affordances",), "inventory_affordance", ("item_id",), ("name", "summary"))
    _register_list_fields(payload, targets, ("next_choices",), "choice", ("choice_id",), ("label", "summary"))
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
    _register_list_fields(payload, targets, ("next_choices",), "choice", ("choice_id",), ("label", "summary"))
    _register_object_fields(payload, targets, ("current_location",), "location", ("id", "key"), ("name", "description"))
    _register_list_fields(payload, targets, ("quest_updates",), "quest_update", ("assignment_id", "quest_template_id"), ("title", "description", "latest_summary", "summary"))
    _register_list_fields(payload, targets, ("faction_updates",), "faction_update", ("faction_id",), ("name", "description"))
    _register_list_fields(payload, targets, ("inventory_updates",), "inventory_update", ("id", "template_key"), ("name", "description"))
    _register_list_fields(payload, targets, ("knowledge_updates",), "knowledge_update", ("id",), ("title", "summary"))
    _register_list_fields(payload, targets, ("skill_updates",), "skill_update", ("id",), ("title", "summary"))
    _register_list_fields(payload, targets, ("trade_updates",), "trade_update", ("trade_id",), ("counterparty", "received_summary", "consideration_summary"))
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


def _register_nested_list_fields(
    root: dict[str, Any],
    targets: list[_TextTarget],
    outer_path: tuple[Any, ...],
    nested_path: tuple[Any, ...],
    kind: str,
    outer_key_fields: tuple[str, ...],
    nested_key_fields: tuple[str, ...],
    text_fields: tuple[str, ...],
) -> None:
    outer_values = _get_path(root, outer_path)
    if not isinstance(outer_values, list):
        return
    for outer_index, outer_value in enumerate(outer_values):
        if not isinstance(outer_value, dict):
            continue
        nested_values = _get_path(outer_value, nested_path)
        if not isinstance(nested_values, list):
            continue
        outer_key = _object_key(outer_value, outer_key_fields) or f"{'.'.join(str(part) for part in outer_path)}.{outer_index}"
        for nested_index, nested_value in enumerate(nested_values):
            if not isinstance(nested_value, dict):
                continue
            nested_key = _object_key(nested_value, nested_key_fields) or f"{'.'.join(str(part) for part in nested_path)}.{nested_index}"
            object_key = f"{outer_key}:{nested_key}"
            for field in text_fields:
                _register_field(
                    root,
                    targets,
                    (*outer_path, outer_index, *nested_path, nested_index, field),
                    f"{kind}.{field}",
                    f"{kind}:{object_key}:{field}",
                )


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
