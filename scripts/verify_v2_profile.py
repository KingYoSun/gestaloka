from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


VERIFY_STEPS = [
    "backend-test",
    "pack-validate",
    "scan-pack-leaks",
    "eval-pack-regressions",
    "build-frontend",
    "frontend-e2e",
]


def run_step(step: str) -> dict[str, object]:
    started = time.perf_counter()
    print(f"==> {step}", flush=True)
    completed = subprocess.run(["make", step], check=False)
    duration_seconds = time.perf_counter() - started
    status = "passed" if completed.returncode == 0 else "failed"
    print(f"<== {step}: {status} in {duration_seconds:.2f}s", flush=True)
    return {
        "name": step,
        "command": f"make {step}",
        "status": status,
        "returncode": completed.returncode,
        "duration_seconds": round(duration_seconds, 3),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Profile the canonical verify-v2 steps.")
    parser.add_argument("--output", default=".cache/verify-v2-profile.json")
    args = parser.parse_args()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    steps: list[dict[str, object]] = []
    exit_code = 0
    for step in VERIFY_STEPS:
        result = run_step(step)
        steps.append(result)
        if result["returncode"] != 0:
            exit_code = int(result["returncode"])
            break

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "passed" if exit_code == 0 else "failed",
        "total_duration_seconds": round(sum(float(item["duration_seconds"]) for item in steps), 3),
        "steps": steps,
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("\nverify-v2 profile summary", flush=True)
    for item in steps:
        print(
            f"- {item['name']}: {item['status']} ({item['duration_seconds']:.2f}s)",
            flush=True,
        )
    print(f"wrote {output_path}", flush=True)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
