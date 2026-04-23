from __future__ import annotations

import argparse
import json
import time

from app.core.container import build_container


def run_once(*, world_id: str | None = None) -> list[dict[str, object]]:
    container = build_container()
    with container.session_factory() as db:
        if world_id:
            result = container.ambient_world_service.run_idle_world_pass(db, world_id=world_id)
            payload = [] if result is None else [
                {
                    "world_id": world_id,
                    "tick_id": result.tick.id,
                    "status": result.tick.status,
                    "summary": result.tick.summary,
                }
            ]
        else:
            payload = [
                {
                    "world_id": result.tick.world_id,
                    "tick_id": result.tick.id,
                    "status": result.tick.status,
                    "summary": result.tick.summary,
                }
                for result in container.ambient_world_service.run_due_idle_world_passes(db)
            ]
        db.commit()
    return payload


def loop(interval_seconds: int) -> None:
    while True:
        payload = run_once()
        if payload:
            print(json.dumps(payload, ensure_ascii=False, indent=2), flush=True)
        time.sleep(interval_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description="GESTALOKA idle world scheduler")
    parser.add_argument("command", choices=["once", "loop"])
    parser.add_argument("--world-id", default=None)
    parser.add_argument("--interval", type=int, default=None)
    args = parser.parse_args()

    container = build_container()
    interval_seconds = args.interval or container.settings.world_idle_interval_seconds

    if args.command == "once":
        payload = run_once(world_id=args.world_id)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    loop(interval_seconds)


if __name__ == "__main__":
    main()
