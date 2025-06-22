"""
探索システムAPIエンドポイント
"""

import json
import random
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, and_, select

from app.api.deps import get_current_active_user, get_user_character
from app.core.database import get_session as get_db
from app.models import (
    Character,
    CharacterLocationHistory,
    EmotionalValence,
    ExplorationArea,
    ExplorationLog,
    Location,
    LocationConnection,
    LogFragment,
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
from app.schemas.user import User
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
                LocationConnection.from_location_id == current_character.location_id,
                ~LocationConnection.is_blocked,
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
                CharacterLocationHistory.character_id == current_character.id,
                CharacterLocationHistory.location_id == current_character.location_id,
                CharacterLocationHistory.departed_at.is_(None),
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

            # フラグメント生成
            fragment = generate_exploration_fragment(
                character_id=current_character.id, location=location, area=area, rarity=rarity
            )
            db.add(fragment)
            fragments_found.append(
                {"keyword": fragment.keyword, "rarity": fragment.rarity, "description": fragment.backstory}
            )

            narrative_events.append(f"You discovered a {fragment.rarity.lower()} memory fragment: '{fragment.keyword}'")

    # 遭遇判定
    if random.randint(1, 100) <= area.encounter_rate:
        encounters = 1
        narrative_events.append("You encountered a distortion in the area, but managed to avoid direct confrontation.")

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
        narrative="\n".join(narrative_events)
        if narrative_events
        else f"You explored {area.name} but found nothing of interest.",
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


def generate_exploration_fragment(
    character_id: str, location: Location, area: ExplorationArea, rarity: LogFragmentRarity
) -> LogFragment:
    """探索で発見されるログフラグメントを生成"""
    # 場所とエリアに基づくキーワード候補
    location_keywords = {
        "city": ["urban_memory", "crowded_streets", "merchant_tale"],
        "town": ["village_life", "local_legend", "simple_times"],
        "dungeon": ["ancient_secret", "trapped_soul", "lost_treasure"],
        "wild": ["nature_spirit", "survival_story", "beast_encounter"],
        "special": ["unique_phenomenon", "temporal_anomaly", "reality_shift"],
    }

    danger_keywords = {
        "safe": ["peaceful_moment", "childhood_memory", "happy_reunion"],
        "low": ["minor_conflict", "small_adventure", "daily_struggle"],
        "medium": ["dangerous_encounter", "narrow_escape", "battle_scar"],
        "high": ["heroic_deed", "desperate_fight", "sacrifice"],
        "extreme": ["legendary_battle", "world_changing_event", "ultimate_truth"],
    }

    # キーワード選択
    keywords = location_keywords.get(location.location_type.value, ["mysterious_memory"])
    keywords.extend(danger_keywords.get(location.danger_level.value, ["unknown_experience"]))

    keyword = random.choice(keywords)

    # 感情価決定
    if location.danger_level.value in ["safe", "low"]:
        valence = random.choice([EmotionalValence.POSITIVE, EmotionalValence.NEUTRAL])
    elif location.danger_level.value in ["high", "extreme"]:
        valence = random.choice([EmotionalValence.NEGATIVE, EmotionalValence.MIXED])
    else:
        valence = random.choice(list(EmotionalValence))

    # バックストーリー生成
    backstories = {
        LogFragmentRarity.COMMON: f"A faint memory from {location.name}, barely visible in the mists of time.",
        LogFragmentRarity.UNCOMMON: f"A clear recollection of events that transpired in {area.name}.",
        LogFragmentRarity.RARE: f"A vivid memory containing important knowledge about {location.name}.",
        LogFragmentRarity.EPIC: f"A powerful memory that resonates with the very essence of {area.name}.",
        LogFragmentRarity.LEGENDARY: f"An ancient memory that holds secrets of {location.name}'s true nature.",
    }

    backstory = backstories.get(rarity, "A mysterious memory fragment.")

    return LogFragment(
        character_id=character_id,
        keyword=keyword,
        emotional_valence=valence,
        rarity=rarity,
        backstory=backstory,
        discovered_at=location.name,
        source_action=f"Exploration of {area.name}",
    )
