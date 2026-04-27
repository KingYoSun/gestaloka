from __future__ import annotations

import argparse
import json

from app.core.container import build_container
from app.modules.eval_harness.service import PACK_REGRESSION_DATASETS
from app.modules.world_state.health import shared_world_health


def _dataset_check(payload: dict[str, object]) -> dict[str, object]:
    summary = payload.get("summary") if isinstance(payload, dict) else {}
    summary = summary if isinstance(summary, dict) else {}
    variants = summary.get("variants")
    variants = variants if isinstance(variants, dict) else {}
    current = variants.get("current")
    candidate = variants.get("candidate")
    current = current if isinstance(current, dict) else {}
    candidate = candidate if isinstance(candidate, dict) else {}
    return {
        "run_id": payload.get("id"),
        "case_count": summary.get("case_count", 0),
        "current_passed": bool(current.get("gate_passed")),
        "candidate_passed": bool(candidate.get("gate_passed")),
        "current_failed_case_ids": current.get("failed_case_ids", []),
        "candidate_failed_case_ids": candidate.get("failed_case_ids", []),
        "pack_scope": summary.get("pack_scope", []),
    }


def _print_pack_regression_summary(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="GESTALOKA v2 eval harness")
    parser.add_argument(
        "command",
        choices=[
            "smoke",
            "dataset",
            "pack-regressions",
            "failure",
            "shadow",
            "gate",
            "nightly",
            "canary-probe",
            "shared-world-health",
        ],
    )
    parser.add_argument("--dataset", help="Dataset id to run for the dataset command, or to override smoke")
    parser.add_argument("--detail", action="store_true", help="Print detailed run payloads for aggregate commands")
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
        elif args.command == "pack-regressions":
            runs = {
                dataset_name: container.eval_service.run_dataset(db, dataset_name)
                for dataset_name in PACK_REGRESSION_DATASETS
            }
            payload = {
                "status": (
                    "passed"
                    if all(
                        _dataset_check(run)["current_passed"] and _dataset_check(run)["candidate_passed"]
                        for run in runs.values()
                    )
                    else "failed"
                ),
                "datasets": {
                    dataset_name: _dataset_check(run)
                    for dataset_name, run in runs.items()
                },
            }
            if args.detail:
                payload["runs"] = runs
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
        elif args.command == "shared-world-health":
            payload = shared_world_health(db)
        else:
            payload = container.observability_service.probe_canary_health().__dict__
        db.commit()

    if args.command == "shared-world-health" and payload.get("status") != "ready":
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        raise SystemExit(1)
    if args.command == "pack-regressions":
        _print_pack_regression_summary(payload)
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
