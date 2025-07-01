"""
探索システムAPIエンドポイント
"""

import json
import random
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, and_, col, select

from app.api.deps import get_current_active_user, get_user_character
from app.core.database import get_session as get_db
from app.models import (
    Character,
    CharacterLocationHistory,
    ExplorationArea,
    ExplorationLog,
    Location,
    LocationConnection,
    LogFragmentRarity,
    SPTransactionType,
)
from app.schemas.exploration import (
    AvailableLocationsResponse,
    ExplorationAreaResponse,
    ExploreRequest,
    ExploreResponse,
    LocationConnectionResponse,
    LocationResponse,
    MoveRequest,
    MoveResponse,
)
from app.schemas.exploration_minimap import (
    ExplorationProgressInDB,
    MapDataResponse,
    UpdateProgressRequest,
)
from app.schemas.user import User
from app.services.exploration_minimap_service import ExplorationMinimapService
from app.services.log_fragment_service import LogFragmentService
from app.services.sp_service import SPService

router = APIRouter()


@router.get("/locations", response_model=list[LocationResponse])
async def get_all_locations(
    *, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)
) -> list[LocationResponse]:
    """全ての発見済み場所を取得"""
    locations = db.exec(select(Location).where(Location.is_discovered)).all()

    return [LocationResponse.model_validate(location) for location in locations]


@router.get("/{character_id}/current-location", response_model=LocationResponse)
async def get_current_location(
    *, db: Session = Depends(get_db), current_character: Character = Depends(get_user_character)
) -> LocationResponse:
    """現在地の情報を取得"""
    if not current_character.location_id:
        # 後方互換性: location_idがない場合はデフォルトの開始地点を設定
        starting_location = db.exec(select(Location).where(Location.is_starting_location)).first()

        if not starting_location:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Starting location not found")

        current_character.location_id = starting_location.id
        db.add(current_character)
        db.commit()
        db.refresh(current_character)

    location = db.get(Location, current_character.location_id)
    if not location:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Current location not found")

    return LocationResponse.model_validate(location)


@router.get("/{character_id}/available-locations", response_model=AvailableLocationsResponse)
async def get_available_locations(
    *, db: Session = Depends(get_db), current_character: Character = Depends(get_user_character)
) -> AvailableLocationsResponse:
    """現在地から移動可能な場所を取得"""
    if not current_character.location_id:
        # 現在地が設定されていない場合は先に設定
        await get_current_location(db=db, current_character=current_character)

    # 現在地情報
    current_location = db.get(Location, current_character.location_id)

    # 移動可能な場所を取得
    connections = db.exec(
        select(LocationConnection).where(
            and_(
                col(LocationConnection.from_location_id) == current_character.location_id,
                col(LocationConnection.is_blocked).is_(False),
            )
        )
    ).all()

    available_locations = []
    for conn in connections:
        # レベル制限チェック
        if current_character.stats and current_character.stats.level >= conn.min_level_required:
            to_location = db.get(Location, conn.to_location_id)
            if to_location and to_location.is_discovered:
                # SP消費計算
                sp_cost = calculate_movement_sp_cost(
                    conn.base_sp_cost, to_location.hierarchy_level, to_location.danger_level
                )

                if conn.id is not None:
                    available_locations.append(
                        LocationConnectionResponse(
                            connection_id=conn.id,
                            to_location=LocationResponse.model_validate(to_location),
                            sp_cost=sp_cost,
                            distance=conn.distance,
                            min_level_required=conn.min_level_required,
                            travel_description=conn.travel_description,
                        )
                    )

    return AvailableLocationsResponse(
        current_location=LocationResponse.model_validate(current_location), available_locations=available_locations
    )


@router.post("/{character_id}/move", response_model=MoveResponse)
async def move_to_location(
    *,
    db: Session = Depends(get_db),
    current_character: Character = Depends(get_user_character),
    move_request: MoveRequest,
) -> MoveResponse:
    """別の場所へ移動"""
    # 接続情報を取得
    connection = db.get(LocationConnection, move_request.connection_id)
    if not connection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid connection")

    # 現在地確認
    if connection.from_location_id != current_character.location_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot move from current location")

    # レベル制限確認
    if current_character.stats and current_character.stats.level < connection.min_level_required:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=f"Level {connection.min_level_required} required"
        )

    # 移動先の場所を取得
    to_location = db.get(Location, connection.to_location_id)
    if not to_location:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Destination not found")

    # SP消費計算
    sp_cost = calculate_movement_sp_cost(connection.base_sp_cost, to_location.hierarchy_level, to_location.danger_level)

    # SP確認と消費
    sp_service = SPService(db)
    player_sp = await sp_service.get_or_create_player_sp(current_character.user_id)

    if player_sp.current_sp < sp_cost:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient SP. Required: {sp_cost}, Current: {player_sp.current_sp}",
        )

    # SP消費
    if sp_cost > 0:
        await sp_service.consume_sp(
            user_id=current_character.user_id,
            amount=sp_cost,
            transaction_type=SPTransactionType.MOVEMENT,
            description=f"Movement to {to_location.name}",
        )

    # 移動履歴を更新
    # 現在地の履歴を終了
    current_history = db.exec(
        select(CharacterLocationHistory).where(
            and_(
                col(CharacterLocationHistory.character_id) == current_character.id,
                col(CharacterLocationHistory.location_id) == current_character.location_id,
                col(CharacterLocationHistory.departed_at).is_(None),
            )
        )
    ).first()

    if current_history:
        current_history.departed_at = datetime.utcnow()
        db.add(current_history)

    # 新しい履歴を作成
    new_history = CharacterLocationHistory(
        character_id=current_character.id, location_id=to_location.id, sp_consumed=sp_cost
    )
    db.add(new_history)

    # キャラクターの現在地を更新
    current_character.location_id = to_location.id
    current_character.location = to_location.name  # 後方互換性
    current_character.updated_at = datetime.utcnow()
    db.add(current_character)

    db.commit()

    # 移動結果を返す
    return MoveResponse(
        success=True,
        new_location=LocationResponse.model_validate(to_location),
        sp_consumed=sp_cost,
        remaining_sp=player_sp.current_sp - sp_cost,
        travel_narrative=connection.travel_description or f"You traveled to {to_location.name}.",
    )


@router.get("/{character_id}/areas", response_model=list[ExplorationAreaResponse])
async def get_exploration_areas(
    *, db: Session = Depends(get_db), current_character: Character = Depends(get_user_character)
) -> list[ExplorationAreaResponse]:
    """現在地の探索可能エリアを取得"""
    if not current_character.location_id:
        await get_current_location(db=db, current_character=current_character)

    areas = db.exec(select(ExplorationArea).where(ExplorationArea.location_id == current_character.location_id)).all()

    return [ExplorationAreaResponse.model_validate(area) for area in areas]


@router.post("/{character_id}/explore", response_model=ExploreResponse)
async def explore_area(
    *,
    db: Session = Depends(get_db),
    current_character: Character = Depends(get_user_character),
    explore_request: ExploreRequest,
) -> ExploreResponse:
    """エリアを探索"""
    # エリア情報取得
    area = db.get(ExplorationArea, explore_request.area_id)
    if not area:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Area not found")

    # 現在地確認
    if area.location_id != current_character.location_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Area not in current location")

    # SP確認と消費
    sp_service = SPService(db)
    player_sp = await sp_service.get_or_create_player_sp(current_character.user_id)

    if player_sp.current_sp < area.exploration_sp_cost:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient SP. Required: {area.exploration_sp_cost}, Current: {player_sp.current_sp}",
        )

    # SP消費
    if area.exploration_sp_cost > 0:
        await sp_service.consume_sp(
            user_id=current_character.user_id,
            amount=area.exploration_sp_cost,
            transaction_type=SPTransactionType.EXPLORATION,
            description=f"Exploration of {area.name}",
        )

    # 探索実行
    fragments_found = []
    encounters = 0
    narrative_events = []

    # ログフラグメント発見判定
    location = db.get(Location, area.location_id)
    if location and random.randint(1, 100) <= location.fragment_discovery_rate:
        # フラグメント発見数を決定
        num_fragments = random.randint(1, area.max_fragments_per_exploration)

        for _ in range(num_fragments):
            # レアリティ決定
            if random.randint(1, 100) <= area.rare_fragment_chance:
                rarity = random.choice([LogFragmentRarity.RARE, LogFragmentRarity.EPIC, LogFragmentRarity.LEGENDARY])
            else:
                rarity = random.choice([LogFragmentRarity.COMMON, LogFragmentRarity.UNCOMMON])

            # フラグメント生成（改善されたサービスを使用）
            fragment = LogFragmentService.generate_exploration_fragment(
                character_id=current_character.id, location=location, area=area, rarity=rarity
            )
            db.add(fragment)

            # レスポンス用のフラグメント情報
            fragment_info = {
                "keyword": fragment.keyword,
                "rarity": fragment.rarity,
                "description": fragment.backstory,
                "emotional_valence": fragment.emotional_valence,
                "keywords": fragment.keywords,
            }
            fragments_found.append(fragment_info)

            # レアリティに応じた発見演出
            rarity_descriptions = {
                LogFragmentRarity.COMMON: "かすかな",
                LogFragmentRarity.UNCOMMON: "鮮明な",
                LogFragmentRarity.RARE: "重要な",
                LogFragmentRarity.EPIC: "伝説的な",
                LogFragmentRarity.LEGENDARY: "世界を揺るがす",
            }

            rarity_desc = rarity_descriptions.get(rarity, "不思議な")
            narrative_events.append(
                f"あなたは{rarity_desc}記憶の断片を発見した: 『{fragment.keyword}』\n"
                f"{fragment.backstory}"
            )

    # 遭遇判定
    if random.randint(1, 100) <= area.encounter_rate:
        encounters = 1
        narrative_events.append("探索中、時空の歪みに遭遇した。幸い、直接的な接触は避けることができた。")

    # 探索ログ記録
    exploration_log = ExplorationLog(
        character_id=current_character.id,
        area_id=area.id,
        sp_consumed=area.exploration_sp_cost,
        fragments_found=len(fragments_found),
        encounters=encounters,
        result_details=json.dumps({"fragments": fragments_found, "narrative_events": narrative_events}),
    )
    db.add(exploration_log)

    db.commit()

    # 探索結果を返す
    return ExploreResponse(
        success=True,
        fragments_found=fragments_found,
        encounters=encounters,
        sp_consumed=area.exploration_sp_cost,
        remaining_sp=player_sp.current_sp - area.exploration_sp_cost,
        narrative="\n\n".join(narrative_events)
        if narrative_events
        else f"{area.name}を探索したが、特に何も見つからなかった。",
    )


def calculate_movement_sp_cost(base_cost: int, hierarchy_level: int, danger_level: str) -> int:
    """移動に必要なSPを計算"""
    # 基本コスト
    total_cost = base_cost

    # 階層深度による追加コスト
    if hierarchy_level > 1:
        total_cost += (hierarchy_level - 1) * 2

    # 危険度による追加コスト
    danger_multipliers = {"safe": 0, "low": 1, "medium": 3, "high": 5, "extreme": 10}

    total_cost += danger_multipliers.get(danger_level.lower(), 0)

    return max(0, total_cost)  # 負の値にならないように




@router.get("/{character_id}/map-data", response_model=MapDataResponse)
async def get_map_data(
    character_id: str,
    *,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    current_character: Character = Depends(get_user_character),
) -> MapDataResponse:
    """キャラクターのマップデータを取得（ミニマップ用）"""
    # 権限チェック
    if current_character.id != character_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only view your own map data")

    minimap_service = ExplorationMinimapService(db)
    return await minimap_service.get_map_data(character_id)


@router.post("/{character_id}/update-progress", response_model=ExplorationProgressInDB)
async def update_exploration_progress(
    character_id: str,
    request: UpdateProgressRequest,
    *,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    current_character: Character = Depends(get_user_character),
) -> ExplorationProgressInDB:
    """探索進捗を更新"""
    # 権限チェック
    if current_character.id != character_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You can only update your own exploration progress"
        )

    minimap_service = ExplorationMinimapService(db)
    return await minimap_service.update_exploration_progress(character_id, request)
