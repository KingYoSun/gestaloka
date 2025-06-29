"""SP購入APIエンドポイント"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.models.sp_purchase import PurchaseStatus
from app.models.user import User
from app.schemas.sp_purchase import (
    PurchaseRequest,
    PurchaseResponse,
    SPPlanResponse,
    SPPurchaseDetail,
    SPPurchaseList,
    SPPurchaseStats,
)
from app.services.sp_purchase_service import SPPurchaseService
from app.websocket.events import emit_sp_purchase_event

router = APIRouter()


@router.get("/plans", response_model=SPPlanResponse)
async def get_sp_plans() -> SPPlanResponse:
    """
    SP購入プラン一覧を取得

    - 現在利用可能な全てのプランを返します
    - payment_modeで現在の支払いモードを確認できます
    """
    plans = SPPurchaseService.get_plans()

    return SPPlanResponse(
        plans=plans,
        payment_mode=settings.PAYMENT_MODE,
        currency="JPY"
    )


@router.post("/purchase", response_model=PurchaseResponse)
async def create_purchase(
    request: PurchaseRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> PurchaseResponse:
    """
    SP購入申請を作成

    - テストモードの場合はtest_reasonが必須です
    - 自動承認が有効な場合は即座にSPが付与されます
    """
    # テストモードでの検証
    if settings.PAYMENT_MODE == "test" and not request.test_reason:
        raise HTTPException(
            status_code=400,
            detail="Test reason is required in test mode"
        )

    try:
        purchase = SPPurchaseService.create_purchase(
            db=db,
            user_id=current_user.id,
            plan_id=request.plan_id,
            test_reason=request.test_reason
        )

        # WebSocketイベント送信
        await emit_sp_purchase_event(
            user_id=current_user.id,
            event_type="purchase_created",
            purchase_id=str(purchase.id),
            status=purchase.status.value,
            sp_amount=purchase.sp_amount,
        )

        return PurchaseResponse(
            purchase_id=str(purchase.id),
            status=purchase.status,
            sp_amount=purchase.sp_amount,
            price_jpy=purchase.price_jpy,
            payment_mode=purchase.payment_mode,
            message="購入申請を受け付けました" if purchase.status == PurchaseStatus.PENDING else "購入が完了しました"
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> SPPurchaseList:
    """
    ユーザーの購入履歴を取得

    - statusでフィルタリング可能
    - 新しい順に返されます
    """
    purchases = SPPurchaseService.get_user_purchases(
        db=db,
        user_id=current_user.id,
        status=status,
        limit=limit,
        offset=offset
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
                approved_at=purchase.approved_at
            )
            for purchase in purchases
        ],
        total=len(purchases),
        limit=limit,
        offset=offset
    )


@router.get("/purchases/{purchase_id}", response_model=SPPurchaseDetail)
async def get_purchase_detail(
    purchase_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> SPPurchaseDetail:
    """
    購入詳細を取得

    - 自分の購入のみ取得可能です
    """
    purchase = SPPurchaseService.get_purchase(
        db=db,
        purchase_id=purchase_id,
        user_id=current_user.id
    )

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
        approved_at=purchase.approved_at
    )


@router.post("/purchases/{purchase_id}/cancel", response_model=SPPurchaseDetail)
async def cancel_purchase(
    purchase_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> SPPurchaseDetail:
    """
    購入をキャンセル

    - PENDING または PROCESSING 状態の購入のみキャンセル可能
    """
    try:
        purchase = SPPurchaseService.cancel_purchase(
            db=db,
            purchase_id=purchase_id,
            user_id=current_user.id
        )

        # WebSocketイベント送信
        await emit_sp_purchase_event(
            user_id=current_user.id,
            event_type="purchase_cancelled",
            purchase_id=str(purchase.id),
            status=purchase.status.value,
            sp_amount=purchase.sp_amount,
        )

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
            approved_at=purchase.approved_at
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"キャンセル処理中にエラーが発生しました: {e!s}")


@router.get("/stats", response_model=SPPurchaseStats)
async def get_purchase_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> SPPurchaseStats:
    """
    ユーザーの購入統計を取得

    - 完了した購入のみが集計対象です
    """
    stats = SPPurchaseService.get_purchase_stats(
        db=db,
        user_id=current_user.id
    )

    return SPPurchaseStats(**stats)
