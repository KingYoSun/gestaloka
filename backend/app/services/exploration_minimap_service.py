"""
ミニマップ機能用のサービス層
"""

from datetime import datetime
from uuid import UUID

from sqlmodel import Session, and_, select

from app.models.character import Character
from app.models.exploration_progress import CharacterExplorationProgress
from app.models.location import CharacterLocationHistory, Location, LocationConnection
from app.schemas.exploration_minimap import (
    CurrentLocation,
    ExplorationProgressInDB,
    LayerData,
    LocationHistory,
    MapConnection,
    MapDataResponse,
    MapLocation,
    UpdateProgressRequest,
)


class ExplorationMinimapService:
    """ミニマップ機能のサービスクラス"""

    def __init__(self, db: Session):
        self.db = db

    async def get_map_data(self, character_id: str) -> MapDataResponse:
        """キャラクターのマップデータを取得"""
        # キャラクター情報を取得
        character = self.db.exec(select(Character).where(Character.id == character_id)).first()

        if not character:
            raise ValueError(f"Character {character_id} not found")

        # 探索進捗を取得
        exploration_progress = self.db.exec(
            select(CharacterExplorationProgress).where(CharacterExplorationProgress.character_id == character_id)
        ).all()

        # 探索済みの場所IDセット
        # explored_location_ids = {ep.location_id for ep in exploration_progress}

        # 全ての発見済み場所を取得
        discovered_locations = self.db.exec(select(Location).where(Location.is_discovered)).all()

        # 階層別にデータを整理
        layers_dict: dict[int, LayerData] = {}

        for location in discovered_locations:
            if location.hierarchy_level not in layers_dict:
                layers_dict[location.hierarchy_level] = LayerData(
                    layer=location.hierarchy_level,
                    name=self._get_layer_name(location.hierarchy_level),
                    locations=[],
                    connections=[],
                    exploration_progress=[],
                )

            # 探索進捗を取得
            progress = next((ep for ep in exploration_progress if ep.location_id == location.id), None)

            # マップ上の場所情報を作成
            if location.id is not None:  # id が None でないことを確認
                map_location = MapLocation(
                    id=location.id,
                    name=location.name,
                    coordinates={"x": location.x_coordinate, "y": location.y_coordinate},
                    type=location.location_type,
                    danger_level=location.danger_level,
                    is_discovered=True,
                    exploration_percentage=progress.exploration_percentage if progress else 0,
                    last_visited=progress.updated_at if progress else None,
                )
            else:
                continue

            layers_dict[location.hierarchy_level].locations.append(map_location)

            if progress:
                layers_dict[location.hierarchy_level].exploration_progress.append(
                    ExplorationProgressInDB.from_orm(progress)
                )

        # 接続情報を取得
        discovered_location_ids = {loc.id for loc in discovered_locations}
        connections = self.db.exec(
            select(LocationConnection).where(
                and_(
                    LocationConnection.from_location_id.in_(list(discovered_location_ids)),  # type: ignore
                    ~LocationConnection.is_blocked,
                )
            )
        ).all()

        for conn in connections:
            # 接続先も発見済みの場合のみ表示
            if conn.to_location_id in discovered_location_ids:
                layer = conn.from_location.hierarchy_level
                if layer in layers_dict and conn.id is not None:
                    map_connection = MapConnection(
                        id=conn.id,
                        from_location_id=conn.from_location_id,
                        to_location_id=conn.to_location_id,
                        path_type=conn.path_type,
                        is_one_way=conn.is_one_way,
                        is_discovered=True,
                        sp_cost=self._calculate_sp_cost(conn),
                        path_metadata=conn.path_metadata or {},
                    )
                    layers_dict[layer].connections.append(map_connection)

        # 移動履歴を取得
        character_trail = await self._get_character_trail(character_id, limit=10)

        # 現在地情報
        current_location = None
        if character.location_id:
            current_loc = next((loc for loc in discovered_locations if loc.id == character.location_id), None)
            if current_loc and current_loc.id is not None:
                current_location = CurrentLocation(
                    id=current_loc.id,
                    layer=current_loc.hierarchy_level,
                    coordinates={"x": current_loc.x_coordinate, "y": current_loc.y_coordinate},
                )

        return MapDataResponse(
            layers=list(layers_dict.values()), character_trail=character_trail, current_location=current_location
        )

    async def update_exploration_progress(
        self, character_id: str, request: UpdateProgressRequest
    ) -> ExplorationProgressInDB:
        """探索進捗を更新"""
        # 既存の進捗を取得または作成
        progress = self.db.exec(
            select(CharacterExplorationProgress).where(
                and_(
                    CharacterExplorationProgress.character_id == character_id,
                    CharacterExplorationProgress.location_id == request.location_id,
                )
            )
        ).first()

        if not progress:
            # 新規作成
            progress = CharacterExplorationProgress(
                character_id=UUID(character_id),
                location_id=request.location_id,
                exploration_percentage=request.exploration_percentage,
                areas_explored=request.areas_explored,
                fog_revealed_at=datetime.utcnow(),
            )
            self.db.add(progress)
        else:
            # 更新
            progress.exploration_percentage = request.exploration_percentage
            progress.areas_explored = request.areas_explored
            progress.updated_at = datetime.utcnow()

            # 完全探索チェック
            if request.exploration_percentage >= 100 and not progress.fully_explored_at:
                progress.fully_explored_at = datetime.utcnow()

        self.db.commit()
        self.db.refresh(progress)

        return ExplorationProgressInDB.from_orm(progress)

    async def _get_character_trail(self, character_id: str, limit: int = 10) -> list[LocationHistory]:
        """キャラクターの移動履歴を取得"""
        history_records = self.db.exec(
            select(CharacterLocationHistory)
            .where(CharacterLocationHistory.character_id == character_id)
            .order_by(CharacterLocationHistory.arrived_at.desc())  # type: ignore
            .limit(limit)
        ).all()

        trail = []
        for record in history_records:
            if record.location:
                trail.append(
                    LocationHistory(
                        location_id=record.location_id,
                        timestamp=record.arrived_at,
                        layer=record.location.hierarchy_level,
                        coordinates={"x": record.location.x_coordinate, "y": record.location.y_coordinate},
                    )
                )

        return trail

    def _calculate_sp_cost(self, connection: LocationConnection) -> int:
        """接続のSPコストを計算"""
        base_cost = connection.base_sp_cost

        # 階層差によるコスト調整
        if connection.from_location and connection.to_location:
            level_diff = abs(connection.from_location.hierarchy_level - connection.to_location.hierarchy_level)
            base_cost += level_diff * 5

        # 危険度によるコスト調整
        if connection.to_location:
            danger_multiplier = {"safe": 1.0, "low": 1.2, "medium": 1.5, "high": 2.0, "extreme": 3.0}
            multiplier = danger_multiplier.get(connection.to_location.danger_level.value, 1.0)
            base_cost = int(base_cost * multiplier)

        return base_cost

    def _get_layer_name(self, layer: int) -> str:
        """階層番号から階層名を取得"""
        layer_names = {7: "天層", 6: "雲層", 5: "風層", 4: "霧層", 3: "土層", 2: "水層", 1: "火層"}
        return layer_names.get(layer, f"第{layer}層")
