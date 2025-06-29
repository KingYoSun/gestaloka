"""SP購入スキーマ定義"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.core.sp_plans import SPPlan
from app.models.sp_purchase import PaymentMode, PurchaseStatus


class PurchaseRequest(BaseModel):
    """購入申請リクエスト"""

    plan_id: str = Field(..., description="購入するプランID")
    test_reason: Optional[str] = Field(None, min_length=10, max_length=500, description="テストモード時の申請理由")


class PurchaseResponse(BaseModel):
    """購入申請レスポンス"""

    purchase_id: str
    status: PurchaseStatus
    sp_amount: int
    price_jpy: int
    payment_mode: PaymentMode
    checkout_url: Optional[str] = None
    message: Optional[str] = None


class SPPlanResponse(BaseModel):
    """SPプラン一覧レスポンス"""

    plans: list[SPPlan]
    payment_mode: str
    currency: str = "JPY"


class SPPurchaseDetail(BaseModel):
    """SP購入詳細"""

    id: str
    plan_id: str
    sp_amount: int
    price_jpy: int
    status: PurchaseStatus
    payment_mode: PaymentMode
    test_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    approved_at: Optional[datetime] = None


class SPPurchaseList(BaseModel):
    """SP購入履歴リスト"""

    purchases: list[SPPurchaseDetail]
    total: int
    limit: int
    offset: int


class SPPurchaseStats(BaseModel):
    """SP購入統計"""

    total_purchases: int = Field(..., description="総購入回数")
    total_sp_purchased: int = Field(..., description="総購入SP")
    total_spent_jpy: int = Field(..., description="総支払額（円）")
