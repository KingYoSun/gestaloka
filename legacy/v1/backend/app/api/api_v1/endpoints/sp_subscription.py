"""
SPサブスクリプションのAPIエンドポイント
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.api.deps import get_current_active_user, get_db
from app.core.logging import get_logger
from app.models.user import User
from app.schemas.sp_subscription import (
    SPSubscriptionCancel,
    SPSubscriptionCreate,
    SPSubscriptionListResponse,
    SPSubscriptionPurchaseResponse,
    SPSubscriptionResponse,
    SPSubscriptionUpdate,
    SubscriptionPlansResponse,
)
from app.services.sp_subscription_service import SPSubscriptionService

router = APIRouter()
logger = get_logger(__name__)


@router.get("/plans", response_model=SubscriptionPlansResponse)
async def get_subscription_plans(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    利用可能なサブスクリプションプラン一覧を取得

    Returns:
        SubscriptionPlansResponse: プラン一覧と現在のサブスクリプション情報
    """
    service = SPSubscriptionService(db)

    # プラン一覧を取得
    plans = service.get_subscription_plans()

    # 現在のサブスクリプションを取得
    current_subscription = service.get_active_subscription(current_user.id)
    current_subscription_response = None

    if current_subscription:
        current_subscription_response = service.to_response(current_subscription)

    return SubscriptionPlansResponse(
        plans=plans,
        current_subscription=current_subscription_response,
    )


@router.get("/current", response_model=SPSubscriptionResponse)
async def get_current_subscription(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    現在有効なサブスクリプションを取得

    Returns:
        SPSubscriptionResponse: 現在のサブスクリプション情報

    Raises:
        HTTPException: 有効なサブスクリプションがない場合
    """
    service = SPSubscriptionService(db)
    subscription = service.get_active_subscription(current_user.id)

    if not subscription:
        raise HTTPException(
            status_code=404,
            detail="有効なサブスクリプションがありません",
        )

    return service.to_response(subscription)


@router.get("/history", response_model=SPSubscriptionListResponse)
async def get_subscription_history(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    サブスクリプション履歴を取得

    Returns:
        SPSubscriptionListResponse: サブスクリプション履歴
    """
    service = SPSubscriptionService(db)
    subscriptions = service.get_user_subscriptions(current_user.id)

    # レスポンス形式に変換
    subscription_responses = [service.to_response(sub) for sub in subscriptions]

    # カウント計算
    active_count = sum(1 for sub in subscription_responses if sub.is_active)
    cancelled_count = sum(1 for sub in subscriptions if sub.cancelled_at is not None)

    return SPSubscriptionListResponse(
        subscriptions=subscription_responses,
        total=len(subscriptions),
        active_count=active_count,
        cancelled_count=cancelled_count,
    )


@router.post("/purchase", response_model=SPSubscriptionPurchaseResponse)
async def purchase_subscription(
    data: SPSubscriptionCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    サブスクリプションを購入

    Args:
        data: サブスクリプション作成データ

    Returns:
        SPSubscriptionPurchaseResponse: 購入結果

    Raises:
        HTTPException: 購入に失敗した場合
    """
    service = SPSubscriptionService(db)

    try:
        result = await service.create_subscription(current_user.id, data)

        if not result["success"]:
            raise HTTPException(
                status_code=400,
                detail=result["message"],
            )

        return SPSubscriptionPurchaseResponse(**result)

    except Exception as e:
        logger.error(
            "Failed to purchase subscription",
            user_id=current_user.id,
            error=str(e),
        )
        raise HTTPException(
            status_code=500,
            detail="サブスクリプションの購入に失敗しました",
        )


@router.post("/cancel", response_model=dict)
async def cancel_subscription(
    data: SPSubscriptionCancel,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    サブスクリプションをキャンセル

    Args:
        data: キャンセルデータ

    Returns:
        dict: キャンセル結果

    Raises:
        HTTPException: キャンセルに失敗した場合
    """
    service = SPSubscriptionService(db)

    try:
        result = await service.cancel_subscription(current_user.id, data)

        if not result["success"]:
            raise HTTPException(
                status_code=400,
                detail=result["message"],
            )

        return result

    except Exception as e:
        logger.error(
            "Failed to cancel subscription",
            user_id=current_user.id,
            error=str(e),
        )
        raise HTTPException(
            status_code=500,
            detail="サブスクリプションのキャンセルに失敗しました",
        )


@router.put("/update", response_model=dict)
async def update_subscription(
    data: SPSubscriptionUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    サブスクリプションを更新（自動更新設定、決済方法など）

    Args:
        data: 更新データ

    Returns:
        dict: 更新結果

    Raises:
        HTTPException: 更新に失敗した場合
    """
    service = SPSubscriptionService(db)

    try:
        result = await service.update_subscription(current_user.id, data)

        if not result["success"]:
            raise HTTPException(
                status_code=400,
                detail=result["message"],
            )

        return result

    except Exception as e:
        logger.error(
            "Failed to update subscription",
            user_id=current_user.id,
            error=str(e),
        )
        raise HTTPException(
            status_code=500,
            detail="サブスクリプションの更新に失敗しました",
        )
