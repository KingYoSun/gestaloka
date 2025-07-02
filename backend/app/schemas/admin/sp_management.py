"""
Admin SP management schemas.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.models.sp import SPTransaction


class AdminSPAdjustment(BaseModel):
    """SP調整リクエスト"""
    user_id: int = Field(..., description="対象ユーザーID")
    amount: int = Field(..., description="調整量（正の値で付与、負の値で減算）")
    reason: Optional[str] = Field(None, description="調整理由")


class AdminSPAdjustmentResponse(BaseModel):
    """SP調整レスポンス"""
    user_id: int
    username: str
    previous_sp: int
    current_sp: int
    adjustment_amount: int
    reason: Optional[str]
    adjusted_by: str
    adjusted_at: datetime = Field(default_factory=datetime.utcnow)


class PlayerSPDetail(BaseModel):
    """プレイヤーSP詳細情報"""
    user_id: int
    username: str
    email: str
    current_sp: int
    total_earned: int
    total_consumed: int
    last_daily_recovery: Optional[datetime]
    consecutive_login_days: int
    created_at: datetime
    updated_at: datetime


class SPTransactionHistory(BaseModel):
    """SP取引履歴"""
    transactions: list[SPTransaction]
    total: int
    skip: int
    limit: int
