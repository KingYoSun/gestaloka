from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_container, get_current_ops_user, get_db
from app.core.container import AppContainer
from app.modules.admin_ops.service import projection_status, rebuild_projection, world_graph_summary
from app.modules.identity.oidc import UserIdentity


router = APIRouter(prefix="/ops", tags=["ops"])


class RebuildProjectionRequest(BaseModel):
    world_id: str = Field(min_length=1, max_length=64)


@router.get("/projection/status")
def get_projection_status(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return projection_status(db, container.settings, container.projection_service)


@router.post("/projection/rebuild")
def post_projection_rebuild(
    payload: RebuildProjectionRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    result = rebuild_projection(db, container.projection_service, payload.world_id)
    db.commit()
    return result


@router.get("/worlds/{world_id}/graph-summary")
def get_world_graph_summary(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return world_graph_summary(db, container.projection_service, world_id)
