from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import yaml
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_container, get_current_ops_user, get_db
from app.core.container import AppContainer
from app.core.prompts import SUPPORTED_MODEL_LANES
from app.models.entities import (
    AdminAppUser,
    AdminPackPublicationOverride,
    AdminPromptOverride,
    AdminRuntimeConfig,
    AdminWorldTemplatePublicationOverride,
    World,
)
from app.modules.admin_ops.service import llm_usage_timeline, projection_status, sp_overview
from app.modules.economy_sp.service import InsufficientSPError
from app.modules.identity.oidc import UserIdentity
from app.modules.world_pack.preprocess import list_pack_preprocess_statuses, run_pack_preprocess
from app.modules.world_pack.service import (
    ENGINE_API_VERSION,
    PackRegistry,
    WorldPackError,
    configure_pack_registry,
    import_pack_archive,
    load_pack_from_dir,
    pack_catalog_diagnostic,
    pack_catalog_health_summary,
    pack_preprocess_status,
)


router = APIRouter(prefix="/admin", tags=["admin"])
DEFAULT_RUNTIME_CONFIG_ID = "default"
ADMIN_ROLES = {"admin", "operator", "viewer"}
ADMIN_STATUSES = {"active", "disabled"}


class CreatePackRequest(BaseModel):
    pack_id: str = Field(min_length=1, max_length=120)
    display_name: str = Field(min_length=1, max_length=120)
    template_id: str = Field(default="default", min_length=1, max_length=120)
    template_display_name: str = Field(default="Default World", min_length=1, max_length=120)
    summary: str = Field(default="", max_length=500)


class ImportPackRequest(BaseModel):
    archive_path: str = Field(min_length=1, max_length=500)
    replace: bool = False


class PatchPackRequest(BaseModel):
    visibility: Literal["public", "private"] | None = None
    publish_status: Literal["playable", "draft", "archived"] | None = None


class PatchTemplateRequest(BaseModel):
    visibility: Literal["public", "private"] | None = None
    publish_status: Literal["playable", "draft", "archived"] | None = None


class UserPermissionsRequest(BaseModel):
    email: str = Field(default="", max_length=255)
    display_name: str = Field(default="", max_length=120)
    role: Literal["admin", "operator", "viewer"] = "viewer"
    status: Literal["active", "disabled"] = "active"
    permissions: dict[str, object] = Field(default_factory=dict)


class LLMSettingsRequest(BaseModel):
    provider: str = Field(min_length=1, max_length=64)
    base_url_secret_ref: str = Field(default="", max_length=160)
    api_key_secret_ref: str = Field(default="", max_length=160)
    embedding_provider: str = Field(default="settings", max_length=64)
    embedding_base_url_secret_ref: str = Field(default="", max_length=160)
    embedding_api_key_secret_ref: str = Field(default="", max_length=160)
    admin_debug_enabled: bool = False


class ModelLanesRequest(BaseModel):
    model_ids: dict[str, str] = Field(default_factory=dict)


class PromptOverrideRequest(BaseModel):
    enabled: bool = True
    instructions: str = Field(default="", max_length=12000)


class SPAdjustmentRequest(BaseModel):
    user_sub: str = Field(min_length=1, max_length=128)
    delta: int
    reason_code: str = Field(min_length=1, max_length=64)
    sp_bucket: Literal["paid", "bonus"]
    world_id: str | None = Field(default=None, max_length=64)
    actor_id: str | None = Field(default=None, max_length=36)
    note: str | None = Field(default=None, max_length=500)


class ReleaseChecklistRequest(BaseModel):
    trigger_type: Literal["manual", "nightly", "pre_promote"] = "manual"
    shadow_limit: int | None = Field(default=None, ge=1, le=50)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _runtime_config(db: Session) -> AdminRuntimeConfig:
    config = db.execute(
        select(AdminRuntimeConfig).where(AdminRuntimeConfig.id == DEFAULT_RUNTIME_CONFIG_ID)
    ).scalar_one_or_none()
    if config is not None:
        return config
    config = AdminRuntimeConfig(
        id=DEFAULT_RUNTIME_CONFIG_ID,
        provider="settings",
        embedding_provider="settings",
        model_ids={},
        admin_debug_enabled=False,
    )
    db.add(config)
    db.flush()
    return config


def _refresh_pack_registry(container: AppContainer) -> None:
    registry = configure_pack_registry(container.settings.pack_dir, force_reload=True)
    container.pack_registry = registry
    container.eval_service.pack_registry = registry
    container.model_router.pack_registry = registry
    container.council_service.model_router.pack_registry = registry
    container.ambient_world_service.model_router.pack_registry = registry


def _pack_payload(db: Session, container: AppContainer) -> dict[str, object]:
    return pack_catalog_diagnostic(db, container.pack_registry, include_paths=True)


def _write_yaml(path: Path, payload: dict[str, object]) -> None:
    path.write_text(yaml.safe_dump(payload, allow_unicode=True, sort_keys=False), encoding="utf-8")


def _override_payload(row: AdminPackPublicationOverride | AdminWorldTemplatePublicationOverride | None) -> dict[str, object] | None:
    if row is None:
        return None
    return {
        "visibility": row.visibility,
        "publish_status": row.publish_status,
        "updated_by_sub": row.updated_by_sub,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _pack_override(db: Session, pack_id: str) -> AdminPackPublicationOverride | None:
    return db.execute(
        select(AdminPackPublicationOverride).where(AdminPackPublicationOverride.pack_id == pack_id)
    ).scalar_one_or_none()


def _template_override(
    db: Session,
    *,
    pack_id: str,
    template_id: str,
) -> AdminWorldTemplatePublicationOverride | None:
    return db.execute(
        select(AdminWorldTemplatePublicationOverride).where(
            AdminWorldTemplatePublicationOverride.pack_id == pack_id,
            AdminWorldTemplatePublicationOverride.world_template_id == template_id,
        )
    ).scalar_one_or_none()


def _effective_pack_values(
    pack,
    *,
    visibility_override: str | None,
    publish_status_override: str | None,
) -> tuple[str, str]:
    return (
        visibility_override or pack.manifest.visibility,
        publish_status_override or pack.manifest.publish_status,
    )


def _effective_template_values(
    template,
    *,
    pack_visibility: str,
    pack_publish_status: str,
    visibility_override: str | None,
    publish_status_override: str | None,
) -> tuple[str, str]:
    return (
        visibility_override or template.visibility or pack_visibility,
        publish_status_override or template.publish_status or pack_publish_status,
    )


def _pack_override_value(source_value: str, requested_value: str | None, existing_value: str | None) -> str | None:
    if requested_value is None:
        return existing_value
    return None if requested_value == source_value else requested_value


def _template_override_value(source_effective_value: str, requested_value: str | None, existing_value: str | None) -> str | None:
    if requested_value is None:
        return existing_value
    return None if requested_value == source_effective_value else requested_value


def _upsert_pack_override(
    db: Session,
    *,
    pack_id: str,
    visibility: str | None,
    publish_status: str | None,
    updated_by_sub: str,
) -> None:
    row = _pack_override(db, pack_id)
    if visibility is None and publish_status is None:
        if row is not None:
            db.delete(row)
        return
    if row is None:
        row = AdminPackPublicationOverride(pack_id=pack_id)
        db.add(row)
    row.visibility = visibility
    row.publish_status = publish_status
    row.updated_by_sub = updated_by_sub


def _upsert_template_override(
    db: Session,
    *,
    pack_id: str,
    template_id: str,
    visibility: str | None,
    publish_status: str | None,
    updated_by_sub: str,
) -> None:
    row = _template_override(db, pack_id=pack_id, template_id=template_id)
    if visibility is None and publish_status is None:
        if row is not None:
            db.delete(row)
        return
    if row is None:
        row = AdminWorldTemplatePublicationOverride(pack_id=pack_id, world_template_id=template_id)
        db.add(row)
    row.visibility = visibility
    row.publish_status = publish_status
    row.updated_by_sub = updated_by_sub


def _raise_preprocess_gate(pack_id: str, blocked: list[str]) -> None:
    if blocked:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "pack_preprocess_required",
                "message": "Run pack preprocess before publishing playable public templates.",
                "pack_id": pack_id,
                "blocked_templates": blocked,
            },
        )


def _ensure_publish_gate_allows_pack_override(
    db: Session,
    container: AppContainer,
    *,
    pack_id: str,
    visibility_override: str | None,
    publish_status_override: str | None,
) -> None:
    pack = container.pack_registry.get_pack(pack_id)
    template_overrides = {
        row.world_template_id: row
        for row in db.execute(
            select(AdminWorldTemplatePublicationOverride).where(
                AdminWorldTemplatePublicationOverride.pack_id == pack_id
            )
        ).scalars()
    }
    pack_visibility, pack_publish_status = _effective_pack_values(
        pack,
        visibility_override=visibility_override,
        publish_status_override=publish_status_override,
    )
    blocked: list[str] = []
    for template_summary in pack.manifest.world_templates:
        override = template_overrides.get(template_summary.template_id)
        effective_visibility, effective_publish_status = _effective_template_values(
            template_summary,
            pack_visibility=pack_visibility,
            pack_publish_status=pack_publish_status,
            visibility_override=override.visibility if override else None,
            publish_status_override=override.publish_status if override else None,
        )
        if effective_visibility != "public" or effective_publish_status != "playable":
            continue
        template = pack.template(template_summary.template_id)
        status_payload = pack_preprocess_status(db, pack, template)
        if not status_payload["ready"]:
            blocked.append(f"{template_summary.template_id}:{status_payload['status']}")
    _raise_preprocess_gate(pack_id, blocked)


def _ensure_publish_gate_allows_template_override(
    db: Session,
    container: AppContainer,
    *,
    pack_id: str,
    template_id: str,
    visibility_override: str | None,
    publish_status_override: str | None,
) -> None:
    pack = container.pack_registry.get_pack(pack_id)
    pack_override = _pack_override(db, pack_id)
    pack_visibility, pack_publish_status = _effective_pack_values(
        pack,
        visibility_override=pack_override.visibility if pack_override else None,
        publish_status_override=pack_override.publish_status if pack_override else None,
    )
    template_summary = next(
        (item for item in pack.manifest.world_templates if item.template_id == template_id),
        None,
    )
    if template_summary is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World template not found")
    effective_visibility, effective_publish_status = _effective_template_values(
        template_summary,
        pack_visibility=pack_visibility,
        pack_publish_status=pack_publish_status,
        visibility_override=visibility_override,
        publish_status_override=publish_status_override,
    )
    blocked: list[str] = []
    if effective_visibility == "public" and effective_publish_status == "playable":
        template = pack.template(template_id)
        status_payload = pack_preprocess_status(db, pack, template)
        if not status_payload["ready"]:
            blocked.append(f"{template_id}:{status_payload['status']}")
    _raise_preprocess_gate(pack_id, blocked)


def _world_template_items(db: Session, container: AppContainer) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    pack_overrides = {
        row.pack_id: row
        for row in db.execute(select(AdminPackPublicationOverride)).scalars()
    }
    template_overrides = {
        (row.pack_id, row.world_template_id): row
        for row in db.execute(select(AdminWorldTemplatePublicationOverride)).scalars()
    }
    for pack in container.pack_registry.list_packs():
        pack_override = pack_overrides.get(pack.manifest.pack_id)
        pack_visibility, pack_publish_status = _effective_pack_values(
            pack,
            visibility_override=pack_override.visibility if pack_override else None,
            publish_status_override=pack_override.publish_status if pack_override else None,
        )
        for template in pack.manifest.world_templates:
            override = template_overrides.get((pack.manifest.pack_id, template.template_id))
            effective_visibility, effective_publish_status = _effective_template_values(
                template,
                pack_visibility=pack_visibility,
                pack_publish_status=pack_publish_status,
                visibility_override=override.visibility if override else None,
                publish_status_override=override.publish_status if override else None,
            )
            definition = pack.template(template.template_id)
            items.append(
                {
                    "pack_id": pack.manifest.pack_id,
                    "pack_display_name": pack.manifest.display_name,
                    "template_id": template.template_id,
                    "display_name": template.display_name,
                    "summary": template.summary,
                    "visibility": template.visibility,
                    "publish_status": template.publish_status,
                    "effective_visibility": effective_visibility,
                    "effective_publish_status": effective_publish_status,
                    "publication_override": _override_payload(override),
                    "preprocess": pack_preprocess_status(db, pack, definition),
                }
            )
    return items


def _scaffold_pack_payload(payload: CreatePackRequest) -> tuple[dict[str, object], dict[str, object], dict[str, object], dict[str, object]]:
    pack_yaml = {
        "pack_id": payload.pack_id,
        "version": "0.1.0",
        "engine_api_version": ENGINE_API_VERSION,
        "display_name": payload.display_name,
        "visibility": "private",
        "publish_status": "draft",
        "world_templates": [
            {
                "template_id": payload.template_id,
                "display_name": payload.template_display_name,
                "summary": payload.summary,
                "visibility": "private",
                "publish_status": "draft",
            }
        ],
        "semantic_tags": [],
        "prompt_overlays": ["prompt_overlays"],
        "content_refs": {
            "world_templates": "world_templates.yaml",
            "npcs": "npcs.yaml",
            "prompt_overlays": "prompts.yaml",
        },
    }
    world_templates = {
        "world_templates": {
            payload.template_id: {
                "template_id": payload.template_id,
                "display_name": payload.template_display_name,
                "summary": payload.summary,
                "world": {"world_id": payload.pack_id, "default_name": payload.template_display_name},
                "roles": {
                    "starter_location_key": "starter",
                    "lore_location_key": "lore",
                    "followup_location_key": "followup",
                    "guide_npc_name": "Guide",
                    "starter_stage_key": "starter_stage",
                    "followup_stage_key": "followup_stage",
                    "opening_chapter_key": "opening_chapter",
                    "followup_chapter_key": "followup_chapter",
                    "reward_effect_kind": "unlock_followup_route",
                    "followup_branches": {
                        "formal_path": {"branch_key": "formal_path", "label": "Formal Path", "anchor_npcs": ["Guide"]},
                        "undercurrent_path": {
                            "branch_key": "undercurrent_path",
                            "label": "Undercurrent Path",
                            "anchor_npcs": ["Guide"],
                        },
                    },
                },
                "locations": {
                    "starter": {"id": "starter", "starter": True, "name": "Starter", "description": "Opening location."},
                    "lore": {"id": "lore", "name": "Lore", "description": "Context location."},
                    "followup": {"id": "followup", "name": "Follow-up", "description": "Follow-up location."},
                },
                "routes": [
                    {"route_key": "starter_to_lore", "from": "starter", "to": "lore", "status": "open"},
                    {"route_key": "starter_to_followup", "from": "starter", "to": "followup", "status": "locked"},
                ],
                "faction": {"id": "local_faction", "name": "Local Faction", "description": "Scaffold faction."},
                "factions": [{"id": "local_faction", "name": "Local Faction", "description": "Scaffold faction."}],
                "quest": {
                    "id": "starter_quest",
                    "title": "Starter Request",
                    "description": "Scaffold starter request.",
                    "stage_key": "starter_stage",
                    "reward_template_key": "starter_reward",
                    "reward_name": "Starter Writ",
                    "reward_description": "Opens the follow-up route.",
                    "state": {"reward_effect_kind": "unlock_followup_route"},
                },
                "followup_quest": {
                    "id": "followup_quest",
                    "title": "Follow-up Request",
                    "description": "Scaffold follow-up request.",
                    "stage_key": "followup_stage",
                    "reward_template_key": "none",
                },
            }
        }
    }
    npcs = {
        "npcs": [
            {
                "display_name": "Guide",
                "personality": "steady",
                "goals": {"duty": "guide the first session"},
                "home_location_key": "starter",
                "routine_state": {"routine_role": "guide"},
                "is_guide": True,
            }
        ]
    }
    prompts = {"global": {}, "templates": {}}
    return pack_yaml, world_templates, npcs, prompts


@router.get("/overview")
def get_admin_overview(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    pack_catalog = pack_catalog_health_summary(db, container.pack_registry)
    projection = projection_status(db, container.settings, container.projection_service)
    release = container.eval_service.latest_release_checklist(db)
    sp = sp_overview(db, container.economy_service)
    return {
        "status": "ready",
        "packs": pack_catalog,
        "projection": {
            "backend": projection["backend"],
            "graph_read_mode": projection["graph_read_mode"],
            "graph_runtime_status": projection["graph_runtime_status"],
            "pending": projection["pending"],
            "failed": projection["failed"],
        },
        "sp": {
            "total_accounts": sp["total_accounts"],
            "total_ledger_entries": sp["total_ledger_entries"],
            "choice_turn_cost": sp["choice_turn_cost"],
            "free_text_turn_cost": sp["free_text_turn_cost"],
        },
        "release": {
            "verdict": release.get("verdict"),
            "canary_promote_status": release.get("canary_promote_status"),
            "created_at": release.get("created_at"),
        },
    }


@router.get("/packs")
def get_admin_packs(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return _pack_payload(db, container)


@router.get("/packs/preprocess-status")
def get_admin_pack_preprocess_status(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return list_pack_preprocess_statuses(db, container.pack_registry)


@router.post("/packs/{pack_id}/templates/{template_id}/preprocess")
def post_admin_pack_preprocess(
    pack_id: str,
    template_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    try:
        result = run_pack_preprocess(
            db,
            registry=container.pack_registry,
            memory_service=container.memory_service,
            projection_service=container.projection_service,
            pack_id=pack_id,
            world_template_id=template_id,
            triggered_by_sub=user.sub,
        )
    except WorldPackError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=exc.diagnostic()) from exc
    db.commit()
    return result


@router.post("/packs", status_code=status.HTTP_201_CREATED)
def post_admin_pack(
    payload: CreatePackRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    try:
        PackRegistry._validate_slug(
            payload.pack_id,
            field_name="pack_id",
            code="invalid_pack_id",
            pack_id=payload.pack_id,
            path=container.settings.pack_dir,
        )
        PackRegistry._validate_slug(
            payload.template_id,
            field_name="world_template_id",
            code="invalid_template_id",
            pack_id=payload.pack_id,
            path=container.settings.pack_dir,
        )
    except WorldPackError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=exc.diagnostic()) from exc
    root = Path(container.settings.pack_dir).resolve() / payload.pack_id
    if root.exists():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pack already exists")
    root.mkdir(parents=True)
    pack_yaml, world_templates, npcs, prompts = _scaffold_pack_payload(payload)
    _write_yaml(root / "pack.yaml", pack_yaml)
    _write_yaml(root / "world_templates.yaml", world_templates)
    _write_yaml(root / "npcs.yaml", npcs)
    _write_yaml(root / "prompts.yaml", prompts)
    try:
        load_pack_from_dir(container.settings.pack_dir, payload.pack_id)
    except WorldPackError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=exc.diagnostic()) from exc
    _refresh_pack_registry(container)
    return {"status": "created", "pack_id": payload.pack_id, "catalog": _pack_payload(db, container)}


@router.post("/packs/import")
def post_admin_pack_import(
    payload: ImportPackRequest,
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    try:
        result = import_pack_archive(container.settings.pack_dir, payload.archive_path, replace=payload.replace)
    except WorldPackError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=exc.diagnostic()) from exc
    _refresh_pack_registry(container)
    return result


@router.patch("/packs/{pack_id}")
def patch_admin_pack(
    pack_id: str,
    payload: PatchPackRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    try:
        pack = container.pack_registry.get_pack(pack_id)
    except WorldPackError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=exc.diagnostic()) from exc
    existing = _pack_override(db, pack_id)
    visibility_override = _pack_override_value(
        pack.manifest.visibility,
        payload.visibility,
        existing.visibility if existing else None,
    )
    publish_status_override = _pack_override_value(
        pack.manifest.publish_status,
        payload.publish_status,
        existing.publish_status if existing else None,
    )
    if payload.visibility == "public" or payload.publish_status == "playable":
        _ensure_publish_gate_allows_pack_override(
            db,
            container,
            pack_id=pack_id,
            visibility_override=visibility_override,
            publish_status_override=publish_status_override,
        )
    _upsert_pack_override(
        db,
        pack_id=pack_id,
        visibility=visibility_override,
        publish_status=publish_status_override,
        updated_by_sub=user.sub,
    )
    db.commit()
    return {"status": "updated", "pack_id": pack_id, "catalog": _pack_payload(db, container)}


@router.get("/world-templates")
def get_admin_world_templates(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return {"items": _world_template_items(db, container)}


@router.patch("/world-templates/{pack_id}/{template_id}")
def patch_admin_world_template(
    pack_id: str,
    template_id: str,
    payload: PatchTemplateRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    try:
        pack = container.pack_registry.get_pack(pack_id)
        template_summary = next(
            (item for item in pack.manifest.world_templates if item.template_id == template_id),
            None,
        )
        if template_summary is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World template not found")
    except WorldPackError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=exc.diagnostic()) from exc
    existing = _template_override(db, pack_id=pack_id, template_id=template_id)
    pack_override = _pack_override(db, pack_id)
    pack_visibility, pack_publish_status = _effective_pack_values(
        pack,
        visibility_override=pack_override.visibility if pack_override else None,
        publish_status_override=pack_override.publish_status if pack_override else None,
    )
    inherited_visibility, inherited_publish_status = _effective_template_values(
        template_summary,
        pack_visibility=pack_visibility,
        pack_publish_status=pack_publish_status,
        visibility_override=None,
        publish_status_override=None,
    )
    visibility_override = _template_override_value(
        inherited_visibility,
        payload.visibility,
        existing.visibility if existing else None,
    )
    publish_status_override = _template_override_value(
        inherited_publish_status,
        payload.publish_status,
        existing.publish_status if existing else None,
    )
    if payload.visibility is None and payload.publish_status is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="No publication override fields provided")
    if payload.visibility == "public" or payload.publish_status == "playable":
        _ensure_publish_gate_allows_template_override(
            db,
            container,
            pack_id=pack_id,
            template_id=template_id,
            visibility_override=visibility_override,
            publish_status_override=publish_status_override,
        )
    _upsert_template_override(
        db,
        pack_id=pack_id,
        template_id=template_id,
        visibility=visibility_override,
        publish_status=publish_status_override,
        updated_by_sub=user.sub,
    )
    db.commit()
    return {"status": "updated", "items": _world_template_items(db, container)}


@router.get("/users")
def get_admin_users(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    rows = list(db.execute(select(AdminAppUser).order_by(AdminAppUser.user_sub)).scalars())
    items = [
        {
            "user_sub": row.user_sub,
            "email": row.email,
            "display_name": row.display_name,
            "role": row.role,
            "status": row.status,
            "permissions": row.permissions,
            "source": "database",
        }
        for row in rows
    ]
    existing = {item["user_sub"] for item in items}
    for sub in container.settings.ops_admin_sub_list:
        if sub not in existing:
            items.append(
                {
                    "user_sub": sub,
                    "email": "",
                    "display_name": sub,
                    "role": "admin",
                    "status": "active",
                    "permissions": {"bootstrap": True},
                    "source": "OPS_ADMIN_SUBS",
                }
            )
    return {"items": items}


@router.patch("/users/{user_sub}/permissions")
def patch_admin_user_permissions(
    user_sub: str,
    payload: UserPermissionsRequest,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    row = db.execute(select(AdminAppUser).where(AdminAppUser.user_sub == user_sub)).scalar_one_or_none()
    if row is None:
        row = AdminAppUser(user_sub=user_sub)
        db.add(row)
    row.email = payload.email
    row.display_name = payload.display_name or user_sub
    row.role = payload.role
    row.status = payload.status
    row.permissions = payload.permissions
    row.updated_at = _now()
    db.commit()
    return {
        "user_sub": row.user_sub,
        "email": row.email,
        "display_name": row.display_name,
        "role": row.role,
        "status": row.status,
        "permissions": row.permissions,
    }


@router.get("/settings/llm")
def get_admin_llm_settings(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    config = _runtime_config(db)
    db.commit()
    return {
        "provider": config.provider,
        "base_url_secret_ref": config.base_url_secret_ref,
        "api_key_secret_ref": config.api_key_secret_ref,
        "embedding_provider": config.embedding_provider,
        "embedding_base_url_secret_ref": config.embedding_base_url_secret_ref,
        "embedding_api_key_secret_ref": config.embedding_api_key_secret_ref,
        "admin_debug_enabled": config.admin_debug_enabled,
        "effective_provider": container.settings.model_provider,
        "effective_embedding_provider": container.settings.embedding_provider,
    }


@router.put("/settings/llm")
def put_admin_llm_settings(
    payload: LLMSettingsRequest,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    config = _runtime_config(db)
    config.provider = payload.provider
    config.base_url_secret_ref = payload.base_url_secret_ref
    config.api_key_secret_ref = payload.api_key_secret_ref
    config.embedding_provider = payload.embedding_provider
    config.embedding_base_url_secret_ref = payload.embedding_base_url_secret_ref
    config.embedding_api_key_secret_ref = payload.embedding_api_key_secret_ref
    config.admin_debug_enabled = payload.admin_debug_enabled
    config.updated_at = _now()
    db.commit()
    return {"status": "updated", "admin_debug_enabled": config.admin_debug_enabled}


@router.get("/model-lanes")
def get_admin_model_lanes(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    config = _runtime_config(db)
    model_ids = {
        "lite_lane": container.settings.model_lite_id,
        "main_lane": container.settings.model_main_id,
        "pro_lane": container.settings.model_pro_id,
        **dict(config.model_ids or {}),
    }
    db.commit()
    return {"supported_lanes": sorted(SUPPORTED_MODEL_LANES), "model_ids": model_ids}


@router.get("/llm-usage")
def get_admin_llm_usage(
    range_name: Literal["24h", "30d"] = Query(default="24h", alias="range"),
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return llm_usage_timeline(db, range_name=range_name)


@router.put("/model-lanes")
def put_admin_model_lanes(
    payload: ModelLanesRequest,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    unknown = sorted(set(payload.model_ids) - SUPPORTED_MODEL_LANES)
    if unknown:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Unsupported lanes: {unknown}")
    config = _runtime_config(db)
    config.model_ids = {lane: model_id for lane, model_id in payload.model_ids.items() if model_id.strip()}
    config.updated_at = _now()
    db.commit()
    return {"status": "updated", "model_ids": config.model_ids}


@router.get("/prompts")
def get_admin_prompts(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    overrides = {
        row.prompt_id: row
        for row in db.execute(select(AdminPromptOverride)).scalars()
    }
    items = []
    for prompt in sorted(container.prompt_registry._cache.values(), key=lambda item: item.prompt_id):
        override = overrides.get(prompt.prompt_id)
        items.append(
            {
                "prompt_id": prompt.prompt_id,
                "owner_module": prompt.owner_module,
                "schema_version": prompt.schema_version,
                "model_lane": prompt.model_lane,
                "expected_output_schema": prompt.expected_output_schema,
                "eval_dataset_ref": prompt.eval_dataset_ref,
                "override_enabled": bool(override.enabled) if override else False,
            }
        )
    return {"items": items}


@router.get("/prompts/{prompt_id}")
def get_admin_prompt(
    prompt_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    try:
        prompt = container.prompt_registry.get(prompt_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    override = db.execute(select(AdminPromptOverride).where(AdminPromptOverride.prompt_id == prompt_id)).scalar_one_or_none()
    return {
        "prompt_id": prompt.prompt_id,
        "owner_module": prompt.owner_module,
        "schema_version": prompt.schema_version,
        "model_lane": prompt.model_lane,
        "expected_output_schema": prompt.expected_output_schema,
        "eval_dataset_ref": prompt.eval_dataset_ref,
        "world_invariants": prompt.world_invariants,
        "instructions": prompt.instructions,
        "override": {
            "enabled": bool(override.enabled) if override else False,
            "instructions": override.instructions if override else "",
        },
    }


@router.put("/prompts/{prompt_id}/override")
def put_admin_prompt_override(
    prompt_id: str,
    payload: PromptOverrideRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    try:
        container.prompt_registry.get(prompt_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    row = db.execute(select(AdminPromptOverride).where(AdminPromptOverride.prompt_id == prompt_id)).scalar_one_or_none()
    if row is None:
        row = AdminPromptOverride(prompt_id=prompt_id)
        db.add(row)
    row.enabled = payload.enabled
    row.instructions = payload.instructions
    row.updated_at = _now()
    db.commit()
    return {"status": "updated", "prompt_id": prompt_id, "enabled": row.enabled}


@router.get("/sp/overview")
def get_admin_sp_overview(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return sp_overview(db, container.economy_service)


@router.post("/sp/adjustments")
def post_admin_sp_adjustment(
    payload: SPAdjustmentRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    if payload.world_id is not None:
        world_exists = db.execute(select(World.id).where(World.id == payload.world_id)).scalar_one_or_none()
        if world_exists is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World not found")
    try:
        result = container.economy_service.apply_adjustment(
            db,
            user_sub=payload.user_sub,
            delta=payload.delta,
            reason_code=payload.reason_code,
            sp_bucket=payload.sp_bucket,
            world_id=payload.world_id,
            actor_id=payload.actor_id,
            created_by_sub=user.sub,
            note=payload.note,
        )
    except InsufficientSPError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.detail) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    db.commit()
    return {
        "ledger_entry_id": result.ledger_entry.id,
        "user_sub": payload.user_sub,
        "delta": result.delta,
        "paid_delta": result.paid_delta,
        "bonus_delta": result.bonus_delta,
        "balance": result.balance_after,
        "paid_sp": result.paid_balance_after,
        "bonus_sp": result.bonus_balance_after,
    }


@router.get("/release")
def get_admin_release(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    report = container.eval_service.latest_release_checklist(db)
    return {
        "report_id": report.get("report_id"),
        "verdict": report.get("verdict"),
        "blocked_reasons": report.get("blocked_reasons", []),
        "trigger_type": report.get("trigger_type"),
        "canary_promote_status": report.get("canary_promote_status"),
        "created_at": report.get("created_at"),
        "cutover_status": report.get("cutover_status"),
        "checks": report.get("check_summaries", []),
    }


@router.post("/release/checklists/run")
def post_admin_release_checklist(
    payload: ReleaseChecklistRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    result = container.eval_service.run_release_checklist(
        db,
        trigger_type=payload.trigger_type,
        shadow_limit=payload.shadow_limit,
    )
    db.commit()
    return result


@router.get("/release/checklists/progress")
def get_admin_release_checklist_progress(
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return container.eval_service.release_checklist_progress()
