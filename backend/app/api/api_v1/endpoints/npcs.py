"""
NPCシステムAPIエンドポイント

ログNPCと永続NPCの管理・相互作用を行うエンドポイント群
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.api_v1.endpoints.auth import get_current_user
from app.core.database import get_session
from app.db.neo4j_models import NPC
from app.schemas.npc_schemas import NPCLocationUpdate, NPCProfile
from app.schemas.user import User
from app.services.npc_generator import NPCGenerator

router = APIRouter()


@router.get("/npcs", response_model=list[NPCProfile])
def list_npcs(
    *,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    location: Optional[str] = None,
    npc_type: Optional[str] = None,
    is_active: bool = True,
) -> Any:
    """
    NPCの一覧を取得

    フィルタリング:
    - location: 特定の場所にいるNPCのみ
    - npc_type: LOG_NPC, PERMANENT_NPC, TEMPORARY_NPC
    - is_active: アクティブなNPCのみ
    """
    npc_generator = NPCGenerator(db)

    if location:
        # 特定の場所のNPCを取得
        npcs = npc_generator.get_npcs_in_location(location)
    else:
        # 全NPCを取得（フィルタリングあり）
        query = NPC.nodes

        if npc_type:
            query = query.filter(npc_type=npc_type)
        if is_active is not None:
            query = query.filter(is_active=is_active)

        npcs = query.all()

    # NPCプロファイルに変換
    profiles = []
    for npc in npcs:
        # 現在の場所を取得
        current_location = None
        for rel in npc.current_location.all():
            if rel.is_current:
                current_location = rel.end_node().name
                break

        profile = NPCProfile(
            npc_id=npc.npc_id,
            name=npc.name,
            title=npc.title,
            npc_type=npc.npc_type,
            personality_traits=npc.personality_traits or [],
            behavior_patterns=npc.behavior_patterns or [],
            skills=npc.skills or [],
            appearance=npc.appearance,
            backstory=npc.backstory,
            original_player=npc.original_player,
            log_source=npc.log_source,
            contamination_level=npc.contamination_level,
            persistence_level=npc.persistence_level,
            current_location=current_location,
            is_active=npc.is_active,
        )
        profiles.append(profile)

    return profiles


@router.get("/npcs/{npc_id}", response_model=NPCProfile)
def get_npc(
    *,
    db: Session = Depends(get_session),
    npc_id: str,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    特定のNPCの詳細を取得
    """
    npc_generator = NPCGenerator(db)
    npc = npc_generator.get_npc_by_id(npc_id)

    if not npc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="NPC not found",
        )

    # 現在の場所を取得
    current_location = None
    for rel in npc.current_location.all():
        if rel.is_current:
            current_location = rel.end_node().name
            break

    return NPCProfile(
        npc_id=npc.npc_id,
        name=npc.name,
        title=npc.title,
        npc_type=npc.npc_type,
        personality_traits=npc.personality_traits or [],
        behavior_patterns=npc.behavior_patterns or [],
        skills=npc.skills or [],
        appearance=npc.appearance,
        backstory=npc.backstory,
        original_player=npc.original_player,
        log_source=npc.log_source,
        contamination_level=npc.contamination_level,
        persistence_level=npc.persistence_level,
        current_location=current_location,
        is_active=npc.is_active,
    )


@router.post("/npcs/{npc_id}/move", response_model=dict)
def move_npc(
    *,
    db: Session = Depends(get_session),
    npc_id: str,
    location_update: NPCLocationUpdate,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    NPCを別の場所に移動（GM権限が必要）
    """
    # TODO: GM権限チェック

    npc_generator = NPCGenerator(db)
    success = npc_generator.move_npc(npc_id, location_update.new_location)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="NPC not found",
        )

    return {
        "status": "success",
        "npc_id": npc_id,
        "new_location": location_update.new_location,
    }


@router.get("/locations/{location_name}/npcs", response_model=list[NPCProfile])
def get_npcs_in_location(
    *,
    db: Session = Depends(get_session),
    location_name: str,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    特定の場所にいるNPCの一覧を取得
    """
    npc_generator = NPCGenerator(db)
    npcs = npc_generator.get_npcs_in_location(location_name)

    profiles = []
    for npc in npcs:
        profile = NPCProfile(
            npc_id=npc.npc_id,
            name=npc.name,
            title=npc.title,
            npc_type=npc.npc_type,
            personality_traits=npc.personality_traits or [],
            behavior_patterns=npc.behavior_patterns or [],
            skills=npc.skills or [],
            appearance=npc.appearance,
            backstory=npc.backstory,
            original_player=npc.original_player,
            log_source=npc.log_source,
            contamination_level=npc.contamination_level,
            persistence_level=npc.persistence_level,
            current_location=location_name,
            is_active=npc.is_active,
        )
        profiles.append(profile)

    return profiles
