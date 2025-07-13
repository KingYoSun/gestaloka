"""
SPシステムのAPIエンドポイント
"""

import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_
from sqlmodel import Session, col, select

from app.api.deps import get_current_active_user, get_db
from app.core.config import settings
from app.core.logging import get_logger
from app.core.stripe_config import stripe_service
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
    StripeCheckoutRequest,
    StripeCheckoutResponse,
)
from app.services.sp_purchase_service import SPPurchaseService
from app.services.sp_service import SPService
from app.utils.exceptions import (
    get_by_condition_or_404,
    handle_sp_errors,
    raise_bad_request,
    raise_internal_error,
    raise_not_found,
)

router = APIRouter()
logger = get_logger(__name__)


@router.get("/balance", response_model=PlayerSPRead)
@handle_sp_errors
async def get_sp_balance(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    現在のSP残高と詳細情報を取得

    Returns:
        PlayerSPRead: SP残高の詳細情報
    """
    service = SPService(db)
    player_sp = await service.get_balance(current_user.id)
    return player_sp


@router.get("/balance/summary", response_model=PlayerSPSummary)
@handle_sp_errors
async def get_sp_balance_summary(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    SP残高の概要を取得（軽量版）

    Returns:
        PlayerSPSummary: SP残高の概要
    """
    service = SPService(db)
    player_sp = await service.get_balance(current_user.id)
    return PlayerSPSummary.model_validate(player_sp)


@router.post("/consume", response_model=SPConsumeResponse)
@handle_sp_errors
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


@router.post("/daily-recovery", response_model=SPDailyRecoveryResponse)
@handle_sp_errors
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
    service = SPService(db)
    result = await service.process_daily_recovery(current_user.id)

    if not result["success"]:
        raise_bad_request(result["message"])

    return SPDailyRecoveryResponse(**result)


@router.get("/transactions", response_model=list[SPTransactionRead])
@handle_sp_errors
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
    service = SPService(db)
    transactions = []
    async for transaction in service.get_transaction_history(
        user_id=current_user.id,
        transaction_type=transaction_type,
        start_date=start_date,
        end_date=end_date,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
        limit=limit,
        offset=offset,
    ):
        transactions.append(transaction)
    return transactions


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
    transaction = get_by_condition_or_404(
        db,
        select(SPTransaction).where(
            and_(
                col(SPTransaction.id) == transaction_id,
                col(SPTransaction.user_id) == current_user.id,
            )
        ),
        "指定された取引が見つかりません"
    )

    return transaction


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
        raise_bad_request("Test reason is required in test mode")

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
        raise_bad_request(str(e))
    except Exception as e:
        raise_internal_error(f"購入処理中にエラーが発生しました: {e!s}")


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
        raise_not_found("Purchase not found")

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
        raise_bad_request(str(e))
    except Exception as e:
        raise_internal_error(f"キャンセル処理中にエラーが発生しました: {e!s}")


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


@router.post("/stripe/checkout", response_model=StripeCheckoutResponse)
async def create_stripe_checkout(
    request: StripeCheckoutRequest, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
) -> StripeCheckoutResponse:
    """
    Stripe チェックアウトセッションを作成

    - 本番モードでのみ利用可能
    - 成功時にはStripeのチェックアウトページへリダイレクトするURLが返されます
    """
    # 本番モードチェック
    if settings.PAYMENT_MODE != "production":
        raise_bad_request("Stripe checkout is only available in production mode")

    # Stripe設定チェック
    if not stripe_service.config.is_configured:
        raise_internal_error("Stripe is not configured. Please contact support.")

    # プランの検証
    plans = SPPurchaseService.get_plans()
    plan = next((p for p in plans if p.id == request.plan_id), None)
    if not plan:
        raise_bad_request("Invalid plan ID")

    try:
        # 購入申請を作成（PENDING状態）
        purchase = SPPurchaseService.create_purchase(
            db=db,
            user_id=current_user.id,
            plan_id=request.plan_id,
            test_reason=None,  # 本番モードでは不要
        )

        # Stripeチェックアウトセッションを作成
        checkout_data = await stripe_service.create_checkout_session(
            plan_id=request.plan_id,
            user_id=current_user.id,
            success_url=f"{settings.STRIPE_SUCCESS_URL}?purchase_id={purchase.id}",
            cancel_url=f"{settings.STRIPE_CANCEL_URL}?purchase_id={purchase.id}",
            metadata={
                "purchase_id": str(purchase.id),
                "sp_amount": str(purchase.sp_amount),
                "price_jpy": str(purchase.price_jpy),
            },
        )

        # セッションIDを購入レコードに保存
        purchase.stripe_checkout_session_id = checkout_data["session_id"]
        db.add(purchase)
        db.commit()

        return StripeCheckoutResponse(
            purchase_id=str(purchase.id), checkout_url=checkout_data["url"], session_id=checkout_data["session_id"]
        )

    except Exception as e:
        # エラー時は購入申請を削除
        if "purchase" in locals():
            db.delete(purchase)
            db.commit()
        raise_internal_error(f"チェックアウトセッション作成中にエラーが発生しました: {e!s}")
