"""
探索システム関連のスキーマ
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.models.location import DangerLevel, LocationType


class LocationBase(BaseModel):
    """場所の基本情報"""

    name: str = Field(..., description="場所名")
    description: str = Field(..., description="場所の説明")
    location_type: LocationType = Field(..., description="場所の種類")
    hierarchy_level: int = Field(..., ge=1, le=7, description="階層レベル")
    danger_level: DangerLevel = Field(..., description="危険度")


class LocationResponse(LocationBase):
    """場所情報のレスポンス"""

    id: int = Field(..., description="場所ID")
    x_coordinate: int = Field(..., description="X座標")
    y_coordinate: int = Field(..., description="Y座標")
    has_inn: bool = Field(..., description="宿屋の有無")
    has_shop: bool = Field(..., description="商店の有無")
    has_guild: bool = Field(..., description="ギルドの有無")
    fragment_discovery_rate: int = Field(..., description="ログフラグメント発見率")
    is_discovered: bool = Field(..., description="発見済みかどうか")

    class Config:
        from_attributes = True


class LocationConnectionResponse(BaseModel):
    """場所間接続情報のレスポンス"""

    connection_id: int = Field(..., description="接続ID")
    to_location: LocationResponse = Field(..., description="移動先の場所")
    sp_cost: int = Field(..., description="移動に必要なSP")
    distance: int = Field(..., description="距離")
    min_level_required: int = Field(..., description="必要最小レベル")
    travel_description: Optional[str] = Field(None, description="移動時の説明文")

    class Config:
        from_attributes = True


class AvailableLocationsResponse(BaseModel):
    """移動可能な場所のレスポンス"""

    current_location: LocationResponse = Field(..., description="現在地")
    available_locations: list[LocationConnectionResponse] = Field(..., description="移動可能な場所リスト")


class MoveRequest(BaseModel):
    """移動リクエスト"""

    connection_id: int = Field(..., description="使用する接続ID")


class MoveResponse(BaseModel):
    """移動レスポンス"""

    success: bool = Field(..., description="移動成功フラグ")
    new_location: LocationResponse = Field(..., description="新しい場所")
    sp_consumed: int = Field(..., description="消費したSP")
    remaining_sp: int = Field(..., description="残りSP")
    travel_narrative: str = Field(..., description="移動時の物語描写")


class ExplorationAreaResponse(BaseModel):
    """探索エリア情報のレスポンス"""

    id: int = Field(..., description="エリアID")
    name: str = Field(..., description="エリア名")
    description: str = Field(..., description="エリアの説明")
    difficulty: int = Field(..., ge=1, le=10, description="探索難易度")
    exploration_sp_cost: int = Field(..., description="探索に必要なSP")
    max_fragments_per_exploration: int = Field(..., description="一度の探索で発見可能な最大フラグメント数")
    rare_fragment_chance: int = Field(..., description="レアフラグメント発見率")
    encounter_rate: int = Field(..., description="歪み遭遇率")

    class Config:
        from_attributes = True


class ExploreRequest(BaseModel):
    """探索リクエスト"""

    area_id: int = Field(..., description="探索するエリアID")


class FragmentFoundResponse(BaseModel):
    """発見したフラグメント情報"""

    keyword: str = Field(..., description="キーワード")
    rarity: str = Field(..., description="レアリティ")
    description: str = Field(..., description="説明")


class ExploreResponse(BaseModel):
    """探索レスポンス"""

    success: bool = Field(..., description="探索成功フラグ")
    fragments_found: list[dict[str, Any]] = Field(..., description="発見したフラグメント")
    encounters: int = Field(..., description="遭遇数")
    sp_consumed: int = Field(..., description="消費したSP")
    remaining_sp: int = Field(..., description="残りSP")
    narrative: str = Field(..., description="探索結果の物語描写")


class LocationHistoryResponse(BaseModel):
    """移動履歴のレスポンス"""

    location: LocationResponse = Field(..., description="場所情報")
    arrived_at: datetime = Field(..., description="到着時刻")
    departed_at: Optional[datetime] = Field(None, description="出発時刻")
    sp_consumed: int = Field(..., description="消費したSP")

    class Config:
        from_attributes = True


class ExplorationStatsResponse(BaseModel):
    """探索統計のレスポンス"""

    total_explorations: int = Field(..., description="総探索回数")
    total_fragments_found: int = Field(..., description="総フラグメント発見数")
    total_encounters: int = Field(..., description="総遭遇数")
    total_sp_consumed: int = Field(..., description="総SP消費量")
    favorite_location: Optional[str] = Field(None, description="最も訪れた場所")
    rarest_fragment: Optional[str] = Field(None, description="最もレアなフラグメント")
