from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_container, get_current_ops_user, get_db
from app.core.container import AppContainer
from app.models.entities import World
from app.modules.admin_ops.service import (
    projection_status,
    rebuild_projection,
    recent_runtime_failures,
    sp_ledger,
    sp_overview,
    world_graph_summary,
)
from app.modules.economy_sp.service import InsufficientSPError
from app.modules.identity.oidc import UserIdentity


router = APIRouter(prefix="/ops", tags=["ops"])


class RebuildProjectionRequest(BaseModel):
    world_id: str = Field(min_length=1, max_length=64)


class SPAdjustmentRequest(BaseModel):
    user_sub: str = Field(min_length=1, max_length=128)
    delta: int
    reason_code: str = Field(min_length=1, max_length=64)
    world_id: str | None = Field(default=None, max_length=64)
    actor_id: str | None = Field(default=None, max_length=36)
    note: str | None = Field(default=None, max_length=500)


class EvalRunRequest(BaseModel):
    source: Literal["dataset", "shadow_replay"]
    dataset_name: str | None = Field(default=None, max_length=128)
    limit: int = Field(default=5, ge=1, le=50)


@router.get("/projection/status")
def get_projection_status(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    payload = projection_status(db, container.settings, container.projection_service)
    payload["recent_failures"] = recent_runtime_failures(db)
    return payload


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


@router.get("/sp/overview")
def get_sp_overview(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return sp_overview(db, container.economy_service)


@router.get("/sp/ledger")
def get_sp_ledger(
    user_sub: str | None = Query(default=None, max_length=128),
    world_id: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return sp_ledger(db, container.economy_service, user_sub=user_sub, world_id=world_id, limit=limit)


@router.post("/sp/adjustments")
def post_sp_adjustment(
    payload: SPAdjustmentRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    if payload.world_id is not None:
        world_exists = db.execute(select(World.id).where(World.id == payload.world_id)).scalar_one_or_none()
        if world_exists is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World not found")

    try:
        result = container.economy_service.apply_adjustment(
            db,
            user_sub=payload.user_sub,
            delta=payload.delta,
            reason_code=payload.reason_code,
            world_id=payload.world_id,
            actor_id=payload.actor_id,
            created_by_sub=user.sub,
            note=payload.note,
        )
    except InsufficientSPError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "detail": exc.detail,
                "balance": exc.balance,
                "required": exc.required,
                "turn_cost": container.settings.turn_sp_cost,
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    db.commit()
    return {
        "ledger_entry_id": result.ledger_entry.id,
        "user_sub": payload.user_sub,
        "delta": result.delta,
        "balance": result.balance_after,
    }


@router.post("/evals/run")
def post_eval_run(
    payload: EvalRunRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    if payload.source == "dataset":
        if payload.dataset_name is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="dataset_name is required")
        result = container.eval_service.run_dataset(db, payload.dataset_name)
    else:
        result = container.eval_service.run_shadow_replay(db, limit=payload.limit)
    db.commit()
    return result


@router.get("/evals/runs")
def get_eval_runs(
    limit: int = Query(default=12, ge=1, le=50),
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return container.eval_service.list_runs(db, limit=limit)


@router.get("/evals/runs/{run_id}")
def get_eval_run_detail(
    run_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return container.eval_service.get_run_detail(db, run_id)


@router.get("/release/gates/latest")
def get_latest_release_gate(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return container.eval_service.latest_gate_report(db)
