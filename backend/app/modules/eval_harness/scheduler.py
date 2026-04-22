from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timedelta, timezone

from app.core.container import build_container


def seconds_until_next_run(cron_expr: str, *, now: datetime | None = None) -> float:
    minute, hour, day_of_month, month, day_of_week = cron_expr.split()
    if (day_of_month, month, day_of_week) != ("*", "*", "*"):
        raise ValueError(f"Unsupported scheduler cron expression: {cron_expr}")

    current = now or datetime.now(timezone.utc)
    target = current.replace(hour=int(hour), minute=int(minute), second=0, microsecond=0)
    if target <= current:
        target += timedelta(days=1)
    return max((target - current).total_seconds(), 0.0)


def run_once(*, trigger_type: str = "nightly", shadow_limit: int | None = None) -> dict[str, object]:
    container = build_container()
    with container.session_factory() as db:
        payload = container.eval_service.run_release_checklist(
            db,
            trigger_type=trigger_type,
            shadow_limit=shadow_limit,
        )
        db.commit()
    return payload


def loop(cron_expr: str, *, shadow_limit: int | None = None) -> None:
    while True:
        delay = seconds_until_next_run(cron_expr)
        time.sleep(delay)
        payload = run_once(trigger_type="nightly", shadow_limit=shadow_limit)
        print(json.dumps(payload, ensure_ascii=False, indent=2), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="GESTALOKA release scheduler")
    parser.add_argument("command", choices=["once", "loop"])
    parser.add_argument("--trigger-type", default="nightly")
    parser.add_argument("--shadow-limit", type=int, default=None)
    parser.add_argument("--cron", default=None)
    args = parser.parse_args()

    if args.command == "once":
        payload = run_once(trigger_type=args.trigger_type, shadow_limit=args.shadow_limit)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    container = build_container()
    cron_expr = args.cron or container.settings.release_scheduler_cron
    loop(cron_expr, shadow_limit=args.shadow_limit or container.settings.release_shadow_limit)


if __name__ == "__main__":
    main()
