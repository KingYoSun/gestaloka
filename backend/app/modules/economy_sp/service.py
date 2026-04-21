from __future__ import annotations


def describe_scope() -> dict[str, str]:
    return {"status": "deferred", "reason": "SP ledger is outside the first vertical slice."}
