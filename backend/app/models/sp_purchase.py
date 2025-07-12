"""SP購入モデル定義"""

import uuid
from datetime import datetime, UTC
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.user import User


class PurchaseStatus(str, Enum):
    """購入ステータス"""

    PENDING = "pending"  # 申請中
    PROCESSING = "processing"  # 処理中
    COMPLETED = "completed"  # 完了
    FAILED = "failed"  # 失敗
    CANCELLED = "cancelled"  # キャンセル
    REFUNDED = "refunded"  # 返金済み


class PaymentMode(str, Enum):
    """支払いモード"""

    TEST = "test"  # テストモード
    PRODUCTION = "production"  # 本番モード


class SPPurchase(SQLModel, table=True):
    """SP購入モデル"""

    __tablename__ = "sp_purchases"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True, index=True)
    user_id: str = Field(foreign_key="users.id", index=True)

    # 購入情報
    plan_id: str = Field(index=True)  # small, medium, large, xlarge
    sp_amount: int = Field(gt=0)
    price_jpy: int = Field(gt=0)  # 円単位

    # ステータス
    status: PurchaseStatus = Field(default=PurchaseStatus.PENDING)
    payment_mode: PaymentMode = Field(default=PaymentMode.TEST)

    # テストモード用
    test_reason: Optional[str] = Field(default=None, max_length=500)
    approved_by: Optional[str] = Field(default=None)
    approved_at: Optional[datetime] = Field(default=None)

    # 本番モード用（将来実装）
    stripe_payment_intent_id: Optional[str] = Field(default=None)
    stripe_checkout_session_id: Optional[str] = Field(default=None)

    # メタデータ
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    # リレーション
    user: Optional["User"] = Relationship(back_populates="sp_purchases")
