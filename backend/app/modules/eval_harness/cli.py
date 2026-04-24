from __future__ import annotations

import argparse
import json

from app.core.container import build_container


def main() -> None:
    parser = argparse.ArgumentParser(description="GESTALOKA v2 eval harness")
    parser.add_argument("command", choices=["smoke", "dataset", "failure", "shadow", "gate", "nightly", "canary-probe"])
    parser.add_argument("--dataset", help="Dataset id to run for the dataset command, or to override smoke")
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()

    container = build_container()
    with container.session_factory() as db:
        if args.command == "smoke":
            payload = container.eval_service.run_dataset(db, args.dataset or "turn_resolution_smoke")
        elif args.command == "dataset":
            if not args.dataset:
                raise SystemExit("--dataset is required for the dataset command")
            payload = container.eval_service.run_dataset(db, args.dataset)
        elif args.command == "failure":
            payload = container.eval_service.run_dataset(db, "turn_resolution_failure_injection")
        elif args.command == "shadow":
            payload = container.eval_service.run_shadow_replay(db, limit=args.limit)
        elif args.command == "gate":
            payload = container.eval_service.run_release_checklist(
                db,
                trigger_type="pre_promote",
                shadow_limit=args.limit,
            )
        elif args.command == "nightly":
            payload = container.eval_service.run_release_checklist(
                db,
                trigger_type="nightly",
                shadow_limit=args.limit,
            )
        else:
            payload = container.observability_service.probe_canary_health().__dict__
        db.commit()

    print(json.dumps(payload, ensure_ascii=False, indent=2))
