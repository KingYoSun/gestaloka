"""
ミニマップ機能用のスキーマ定義
"""

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.location import DangerLevel, LocationType, PathType


class ExplorationProgressBase(BaseModel):
    """探索進捗の基本スキーマ"""

    location_id: int
    exploration_percentage: int = Field(ge=0, le=100)
    areas_explored: list[str] = []


class ExplorationProgressCreate(ExplorationProgressBase):
    """探索進捗作成スキーマ"""

    pass


class ExplorationProgressUpdate(BaseModel):
    """探索進捗更新スキーマ"""

    exploration_percentage: Optional[int] = Field(None, ge=0, le=100)
    areas_explored: Optional[list[str]] = None


class ExplorationProgressInDB(ExplorationProgressBase):
    """探索進捗DBスキーマ"""

    id: UUID
    character_id: UUID
    fog_revealed_at: Optional[datetime]
    fully_explored_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MapLocation(BaseModel):
    """マップ上の場所情報"""

    id: int
    name: str
    coordinates: dict[str, int] = Field(description="x, y座標")
    type: LocationType
    danger_level: DangerLevel
    is_discovered: bool
    exploration_percentage: int = 0
    last_visited: Optional[datetime] = None


class MapConnection(BaseModel):
    """マップ上の接続情報"""

    id: int
    from_location_id: int
    to_location_id: int
    path_type: PathType
    is_one_way: bool
    is_discovered: bool
    sp_cost: int
    path_metadata: dict[str, Any] = Field(default_factory=dict)


class LayerData(BaseModel):
    """階層別のマップデータ"""

    layer: int
    name: str
    locations: list[MapLocation]
    connections: list[MapConnection]
    exploration_progress: list[ExplorationProgressInDB]


class LocationHistory(BaseModel):
    """移動履歴"""

    location_id: int
    timestamp: datetime
    layer: int
    coordinates: dict[str, int]


class CurrentLocation(BaseModel):
    """現在地情報"""

    id: int
    layer: int
    coordinates: dict[str, int]


class MapDataResponse(BaseModel):
    """マップデータレスポンス"""

    layers: list[LayerData]
    character_trail: list[LocationHistory]
    current_location: Optional[CurrentLocation]


class UpdateProgressRequest(BaseModel):
    """探索進捗更新リクエスト"""

    location_id: int
    exploration_percentage: int = Field(ge=0, le=100)
    areas_explored: list[str]
