from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.modules.world_pack.service import (
    ENGINE_API_VERSION,
    FOLLOWUP_BRANCH_SLOTS,
    PackRegistry,
    WorldPackError,
    export_pack_archive,
    get_pack_registry,
    import_pack_archive,
    load_pack_from_dir,
)


TEXT_SUFFIXES = {
    ".css",
    ".html",
    ".js",
    ".jsx",
    ".md",
    ".py",
    ".ts",
    ".tsx",
}


@dataclass(frozen=True)
class LeakTerm:
    value: str
    pack_id: str
    source: str


def _project_root_from_pack_dir(pack_dir: Path) -> Path:
    for candidate in [pack_dir.resolve(), *pack_dir.resolve().parents]:
        if (candidate / "AGENTS.md").exists() and (candidate / "backend").is_dir():
            return candidate
    return pack_dir.resolve().parent


def _default_scan_roots(pack_dir: Path) -> list[Path]:
    repo_root = _project_root_from_pack_dir(pack_dir)
    return [
        path
        for path in (
            repo_root / "backend" / "app",
            repo_root / "frontend" / "src",
        )
        if path.exists()
    ]


def _add_term(terms: dict[str, LeakTerm], *, value: str | None, pack_id: str, source: str) -> None:
    candidate = str(value or "").strip()
    if not candidate:
        return
    terms.setdefault(candidate, LeakTerm(value=candidate, pack_id=pack_id, source=source))


def _pack_specific_terms(registry: PackRegistry) -> list[LeakTerm]:
    terms: dict[str, LeakTerm] = {}
    for pack in registry.list_packs():
        pack_id = pack.manifest.pack_id
        _add_term(terms, value=pack.manifest.pack_id, pack_id=pack_id, source="pack_id")
        _add_term(terms, value=pack.manifest.display_name, pack_id=pack_id, source="pack_display_name")
        for template_summary in pack.manifest.world_templates:
            _add_term(terms, value=template_summary.template_id, pack_id=pack_id, source="world_template_id")
            _add_term(terms, value=template_summary.display_name, pack_id=pack_id, source="world_template_display_name")
        for template in pack.templates.values():
            _add_term(terms, value=template.template_id, pack_id=pack_id, source="world_template_id")
            _add_term(terms, value=template.display_name, pack_id=pack_id, source="world_template_display_name")
            _add_term(terms, value=template.world.get("default_name"), pack_id=pack_id, source="world_name")
            _add_term(terms, value=template.roles.starter_stage_key, pack_id=pack_id, source="stage_key")
            _add_term(terms, value=template.roles.followup_stage_key, pack_id=pack_id, source="stage_key")
            if template.roles.opening_chapter_key:
                _add_term(terms, value=template.roles.opening_chapter_key, pack_id=pack_id, source="chapter_key")
            if template.roles.followup_chapter_key:
                _add_term(terms, value=template.roles.followup_chapter_key, pack_id=pack_id, source="chapter_key")
            for slot in FOLLOWUP_BRANCH_SLOTS:
                branch = getattr(template.roles.followup_branches, slot)
                _add_term(terms, value=branch.branch_key, pack_id=pack_id, source="branch_key")
                _add_term(terms, value=branch.label, pack_id=pack_id, source="branch_label")
            for quest in (template.quest, template.followup_quest):
                if quest is None:
                    continue
                _add_term(terms, value=quest.stage_key, pack_id=pack_id, source="stage_key")
                _add_term(terms, value=quest.reward_name, pack_id=pack_id, source="reward_name")
            for location in template.locations.values():
                _add_term(terms, value=location.name, pack_id=pack_id, source="location_name")
            _add_term(terms, value=template.faction.name, pack_id=pack_id, source="faction_name")
        for npc in pack.npcs:
            _add_term(terms, value=npc.display_name, pack_id=pack_id, source="npc_name")
    return sorted(terms.values(), key=lambda item: (item.pack_id, item.source, item.value))


def _iter_scan_files(roots: list[Path]) -> list[Path]:
    files: list[Path] = []
    for root in roots:
        if root.is_file() and root.suffix in TEXT_SUFFIXES:
            files.append(root)
            continue
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                continue
            if "__pycache__" in path.parts:
                continue
            files.append(path)
    return sorted(files)


def scan_pack_leaks(registry: PackRegistry, scan_roots: list[Path]) -> dict[str, Any]:
    terms = _pack_specific_terms(registry)
    leaks: list[dict[str, Any]] = []
    for path in _iter_scan_files(scan_roots):
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            continue
        for line_number, line in enumerate(lines, start=1):
            for term in terms:
                if term.value in line:
                    leaks.append(
                        {
                            "path": str(path),
                            "line": line_number,
                            "term": term.value,
                            "pack_id": term.pack_id,
                            "source": term.source,
                        }
                    )
    return {
        "term_count": len(terms),
        "leak_count": len(leaks),
        "leaks": leaks,
    }


def _pack_payload(pack: Any) -> dict[str, Any]:
    return {
        "pack_id": pack.manifest.pack_id,
        "display_name": pack.manifest.display_name,
        "version": pack.manifest.version,
        "engine_api_version": pack.manifest.engine_api_version,
        "world_templates": sorted(pack.templates),
        "prompt_overlays": {
            "global": sorted(pack.prompt_overlays.global_overlays),
            "templates": sorted(pack.prompt_overlays.template_overlays),
        },
        "root_dir": str(pack.root_dir),
    }


def _error_payload(exc: BaseException, *, pack_dir: Path | None = None, archive: Path | None = None) -> dict[str, Any]:
    if isinstance(exc, WorldPackError):
        payload = exc.diagnostic()
    else:
        payload = {
            "error": exc.__class__.__name__,
            "message": str(exc),
        }
    if pack_dir is not None:
        payload["pack_dir"] = str(pack_dir.resolve())
    if archive is not None:
        payload["archive"] = str(archive.resolve())
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="GESTALOKA v2 world pack tooling")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("list", help="List discovered world packs")

    validate_parser = subparsers.add_parser("validate", help="Validate discovered packs")
    validate_parser.add_argument("--pack", dest="pack_id", help="Validate only one pack_id")

    export_parser = subparsers.add_parser("export", help="Export one validated pack as a .tar.gz archive")
    export_parser.add_argument("--pack", dest="pack_id", required=True, help="Pack id to export")
    export_parser.add_argument("--output", dest="output", required=True, help="Output .tar.gz archive path")

    import_parser = subparsers.add_parser("import", help="Import one validated .tar.gz pack archive")
    import_parser.add_argument("--archive", dest="archive", required=True, help="Input .tar.gz archive path")
    import_parser.add_argument("--replace", action="store_true", help="Replace an existing pack with the same pack_id")

    scan_parser = subparsers.add_parser("scan-leaks", help="Scan runtime source for bundled pack-specific literals")
    scan_parser.add_argument(
        "--scan-root",
        action="append",
        dest="scan_roots",
        help="Path to scan. Defaults to backend/app and frontend/src under the project root.",
    )

    settings = None
    args = None
    try:
        args = parser.parse_args()
        settings = get_settings()
        pack_dir = Path(settings.pack_dir).resolve()

        if args.command == "list":
            registry = get_pack_registry(settings)
            payload = registry.catalog_diagnostic(include_paths=True)
        elif args.command == "validate":
            if args.pack_id:
                pack = load_pack_from_dir(settings.pack_dir, args.pack_id)
                payload = {
                    "status": "ready",
                    "pack_dir": str(pack_dir),
                    "engine_api_version": ENGINE_API_VERSION,
                    "pack_count": 1,
                    "template_count": len(pack.manifest.world_templates),
                    "failure_count": 0,
                    "failures": [],
                    "validated": [_pack_payload(pack)],
                }
            else:
                registry = get_pack_registry(settings)
                diagnostic = registry.catalog_diagnostic(include_paths=True)
                payload = {
                    **diagnostic,
                    "validated": [_pack_payload(pack) for pack in registry.list_packs()],
                }
                print(json.dumps(payload, ensure_ascii=False, indent=2))
                if registry.failure_count:
                    raise SystemExit(1)
                return
        elif args.command == "export":
            payload = export_pack_archive(settings.pack_dir, args.pack_id, args.output)
        elif args.command == "import":
            payload = import_pack_archive(settings.pack_dir, args.archive, replace=args.replace)
        else:
            registry = get_pack_registry(settings)
            if registry.status == "error":
                payload = registry.catalog_diagnostic(include_paths=True)
                print(json.dumps(payload, ensure_ascii=False, indent=2))
                raise SystemExit(1)
            scan_roots = (
                [Path(item).resolve() for item in args.scan_roots]
                if args.scan_roots
                else _default_scan_roots(settings.pack_dir)
            )
            result = scan_pack_leaks(registry, scan_roots)
            payload = {
                "pack_dir": str(pack_dir),
                "scan_roots": [str(path) for path in scan_roots],
                **result,
            }
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            if result["leak_count"]:
                raise SystemExit(1)
            return

        print(json.dumps(payload, ensure_ascii=False, indent=2))
    except (WorldPackError, OSError, ValueError) as exc:
        pack_dir = Path(settings.pack_dir) if settings is not None else None
        archive = None
        if args is not None:
            raw_archive = getattr(args, "archive", None) or getattr(args, "output", None)
            archive = Path(raw_archive) if raw_archive else None
        print(json.dumps(_error_payload(exc, pack_dir=pack_dir, archive=archive), ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(1) from exc
