from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
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


class PackManifest(BaseModel):
    pack_id: str = Field(min_length=1, max_length=120)
    version: str = Field(min_length=1, max_length=32)
    engine_api_version: str = Field(min_length=1, max_length=16)
    display_name: str = Field(min_length=1, max_length=120)
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


class PackRegistry:
    def __init__(self, pack_dir: Path) -> None:
        self.pack_dir = Path(pack_dir).resolve()
        self._packs = self._load_packs()

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

    def pack_summary_items(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for pack in self.list_packs():
            items.append(
                {
                    "pack_id": pack.manifest.pack_id,
                    "version": pack.manifest.version,
                    "engine_api_version": pack.manifest.engine_api_version,
                    "display_name": pack.manifest.display_name,
                    "semantic_tags": list(pack.manifest.semantic_tags),
                    "content_refs": dict(pack.manifest.content_refs),
                    "world_templates": [template.model_dump() for template in pack.manifest.world_templates],
                }
            )
        return items

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
            raise WorldPackError(
                f"Pack directory not found: {self.pack_dir}",
                code="pack_dir_not_found",
                path=self.pack_dir,
            )
        if not self.pack_dir.is_dir():
            raise WorldPackError(
                f"Pack directory is not a directory: {self.pack_dir}",
                code="pack_dir_not_directory",
                path=self.pack_dir,
            )
        packs: dict[str, LoadedWorldPack] = {}
        for pack_file in sorted(self.pack_dir.glob("*/pack.yaml")):
            loaded = self._load_pack(pack_file)
            if loaded.manifest.pack_id in packs:
                raise WorldPackError(
                    f"Duplicate pack_id {loaded.manifest.pack_id!r} detected in {self.pack_dir}",
                    code="duplicate_pack_id",
                    pack_id=loaded.manifest.pack_id,
                    path=pack_file,
                )
            packs[loaded.manifest.pack_id] = loaded
        if not packs:
            raise WorldPackError(
                f"No world packs found in {self.pack_dir}",
                code="empty_pack_dir",
                path=self.pack_dir,
            )
        return packs

    def _load_pack(self, manifest_path: Path) -> LoadedWorldPack:
        manifest_path = manifest_path.resolve()
        pack_dir_name = manifest_path.parent.name
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


def load_pack_from_dir(pack_dir: Path | str, pack_id: str) -> LoadedWorldPack:
    resolved_dir = Path(pack_dir).resolve()
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
