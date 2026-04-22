from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_container, get_db
from app.core.container import AppContainer
from app.modules.admin_ops.service import runtime_snapshot


router = APIRouter()


@router.get("/health")
def health(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
) -> dict[str, object]:
    db.execute(text("SELECT 1"))
    snapshot = runtime_snapshot(db, container.settings, container.projection_service)
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
        "oidc_mode": "development" if container.settings.oidc_dev_mode else "keycloak",
    }
