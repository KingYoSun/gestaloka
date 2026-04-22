from __future__ import annotations

import argparse
import json

from app.core.container import build_container


def main() -> None:
    parser = argparse.ArgumentParser(description="GESTALOKA v2 eval harness")
    parser.add_argument("command", choices=["smoke", "failure", "shadow", "gate"])
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()

    container = build_container()
    with container.session_factory() as db:
        if args.command == "smoke":
            payload = container.eval_service.run_dataset(db, "turn_resolution_smoke")
        elif args.command == "failure":
            payload = container.eval_service.run_dataset(db, "turn_resolution_failure_injection")
        elif args.command == "shadow":
            payload = container.eval_service.run_shadow_replay(db, limit=args.limit)
        else:
            container.eval_service.run_dataset(db, "turn_resolution_smoke")
            container.eval_service.run_dataset(db, "turn_resolution_failure_injection")
            container.eval_service.run_shadow_replay(db, limit=args.limit)
            payload = container.eval_service.latest_gate_report(db)
        db.commit()

    print(json.dumps(payload, ensure_ascii=False, indent=2))
