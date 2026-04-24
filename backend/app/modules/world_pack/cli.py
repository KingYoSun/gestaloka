from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.modules.world_pack.service import FOLLOWUP_BRANCH_SLOTS, PackRegistry, get_pack_registry, load_pack_from_dir


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
        if (candidate / "rebuild_plan_v2.md").exists():
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
            _add_term(terms, value=template.roles.opening_chapter_key, pack_id=pack_id, source="chapter_key")
            _add_term(terms, value=template.roles.followup_chapter_key, pack_id=pack_id, source="chapter_key")
            for slot in FOLLOWUP_BRANCH_SLOTS:
                branch = getattr(template.roles.followup_branches, slot)
                _add_term(terms, value=branch.branch_key, pack_id=pack_id, source="branch_key")
                _add_term(terms, value=branch.label, pack_id=pack_id, source="branch_label")
            for quest in (template.quest, template.followup_quest):
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


def main() -> None:
    parser = argparse.ArgumentParser(description="GESTALOKA v2 world pack tooling")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("list", help="List discovered world packs")

    validate_parser = subparsers.add_parser("validate", help="Validate discovered packs")
    validate_parser.add_argument("--pack", dest="pack_id", help="Validate only one pack_id")

    scan_parser = subparsers.add_parser("scan-leaks", help="Scan runtime source for bundled pack-specific literals")
    scan_parser.add_argument(
        "--scan-root",
        action="append",
        dest="scan_roots",
        help="Path to scan. Defaults to backend/app and frontend/src under the project root.",
    )

    args = parser.parse_args()
    settings = get_settings()

    if args.command == "list":
        registry = get_pack_registry(settings)
        payload = {
            "pack_dir": str(settings.pack_dir),
            "items": [_pack_payload(pack) for pack in registry.list_packs()],
        }
    elif args.command == "validate":
        if args.pack_id:
            pack = load_pack_from_dir(settings.pack_dir, args.pack_id)
            items = [_pack_payload(pack)]
        else:
            registry = get_pack_registry(settings)
            items = [_pack_payload(pack) for pack in registry.list_packs()]
        payload = {
            "pack_dir": str(settings.pack_dir),
            "validated": items,
        }
    else:
        registry = get_pack_registry(settings)
        scan_roots = (
            [Path(item).resolve() for item in args.scan_roots]
            if args.scan_roots
            else _default_scan_roots(settings.pack_dir)
        )
        result = scan_pack_leaks(registry, scan_roots)
        payload = {
            "pack_dir": str(settings.pack_dir),
            "scan_roots": [str(path) for path in scan_roots],
            **result,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        if result["leak_count"]:
            raise SystemExit(1)
        return

    print(json.dumps(payload, ensure_ascii=False, indent=2))
