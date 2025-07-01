"""
探索ミニマップ機能のテスト
"""

import pytest
from datetime import datetime
from sqlmodel import Session
from app.models.character import Character
from app.models.location import Location, LocationConnection, LocationType, DangerLevel, PathType
from app.models.exploration_progress import CharacterExplorationProgress
from app.services.exploration_minimap_service import ExplorationMinimapService
from app.schemas.exploration_minimap import UpdateProgressRequest
from app.models.user import User


@pytest.fixture
def test_user(session: Session):
    """テスト用ユーザー作成"""
    import uuid
    user = User(
        id=str(uuid.uuid4()),
        username="testuser",
        email="test@example.com",
        hashed_password="dummy_hash",
        is_active=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@pytest.fixture
def exploration_minimap_service(session: Session):
    """ExplorationMinimapServiceのフィクスチャ"""
    return ExplorationMinimapService(session)


@pytest.fixture
def test_locations(session: Session):
    """テスト用の場所データ作成"""
    locations = []
    
    # 開始地点（第1層）
    location1 = Location(
        name="火層の入口",
        description="冒険の始まりの地",
        location_type=LocationType.TOWN,
        hierarchy_level=1,
        danger_level=DangerLevel.SAFE,
        x_coordinate=0,
        y_coordinate=0,
        has_inn=True,
        has_shop=True,
        is_starting_location=True,
        is_discovered=True,
    )
    session.add(location1)
    locations.append(location1)
    
    # 第1層の別の場所
    location2 = Location(
        name="火層の洞窟",
        description="灼熱の洞窟",
        location_type=LocationType.DUNGEON,
        hierarchy_level=1,
        danger_level=DangerLevel.MEDIUM,
        x_coordinate=100,
        y_coordinate=50,
        is_discovered=True,
    )
    session.add(location2)
    locations.append(location2)
    
    # 第2層の場所
    location3 = Location(
        name="水層の湖畔",
        description="静かな湖畔の町",
        location_type=LocationType.TOWN,
        hierarchy_level=2,
        danger_level=DangerLevel.LOW,
        x_coordinate=150,
        y_coordinate=200,
        is_discovered=True,
    )
    session.add(location3)
    locations.append(location3)
    
    session.commit()
    for loc in locations:
        session.refresh(loc)
    
    # 接続を作成
    connection1 = LocationConnection(
        from_location_id=location1.id,
        to_location_id=location2.id,
        base_sp_cost=10,
        distance=1,
        path_type=PathType.DIRECT,
    )
    session.add(connection1)
    
    connection2 = LocationConnection(
        from_location_id=location2.id,
        to_location_id=location3.id,
        base_sp_cost=20,
        distance=2,
        path_type=PathType.STAIRS,
        min_level_required=5,
    )
    session.add(connection2)
    
    session.commit()
    
    return locations


@pytest.fixture
def test_character_with_progress(session: Session, test_user, test_locations):
    """探索進捗付きのテストキャラクター作成"""
    import uuid
    character = Character(
        id=str(uuid.uuid4()),
        user_id=test_user.id,
        name="Test Explorer",
        description="A test explorer",
        personality="Curious",
        location_id=test_locations[0].id,
    )
    session.add(character)
    session.commit()
    session.refresh(character)
    
    # 探索進捗を追加
    progress1 = CharacterExplorationProgress(
        character_id=character.id,
        location_id=test_locations[0].id,
        exploration_percentage=100,
        areas_explored=["entrance", "inn", "shop"],
        fog_revealed_at=datetime.utcnow(),
        fully_explored_at=datetime.utcnow(),
    )
    session.add(progress1)
    
    progress2 = CharacterExplorationProgress(
        character_id=character.id,
        location_id=test_locations[1].id,
        exploration_percentage=50,
        areas_explored=["entrance", "first_chamber"],
        fog_revealed_at=datetime.utcnow(),
    )
    session.add(progress2)
    
    session.commit()
    
    return character


@pytest.mark.asyncio
async def test_get_map_data(exploration_minimap_service, test_character_with_progress, test_locations):
    """マップデータ取得のテスト"""
    character_id = str(test_character_with_progress.id)
    
    map_data = await exploration_minimap_service.get_map_data(character_id)
    
    # 基本構造の確認
    assert map_data is not None
    assert len(map_data.layers) > 0
    assert map_data.current_location is not None
    
    # 現在地の確認
    assert map_data.current_location.id == test_locations[0].id
    assert map_data.current_location.layer == 1
    assert map_data.current_location.coordinates["x"] == 0
    assert map_data.current_location.coordinates["y"] == 0
    
    # レイヤーデータの確認
    layer1 = next((layer for layer in map_data.layers if layer.layer == 1), None)
    assert layer1 is not None
    assert layer1.name == "火層"
    assert len(layer1.locations) >= 2
    assert len(layer1.connections) >= 1
    assert len(layer1.exploration_progress) >= 2
    
    # 探索進捗の確認
    location1_data = next((loc for loc in layer1.locations if loc.id == test_locations[0].id), None)
    assert location1_data is not None
    assert location1_data.exploration_percentage == 100
    assert location1_data.is_discovered is True
    
    location2_data = next((loc for loc in layer1.locations if loc.id == test_locations[1].id), None)
    assert location2_data is not None
    assert location2_data.exploration_percentage == 50


@pytest.mark.asyncio
async def test_update_exploration_progress_new(exploration_minimap_service, test_character_with_progress, test_locations):
    """新規探索進捗の更新テスト"""
    character_id = str(test_character_with_progress.id)
    
    # 第3の場所の探索進捗を新規作成
    request = UpdateProgressRequest(
        location_id=test_locations[2].id,
        exploration_percentage=30,
        areas_explored=["lakeside", "dock"],
    )
    
    progress = await exploration_minimap_service.update_exploration_progress(character_id, request)
    
    assert progress is not None
    assert str(progress.character_id) == character_id
    assert progress.location_id == test_locations[2].id
    assert progress.exploration_percentage == 30
    assert "lakeside" in progress.areas_explored
    assert "dock" in progress.areas_explored
    assert progress.fog_revealed_at is not None
    assert progress.fully_explored_at is None


@pytest.mark.asyncio
async def test_update_exploration_progress_existing(exploration_minimap_service, test_character_with_progress, test_locations):
    """既存探索進捗の更新テスト"""
    character_id = str(test_character_with_progress.id)
    
    # 既存の進捗を更新（50% -> 100%）
    request = UpdateProgressRequest(
        location_id=test_locations[1].id,
        exploration_percentage=100,
        areas_explored=["entrance", "first_chamber", "second_chamber", "boss_room"],
    )
    
    progress = await exploration_minimap_service.update_exploration_progress(character_id, request)
    
    assert progress is not None
    assert progress.exploration_percentage == 100
    assert len(progress.areas_explored) == 4
    assert progress.fully_explored_at is not None


@pytest.mark.asyncio
async def test_get_character_trail(exploration_minimap_service, test_character_with_progress, test_locations, session: Session):
    """キャラクターの移動履歴取得テスト"""
    from app.models.location import CharacterLocationHistory
    
    # 移動履歴を作成
    history1 = CharacterLocationHistory(
        character_id=test_character_with_progress.id,
        location_id=test_locations[0].id,
        arrived_at=datetime.utcnow(),
        sp_consumed=0,
    )
    session.add(history1)
    
    history2 = CharacterLocationHistory(
        character_id=test_character_with_progress.id,
        location_id=test_locations[1].id,
        arrived_at=datetime.utcnow(),
        sp_consumed=10,
    )
    session.add(history2)
    
    session.commit()
    
    # 移動履歴を取得
    character_id = str(test_character_with_progress.id)
    trail = await exploration_minimap_service._get_character_trail(character_id, limit=5)
    
    assert len(trail) == 2
    assert trail[0].location_id == test_locations[1].id  # 最新の履歴が最初
    assert trail[0].layer == 1
    assert trail[1].location_id == test_locations[0].id


@pytest.mark.asyncio
async def test_calculate_sp_cost(exploration_minimap_service, test_locations, session: Session):
    """SP消費計算のテスト"""
    # 階層間移動の接続
    connection = LocationConnection(
        from_location_id=test_locations[0].id,
        to_location_id=test_locations[2].id,
        base_sp_cost=15,
        from_location=test_locations[0],
        to_location=test_locations[2],
    )
    
    sp_cost = exploration_minimap_service._calculate_sp_cost(connection)
    
    # 基本コスト15 + 階層差1 * 5 = 20
    # 危険度LOW * 1.2 = 24
    assert sp_cost == 24


def test_get_layer_name(exploration_minimap_service):
    """階層名取得のテスト"""
    assert exploration_minimap_service._get_layer_name(1) == "火層"
    assert exploration_minimap_service._get_layer_name(2) == "水層"
    assert exploration_minimap_service._get_layer_name(3) == "土層"
    assert exploration_minimap_service._get_layer_name(4) == "霧層"
    assert exploration_minimap_service._get_layer_name(5) == "風層"
    assert exploration_minimap_service._get_layer_name(6) == "雲層"
    assert exploration_minimap_service._get_layer_name(7) == "天層"
    assert exploration_minimap_service._get_layer_name(8) == "第8層"  # 未定義の層