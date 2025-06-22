"""
ログ派遣システムAPIエンドポイント

完成ログを他のプレイヤーの世界に独立NPCとして派遣するエンドポイント群
"""

from datetime import datetime, timedelta
from typing import Any, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc as sa_desc
from sqlmodel import Session, and_, select

from app.api.deps import get_current_active_user, get_user_character
from app.core.database import get_session
from app.models.character import Character
from app.models.log import CompletedLog, CompletedLogStatus
from app.models.log_dispatch import (
    DispatchEncounter,
    DispatchReport,
    DispatchStatus,
    LogDispatch,
)
from app.models.sp import PlayerSP, SPTransaction, SPTransactionType
from app.schemas.dispatch import (
    DispatchCreate,
    DispatchRead,
    DispatchReportRead,
    DispatchWithEncounters,
)
from app.schemas.user import User

router = APIRouter()


async def check_sp_balance(
    user_id: str, required_sp: int, db: Session
) -> PlayerSP:
    """
    SPの残高を確認し、十分なSPがあるかチェック
    """
    # プレイヤーのSP情報を取得
    player_sp_stmt = select(PlayerSP).where(PlayerSP.user_id == user_id)
    result = db.exec(player_sp_stmt)
    player_sp = result.first()

    if not player_sp:
        # SP情報がない場合は初期作成
        player_sp = PlayerSP(
            id=str(uuid4()),
            user_id=user_id,
            current_sp=30,  # 初期SP
            total_earned_sp=30,
            total_consumed_sp=0,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(player_sp)
        db.commit()
        db.refresh(player_sp)

    if player_sp.current_sp < required_sp:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient SP. Required: {required_sp}, Current: {player_sp.current_sp}",
        )

    return player_sp


async def consume_sp(
    player_sp: PlayerSP,
    amount: int,
    transaction_type: SPTransactionType,
    description: str,
    db: Session,
    metadata: Optional[dict] = None,
) -> SPTransaction:
    """
    SPを消費し、トランザクションを記録
    """
    # SP残高を更新
    player_sp.current_sp -= amount
    player_sp.total_consumed_sp += amount
    player_sp.updated_at = datetime.utcnow()

    # トランザクションを記録
    transaction = SPTransaction(
        id=str(uuid4()),
        player_sp_id=player_sp.id,
        user_id=player_sp.user_id,
        transaction_type=transaction_type,
        amount=-amount,  # 消費は負の値
        balance_before=player_sp.current_sp + amount,
        balance_after=player_sp.current_sp,
        description=description,
        transaction_metadata=metadata or {},
        created_at=datetime.utcnow(),
    )

    db.add(transaction)
    db.commit()

    return transaction


@router.post("/dispatch", response_model=DispatchRead)
async def create_dispatch(
    *,
    db: Session = Depends(get_session),
    dispatch_in: DispatchCreate,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    ログを派遣する

    完成ログを指定して、他のプレイヤーの世界に派遣します。
    派遣にはSPが必要です。
    """
    # キャラクターの所有権確認
    character = await get_user_character(dispatch_in.dispatcher_id, db, current_user)

    # 完成ログの確認
    log_stmt = select(CompletedLog).where(
        and_(
            CompletedLog.id == dispatch_in.completed_log_id,
            CompletedLog.creator_id == character.id,
            CompletedLog.status == CompletedLogStatus.COMPLETED,
        )
    )
    result = db.exec(log_stmt)
    completed_log = result.first()

    if not completed_log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Completed log not found or not available for dispatch",
        )

    # SP消費量の計算（基本10SP + 期間 * 5SP）
    sp_cost = 10 + (dispatch_in.dispatch_duration_days * 5)
    if sp_cost > 300:
        sp_cost = 300  # 上限

    # SP残高確認
    player_sp = await check_sp_balance(current_user.id, sp_cost, db)

    # 派遣記録を作成
    dispatch = LogDispatch(
        id=str(uuid4()),
        completed_log_id=completed_log.id,
        dispatcher_id=character.id,
        objective_type=dispatch_in.objective_type,
        objective_detail=dispatch_in.objective_detail,
        initial_location=dispatch_in.initial_location,
        dispatch_duration_days=dispatch_in.dispatch_duration_days,
        sp_cost=sp_cost,
        status=DispatchStatus.PREPARING,
        travel_log=[],
        collected_items=[],
        discovered_locations=[],
        sp_refund_amount=0,
        achievement_score=0.0,
        created_at=datetime.utcnow(),
    )

    db.add(dispatch)

    # SP消費
    await consume_sp(
        player_sp,
        sp_cost,
        SPTransactionType.LOG_DISPATCH,
        f"Dispatch log: {completed_log.name}",
        db,
        metadata={
            "dispatch_id": dispatch.id,
            "log_name": completed_log.name,
            "duration_days": dispatch_in.dispatch_duration_days,
        },
    )

    # 派遣開始
    dispatch.status = DispatchStatus.DISPATCHED
    dispatch.dispatched_at = datetime.utcnow()
    dispatch.expected_return_at = datetime.utcnow() + timedelta(days=dispatch_in.dispatch_duration_days)

    # Celeryタスクをスケジュール（派遣処理）
    from app.tasks.dispatch_tasks import process_dispatch_activities

    process_dispatch_activities.apply_async(
        args=[dispatch.id],
        countdown=60,  # 1分後に最初の活動
    )

    db.commit()
    db.refresh(dispatch)

    return dispatch


@router.get("/dispatches", response_model=list[DispatchRead])
async def get_my_dispatches(
    *,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user),
    status: Optional[DispatchStatus] = Query(None, description="フィルタするステータス"),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
) -> Any:
    """
    自分の派遣一覧を取得
    """
    # 自分のキャラクター一覧を取得
    char_stmt = select(Character).where(Character.user_id == current_user.id)
    result = db.exec(char_stmt)
    characters = result.all()
    character_ids = [char.id for char in characters]

    if not character_ids:
        return []

    # 派遣記録を取得
    dispatch_stmt = select(LogDispatch).where(
        LogDispatch.dispatcher_id.in_(character_ids)  # type: ignore[attr-defined]
    )

    if status:
        dispatch_stmt = dispatch_stmt.where(LogDispatch.status == status)

    dispatch_stmt = (
        dispatch_stmt.order_by(sa_desc(LogDispatch.created_at))
        .offset(skip)
        .limit(limit)
    )

    result = db.exec(dispatch_stmt)  # type: ignore[arg-type]
    dispatches = result.all()

    return dispatches


@router.get("/dispatches/{dispatch_id}", response_model=DispatchWithEncounters)
async def get_dispatch_detail(
    *,
    db: Session = Depends(get_session),
    dispatch_id: str,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    派遣の詳細情報を取得

    遭遇記録や活動ログを含む詳細情報を返します。
    """
    # 派遣記録を取得
    dispatch_stmt = select(LogDispatch).where(LogDispatch.id == dispatch_id)
    result = db.exec(dispatch_stmt)
    dispatch = result.first()

    if not dispatch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dispatch not found",
        )

    # 派遣したキャラクターの所有権確認
    await get_user_character(dispatch.dispatcher_id, db, current_user)

    # 遭遇記録を取得
    encounter_stmt = (
        select(DispatchEncounter)
        .where(DispatchEncounter.dispatch_id == dispatch_id)
        .order_by(sa_desc(DispatchEncounter.occurred_at))
    )
    result = db.exec(encounter_stmt)  # type: ignore[arg-type]
    encounters = result.all()

    # レスポンスを構築
    dispatch_dict = dispatch.model_dump()
    dispatch_dict["encounters"] = encounters

    return dispatch_dict


@router.get("/dispatches/{dispatch_id}/report", response_model=DispatchReportRead)
async def get_dispatch_report(
    *,
    db: Session = Depends(get_session),
    dispatch_id: str,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    派遣報告書を取得

    派遣が完了した後の詳細な報告書を取得します。
    """
    # 派遣記録を取得
    dispatch_stmt = select(LogDispatch).where(
        and_(
            LogDispatch.id == dispatch_id,
            LogDispatch.status == DispatchStatus.COMPLETED,
        )
    )
    result = db.exec(dispatch_stmt)
    dispatch = result.first()

    if not dispatch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Completed dispatch not found",
        )

    # 派遣したキャラクターの所有権確認
    await get_user_character(dispatch.dispatcher_id, db, current_user)

    # 報告書を取得
    report_stmt = select(DispatchReport).where(DispatchReport.dispatch_id == dispatch_id)
    result = db.exec(report_stmt)  # type: ignore[arg-type]
    report = result.first()

    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dispatch report not found",
        )

    return report


@router.post("/dispatches/{dispatch_id}/recall")
async def recall_dispatch(
    *,
    db: Session = Depends(get_session),
    dispatch_id: str,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    派遣を緊急召還する

    派遣中のログを即座に帰還させます。
    追加のSPが必要です。
    """
    # 派遣記録を取得
    dispatch_stmt = select(LogDispatch).where(
        and_(
            LogDispatch.id == dispatch_id,
            LogDispatch.status == DispatchStatus.DISPATCHED,
        )
    )
    result = db.exec(dispatch_stmt)
    dispatch = result.first()

    if not dispatch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Active dispatch not found",
        )

    # 派遣したキャラクターの所有権確認
    await get_user_character(dispatch.dispatcher_id, db, current_user)

    # 緊急召還のSPコスト（元の派遣コストの50%）
    recall_cost = dispatch.sp_cost // 2

    # SP残高確認
    player_sp = await check_sp_balance(current_user.id, recall_cost, db)

    # SP消費
    await consume_sp(
        player_sp,
        recall_cost,
        SPTransactionType.SYSTEM_FUNCTION,
        f"Emergency recall: {dispatch.id}",
        db,
        metadata={"dispatch_id": dispatch.id, "action": "emergency_recall"},
    )

    # 派遣を召還
    dispatch.status = DispatchStatus.RECALLED
    dispatch.actual_return_at = datetime.utcnow()

    # 部分的な成果計算（経過時間に基づく）
    if dispatch.dispatched_at:
        if dispatch.expected_return_at and dispatch.dispatched_at:
            total_duration = dispatch.expected_return_at - dispatch.dispatched_at
            actual_duration = datetime.utcnow() - dispatch.dispatched_at
        else:
            total_duration = timedelta(days=1)
            actual_duration = timedelta(hours=1)
        completion_rate = min(1.0, actual_duration.total_seconds() / total_duration.total_seconds())
        dispatch.achievement_score = completion_rate * 0.5  # 召還の場合は半分の達成度

    db.commit()

    # 報告書生成タスクをスケジュール
    from app.tasks.dispatch_tasks import generate_dispatch_report

    generate_dispatch_report.delay(dispatch.id)

    return {"message": "Dispatch recalled successfully", "recall_cost": recall_cost}
