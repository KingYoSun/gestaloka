"""
場所（Location）関連のモデル定義
"""

from datetime import datetime
from enum import Enum
from typing import Optional, TYPE_CHECKING, Dict, Any

from sqlalchemy import Column, JSON
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.exploration_progress import CharacterExplorationProgress


class LocationType(str, Enum):
    """場所の種類"""

    CITY = "city"
    TOWN = "town"
    DUNGEON = "dungeon"
    WILD = "wild"
    SPECIAL = "special"


class DangerLevel(str, Enum):
    """危険度レベル"""

    SAFE = "safe"  # 安全
    LOW = "low"  # 低危険度
    MEDIUM = "medium"  # 中危険度
    HIGH = "high"  # 高危険度
    EXTREME = "extreme"  # 極度の危険


class Location(SQLModel, table=True):
    """場所モデル"""

    __tablename__ = "locations"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, description="場所名")
    description: str = Field(description="場所の説明")
    location_type: LocationType = Field(default=LocationType.TOWN, description="場所の種類")
    hierarchy_level: int = Field(default=1, ge=1, le=7, description="階層レベル（1-7）")
    danger_level: DangerLevel = Field(default=DangerLevel.SAFE, description="危険度")

    # ゲーム内座標（マップ表示用）
    x_coordinate: int = Field(default=0, description="X座標")
    y_coordinate: int = Field(default=0, description="Y座標")

    # 施設・サービス
    has_inn: bool = Field(default=False, description="宿屋の有無")
    has_shop: bool = Field(default=False, description="商店の有無")
    has_guild: bool = Field(default=False, description="ギルドの有無")

    # フラグメント発見率（0-100%）
    fragment_discovery_rate: int = Field(default=10, ge=0, le=100, description="ログフラグメント発見率")

    # 特別な属性
    is_starting_location: bool = Field(default=False, description="開始地点かどうか")
    is_discovered: bool = Field(default=True, description="発見済みかどうか")

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # リレーション
    connections_from: list["LocationConnection"] = Relationship(
        back_populates="from_location", sa_relationship_kwargs={"foreign_keys": "[LocationConnection.from_location_id]"}
    )
    connections_to: list["LocationConnection"] = Relationship(
        back_populates="to_location", sa_relationship_kwargs={"foreign_keys": "[LocationConnection.to_location_id]"}
    )
    exploration_areas: list["ExplorationArea"] = Relationship(back_populates="location")
    characters: list["Character"] = Relationship(back_populates="current_location")
    exploration_progress: list["CharacterExplorationProgress"] = Relationship(back_populates="location")


class PathType(str, Enum):
    """経路の種類"""

    DIRECT = "direct"  # 直線
    CURVED = "curved"  # 曲線
    TELEPORT = "teleport"  # テレポート
    STAIRS = "stairs"  # 階段
    ELEVATOR = "elevator"  # エレベーター


class LocationConnection(SQLModel, table=True):
    """場所間の接続情報"""

    __tablename__ = "location_connections"

    id: Optional[int] = Field(default=None, primary_key=True)
    from_location_id: int = Field(foreign_key="locations.id")
    to_location_id: int = Field(foreign_key="locations.id")

    # 移動コスト
    base_sp_cost: int = Field(default=0, ge=0, description="基本SP消費")
    distance: int = Field(default=1, ge=1, description="距離（移動にかかる時間の単位）")

    # 移動条件
    min_level_required: int = Field(default=1, ge=1, description="必要最小レベル")
    is_one_way: bool = Field(default=False, description="一方通行かどうか")
    is_blocked: bool = Field(default=False, description="通行不可かどうか")

    # 視覚的表現
    path_type: PathType = Field(default=PathType.DIRECT, description="経路の種類")
    path_metadata: Dict[str, Any] = Field(
        default_factory=dict, sa_column=Column("path_metadata", JSON, default={}), description="経路の視覚的メタデータ"
    )

    # 説明
    travel_description: Optional[str] = Field(default=None, description="移動時の説明文")

    created_at: datetime = Field(default_factory=datetime.utcnow)

    # リレーション
    from_location: Location = Relationship(
        back_populates="connections_from",
        sa_relationship_kwargs={"foreign_keys": "[LocationConnection.from_location_id]"},
    )
    to_location: Location = Relationship(
        back_populates="connections_to", sa_relationship_kwargs={"foreign_keys": "[LocationConnection.to_location_id]"}
    )


class ExplorationArea(SQLModel, table=True):
    """探索エリア"""

    __tablename__ = "exploration_areas"

    id: Optional[int] = Field(default=None, primary_key=True)
    location_id: int = Field(foreign_key="locations.id")
    name: str = Field(index=True, description="エリア名")
    description: str = Field(description="エリアの説明")

    # 探索難易度
    difficulty: int = Field(default=1, ge=1, le=10, description="探索難易度")
    exploration_sp_cost: int = Field(default=5, ge=0, description="探索に必要なSP")

    # 発見可能なもの
    max_fragments_per_exploration: int = Field(default=1, ge=0, description="一度の探索で発見可能な最大フラグメント数")
    rare_fragment_chance: int = Field(default=5, ge=0, le=100, description="レアフラグメント発見率")

    # 遭遇率
    encounter_rate: int = Field(default=20, ge=0, le=100, description="歪み遭遇率")

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # リレーション
    location: Location = Relationship(back_populates="exploration_areas")


class CharacterLocationHistory(SQLModel, table=True):
    """キャラクターの移動履歴"""

    __tablename__ = "character_location_history"

    id: Optional[int] = Field(default=None, primary_key=True)
    character_id: str = Field(foreign_key="characters.id", index=True)
    location_id: int = Field(foreign_key="locations.id")

    arrived_at: datetime = Field(default_factory=datetime.utcnow)
    departed_at: Optional[datetime] = Field(default=None)
    sp_consumed: int = Field(default=0, ge=0, description="移動で消費したSP")

    # リレーション
    character: "Character" = Relationship()
    location: Location = Relationship()


class ExplorationLog(SQLModel, table=True):
    """探索ログ"""

    __tablename__ = "exploration_logs"

    id: Optional[int] = Field(default=None, primary_key=True)
    character_id: str = Field(foreign_key="characters.id", index=True)
    area_id: int = Field(foreign_key="exploration_areas.id")

    explored_at: datetime = Field(default_factory=datetime.utcnow)
    sp_consumed: int = Field(default=0, ge=0)
    fragments_found: int = Field(default=0, ge=0)
    encounters: int = Field(default=0, ge=0)

    # 探索結果の詳細（JSON形式で保存）
    result_details: Optional[str] = Field(default=None)

    # リレーション
    character: "Character" = Relationship()
    area: ExplorationArea = Relationship()


# Characterモデルへの参照を追加するための型アノテーション
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .character import Character
