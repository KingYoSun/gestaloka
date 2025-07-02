"""
Admin SP management endpoints.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, col, select

from app.api.deps import get_db
from app.api.v1.admin.deps import get_current_admin_user
from app.models.sp import PlayerSP, SPTransaction, SPTransactionType
from app.models.user import User
from app.schemas.admin.sp_management import (
    AdminSPAdjustment,
    AdminSPAdjustmentResponse,
    PlayerSPDetail,
    SPTransactionHistory,
)
from app.services.sp_service import SPService

router = APIRouter()


@router.get("/players", response_model=list[PlayerSPDetail])
async def get_all_players_sp(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    search: Optional[str] = None,
    admin_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    """
    全プレイヤーのSP情報を取得。
    検索機能付き（ユーザー名、メールアドレス）。
    """
    query = select(PlayerSP).join(User)

    if search:
        query = query.where(
            (col(User.username).ilike(f"%{search}%")) | (col(User.email).ilike(f"%{search}%"))
        )

    query = query.offset(skip).limit(limit)
    results = db.exec(query).all()

    return [
        PlayerSPDetail(
            user_id=int(sp.user_id),
            username=sp.user.username if sp.user else "",
            email=sp.user.email if sp.user else "",
            current_sp=sp.current_sp,
            total_earned=sp.total_earned_sp,
            total_consumed=sp.total_consumed_sp,
            last_daily_recovery=sp.last_daily_recovery_at,
            consecutive_login_days=sp.consecutive_login_days,
            created_at=sp.created_at,
            updated_at=sp.updated_at,
        )
        for sp in results
    ]


@router.get("/players/{user_id}", response_model=PlayerSPDetail)
async def get_player_sp_detail(
    user_id: str,
    admin_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    """
    特定プレイヤーのSP情報を取得。
    """
    stmt = select(PlayerSP).where(PlayerSP.user_id == user_id)
    player_sp = db.exec(stmt).first()

    if not player_sp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Player SP data not found"
        )

    return PlayerSPDetail(
        user_id=int(player_sp.user_id),
        username=player_sp.user.username if player_sp.user else "",
        email=player_sp.user.email if player_sp.user else "",
        current_sp=player_sp.current_sp,
        total_earned=player_sp.total_earned_sp,
        total_consumed=player_sp.total_consumed_sp,
        last_daily_recovery=player_sp.last_daily_recovery_at,
        consecutive_login_days=player_sp.consecutive_login_days,
        created_at=player_sp.created_at,
        updated_at=player_sp.updated_at,
    )


@router.get("/players/{user_id}/transactions", response_model=SPTransactionHistory)
async def get_player_sp_transactions(
    user_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    transaction_type: Optional[SPTransactionType] = None,
    admin_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    """
    特定プレイヤーのSP取引履歴を取得。
    """
    query = select(SPTransaction).where(SPTransaction.user_id == user_id)

    if transaction_type:
        query = query.where(SPTransaction.transaction_type == transaction_type)

    # Get total count
    count_query = select(SPTransaction).where(SPTransaction.user_id == user_id)
    if transaction_type:
        count_query = count_query.where(SPTransaction.transaction_type == transaction_type)
    total = len(db.exec(count_query).all())

    # Get paginated results
    query = query.order_by(col(SPTransaction.created_at).desc()).offset(skip).limit(limit)
    transactions = db.exec(query).all()

    return SPTransactionHistory(
        transactions=list(transactions),
        total=total,
        skip=skip,
        limit=limit,
    )


@router.post("/adjust", response_model=AdminSPAdjustmentResponse)
async def adjust_player_sp(
    adjustment: AdminSPAdjustment,
    admin_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    """
    プレイヤーのSPを手動で調整。
    管理者による付与・減算が可能。
    """
    sp_service = SPService(db)

    # Check if user exists
    stmt = select(User).where(User.id == str(adjustment.user_id))
    user = db.exec(stmt).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Get or create player SP
    player_sp = await sp_service.get_or_create_player_sp(str(adjustment.user_id))

    # Validate adjustment
    if adjustment.amount < 0 and abs(adjustment.amount) > player_sp.current_sp:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot deduct {abs(adjustment.amount)} SP. Current balance: {player_sp.current_sp}"
        )

    # Apply adjustment
    if adjustment.amount > 0:
        # Add SP
        await sp_service.add_sp(
            user_id=str(adjustment.user_id),
            amount=adjustment.amount,
            transaction_type=SPTransactionType.ADMIN_GRANT,
            description=f"管理者付与: {adjustment.reason or '理由なし'} (by {admin_user.username})"
        )
    else:
        # Deduct SP
        await sp_service.consume_sp(
            user_id=str(adjustment.user_id),
            amount=abs(adjustment.amount),
            transaction_type=SPTransactionType.ADMIN_DEDUCT,
            description=f"管理者減算: {adjustment.reason or '理由なし'} (by {admin_user.username})"
        )

    # Get updated player SP
    player_sp = await sp_service.get_or_create_player_sp(str(adjustment.user_id))

    return AdminSPAdjustmentResponse(
        user_id=adjustment.user_id,
        username=user.username,
        previous_sp=player_sp.current_sp - adjustment.amount,
        current_sp=player_sp.current_sp,
        adjustment_amount=adjustment.amount,
        reason=adjustment.reason,
        adjusted_by=admin_user.username,
    )


@router.post("/batch-adjust", response_model=list[AdminSPAdjustmentResponse])
async def batch_adjust_sp(
    adjustments: list[AdminSPAdjustment],
    admin_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    """
    複数プレイヤーのSPを一括調整。
    イベント配布などに使用。
    """
    sp_service = SPService(db)
    results = []

    for adjustment in adjustments:
        try:
            # Check if user exists
            stmt = select(User).where(User.id == str(adjustment.user_id))
            user = db.exec(stmt).first()
            if not user:
                continue

            # Get or create player SP
            player_sp = await sp_service.get_or_create_player_sp(str(adjustment.user_id))
            previous_sp = player_sp.current_sp

            # Apply adjustment
            if adjustment.amount > 0:
                await sp_service.add_sp(
                    user_id=str(adjustment.user_id),
                    amount=adjustment.amount,
                    transaction_type=SPTransactionType.ADMIN_GRANT,
                    description=f"一括付与: {adjustment.reason or 'イベント配布'} (by {admin_user.username})"
                )
            elif adjustment.amount < 0 and abs(adjustment.amount) <= player_sp.current_sp:
                await sp_service.consume_sp(
                    user_id=str(adjustment.user_id),
                    amount=abs(adjustment.amount),
                    transaction_type=SPTransactionType.ADMIN_DEDUCT,
                    description=f"一括減算: {adjustment.reason or '理由なし'} (by {admin_user.username})"
                )
            else:
                continue

            # Get updated player SP
            player_sp = await sp_service.get_or_create_player_sp(str(adjustment.user_id))

            results.append(AdminSPAdjustmentResponse(
                user_id=adjustment.user_id,
                username=user.username,
                previous_sp=previous_sp,
                current_sp=player_sp.current_sp,
                adjustment_amount=adjustment.amount,
                reason=adjustment.reason,
                adjusted_by=admin_user.username,
            ))
        except Exception:
            # Skip failed adjustments
            continue

    return results
