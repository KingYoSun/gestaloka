"""
SPシステムのAPIエンドポイント
"""

import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_
from sqlmodel import Session, col, select

from app.api.deps import get_current_active_user, get_db
from app.core.config import settings
from app.core.exceptions import InsufficientSPError, SPSystemError
from app.core.logging import get_logger
from app.models.sp import SPTransaction, SPTransactionType
from app.models.sp_purchase import PurchaseStatus
from app.models.user import User
from app.schemas.sp import (
    PlayerSPRead,
    PlayerSPSummary,
    SPConsumeRequest,
    SPConsumeResponse,
    SPDailyRecoveryResponse,
    SPTransactionRead,
)
from app.schemas.sp_purchase import (
    PurchaseRequest,
    PurchaseResponse,
    SPPlanResponse,
    SPPurchaseDetail,
    SPPurchaseList,
    SPPurchaseStats,
)
from app.services.sp_purchase_service import SPPurchaseService
from app.services.sp_service import SPService

router = APIRouter()
logger = get_logger(__name__)


@router.get("/balance", response_model=PlayerSPRead)
async def get_sp_balance(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    現在のSP残高と詳細情報を取得

    Returns:
        PlayerSPRead: SP残高の詳細情報
    """
    try:
        service = SPService(db)
        player_sp = await service.get_balance(current_user.id)
        return player_sp
    except SPSystemError as e:
        logger.error(
            "Failed to get SP balance",
            user_id=current_user.id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/balance/summary", response_model=PlayerSPSummary)
async def get_sp_balance_summary(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    SP残高の概要を取得（軽量版）

    Returns:
        PlayerSPSummary: SP残高の概要
    """
    try:
        service = SPService(db)
        player_sp = await service.get_balance(current_user.id)
        return PlayerSPSummary.model_validate(player_sp)
    except SPSystemError as e:
        logger.error(
            "Failed to get SP balance summary",
            user_id=current_user.id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/consume", response_model=SPConsumeResponse)
async def consume_sp(
    request: SPConsumeRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    SPを消費

    Args:
        request: SP消費リクエスト

    Returns:
        SPConsumeResponse: 消費結果

    Raises:
        HTTPException: SP不足または処理エラー
    """
    try:
        service = SPService(db)
        transaction = await service.consume_sp(
            user_id=current_user.id,
            amount=request.amount,
            transaction_type=request.transaction_type,
            description=request.description,
            related_entity_type=request.related_entity_type,
            related_entity_id=request.related_entity_id,
            metadata=request.metadata,
        )

        return SPConsumeResponse(
            success=True,
            transaction_id=transaction.id,
            balance_before=transaction.balance_before,
            balance_after=transaction.balance_after,
            message=f"SP {abs(transaction.amount)} を消費しました",
        )

    except InsufficientSPError as e:
        logger.warning(
            "Insufficient SP",
            user_id=current_user.id,
            requested_amount=request.amount,
            error=str(e),
        )
        raise HTTPException(status_code=400, detail=str(e))
    except SPSystemError as e:
        logger.error(
            "Failed to consume SP",
            user_id=current_user.id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/daily-recovery", response_model=SPDailyRecoveryResponse)
async def process_daily_recovery(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    日次SP回復処理

    Returns:
        SPDailyRecoveryResponse: 回復結果

    Note:
        - 1日1回のみ実行可能
        - 連続ログインボーナスも同時に処理
        - サブスクリプションボーナスも適用
    """
    try:
        service = SPService(db)
        result = await service.process_daily_recovery(current_user.id)

        if not result["success"]:
            raise HTTPException(status_code=400, detail=result["message"])

        return SPDailyRecoveryResponse(**result)

    except SPSystemError as e:
        logger.error(
            "Failed to process daily recovery",
            user_id=current_user.id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/transactions", response_model=list[SPTransactionRead])
async def get_transaction_history(
    transaction_type: SPTransactionType | None = Query(None),
    start_date: datetime | None = Query(None),
    end_date: datetime | None = Query(None),
    related_entity_type: str | None = Query(None),
    related_entity_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    SP取引履歴を取得

    Args:
        transaction_type: 取引種別でフィルター
        start_date: 開始日時
        end_date: 終了日時
        related_entity_type: 関連エンティティ種別
        related_entity_id: 関連エンティティID
        limit: 取得件数上限
        offset: オフセット

    Returns:
        list[SPTransactionRead]: 取引履歴のリスト
    """
    try:
        service = SPService(db)
        transactions = await service.get_transaction_history(
            user_id=current_user.id,
            transaction_type=transaction_type,
            start_date=start_date,
            end_date=end_date,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
            limit=limit,
            offset=offset,
        )
        return transactions

    except SPSystemError as e:
        logger.error(
            "Failed to get transaction history",
            user_id=current_user.id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/transactions/{transaction_id}", response_model=SPTransactionRead)
async def get_transaction_detail(
    transaction_id: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    特定の取引詳細を取得

    Args:
        transaction_id: 取引ID

    Returns:
        SPTransactionRead: 取引詳細

    Raises:
        HTTPException: 取引が見つからない場合
    """
    try:
        stmt = select(SPTransaction).where(
            and_(
                col(SPTransaction.id) == transaction_id,
                col(SPTransaction.user_id) == current_user.id,
            )
        )
        transaction = db.exec(stmt).first()

        if not transaction:
            raise HTTPException(
                status_code=404,
                detail="指定された取引が見つかりません",
            )

        return transaction

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get transaction detail",
            user_id=current_user.id,
            transaction_id=transaction_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=500,
            detail="取引詳細の取得に失敗しました",
        )


# SP購入エンドポイント
@router.get("/plans", response_model=SPPlanResponse)
async def get_sp_plans() -> SPPlanResponse:
    """
    SP購入プラン一覧を取得

    - 現在利用可能な全てのプランを返します
    - payment_modeで現在の支払いモードを確認できます
    """
    plans = SPPurchaseService.get_plans()

    return SPPlanResponse(plans=plans, payment_mode=settings.PAYMENT_MODE, currency="JPY")


@router.post("/purchase", response_model=PurchaseResponse)
async def create_purchase(
    request: PurchaseRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> PurchaseResponse:
    """
    SP購入申請を作成

    - テストモードの場合はtest_reasonが必須です
    - 自動承認が有効な場合は即座にSPが付与されます
    """
    # テストモードでの検証
    if settings.PAYMENT_MODE == "test" and not request.test_reason:
        raise HTTPException(status_code=400, detail="Test reason is required in test mode")

    try:
        purchase = SPPurchaseService.create_purchase(
            db=db, user_id=current_user.id, plan_id=request.plan_id, test_reason=request.test_reason
        )

        return PurchaseResponse(
            purchase_id=str(purchase.id),
            status=purchase.status,
            sp_amount=purchase.sp_amount,
            price_jpy=purchase.price_jpy,
            payment_mode=purchase.payment_mode,
            message="購入申請を受け付けました" if purchase.status == PurchaseStatus.PENDING else "購入が完了しました",
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"購入処理中にエラーが発生しました: {e!s}")


@router.get("/purchases", response_model=SPPurchaseList)
async def get_user_purchases(
    status: Optional[PurchaseStatus] = Query(None, description="フィルタするステータス"),
    limit: int = Query(20, ge=1, le=100, description="取得件数"),
    offset: int = Query(0, ge=0, description="オフセット"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> SPPurchaseList:
    """
    ユーザーの購入履歴を取得

    - statusでフィルタリング可能
    - 新しい順に返されます
    """
    purchases = SPPurchaseService.get_user_purchases(
        db=db, user_id=current_user.id, status=status, limit=limit, offset=offset
    )

    return SPPurchaseList(
        purchases=[
            SPPurchaseDetail(
                id=str(purchase.id),
                plan_id=purchase.plan_id,
                sp_amount=purchase.sp_amount,
                price_jpy=purchase.price_jpy,
                status=purchase.status,
                payment_mode=purchase.payment_mode,
                test_reason=purchase.test_reason,
                created_at=purchase.created_at,
                updated_at=purchase.updated_at,
                approved_at=purchase.approved_at,
            )
            for purchase in purchases
        ],
        total=len(purchases),
        limit=limit,
        offset=offset,
    )


@router.get("/purchases/{purchase_id}", response_model=SPPurchaseDetail)
async def get_purchase_detail(
    purchase_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> SPPurchaseDetail:
    """
    購入詳細を取得

    - 自分の購入のみ取得可能です
    """
    purchase = SPPurchaseService.get_purchase(db=db, purchase_id=purchase_id, user_id=current_user.id)

    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")

    return SPPurchaseDetail(
        id=str(purchase.id),
        plan_id=purchase.plan_id,
        sp_amount=purchase.sp_amount,
        price_jpy=purchase.price_jpy,
        status=purchase.status,
        payment_mode=purchase.payment_mode,
        test_reason=purchase.test_reason,
        created_at=purchase.created_at,
        updated_at=purchase.updated_at,
        approved_at=purchase.approved_at,
    )


@router.post("/purchases/{purchase_id}/cancel", response_model=SPPurchaseDetail)
async def cancel_purchase(
    purchase_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> SPPurchaseDetail:
    """
    購入をキャンセル

    - PENDING または PROCESSING 状態の購入のみキャンセル可能
    """
    try:
        purchase = SPPurchaseService.cancel_purchase(db=db, purchase_id=purchase_id, user_id=current_user.id)

        return SPPurchaseDetail(
            id=str(purchase.id),
            plan_id=purchase.plan_id,
            sp_amount=purchase.sp_amount,
            price_jpy=purchase.price_jpy,
            status=purchase.status,
            payment_mode=purchase.payment_mode,
            test_reason=purchase.test_reason,
            created_at=purchase.created_at,
            updated_at=purchase.updated_at,
            approved_at=purchase.approved_at,
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"キャンセル処理中にエラーが発生しました: {e!s}")


@router.get("/purchase-stats", response_model=SPPurchaseStats)
async def get_purchase_stats(
    current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
) -> SPPurchaseStats:
    """
    ユーザーの購入統計を取得

    - 完了した購入のみが集計対象です
    """
    stats = SPPurchaseService.get_purchase_stats(db=db, user_id=current_user.id)

    return SPPurchaseStats(**stats)
