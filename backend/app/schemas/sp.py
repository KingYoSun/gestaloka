"""
SPシステム関連のスキーマ定義
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.models.sp import (
    SPPurchasePackage,
    SPSubscriptionType,
    SPTransactionType,
)


class PlayerSPBase(BaseModel):
    """プレイヤーSP基本スキーマ"""

    current_sp: int = Field(ge=0, description="現在のSP残高")
    total_earned_sp: int = Field(ge=0, description="これまでに獲得した総SP")
    total_consumed_sp: int = Field(ge=0, description="これまでに消費した総SP")


class PlayerSPRead(PlayerSPBase):
    """プレイヤーSP読み取り用スキーマ"""

    id: str
    user_id: str
    total_purchased_sp: int
    total_purchase_amount: int
    active_subscription: Optional[SPSubscriptionType]
    subscription_expires_at: Optional[datetime]
    consecutive_login_days: int
    last_login_date: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PlayerSPSummary(BaseModel):
    """プレイヤーSP概要スキーマ（軽量版）"""

    current_sp: int
    active_subscription: Optional[SPSubscriptionType]
    subscription_expires_at: Optional[datetime]

    model_config = {"from_attributes": True}


class SPTransactionBase(BaseModel):
    """SP取引基本スキーマ"""

    transaction_type: SPTransactionType
    amount: int
    description: str


class SPTransactionCreate(SPTransactionBase):
    """SP取引作成用スキーマ（内部使用）"""

    player_sp_id: str
    user_id: str
    balance_before: int
    balance_after: int
    transaction_metadata: dict = Field(default_factory=dict)
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[str] = None
    purchase_package: Optional[SPPurchasePackage] = None
    purchase_amount: Optional[int] = None
    payment_method: Optional[str] = None
    payment_transaction_id: Optional[str] = None


class SPTransactionRead(SPTransactionBase):
    """SP取引読み取り用スキーマ"""

    id: str
    player_sp_id: str
    user_id: str
    balance_before: int
    balance_after: int
    transaction_metadata: dict
    related_entity_type: Optional[str]
    related_entity_id: Optional[str]
    purchase_package: Optional[SPPurchasePackage]
    purchase_amount: Optional[int]
    payment_method: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class SPConsumeRequest(BaseModel):
    """SP消費リクエストスキーマ"""

    amount: int = Field(gt=0, description="消費するSP量")
    transaction_type: SPTransactionType = Field(description="取引の種類")
    description: str = Field(description="取引の説明")
    related_entity_type: Optional[str] = Field(default=None, description="関連エンティティの種類")
    related_entity_id: Optional[str] = Field(default=None, description="関連エンティティのID")
    metadata: dict = Field(default_factory=dict, description="追加のメタデータ")


class SPConsumeResponse(BaseModel):
    """SP消費レスポンススキーマ"""

    success: bool
    transaction_id: str
    balance_before: int
    balance_after: int
    message: str


class SPPurchaseRequest(BaseModel):
    """SP購入リクエストスキーマ"""

    package: SPPurchasePackage
    payment_method: str
    payment_transaction_id: str


class SPPurchaseResponse(BaseModel):
    """SP購入レスポンススキーマ"""

    success: bool
    transaction_id: str
    amount_added: int
    balance_after: int
    purchase_amount: int


class SPTransactionFilter(BaseModel):
    """SP取引履歴フィルタースキーマ"""

    transaction_type: Optional[SPTransactionType] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[str] = None
    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


class SPDailyRecoveryResponse(BaseModel):
    """SP日次回復レスポンススキーマ"""

    success: bool
    recovered_amount: int
    login_bonus: int
    consecutive_days: int
    total_amount: int
    balance_after: int
    message: str
