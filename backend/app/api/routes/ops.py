from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_container, get_current_ops_user, get_db
from app.core.container import AppContainer
from app.core.realtime import realtime_hub, with_world_context
from app.models.entities import Session as GameSession, World
from app.modules.admin_ops.service import (
    get_council_turn,
    list_world_contexts,
    list_council_turns,
    memory_status,
    observability_summary,
    projection_status,
    rebuild_projection,
    reindex_memories,
    recent_runtime_failures,
    sp_ledger,
    sp_overview,
    trigger_idle_world_pass,
    world_ambient_beats,
    world_offstage_beats,
    world_memory_search,
    world_graph_summary,
    world_chapters,
    world_locations,
    world_npc_locations,
    world_npc_routines,
    world_route_pressures,
    world_relationships,
    world_scenes,
    world_travel_log,
    world_chapter_branches,
    world_consequence_threads,
    world_ticks,
)
from app.modules.economy_sp.service import InsufficientSPError
from app.modules.identity.oidc import UserIdentity
from app.modules.world_pack.service import world_context_for_world


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


class ReleaseChecklistRequest(BaseModel):
    trigger_type: Literal["manual", "nightly", "pre_promote"] = "manual"
    shadow_limit: int | None = Field(default=None, ge=1, le=50)


class ReindexMemoriesRequest(BaseModel):
    world_id: str | None = Field(default=None, max_length=64)
    limit: int = Field(default=200, ge=1, le=1000)


@router.get("/worlds")
def get_ops_worlds(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del container, user
    return list_world_contexts(db)


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


@router.get("/memories/status")
def get_memory_status(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return memory_status(db, container.memory_service)


@router.post("/memories/reindex")
def post_memory_reindex(
    payload: ReindexMemoriesRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    result = reindex_memories(
        db,
        container.memory_service,
        world_id=payload.world_id,
        limit=payload.limit,
    )
    db.commit()
    return result


@router.get("/observability/summary")
def get_observability_summary(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return observability_summary(db, container.settings, container.projection_service, container.observability_service)


@router.get("/observability/langfuse/status")
def get_langfuse_status(
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return container.observability_service.langfuse_runtime()


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


@router.get("/worlds/{world_id}/memory-search")
def get_world_memory_search(
    world_id: str,
    query: str = Query(min_length=1, max_length=2000),
    actor_id: str | None = Query(default=None, max_length=36),
    location_id: str | None = Query(default=None, max_length=96),
    limit: int = Query(default=8, ge=1, le=50),
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return world_memory_search(
        db,
        container.memory_service,
        world_id=world_id,
        query=query,
        actor_id=actor_id,
        location_id=location_id,
        limit=limit,
    )


@router.get("/worlds/{world_id}/relationships")
def get_world_relationships(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del container, user
    return world_relationships(db, world_id=world_id)


@router.get("/worlds/{world_id}/chapters")
def get_world_chapters(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del container, user
    return world_chapters(db, world_id=world_id)


@router.get("/worlds/{world_id}/chapter-branches")
def get_world_chapter_branches(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del container, user
    return world_chapter_branches(db, world_id=world_id)


@router.get("/worlds/{world_id}/scenes")
def get_world_scenes(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del container, user
    return world_scenes(db, world_id=world_id)


@router.get("/worlds/{world_id}/consequence-threads")
def get_world_consequence_threads(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del container, user
    return world_consequence_threads(db, world_id=world_id)


@router.get("/worlds/{world_id}/route-pressures")
def get_world_route_pressures(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del container, user
    return world_route_pressures(db, world_id=world_id)


@router.get("/worlds/{world_id}/npc-routines")
def get_world_npc_routines(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del container, user
    return world_npc_routines(db, world_id=world_id)


@router.get("/worlds/{world_id}/ambient-beats")
def get_world_ambient_beats(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del container, user
    return world_ambient_beats(db, world_id=world_id)


@router.post("/worlds/{world_id}/idle-pass")
async def post_world_idle_pass(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    world_context = world_context_for_world(db, world_id)
    result = trigger_idle_world_pass(db, container.ambient_world_service, world_id=world_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World not found or has no active session")
    db.commit()
    active_sessions = list(
        db.execute(
            select(GameSession).where(GameSession.world_id == world_id, GameSession.status == "active")
        ).scalars()
    )
    payload = {
        "world_id": world_id,
        "tick": result["tick"],
        "items": result["idle_updates"],
        "recent_offstage_beats": result["recent_offstage_beats"],
        "offstage_murmurs": result["offstage_murmurs"],
        "npc_locations": result["npc_locations"],
    }
    for game_session in active_sessions:
        await realtime_hub.emit_with_world_context(game_session.id, "idle.updated", payload, world_context)
        if result["idle_updates"]:
            moved_items = [item for item in result["idle_updates"] if item.get("moved")]
            if moved_items:
                await realtime_hub.emit_with_world_context(
                    game_session.id,
                    "location.updated",
                    {"items": moved_items},
                    world_context,
                )
    return with_world_context(result, world_context)


@router.get("/worlds/{world_id}/world-ticks")
def get_world_ticks(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del container, user
    return world_ticks(db, world_id=world_id)


@router.get("/worlds/{world_id}/npc-locations")
def get_world_npc_locations(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del container, user
    return world_npc_locations(db, world_id=world_id)


@router.get("/worlds/{world_id}/offstage-beats")
def get_world_offstage_beats(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del container, user
    return world_offstage_beats(db, world_id=world_id)


@router.get("/worlds/{world_id}/locations")
def get_world_locations(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del container, user
    return world_locations(db, world_id=world_id)


@router.get("/worlds/{world_id}/travel-log")
def get_world_travel_log(
    world_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del container, user
    return world_travel_log(db, world_id=world_id)


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
                "turn_cost": container.settings.choice_turn_sp_cost,
                "choice_turn_cost": container.settings.choice_turn_sp_cost,
                "free_text_turn_cost": container.settings.free_text_turn_sp_cost,
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc

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
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="dataset_name is required")
        result = container.eval_service.run_dataset(db, payload.dataset_name)
    else:
        result = container.eval_service.run_shadow_replay(db, limit=payload.limit)
    db.commit()
    return result


@router.post("/release/checklists/run")
def post_release_checklist_run(
    payload: ReleaseChecklistRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    result = container.eval_service.run_release_checklist(
        db,
        trigger_type=payload.trigger_type,
        shadow_limit=payload.shadow_limit,
    )
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


@router.get("/release/checklists/latest")
def get_latest_release_checklist(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return container.eval_service.latest_release_checklist(db)


@router.get("/release/checklists/{report_id}")
def get_release_checklist_detail(
    report_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del user
    return container.eval_service.get_release_checklist(db, report_id)


@router.get("/council/turns")
def get_council_turn_list(
    limit: int = Query(default=12, ge=1, le=50),
    session_id: str | None = Query(default=None, max_length=36),
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del container, user
    return list_council_turns(db, limit=limit, session_id=session_id)


@router.get("/council/turns/{turn_id}")
def get_council_turn_detail(
    turn_id: str,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_ops_user),
) -> dict[str, object]:
    del container, user
    return get_council_turn(db, turn_id)
