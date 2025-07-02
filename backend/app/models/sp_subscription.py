"""
SPサブスクリプションモデル定義
"""

import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import JSON, Column, Index
from sqlalchemy import Enum as SQLEnum
from sqlmodel import Field, Relationship, SQLModel

from app.models.sp import SPSubscriptionType

if TYPE_CHECKING:
    from app.models.user import User


class SubscriptionStatus(str, Enum):
    """サブスクリプションステータス"""

    ACTIVE = "active"  # 有効
    CANCELLED = "cancelled"  # キャンセル済み
    EXPIRED = "expired"  # 期限切れ
    PENDING = "pending"  # 支払い待ち
    FAILED = "failed"  # 支払い失敗


class SPSubscription(SQLModel, table=True):
    """SPサブスクリプション履歴"""

    __tablename__ = "sp_subscriptions"
    __table_args__ = (
        Index("idx_sp_subscription_user_id", "user_id"),
        Index("idx_sp_subscription_status", "status"),
        Index("idx_sp_subscription_stripe_id", "stripe_subscription_id"),
    )

    # ID
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)

    # 関連ID
    user_id: str = Field(foreign_key="users.id", description="ユーザーID")

    # サブスクリプション情報
    subscription_type: SPSubscriptionType = Field(
        sa_column=Column(SQLEnum(SPSubscriptionType)), description="サブスクリプションタイプ"
    )
    status: SubscriptionStatus = Field(
        sa_column=Column(SQLEnum(SubscriptionStatus), default=SubscriptionStatus.PENDING),
        default=SubscriptionStatus.PENDING,
        description="ステータス",
    )

    # 期間情報
    started_at: Optional[datetime] = Field(default=None, description="開始日時")
    expires_at: Optional[datetime] = Field(default=None, description="有効期限")
    cancelled_at: Optional[datetime] = Field(default=None, description="キャンセル日時")

    # Stripe情報
    stripe_subscription_id: Optional[str] = Field(default=None, description="StripeサブスクリプションID")
    stripe_customer_id: Optional[str] = Field(default=None, description="Stripe顧客ID")
    stripe_payment_method_id: Optional[str] = Field(default=None, description="Stripe決済方法ID")

    # 価格情報
    price: int = Field(description="月額料金（円）")
    currency: str = Field(default="jpy", description="通貨")

    # 自動更新
    auto_renew: bool = Field(default=True, description="自動更新フラグ")
    next_billing_date: Optional[datetime] = Field(default=None, description="次回請求日")

    # 試用期間
    trial_end: Optional[datetime] = Field(default=None, description="試用期間終了日")

    # メタデータ
    extra_data: dict = Field(default_factory=dict, sa_column=Column(JSON), description="追加情報")

    # タイムスタンプ
    created_at: datetime = Field(default_factory=datetime.utcnow, description="作成日時")
    updated_at: datetime = Field(default_factory=datetime.utcnow, description="更新日時")

    # リレーション
    user: Optional["User"] = Relationship(back_populates="sp_subscriptions")


class SubscriptionTransaction(SQLModel, table=True):
    """サブスクリプション取引履歴"""

    __tablename__ = "subscription_transactions"
    __table_args__ = (
        Index("idx_subscription_transaction_subscription_id", "subscription_id"),
        Index("idx_subscription_transaction_type", "transaction_type"),
    )

    # ID
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)

    # 関連ID
    subscription_id: str = Field(foreign_key="sp_subscriptions.id", description="サブスクリプションID")

    # 取引情報
    transaction_type: str = Field(description="取引タイプ（purchase/renewal/cancel/refund）")
    amount: int = Field(description="金額（円）")
    currency: str = Field(default="jpy", description="通貨")

    # Stripe情報
    stripe_payment_intent_id: Optional[str] = Field(default=None, description="Stripe決済インテントID")
    stripe_invoice_id: Optional[str] = Field(default=None, description="Stripe請求書ID")

    # ステータス
    status: str = Field(default="pending", description="取引ステータス")
    error_message: Optional[str] = Field(default=None, description="エラーメッセージ")

    # メタデータ
    extra_data: dict = Field(default_factory=dict, sa_column=Column(JSON), description="追加情報")

    # タイムスタンプ
    created_at: datetime = Field(default_factory=datetime.utcnow, description="作成日時")
    updated_at: datetime = Field(default_factory=datetime.utcnow, description="更新日時")

    # リレーション
    subscription: Optional[SPSubscription] = Relationship()
