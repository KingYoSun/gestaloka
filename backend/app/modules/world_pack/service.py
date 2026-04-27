from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import tempfile
from typing import Any, Literal, Mapping

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.models.entities import World


ENGINE_API_VERSION = "v2"
FOLLOWUP_BRANCH_SLOTS = ("formal_path", "undercurrent_path")
PACK_YAML_SUFFIXES = {".yaml", ".yml"}
PACK_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,119}$")
PACK_ARCHIVE_SUFFIX = ".tar.gz"
PackVisibility = Literal["public", "private"]
PackPublishStatus = Literal["playable", "draft", "archived"]

_ACTIVE_REGISTRY: PackRegistry | None = None
_ACTIVE_PACK_DIR: Path | None = None


class WorldPackError(ValueError):
    def __init__(
        self,
        message: str,
        *,
        code: str = "world_pack_error",
        pack_id: str | None = None,
        path: Path | str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.pack_id = pack_id
        self.path = str(path) if path is not None else None

    def diagnostic(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "error": self.code,
            "message": str(self),
        }
        if self.pack_id is not None:
            payload["pack_id"] = self.pack_id
        if self.path is not None:
            payload["path"] = self.path
        return payload


class TemplateSummary(BaseModel):
    template_id: str = Field(min_length=1, max_length=120)
    display_name: str = Field(min_length=1, max_length=120)
    summary: str = ""
    visibility: PackVisibility | None = None
    publish_status: PackPublishStatus | None = None


class PackManifest(BaseModel):
    pack_id: str = Field(min_length=1, max_length=120)
    version: str = Field(min_length=1, max_length=32)
    engine_api_version: str = Field(min_length=1, max_length=16)
    display_name: str = Field(min_length=1, max_length=120)
    visibility: PackVisibility = "public"
    publish_status: PackPublishStatus = "playable"
    world_templates: list[TemplateSummary] = Field(min_length=1)
    semantic_tags: list[str] = Field(default_factory=list)
    prompt_overlays: list[str] = Field(default_factory=list)
    content_refs: dict[str, str] = Field(default_factory=dict)


class PackRoles(BaseModel):
    starter_location_key: str = "starter"
    lore_location_key: str = "lore"
    followup_location_key: str = "followup"
    guide_npc_name: str = ""
    starter_stage_key: str = "starter_stage"
    followup_stage_key: str = "followup_stage"
    opening_chapter_key: str = "opening_chapter"
    followup_chapter_key: str = "followup_chapter"
    reward_effect_kind: str = "unlock_followup_route"
    followup_branches: PackFollowupBranches


FollowupBranchSlot = Literal["formal_path", "undercurrent_path"]


class PackFollowupBranch(BaseModel):
    branch_key: str = Field(min_length=1, max_length=120)
    label: str = Field(min_length=1, max_length=120)
    anchor_npcs: list[str] = Field(min_length=1)
    summary: str = ""
    committed_summary: str = ""
    player_hint: str = ""
    signal_weights: dict[str, float] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_anchor_npcs(self) -> "PackFollowupBranch":
        deduplicated: list[str] = []
        seen: set[str] = set()
        for item in self.anchor_npcs:
            candidate = str(item or "").strip()
            if not candidate or candidate in seen:
                continue
            deduplicated.append(candidate)
            seen.add(candidate)
        if not deduplicated:
            raise ValueError("followup branch must define at least one anchor_npcs entry")
        self.anchor_npcs = deduplicated
        return self


class PackFollowupBranches(BaseModel):
    formal_path: PackFollowupBranch
    undercurrent_path: PackFollowupBranch

    @model_validator(mode="after")
    def validate_branch_keys(self) -> "PackFollowupBranches":
        keys = [self.formal_path.branch_key, self.undercurrent_path.branch_key]
        if len(set(keys)) != len(keys):
            raise ValueError("followup branch keys must be unique")
        return self

    def by_slot(self) -> dict[FollowupBranchSlot, PackFollowupBranch]:
        return {
            "formal_path": self.formal_path,
            "undercurrent_path": self.undercurrent_path,
        }


class PackBootstrap(BaseModel):
    start_consequence_summary: str = "The first request waits for your next move."
    session_started_narrative: str = (
        "{player_name} began a session in {starter_location_name} and received the first request from {guide_npc_name}."
    )
    reward_unlock_summary: str = "{reward_name} unlocked the next route."
    reward_use_narrative: str = (
        "{player_name} raised {reward_name} in {starter_location_name}, and {faction_name} opened the next route."
    )
    reward_location_memory: str = "{starter_location_name} remembers {reward_name} opening the next route."
    reward_world_memory: str = (
        "{player_name} used {reward_name} to open the next route for {faction_name}'s follow-up request."
    )


class PackLocation(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    starter: bool = False
    name: str = Field(min_length=1, max_length=120)
    description: str = ""


class PackRoute(BaseModel):
    route_key: str = Field(min_length=1, max_length=120)
    from_location_key: str = Field(alias="from", min_length=1, max_length=120)
    to_location_key: str = Field(alias="to", min_length=1, max_length=120)
    status: str = "open"
    travel_summary: str = ""
    unlock_requirements: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(populate_by_name=True)


class PackFaction(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    state: dict[str, Any] = Field(default_factory=dict)


class PackQuest(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=160)
    description: str = ""
    stage_key: str = Field(min_length=1, max_length=120)
    unlock_requirements: dict[str, Any] = Field(default_factory=dict)
    completion_target: int = Field(default=1, ge=1)
    reward_template_key: str = "none"
    reward_name: str = ""
    reward_description: str = ""
    state: dict[str, Any] = Field(default_factory=dict)


class PackCharacter(BaseModel):
    rank: str = "Wayfarer"
    hp: int = 10
    focus: int = 5
    status_json: dict[str, Any] = Field(default_factory=dict)


class PackNPCSeed(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    personality: str = ""
    goals: dict[str, str] = Field(default_factory=dict)
    home_location_key: str = Field(min_length=1, max_length=120)
    routine_state: dict[str, Any] = Field(default_factory=dict)
    is_guide: bool = False


class WorldTemplateDefinition(BaseModel):
    template_id: str = Field(min_length=1, max_length=120)
    display_name: str = Field(min_length=1, max_length=120)
    summary: str = ""
    world: dict[str, Any] = Field(default_factory=dict)
    roles: PackRoles = Field(default_factory=PackRoles)
    bootstrap: PackBootstrap = Field(default_factory=PackBootstrap)
    locations: dict[str, PackLocation]
    routes: list[PackRoute]
    faction: PackFaction
    quest: PackQuest
    followup_quest: PackQuest
    character: PackCharacter = Field(default_factory=PackCharacter)

    @model_validator(mode="after")
    def validate_world_template(self) -> "WorldTemplateDefinition":
        location_keys = set(self.locations)
        required = {
            self.roles.starter_location_key,
            self.roles.lore_location_key,
            self.roles.followup_location_key,
        }
        missing = required - location_keys
        if missing:
            raise ValueError(f"world template {self.template_id} is missing location keys: {sorted(missing)}")
        npc_reward_effect = str((self.quest.state or {}).get("reward_effect_kind") or self.roles.reward_effect_kind)
        if npc_reward_effect != self.roles.reward_effect_kind:
            self.roles.reward_effect_kind = npc_reward_effect
        return self


class WorldTemplatesPayload(BaseModel):
    world_templates: dict[str, WorldTemplateDefinition]


class NPCSeedsPayload(BaseModel):
    npcs: list[PackNPCSeed] = Field(default_factory=list)


class PromptOverlaysPayload(BaseModel):
    global_overlays: dict[str, str] = Field(default_factory=dict, alias="global")
    template_overlays: dict[str, dict[str, str]] = Field(default_factory=dict, alias="templates")

    model_config = ConfigDict(populate_by_name=True)


def serialize_followup_branches(
    followup_branches: PackFollowupBranches | Mapping[str, Any] | None,
) -> dict[FollowupBranchSlot, dict[str, Any]]:
    if isinstance(followup_branches, PackFollowupBranches):
        entries = followup_branches.by_slot()
    else:
        raw = dict(followup_branches or {})
        entries = {}
        for slot in FOLLOWUP_BRANCH_SLOTS:
            item = raw.get(slot)
            if not isinstance(item, Mapping):
                raise ValueError(f"followup branch mapping is missing slot {slot}")
            branch_key = str(item.get("branch_key") or "").strip()
            label = str(item.get("label") or "").strip() or branch_key.replace("_", " ").title()
            if not branch_key:
                raise ValueError(f"followup branch mapping is missing branch_key for slot {slot}")
            entries[slot] = {
                "branch_key": branch_key,
                "label": label,
                "anchor_npcs": [str(name).strip() for name in item.get("anchor_npcs") or [] if str(name).strip()],
                "summary": str(item.get("summary") or "").strip(),
                "committed_summary": str(item.get("committed_summary") or "").strip(),
                "player_hint": str(item.get("player_hint") or "").strip(),
                "signal_weights": {
                    str(key): float(value)
                    for key, value in dict(item.get("signal_weights") or {}).items()
                    if str(key).strip()
                },
            }
    return {
        slot: {
            "slot": slot,
            "branch_key": entry.branch_key if isinstance(entry, PackFollowupBranch) else str(entry["branch_key"]),
            "label": entry.label if isinstance(entry, PackFollowupBranch) else str(entry["label"]),
            "anchor_npcs": (
                list(entry.anchor_npcs)
                if isinstance(entry, PackFollowupBranch)
                else [str(name) for name in entry.get("anchor_npcs") or []]
            ),
            "summary": entry.summary if isinstance(entry, PackFollowupBranch) else str(entry.get("summary") or ""),
            "committed_summary": (
                entry.committed_summary
                if isinstance(entry, PackFollowupBranch)
                else str(entry.get("committed_summary") or "")
            ),
            "player_hint": entry.player_hint if isinstance(entry, PackFollowupBranch) else str(entry.get("player_hint") or ""),
            "signal_weights": (
                dict(entry.signal_weights)
                if isinstance(entry, PackFollowupBranch)
                else {
                    str(key): float(value)
                    for key, value in dict(entry.get("signal_weights") or {}).items()
                    if str(key).strip()
                }
            ),
        }
        for slot, entry in entries.items()
    }


def branch_labels_from_followup_branches(
    followup_branches: PackFollowupBranches | Mapping[str, Any] | None,
) -> dict[str, str]:
    entries = serialize_followup_branches(followup_branches)
    return {
        str(entry["branch_key"]): str(entry["label"])
        for entry in entries.values()
    }


@dataclass(frozen=True)
class LoadedWorldPack:
    manifest: PackManifest
    templates: dict[str, WorldTemplateDefinition]
    npcs: list[PackNPCSeed]
    prompt_overlays: PromptOverlaysPayload
    root_dir: Path

    def template(self, template_id: str) -> WorldTemplateDefinition:
        try:
            return self.templates[template_id]
        except KeyError as exc:
            raise WorldPackError(
                f"Unknown world_template_id {template_id!r} for pack {self.manifest.pack_id}",
                code="unknown_template",
                pack_id=self.manifest.pack_id,
                path=self.root_dir,
            ) from exc


@dataclass(frozen=True)
class PackCatalogFailure:
    error: str
    message: str
    severity: str
    pack_id: str | None = None
    path: str | None = None

    @classmethod
    def from_error(cls, exc: WorldPackError) -> "PackCatalogFailure":
        return cls(
            error=exc.code,
            message=str(exc),
            severity=_failure_severity(exc.code),
            pack_id=exc.pack_id,
            path=exc.path,
        )

    def diagnostic(self, *, include_path: bool) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "error": self.error,
            "message": self.message,
            "severity": self.severity,
        }
        if self.pack_id is not None:
            payload["pack_id"] = self.pack_id
        if include_path and self.path is not None:
            payload["path"] = self.path
        return payload


def _failure_severity(code: str) -> str:
    if code in {"pack_dir_not_found", "pack_dir_not_directory", "empty_pack_dir"}:
        return "critical"
    return "error"


class PackRegistry:
    def __init__(self, pack_dir: Path) -> None:
        self.pack_dir = Path(pack_dir).resolve()
        self.failures: list[PackCatalogFailure] = []
        self._packs = self._load_packs()

    @property
    def status(self) -> Literal["ready", "degraded", "error"]:
        if self._packs and not self.failures:
            return "ready"
        if self._packs:
            return "degraded"
        return "error"

    @property
    def failure_count(self) -> int:
        return len(self.failures)

    def list_packs(self) -> list[LoadedWorldPack]:
        return [self._packs[key] for key in sorted(self._packs)]

    def get_pack(self, pack_id: str) -> LoadedWorldPack:
        try:
            return self._packs[pack_id]
        except KeyError as exc:
            raise WorldPackError(
                f"Unknown pack_id {pack_id!r} in pack_dir {self.pack_dir}",
                code="unknown_pack",
                pack_id=pack_id,
                path=self.pack_dir,
            ) from exc

    def get_template(self, pack_id: str, template_id: str) -> WorldTemplateDefinition:
        return self.get_pack(pack_id).template(template_id)

    def pack_summary_items(self, *, public_only: bool = False) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for pack in self.list_packs():
            template_summaries = list(pack.manifest.world_templates)
            if public_only:
                template_summaries = [
                    template
                    for template in template_summaries
                    if _template_is_public_playable(self, pack, template.template_id)
                ]
                if not template_summaries:
                    continue
            items.append(
                {
                    "pack_id": pack.manifest.pack_id,
                    "version": pack.manifest.version,
                    "engine_api_version": pack.manifest.engine_api_version,
                    "display_name": pack.manifest.display_name,
                    "visibility": pack.manifest.visibility,
                    "publish_status": pack.manifest.publish_status,
                    "semantic_tags": list(pack.manifest.semantic_tags),
                    "content_refs": dict(pack.manifest.content_refs),
                    "world_templates": [
                        _template_summary_payload(pack, template)
                        for template in template_summaries
                    ],
                }
            )
        return items

    def public_catalog(self) -> dict[str, Any]:
        items = self.pack_summary_items(public_only=True)
        template_count = sum(len(item["world_templates"]) for item in items)
        return {
            "status": "ready" if template_count else "error",
            "engine_api_version": ENGINE_API_VERSION,
            "pack_count": len(items),
            "template_count": template_count,
            "items": items,
        }

    def catalog_diagnostic(self, *, include_paths: bool = True) -> dict[str, Any]:
        packs = self.list_packs()
        items: list[dict[str, Any]] = []
        for pack in packs:
            item = {
                "pack_id": pack.manifest.pack_id,
                "version": pack.manifest.version,
                "engine_api_version": pack.manifest.engine_api_version,
                "display_name": pack.manifest.display_name,
                "visibility": pack.manifest.visibility,
                "publish_status": pack.manifest.publish_status,
                "semantic_tags": list(pack.manifest.semantic_tags),
                "world_templates": [
                    _template_summary_payload(pack, template)
                    for template in pack.manifest.world_templates
                ],
            }
            if include_paths:
                item["root_dir"] = str(pack.root_dir)
            items.append(item)
        payload: dict[str, Any] = {
            "status": self.status,
            "engine_api_version": ENGINE_API_VERSION,
            "pack_count": len(packs),
            "template_count": sum(len(pack.manifest.world_templates) for pack in packs),
            "failure_count": self.failure_count,
            "failures": [failure.diagnostic(include_path=include_paths) for failure in self.failures],
            "items": items,
        }
        if include_paths:
            payload["pack_dir"] = str(self.pack_dir)
        return payload

    def health_summary(self) -> dict[str, Any]:
        diagnostic = self.catalog_diagnostic(include_paths=False)
        return {
            "status": diagnostic["status"],
            "engine_api_version": diagnostic["engine_api_version"],
            "pack_count": diagnostic["pack_count"],
            "template_count": diagnostic["template_count"],
            "failure_count": diagnostic["failure_count"],
        }

    def resolve_prompt_overlay(self, *, pack_id: str, template_id: str, prompt_id: str) -> str:
        pack = self.get_pack(pack_id)
        sections = [
            pack.prompt_overlays.global_overlays.get("*", "").strip(),
            pack.prompt_overlays.global_overlays.get(prompt_id, "").strip(),
            (pack.prompt_overlays.template_overlays.get(template_id) or {}).get("*", "").strip(),
            (pack.prompt_overlays.template_overlays.get(template_id) or {}).get(prompt_id, "").strip(),
        ]
        return "\n\n".join(section for section in sections if section)


    def _load_packs(self) -> dict[str, LoadedWorldPack]:
        if not self.pack_dir.exists():
            self._record_failure(
                WorldPackError(
                    f"Pack directory not found: {self.pack_dir}",
                    code="pack_dir_not_found",
                    path=self.pack_dir,
                )
            )
            return {}
        if not self.pack_dir.is_dir():
            self._record_failure(
                WorldPackError(
                    f"Pack directory is not a directory: {self.pack_dir}",
                    code="pack_dir_not_directory",
                    path=self.pack_dir,
                )
            )
            return {}
        packs: dict[str, LoadedWorldPack] = {}
        pack_roots: list[Path] = []
        for path in sorted(self.pack_dir.iterdir()):
            if path.name.startswith(".") or path.name == "__pycache__":
                continue
            if path.is_symlink():
                self._record_failure(
                    WorldPackError(
                        f"Pack root symlink is not allowed: {path}",
                        code="pack_root_symlink_not_allowed",
                        pack_id=path.name,
                        path=path,
                    )
                )
                continue
            if path.is_dir():
                pack_roots.append(path)
        if not pack_roots:
            if not self.failures:
                self._record_failure(
                    WorldPackError(
                        f"No world packs found in {self.pack_dir}",
                        code="empty_pack_dir",
                        path=self.pack_dir,
                    )
                )
            return {}
        for pack_root in pack_roots:
            pack_file = pack_root / "pack.yaml"
            if not pack_file.exists():
                self._record_failure(
                    WorldPackError(
                        f"Pack manifest not found: {pack_file}",
                        code="pack_manifest_not_found",
                        pack_id=pack_root.name,
                        path=pack_file,
                    )
                )
                continue
            if not pack_file.is_file():
                self._record_failure(
                    WorldPackError(
                        f"Pack manifest is not a file: {pack_file}",
                        code="pack_manifest_not_file",
                        pack_id=pack_root.name,
                        path=pack_file,
                    )
                )
                continue
            try:
                loaded = self._load_pack(pack_file)
            except WorldPackError as exc:
                self._record_failure(exc)
                continue
            if loaded.manifest.pack_id in packs:
                self._record_failure(
                    WorldPackError(
                        f"Duplicate pack_id {loaded.manifest.pack_id!r} detected in {self.pack_dir}",
                        code="duplicate_pack_id",
                        pack_id=loaded.manifest.pack_id,
                        path=pack_file,
                    )
                )
                continue
            packs[loaded.manifest.pack_id] = loaded
        if not packs:
            if not self.failures:
                self._record_failure(
                    WorldPackError(
                        f"No world packs found in {self.pack_dir}",
                        code="empty_pack_dir",
                        path=self.pack_dir,
                    )
                )
        return packs

    def _record_failure(self, exc: WorldPackError) -> None:
        self.failures.append(PackCatalogFailure.from_error(exc))

    def _load_pack(self, manifest_path: Path) -> LoadedWorldPack:
        manifest_path = manifest_path.resolve()
        pack_dir_name = manifest_path.parent.name
        self._validate_pack_root(manifest_path.parent, pack_id=pack_dir_name, path=manifest_path)
        if not manifest_path.is_file():
            raise WorldPackError(
                f"Pack manifest is not a file: {manifest_path}",
                code="pack_manifest_not_file",
                pack_id=pack_dir_name,
                path=manifest_path,
            )
        raw_manifest = self._read_yaml_mapping(manifest_path, pack_id=pack_dir_name, content_key="manifest")
        try:
            manifest = PackManifest.model_validate(raw_manifest)
        except ValidationError as exc:
            raise WorldPackError(
                f"Pack manifest is invalid at {manifest_path}: {exc}",
                code="invalid_manifest",
                pack_id=pack_dir_name,
                path=manifest_path,
            ) from exc
        self._validate_slug(
            manifest.pack_id,
            field_name="pack_id",
            code="invalid_pack_id",
            pack_id=manifest.pack_id,
            path=manifest_path,
        )
        seen_template_ids: set[str] = set()
        for template_summary in manifest.world_templates:
            self._validate_slug(
                template_summary.template_id,
                field_name="world_template_id",
                code="invalid_template_id",
                pack_id=manifest.pack_id,
                path=manifest_path,
            )
            if template_summary.template_id in seen_template_ids:
                raise WorldPackError(
                    f"Pack {manifest.pack_id} manifest has duplicate world_template_id {template_summary.template_id!r}",
                    code="duplicate_template_id",
                    pack_id=manifest.pack_id,
                    path=manifest_path,
                )
            seen_template_ids.add(template_summary.template_id)
        if manifest.pack_id != pack_dir_name:
            raise WorldPackError(
                f"Pack directory {pack_dir_name!r} contains manifest pack_id {manifest.pack_id!r}; they must match",
                code="pack_id_mismatch",
                pack_id=manifest.pack_id,
                path=manifest_path,
            )
        if manifest.engine_api_version != ENGINE_API_VERSION:
            raise WorldPackError(
                f"Pack {manifest.pack_id} uses engine_api_version {manifest.engine_api_version}, expected {ENGINE_API_VERSION}",
                code="engine_api_version_mismatch",
                pack_id=manifest.pack_id,
                path=manifest_path,
            )

        root_dir = manifest_path.parent
        templates_payload = self._read_content(root_dir, manifest, "world_templates", WorldTemplatesPayload)
        npc_payload = self._read_content(root_dir, manifest, "npcs", NPCSeedsPayload)
        prompt_payload = self._read_content(root_dir, manifest, "prompt_overlays", PromptOverlaysPayload)

        template_ids = {template.template_id for template in manifest.world_templates}
        loaded_ids = set(templates_payload.world_templates)
        if template_ids != loaded_ids:
            raise WorldPackError(
                f"Pack {manifest.pack_id} template mismatch. manifest={sorted(template_ids)} loaded={sorted(loaded_ids)}",
                code="template_mismatch",
                pack_id=manifest.pack_id,
                path=manifest_path,
            )

        guide_name = next((npc.display_name for npc in npc_payload.npcs if npc.is_guide), "")
        npc_names = {npc.display_name for npc in npc_payload.npcs}
        templates: dict[str, WorldTemplateDefinition] = {}
        for template_id, template in templates_payload.world_templates.items():
            self._validate_slug(
                template_id,
                field_name="world_template_id",
                code="invalid_template_id",
                pack_id=manifest.pack_id,
                path=root_dir / manifest.content_refs["world_templates"],
            )
            self._validate_slug(
                template.template_id,
                field_name="world_template_id",
                code="invalid_template_id",
                pack_id=manifest.pack_id,
                path=root_dir / manifest.content_refs["world_templates"],
            )
            if not template.roles.guide_npc_name and guide_name:
                template.roles.guide_npc_name = guide_name
            self._validate_followup_branches(manifest.pack_id, template, npc_names)
            templates[template_id] = template

        return LoadedWorldPack(
            manifest=manifest,
            templates=templates,
            npcs=npc_payload.npcs,
            prompt_overlays=prompt_payload,
            root_dir=root_dir,
        )

    def _read_content(self, root_dir: Path, manifest: PackManifest, key: str, model: type[BaseModel]) -> BaseModel:
        relative = manifest.content_refs.get(key)
        if not relative:
            raise WorldPackError(
                f"Pack {manifest.pack_id} is missing content_ref for {key}",
                code="missing_content_ref",
                pack_id=manifest.pack_id,
                path=root_dir,
            )
        content_path = self._resolve_content_ref(root_dir, manifest.pack_id, key, relative)
        raw = self._read_yaml_mapping(content_path, pack_id=manifest.pack_id, content_key=key)
        try:
            return model.model_validate(raw)
        except ValidationError as exc:
            raise WorldPackError(
                f"Pack {manifest.pack_id} content_ref {key!r} is invalid at {content_path}: {exc}",
                code="invalid_content",
                pack_id=manifest.pack_id,
                path=content_path,
            ) from exc

    @staticmethod
    def _resolve_content_ref(root_dir: Path, pack_id: str, key: str, relative: str) -> Path:
        relative_path = Path(relative)
        if relative_path.is_absolute():
            raise WorldPackError(
                f"Pack {pack_id} content_ref {key!r} must be relative: {relative}",
                code="invalid_content_ref",
                pack_id=pack_id,
                path=relative,
            )
        root = root_dir.resolve()
        content_path = (root / relative_path).resolve()
        try:
            content_path.relative_to(root)
        except ValueError as exc:
            raise WorldPackError(
                f"Pack {pack_id} content_ref {key!r} escapes pack root: {relative}",
                code="invalid_content_ref",
                pack_id=pack_id,
                path=content_path,
            ) from exc
        if content_path.suffix not in PACK_YAML_SUFFIXES:
            raise WorldPackError(
                f"Pack {pack_id} content_ref {key!r} must point to a YAML file: {relative}",
                code="invalid_content_ref",
                pack_id=pack_id,
                path=content_path,
            )
        if not content_path.exists():
            raise WorldPackError(
                f"Pack {pack_id} content_ref {key!r} file not found: {content_path}",
                code="content_file_not_found",
                pack_id=pack_id,
                path=content_path,
            )
        if not content_path.is_file():
            raise WorldPackError(
                f"Pack {pack_id} content_ref {key!r} is not a file: {content_path}",
                code="content_not_file",
                pack_id=pack_id,
                path=content_path,
            )
        return content_path

    def _validate_pack_root(self, root_dir: Path, *, pack_id: str, path: Path | str) -> None:
        root = root_dir.resolve()
        try:
            root.relative_to(self.pack_dir)
        except ValueError as exc:
            raise WorldPackError(
                f"Pack root escapes pack_dir {self.pack_dir}: {root}",
                code="pack_root_escaped",
                pack_id=pack_id,
                path=path,
            ) from exc

    @staticmethod
    def _read_yaml_mapping(path: Path, *, pack_id: str, content_key: str) -> dict[str, Any]:
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except OSError as exc:
            raise WorldPackError(
                f"Pack {pack_id} failed to read {content_key} YAML at {path}: {exc}",
                code="content_read_failed",
                pack_id=pack_id,
                path=path,
            ) from exc
        except yaml.YAMLError as exc:
            raise WorldPackError(
                f"Pack {pack_id} has invalid {content_key} YAML at {path}: {exc}",
                code="invalid_yaml",
                pack_id=pack_id,
                path=path,
            ) from exc
        if not isinstance(raw, dict):
            raise WorldPackError(
                f"Pack {pack_id} {content_key} YAML must be a mapping at {path}",
                code="invalid_yaml",
                pack_id=pack_id,
                path=path,
            )
        return raw

    @staticmethod
    def _validate_slug(value: str, *, field_name: str, code: str, pack_id: str, path: Path | str) -> None:
        if PACK_SLUG_RE.fullmatch(value):
            return
        raise WorldPackError(
            f"Pack {pack_id} has invalid {field_name} {value!r}; use lowercase slug characters [a-z0-9_-]",
            code=code,
            pack_id=pack_id,
            path=path,
        )

    @staticmethod
    def _validate_followup_branches(
        pack_id: str,
        template: WorldTemplateDefinition,
        npc_names: set[str],
    ) -> None:
        for slot, branch in template.roles.followup_branches.by_slot().items():
            missing = [name for name in branch.anchor_npcs if name not in npc_names]
            if missing:
                raise WorldPackError(
                    f"Pack {pack_id} template {template.template_id} slot {slot} references unknown anchor_npcs: {missing}",
                    code="unknown_anchor_npc",
                    pack_id=pack_id,
                )


class WorldAvailabilityError(WorldPackError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int = 503,
        code: str = "world_unavailable",
        pack_id: str | None = None,
        path: Path | str | None = None,
    ) -> None:
        super().__init__(message, code=code, pack_id=pack_id, path=path)
        self.status_code = status_code


def template_world_id(template: WorldTemplateDefinition) -> str:
    return str((template.world or {}).get("world_id") or template.template_id).strip()


def _pack_has_failures(registry: PackRegistry, pack_id: str) -> bool:
    return any(failure.pack_id == pack_id for failure in registry.failures)


def _effective_template_visibility(pack: LoadedWorldPack, template_summary: TemplateSummary) -> PackVisibility:
    return template_summary.visibility or pack.manifest.visibility


def _effective_template_publish_status(pack: LoadedWorldPack, template_summary: TemplateSummary) -> PackPublishStatus:
    return template_summary.publish_status or pack.manifest.publish_status


def _template_is_public_playable(registry: PackRegistry, pack: LoadedWorldPack, template_id: str) -> bool:
    template_summary = next(
        (item for item in pack.manifest.world_templates if item.template_id == template_id),
        None,
    )
    if template_summary is None:
        return False
    return (
        _effective_template_visibility(pack, template_summary) == "public"
        and _effective_template_publish_status(pack, template_summary) == "playable"
        and not _pack_has_failures(registry, pack.manifest.pack_id)
    )


def _template_summary_payload(pack: LoadedWorldPack, template_summary: TemplateSummary) -> dict[str, Any]:
    return {
        **template_summary.model_dump(),
        "effective_visibility": _effective_template_visibility(pack, template_summary),
        "effective_publish_status": _effective_template_publish_status(pack, template_summary),
    }


def _world_catalog_entries(registry: PackRegistry) -> list[tuple[LoadedWorldPack, WorldTemplateDefinition]]:
    entries: list[tuple[LoadedWorldPack, WorldTemplateDefinition]] = []
    for pack in registry.list_packs():
        for template_id in sorted(pack.templates):
            entries.append((pack, pack.templates[template_id]))
    return entries


def _public_world_catalog_entries(registry: PackRegistry) -> list[tuple[LoadedWorldPack, WorldTemplateDefinition]]:
    return [
        (pack, template)
        for pack, template in _world_catalog_entries(registry)
        if _template_is_public_playable(registry, pack, template.template_id)
    ]


def resolve_catalog_world(registry: PackRegistry, world_id: str) -> tuple[LoadedWorldPack, WorldTemplateDefinition]:
    matches = [
        (pack, template)
        for pack, template in _public_world_catalog_entries(registry)
        if template_world_id(template) == world_id
    ]
    if not matches:
        raise WorldAvailabilityError(
            f"World {world_id!r} is not present in the playable world catalog",
            status_code=503,
            code="world_unavailable",
        )
    if len(matches) > 1:
        raise WorldAvailabilityError(
            f"World {world_id!r} is defined by more than one pack/template",
            status_code=503,
            code="duplicate_catalog_world",
        )
    return matches[0]


def pack_context_payload(pack: LoadedWorldPack, template: WorldTemplateDefinition) -> dict[str, Any]:
    return {
        "pack_id": pack.manifest.pack_id,
        "pack_display_name": pack.manifest.display_name,
        "world_template_id": template.template_id,
        "world_template_display_name": template.display_name,
    }


def playable_world_catalog(registry: PackRegistry) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for pack, template in _public_world_catalog_entries(registry):
        world_id = template_world_id(template)
        items.append(
            {
                "world_id": world_id,
                "display_name": str((template.world or {}).get("default_name") or template.display_name),
                "summary": template.summary,
                "health_url": f"/worlds/{world_id}/health",
                "status": "playable",
                "pack_context": pack_context_payload(pack, template),
            }
        )
    return {
        "status": "ready" if items else "error",
        "engine_api_version": ENGINE_API_VERSION,
        "world_count": len(items),
        "items": sorted(items, key=lambda item: (item["display_name"], item["world_id"])),
    }


def world_health(db: Session, registry: PackRegistry, world_id: str) -> dict[str, Any]:
    try:
        pack, template = resolve_catalog_world(registry, world_id)
    except WorldAvailabilityError:
        world = db.execute(select(World).where(World.id == world_id)).scalar_one_or_none()
        if world is None:
            raise
        try:
            metadata = world_pack_metadata(world)
        except ValueError as exc:
            raise WorldAvailabilityError(
                f"World {world_id!r} is missing pack metadata",
                status_code=503,
                code="world_pack_metadata_missing",
            ) from exc
        try:
            pack = registry.get_pack(metadata["pack_id"])
            pack.template(metadata["world_template_id"])
        except WorldPackError as exc:
            raise WorldAvailabilityError(
                f"World {world_id!r} references unavailable pack/template metadata",
                status_code=503,
                code="world_unavailable",
                pack_id=exc.pack_id or metadata["pack_id"],
                path=exc.path,
            ) from exc
        raise WorldAvailabilityError(
            f"World {world_id!r} is not present in the playable world catalog",
            status_code=503,
            code="world_unavailable",
            pack_id=pack.manifest.pack_id,
        )

    if _pack_has_failures(registry, pack.manifest.pack_id):
        raise WorldAvailabilityError(
            f"World {world_id!r} pack catalog is degraded for pack {pack.manifest.pack_id!r}",
            status_code=503,
            code="world_unavailable",
            pack_id=pack.manifest.pack_id,
        )

    world = db.execute(select(World).where(World.id == world_id)).scalar_one_or_none()
    if world is not None:
        try:
            metadata = world_pack_metadata(world)
        except ValueError as exc:
            raise WorldAvailabilityError(
                f"World {world_id!r} is missing pack metadata",
                status_code=503,
                code="world_pack_metadata_missing",
            ) from exc
        if metadata["pack_id"] != pack.manifest.pack_id or metadata["world_template_id"] != template.template_id:
            raise WorldAvailabilityError(
                f"World {world_id!r} is already bound to a different pack/template",
                status_code=409,
                code="world_pack_immutable",
                pack_id=metadata["pack_id"],
            )

    return {
        "status": "playable",
        "world_id": world_id,
        "display_name": str((template.world or {}).get("default_name") or template.display_name),
        "summary": template.summary,
        "pack_context": pack_context_payload(pack, template),
    }


def ensure_requested_world_is_playable(
    db: Session,
    registry: PackRegistry,
    world_id: str,
    *,
    requested_pack_id: str | None = None,
    requested_world_template_id: str | None = None,
) -> tuple[LoadedWorldPack, WorldTemplateDefinition, dict[str, Any]]:
    health = world_health(db, registry, world_id)
    pack = registry.get_pack(str(health["pack_context"]["pack_id"]))
    template = pack.template(str(health["pack_context"]["world_template_id"]))
    if requested_pack_id and requested_pack_id != pack.manifest.pack_id:
        raise WorldAvailabilityError(
            f"World {world_id!r} is bound to pack {pack.manifest.pack_id!r}, not {requested_pack_id!r}",
            status_code=409,
            code="world_pack_immutable",
            pack_id=pack.manifest.pack_id,
        )
    if requested_world_template_id and requested_world_template_id != template.template_id:
        raise WorldAvailabilityError(
            f"World {world_id!r} is bound to template {template.template_id!r}, not {requested_world_template_id!r}",
            status_code=409,
            code="world_pack_immutable",
            pack_id=pack.manifest.pack_id,
        )
    return pack, template, health


def load_pack_from_dir(pack_dir: Path | str, pack_id: str) -> LoadedWorldPack:
    resolved_dir = Path(pack_dir).resolve()
    PackRegistry._validate_slug(
        pack_id,
        field_name="pack_id",
        code="invalid_pack_id",
        pack_id=pack_id,
        path=resolved_dir,
    )
    manifest_path = resolved_dir / pack_id / "pack.yaml"
    if not manifest_path.exists():
        raise WorldPackError(
            f"Unknown pack_id {pack_id!r} in pack_dir {resolved_dir}",
            code="unknown_pack",
            pack_id=pack_id,
            path=resolved_dir,
        )
    registry = PackRegistry.__new__(PackRegistry)
    registry.pack_dir = resolved_dir
    return registry._load_pack(manifest_path)


def _pack_archive_payload(
    *,
    status: str,
    pack: LoadedWorldPack,
    archive_path: Path,
    pack_dir: Path,
    root_dir: Path,
) -> dict[str, Any]:
    return {
        "status": status,
        "pack_id": pack.manifest.pack_id,
        "version": pack.manifest.version,
        "engine_api_version": pack.manifest.engine_api_version,
        "archive": str(archive_path.resolve()),
        "pack_dir": str(pack_dir.resolve()),
        "root_dir": str(root_dir.resolve()),
    }


def _validate_archive_path(path: Path, *, must_exist: bool) -> Path:
    archive_path = Path(path).resolve()
    if not archive_path.name.endswith(PACK_ARCHIVE_SUFFIX):
        raise WorldPackError(
            f"World pack archive must end with {PACK_ARCHIVE_SUFFIX}: {archive_path}",
            code="invalid_pack_archive",
            path=archive_path,
        )
    if must_exist:
        if not archive_path.exists():
            raise WorldPackError(
                f"World pack archive not found: {archive_path}",
                code="pack_archive_not_found",
                path=archive_path,
            )
        if not archive_path.is_file():
            raise WorldPackError(
                f"World pack archive is not a file: {archive_path}",
                code="pack_archive_not_file",
                path=archive_path,
            )
    return archive_path


def export_pack_archive(pack_dir: Path | str, pack_id: str, archive_path: Path | str) -> dict[str, Any]:
    resolved_pack_dir = Path(pack_dir).resolve()
    archive = _validate_archive_path(Path(archive_path), must_exist=False)
    pack = load_pack_from_dir(resolved_pack_dir, pack_id)
    root_dir = pack.root_dir.resolve()
    content_paths = {root_dir / "pack.yaml"}
    for key, relative in pack.manifest.content_refs.items():
        content_paths.add(PackRegistry._resolve_content_ref(root_dir, pack.manifest.pack_id, key, relative))
    for path in content_paths:
        if path.is_symlink():
            raise WorldPackError(
                f"Pack {pack.manifest.pack_id} export cannot include symlink content: {path}",
                code="content_symlink_not_allowed",
                pack_id=pack.manifest.pack_id,
                path=path,
            )
    archive.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "w:gz") as tar:
        for path in sorted(content_paths):
            relative = path.resolve().relative_to(root_dir).as_posix()
            tar.add(path, arcname=f"{pack.manifest.pack_id}/{relative}", recursive=False)
    return _pack_archive_payload(
        status="exported",
        pack=pack,
        archive_path=archive,
        pack_dir=resolved_pack_dir,
        root_dir=root_dir,
    )


def _safe_tar_member_parts(member: tarfile.TarInfo, *, archive_path: Path) -> tuple[str, ...]:
    if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
        raise WorldPackError(
            f"World pack archive contains unsupported member type: {member.name}",
            code="unsafe_pack_archive_member",
            path=archive_path,
        )
    candidate = PurePosixPath(member.name)
    if candidate.is_absolute():
        raise WorldPackError(
            f"World pack archive contains absolute member path: {member.name}",
            code="unsafe_pack_archive_member",
            path=archive_path,
        )
    parts = tuple(part for part in candidate.parts if part not in {"", "."})
    if not parts or ".." in parts:
        raise WorldPackError(
            f"World pack archive contains escaping member path: {member.name}",
            code="unsafe_pack_archive_member",
            path=archive_path,
        )
    return parts


def _extract_pack_archive_safely(archive_path: Path, staging_dir: Path) -> str:
    roots: set[str] = set()
    seen_targets: set[Path] = set()
    try:
        with tarfile.open(archive_path, "r:gz") as tar:
            members = tar.getmembers()
            if not members:
                raise WorldPackError(
                    f"World pack archive is empty: {archive_path}",
                    code="empty_pack_archive",
                    path=archive_path,
                )
            for member in members:
                parts = _safe_tar_member_parts(member, archive_path=archive_path)
                roots.add(parts[0])
                if len(roots) > 1:
                    raise WorldPackError(
                        f"World pack archive must contain a single root directory: {sorted(roots)}",
                        code="multiple_pack_archive_roots",
                        path=archive_path,
                    )
                PackRegistry._validate_slug(
                    parts[0],
                    field_name="pack archive root",
                    code="invalid_pack_archive_root",
                    pack_id=parts[0],
                    path=archive_path,
                )
                target = (staging_dir / Path(*parts)).resolve()
                try:
                    target.relative_to(staging_dir.resolve())
                except ValueError as exc:
                    raise WorldPackError(
                        f"World pack archive member escapes staging directory: {member.name}",
                        code="unsafe_pack_archive_member",
                        path=archive_path,
                    ) from exc
                if target in seen_targets:
                    raise WorldPackError(
                        f"World pack archive contains duplicate member path: {member.name}",
                        code="duplicate_pack_archive_member",
                        path=archive_path,
                    )
                seen_targets.add(target)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    source = tar.extractfile(member)
                    if source is None:
                        raise WorldPackError(
                            f"World pack archive failed to read member: {member.name}",
                            code="pack_archive_read_failed",
                            path=archive_path,
                        )
                    with source, target.open("wb") as output:
                        shutil.copyfileobj(source, output)
    except tarfile.TarError as exc:
        raise WorldPackError(
            f"World pack archive is invalid: {archive_path}: {exc}",
            code="invalid_pack_archive",
            path=archive_path,
        ) from exc
    if len(roots) != 1:
        raise WorldPackError(
            f"World pack archive must contain a single root directory: {archive_path}",
            code="invalid_pack_archive_root",
            path=archive_path,
        )
    root_name = next(iter(roots))
    if not (staging_dir / root_name / "pack.yaml").is_file():
        raise WorldPackError(
            f"World pack archive root {root_name!r} is missing pack.yaml",
            code="pack_manifest_not_found",
            pack_id=root_name,
            path=archive_path,
        )
    return root_name


def import_pack_archive(pack_dir: Path | str, archive_path: Path | str, *, replace: bool = False) -> dict[str, Any]:
    resolved_pack_dir = Path(pack_dir).resolve()
    archive = _validate_archive_path(Path(archive_path), must_exist=True)
    with tempfile.TemporaryDirectory(prefix="gestaloka-pack-import-") as temp_dir:
        staging_dir = Path(temp_dir).resolve()
        root_name = _extract_pack_archive_safely(archive, staging_dir)
        pack = load_pack_from_dir(staging_dir, root_name)
        if pack.manifest.pack_id != root_name:
            raise WorldPackError(
                f"World pack archive root {root_name!r} contains manifest pack_id {pack.manifest.pack_id!r}",
                code="pack_id_mismatch",
                pack_id=pack.manifest.pack_id,
                path=archive,
            )
        target_root = resolved_pack_dir / pack.manifest.pack_id
        if target_root.exists() and not replace:
            raise WorldPackError(
                f"Pack {pack.manifest.pack_id!r} already exists in {resolved_pack_dir}; use --replace to overwrite",
                code="pack_already_exists",
                pack_id=pack.manifest.pack_id,
                path=target_root,
            )
        resolved_pack_dir.mkdir(parents=True, exist_ok=True)
        if target_root.exists():
            if target_root.is_symlink() or not target_root.is_dir():
                raise WorldPackError(
                    f"Existing pack target is not a directory: {target_root}",
                    code="pack_target_not_directory",
                    pack_id=pack.manifest.pack_id,
                    path=target_root,
                )
            shutil.rmtree(target_root)
        shutil.copytree(staging_dir / root_name, target_root, symlinks=False)
        imported = load_pack_from_dir(resolved_pack_dir, pack.manifest.pack_id)
    configure_pack_registry(resolved_pack_dir)
    return _pack_archive_payload(
        status="imported",
        pack=imported,
        archive_path=archive,
        pack_dir=resolved_pack_dir,
        root_dir=target_root,
    )


def configure_pack_registry(pack_dir: Path | str) -> PackRegistry:
    global _ACTIVE_PACK_DIR, _ACTIVE_REGISTRY
    resolved_dir = Path(pack_dir).resolve()
    if _ACTIVE_REGISTRY is not None and _ACTIVE_PACK_DIR == resolved_dir:
        return _ACTIVE_REGISTRY
    registry = PackRegistry(resolved_dir)
    _ACTIVE_PACK_DIR = resolved_dir
    _ACTIVE_REGISTRY = registry
    return _ACTIVE_REGISTRY


def get_pack_registry(settings: Settings | None = None) -> PackRegistry:
    resolved_settings = settings or get_settings()
    return configure_pack_registry(resolved_settings.pack_dir)


def world_pack_metadata(world: World | None) -> dict[str, Any]:
    state = dict((world.state if world is not None else None) or {})
    pack_id = str(state.get("pack_id") or "").strip()
    template_id = str(state.get("world_template_id") or "").strip()
    if not pack_id or not template_id:
        world_id = world.id if world is not None else "<missing>"
        raise ValueError(f"World {world_id} is missing pack_id/world_template_id metadata")
    return {
        "pack_id": pack_id,
        "world_template_id": template_id,
    }


def resolve_world_pack(db: Session, world_id: str) -> tuple[LoadedWorldPack, WorldTemplateDefinition]:
    world = db.execute(select(World).where(World.id == world_id)).scalar_one_or_none()
    if world is None:
        raise LookupError(f"World not found: {world_id}")
    registry = get_pack_registry()
    metadata = world_pack_metadata(world)
    pack = registry.get_pack(metadata["pack_id"])
    template = pack.template(metadata["world_template_id"])
    return pack, template


def world_pack_summary(db: Session, world_id: str) -> dict[str, Any]:
    world = db.execute(select(World).where(World.id == world_id)).scalar_one_or_none()
    if world is None:
        raise LookupError(f"World not found: {world_id}")
    return world_context_for_world(db, world_id)


def world_context_for_world(db: Session, world_id: str) -> dict[str, Any]:
    world = db.execute(select(World).where(World.id == world_id)).scalar_one_or_none()
    if world is None:
        raise LookupError(f"World not found: {world_id}")
    registry = get_pack_registry()
    metadata = world_pack_metadata(world)
    pack = registry.get_pack(metadata["pack_id"])
    template = pack.template(metadata["world_template_id"])
    return {
        "world_id": world.id,
        "world_name": world.name,
        "pack_id": pack.manifest.pack_id,
        "pack_display_name": pack.manifest.display_name,
        "world_template_id": template.template_id,
        "world_template_display_name": template.display_name,
        "semantic_tags": list(pack.manifest.semantic_tags),
    }


def nullable_world_context_for_world(db: Session, world_id: str | None) -> dict[str, Any] | None:
    if world_id is None:
        return None
    return world_context_for_world(db, world_id)
