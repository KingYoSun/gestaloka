from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_container, get_db
from app.core.container import AppContainer
from app.modules.admin_ops.service import memory_status, observability_summary, runtime_snapshot


router = APIRouter()


@router.get("/health")
def health(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
) -> dict[str, object]:
    db.execute(text("SELECT 1"))
    snapshot = runtime_snapshot(db, container.settings, container.projection_service)
    observability = observability_summary(
        db,
        container.settings,
        container.projection_service,
        container.observability_service,
    )
    embedding = memory_status(db, container.memory_service)
    release_gate = container.eval_service.latest_release_checklist(db)
    return {
        "status": "ok",
        "database": "ok",
        "projection": {
            "backend": snapshot["backend"],
            "space": snapshot["space"],
            "pending_outbox": snapshot["pending_outbox"],
            "failed_outbox": snapshot["failed_outbox"],
            "projected_outbox": snapshot["projected_outbox"],
            "projection_records": snapshot["projection_records"],
            "graph_read_mode": snapshot["graph_read_mode"],
            "last_error": snapshot["last_error"],
        },
        "projection_runtime": {
            "graph_runtime_status": snapshot["graph_runtime_status"],
            "graph_runtime_error": snapshot["graph_runtime_error"],
        },
        "sp": {
            "default_balance": container.settings.sp_default_balance,
            "turn_cost": container.settings.turn_sp_cost,
            "economy_status": "ready",
        },
        "embedding": {
            "provider": embedding["provider"],
            "model": embedding["model"],
            "dimension": embedding["dimension"],
            "pending_count": embedding["pending_count"],
            "failed_count": embedding["failed_count"],
            "runtime_status": embedding["runtime_status"],
        },
        "observability": {
            "runtime_role": container.settings.app_runtime_role,
            "projection_lag_seconds": snapshot["projection_lag_seconds"],
            "outbox_pending_count": snapshot["pending_outbox"],
            "outbox_failed_count": snapshot["failed_outbox"],
            "llm_schema_valid_rate": snapshot["llm_schema_valid_rate"],
            "llm_fallback_rate": snapshot["llm_fallback_rate"],
            "canary_health": observability["canary"],
        },
        "release_gate": {
            "report_id": release_gate["report_id"],
            "verdict": release_gate["verdict"],
            "blocked_reasons": release_gate["blocked_reasons"],
            "created_at": release_gate["created_at"],
            "canary_promote_status": release_gate["canary_promote_status"],
        },
        "oidc_mode": "development" if container.settings.oidc_dev_mode else "keycloak",
    }
