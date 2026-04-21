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
    snapshot = runtime_snapshot(db)
    return {
        "status": "ok",
        "database": "ok",
        "projection": {
            "backend": container.settings.graph_projection_backend,
            "pending_outbox": snapshot["pending_outbox"],
            "projection_records": snapshot["projection_records"],
        },
        "oidc_mode": "development" if container.settings.oidc_dev_mode else "keycloak",
    }
