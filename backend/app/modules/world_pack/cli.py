from __future__ import annotations

import argparse
import json
from typing import Any

from app.core.config import get_settings
from app.modules.world_pack.service import get_pack_registry, load_pack_from_dir


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

    args = parser.parse_args()
    settings = get_settings()

    if args.command == "list":
        registry = get_pack_registry(settings)
        payload = {
            "pack_dir": str(settings.pack_dir),
            "items": [_pack_payload(pack) for pack in registry.list_packs()],
        }
    else:
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

    print(json.dumps(payload, ensure_ascii=False, indent=2))
