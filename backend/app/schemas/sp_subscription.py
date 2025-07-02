"""
SPサブスクリプションスキーマ定義
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.models.sp import SPSubscriptionType
from app.models.sp_subscription import SubscriptionStatus


class SPSubscriptionBase(BaseModel):
    """サブスクリプション基本スキーマ"""

    subscription_type: SPSubscriptionType = Field(..., description="サブスクリプションタイプ")
    auto_renew: bool = Field(True, description="自動更新フラグ")


class SPSubscriptionCreate(SPSubscriptionBase):
    """サブスクリプション作成スキーマ"""

    payment_method_id: Optional[str] = Field(None, description="Stripe決済方法ID（本番モードのみ）")
    trial_days: Optional[int] = Field(None, description="試用期間（日数）")


class SPSubscriptionUpdate(BaseModel):
    """サブスクリプション更新スキーマ"""

    auto_renew: Optional[bool] = Field(None, description="自動更新フラグ")
    payment_method_id: Optional[str] = Field(None, description="Stripe決済方法ID")


class SPSubscriptionCancel(BaseModel):
    """サブスクリプションキャンセルスキーマ"""

    reason: Optional[str] = Field(None, description="キャンセル理由")
    immediate: bool = Field(False, description="即時キャンセル（Trueの場合、期限まで待たずに即座にキャンセル）")


class SPSubscriptionInDB(SPSubscriptionBase):
    """サブスクリプションDBスキーマ"""

    id: str
    user_id: str
    status: SubscriptionStatus
    started_at: Optional[datetime]
    expires_at: Optional[datetime]
    cancelled_at: Optional[datetime]
    stripe_subscription_id: Optional[str]
    stripe_customer_id: Optional[str]
    price: int
    currency: str
    next_billing_date: Optional[datetime]
    trial_end: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SPSubscriptionResponse(SPSubscriptionInDB):
    """サブスクリプションレスポンススキーマ"""

    # 追加の計算フィールド
    is_active: bool = Field(..., description="現在有効かどうか")
    days_remaining: Optional[int] = Field(None, description="残り日数")
    is_trial: bool = Field(False, description="試用期間中かどうか")


class SPSubscriptionPurchaseResponse(BaseModel):
    """サブスクリプション購入レスポンス"""

    success: bool = Field(..., description="購入成功フラグ")
    subscription_id: Optional[str] = Field(None, description="サブスクリプションID")
    checkout_url: Optional[str] = Field(None, description="Stripeチェックアウトページ（本番モードのみ）")
    message: str = Field(..., description="メッセージ")
    test_mode: bool = Field(..., description="テストモードフラグ")


class SPSubscriptionListResponse(BaseModel):
    """サブスクリプション一覧レスポンス"""

    subscriptions: list[SPSubscriptionResponse]
    total: int
    active_count: int
    cancelled_count: int


class SubscriptionBenefits(BaseModel):
    """サブスクリプション特典情報"""

    subscription_type: SPSubscriptionType
    name: str
    price: int
    daily_bonus: int = Field(..., description="日次回復ボーナスSP")
    discount_rate: float = Field(..., description="SP消費時の割引率")
    features: list[str] = Field(..., description="その他の特典")


class SubscriptionPlansResponse(BaseModel):
    """サブスクリプションプラン一覧レスポンス"""

    plans: list[SubscriptionBenefits]
    current_subscription: Optional[SPSubscriptionResponse] = None