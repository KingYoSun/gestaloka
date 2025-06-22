"""
ログ派遣システムのスキーマ定義
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.models.log_dispatch import DispatchObjectiveType, DispatchStatus


class DispatchBase(BaseModel):
    """派遣の基本情報"""
    
    completed_log_id: str = Field(description="派遣する完成ログのID")
    dispatcher_id: str = Field(description="派遣するキャラクターのID")
    objective_type: DispatchObjectiveType = Field(description="派遣目的")
    objective_detail: str = Field(description="具体的な目的の説明", min_length=10, max_length=500)
    initial_location: str = Field(description="初期スポーン地点", min_length=1, max_length=100)
    dispatch_duration_days: int = Field(description="派遣期間（日）", ge=1, le=30)


class DispatchCreate(DispatchBase):
    """派遣作成時の入力"""
    
    pass


class DispatchRead(DispatchBase):
    """派遣情報の読み取り"""
    
    id: str
    sp_cost: int = Field(description="消費SP")
    status: DispatchStatus = Field(description="派遣ステータス")
    
    # 活動概要
    travel_log: list[dict] = Field(description="時系列の活動記録")
    collected_items: list[dict] = Field(description="収集したアイテム")
    discovered_locations: list[str] = Field(description="発見した場所")
    
    # 成果
    sp_refund_amount: int = Field(description="SP還元量")
    achievement_score: float = Field(description="達成度スコア（0.0-1.0）")
    
    # タイムスタンプ
    created_at: datetime
    dispatched_at: Optional[datetime]
    expected_return_at: Optional[datetime]
    actual_return_at: Optional[datetime]
    
    class Config:
        from_attributes = True


class DispatchEncounterRead(BaseModel):
    """遭遇記録の読み取り"""
    
    id: str
    dispatch_id: str
    
    # 遭遇相手
    encountered_character_id: Optional[str]
    encountered_npc_name: Optional[str]
    
    # 遭遇内容
    location: str
    interaction_type: str
    interaction_summary: str
    outcome: str
    
    # 影響
    relationship_change: float
    items_exchanged: list[str]
    
    # タイムスタンプ
    occurred_at: datetime
    
    class Config:
        from_attributes = True


class DispatchWithEncounters(DispatchRead):
    """遭遇記録を含む派遣情報"""
    
    encounters: list[DispatchEncounterRead] = Field(description="遭遇記録一覧")


class DispatchReportRead(BaseModel):
    """派遣報告書の読み取り"""
    
    id: str
    dispatch_id: str
    
    # 活動概要
    total_distance_traveled: int
    total_encounters: int
    total_items_collected: int
    total_locations_discovered: int
    
    # 評価
    objective_completion_rate: float
    memorable_moments: list[dict]
    
    # ログの成長
    personality_changes: list[str]
    new_skills_learned: list[str]
    
    # 物語
    narrative_summary: str
    epilogue: Optional[str]
    
    # タイムスタンプ
    created_at: datetime
    
    class Config:
        from_attributes = True


class SPBalanceRead(BaseModel):
    """SP残高情報"""
    
    current_sp: int = Field(description="現在のSP")
    daily_recovery_amount: int = Field(description="日次回復量")
    monthly_pass_active: bool = Field(description="月額パス有効")
    last_recovery_at: Optional[datetime] = Field(description="最後の日次回復日時")
    
    class Config:
        from_attributes = True