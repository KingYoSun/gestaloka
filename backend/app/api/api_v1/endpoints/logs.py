"""
ログシステムAPIエンドポイント

プレイヤーの行動履歴をログとして記録し、
完成ログの編纂・契約管理を行うエンドポイント群
"""

from datetime import datetime
from typing import Any, cast
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import desc
from sqlmodel import Session, and_, select

from app.api.deps import get_current_active_user
from app.core.database import get_session
from app.models.character import Character, GameSession
from app.models.log import (
    CompletedLog,
    CompletedLogStatus,
    CompletedLogSubFragment,
    EmotionalValence,
    LogFragment,
)
from app.schemas.log import (
    CompletedLogCreate,
    CompletedLogRead,
    CompletedLogUpdate,
    LogFragmentCreate,
    LogFragmentRead,
)
from app.schemas.user import User
from app.services.compilation_bonus import CompilationBonusService
from app.services.contamination_purification import ContaminationPurificationService
from app.services.sp_service import SPService

router = APIRouter()


@router.post("/fragments", response_model=LogFragmentRead)
async def create_log_fragment(
    *,
    db: Session = Depends(get_session),
    fragment_in: LogFragmentCreate,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    ログの欠片を作成

    重要な行動や決断から生成される記録の断片。
    GMのAIによって自動生成される。
    """
    # キャラクターの所有権確認
    character = db.exec(
        select(Character).where(Character.id == fragment_in.character_id, Character.user_id == current_user.id)
    ).first()

    if not character:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Character not found")

    # ゲームセッションの確認
    session_stmt = select(GameSession).where(
        and_(
            GameSession.id == fragment_in.session_id,
            GameSession.character_id == fragment_in.character_id,
            GameSession.is_active == True,  # noqa: E712
        )
    )
    result = db.exec(session_stmt)
    session = result.first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Active game session not found",
        )

    # ログフラグメント作成
    db_fragment = LogFragment(
        id=str(uuid4()),
        **fragment_in.model_dump(),
        created_at=datetime.utcnow(),
    )
    db.add(db_fragment)
    db.commit()
    db.refresh(db_fragment)

    return db_fragment


@router.get("/fragments/{character_id}", response_model=list[LogFragmentRead])
async def get_character_fragments(
    *,
    db: Session = Depends(get_session),
    character_id: str,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    キャラクターのログフラグメント一覧を取得
    """
    # キャラクターの所有権確認
    character = db.exec(
        select(Character).where(Character.id == character_id, Character.user_id == current_user.id)
    ).first()

    if not character:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Character not found")

    # フラグメント取得
    fragment_stmt = (
        select(LogFragment)
        .where(LogFragment.character_id == character_id)
        .order_by(desc(cast(Any, LogFragment.created_at)))
    )
    result = db.exec(fragment_stmt)
    fragments = result.all()

    return fragments


@router.post("/completed", response_model=CompletedLogRead)
async def create_completed_log(
    *,
    db: Session = Depends(get_session),
    log_in: CompletedLogCreate,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    完成ログを作成（ログフラグメントの編纂）

    複数のログフラグメントを組み合わせて、
    他プレイヤーの世界でNPCとして活動可能な完全な記録を作成。
    """
    # キャラクターの所有権確認
    character = db.exec(
        select(Character).where(Character.id == log_in.creator_id, Character.user_id == current_user.id)
    ).first()

    if not character:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Character not found")

    # コアフラグメントの確認
    core_stmt = select(LogFragment).where(
        and_(
            LogFragment.id == log_in.core_fragment_id,
            LogFragment.character_id == log_in.creator_id,
        )
    )
    result = db.exec(core_stmt)
    core_fragment = result.first()
    if not core_fragment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Core fragment not found",
        )

    # サブフラグメントの確認
    sub_fragments = []
    for sub_id in log_in.sub_fragment_ids:
        sub_stmt = select(LogFragment).where(
            and_(
                LogFragment.id == sub_id,
                LogFragment.character_id == log_in.creator_id,
            )
        )
        result = db.exec(sub_stmt)
        fragment = result.first()
        if not fragment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Sub fragment {sub_id} not found",
            )
        sub_fragments.append(fragment)

    # コンボボーナスサービスの初期化
    bonus_service = CompilationBonusService(db)
    sp_service = SPService(db)

    # 汚染度の計算（コンボボーナス適用前）
    all_fragments = [core_fragment, *sub_fragments]
    negative_count = sum(1 for f in all_fragments if f.emotional_valence == EmotionalValence.NEGATIVE)
    total_count = len(all_fragments)
    base_contamination_level = negative_count / total_count if total_count > 0 else 0.0

    # コンボボーナスの計算
    compilation_result = bonus_service.calculate_compilation_bonuses(
        core_fragment=core_fragment, sub_fragments=sub_fragments, character=character
    )

    # SP残高の確認
    player_sp = await sp_service.get_balance(character.user_id)
    if player_sp.current_sp < compilation_result.final_sp_cost:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient SP. Required: {compilation_result.final_sp_cost}, Current: {player_sp.current_sp}",
        )

    # SP消費
    from app.models.sp import SPTransactionType

    await sp_service.consume_sp(
        user_id=character.user_id,
        amount=compilation_result.final_sp_cost,
        transaction_type=SPTransactionType.LOG_DISPATCH,
        description=f"ログ編纂: {log_in.name}",
    )

    # 完成ログ作成
    db_log = CompletedLog(
        id=str(uuid4()),
        creator_id=log_in.creator_id,
        core_fragment_id=log_in.core_fragment_id,
        name=log_in.name,
        title=log_in.title,
        description=log_in.description,
        skills=log_in.skills,
        personality_traits=log_in.personality_traits,
        behavior_patterns=log_in.behavior_patterns,
        contamination_level=compilation_result.final_contamination,  # コンボボーナス適用後の汚染度
        status=CompletedLogStatus.DRAFT,
        created_at=datetime.utcnow(),
        compilation_metadata={
            "base_contamination": base_contamination_level,
            "power_multiplier": compilation_result.power_multiplier,
            "combo_bonuses": [
                {"type": bonus.bonus_type, "description": bonus.description, "value": bonus.value}
                for bonus in compilation_result.combo_bonuses
            ],
        },
    )
    db.add(db_log)

    # サブフラグメントの関連付け
    for i, fragment in enumerate(sub_fragments):
        sub_relation = CompletedLogSubFragment(
            completed_log_id=db_log.id,
            fragment_id=fragment.id,
            order=i,
        )
        db.add(sub_relation)

    # 特殊称号の付与
    if compilation_result.special_titles:
        bonus_service.apply_special_titles(character=character, titles=compilation_result.special_titles, db=db)

    db.commit()
    db.refresh(db_log)

    return db_log


@router.patch("/completed/{log_id}", response_model=CompletedLogRead)
async def update_completed_log(
    *,
    db: Session = Depends(get_session),
    log_id: str,
    log_in: CompletedLogUpdate,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    完成ログを更新
    """
    # 完成ログと所有権の確認
    stmt = (
        select(CompletedLog)
        .join(Character)
        .where(
            and_(
                CompletedLog.id == log_id,
                Character.user_id == current_user.id,
            )
        )
    )
    result = db.exec(stmt)
    db_log = result.first()
    if not db_log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Completed log not found",
        )

    # ステータスが編纂中でない場合は更新不可
    if db_log.status != CompletedLogStatus.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only update logs in draft status",
        )

    # 更新
    update_data = log_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_log, key, value)

    if log_in.status == CompletedLogStatus.COMPLETED:
        db_log.completed_at = datetime.utcnow()

    db.commit()
    db.refresh(db_log)

    return db_log


@router.get("/completed/{character_id}", response_model=list[CompletedLogRead])
async def get_character_completed_logs(
    *,
    db: Session = Depends(get_session),
    character_id: str,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    キャラクターの完成ログ一覧を取得
    """
    # キャラクターの所有権確認
    character = db.exec(
        select(Character).where(Character.id == character_id, Character.user_id == current_user.id)
    ).first()

    if not character:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Character not found")

    # 完成ログ取得
    log_stmt = (
        select(CompletedLog)
        .where(CompletedLog.creator_id == character_id)
        .order_by(desc(cast(Any, CompletedLog.created_at)))
    )
    result = db.exec(log_stmt)
    logs = result.all()

    return logs


@router.post("/completed/preview")
async def preview_compilation_cost(
    *,
    db: Session = Depends(get_session),
    preview_in: CompletedLogCreate,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    編纂コストとボーナスをプレビュー

    実際にSPを消費せずに、編纂時のコストとボーナスを確認できる
    """
    # キャラクターの所有権確認
    character = db.exec(
        select(Character).where(Character.id == preview_in.creator_id, Character.user_id == current_user.id)
    ).first()

    if not character:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Character not found")

    # コアフラグメントの確認
    core_stmt = select(LogFragment).where(
        and_(
            LogFragment.id == preview_in.core_fragment_id,
            LogFragment.character_id == preview_in.creator_id,
        )
    )
    result = db.exec(core_stmt)
    core_fragment = result.first()
    if not core_fragment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Core fragment not found",
        )

    # サブフラグメントの確認
    sub_fragments = []
    for sub_id in preview_in.sub_fragment_ids:
        sub_stmt = select(LogFragment).where(
            and_(
                LogFragment.id == sub_id,
                LogFragment.character_id == preview_in.creator_id,
            )
        )
        result = db.exec(sub_stmt)
        fragment = result.first()
        if not fragment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Sub fragment {sub_id} not found",
            )
        sub_fragments.append(fragment)

    # コンボボーナスサービスの初期化
    bonus_service = CompilationBonusService(db)
    sp_service = SPService(db)

    # コンボボーナスの計算
    compilation_result = bonus_service.calculate_compilation_bonuses(
        core_fragment=core_fragment, sub_fragments=sub_fragments, character=character
    )

    # 現在のSP残高を取得
    player_sp = await sp_service.get_balance(character.user_id)
    current_sp = player_sp.current_sp

    return {
        "base_sp_cost": compilation_result.base_sp_cost,
        "final_sp_cost": compilation_result.final_sp_cost,
        "current_sp": current_sp,
        "can_afford": current_sp >= compilation_result.final_sp_cost,
        "contamination_level": compilation_result.contamination_level,
        "final_contamination": compilation_result.final_contamination,
        "power_multiplier": compilation_result.power_multiplier,
        "combo_bonuses": [
            {"type": bonus.bonus_type, "description": bonus.description, "value": bonus.value, "title": bonus.title}
            for bonus in compilation_result.combo_bonuses
        ],
        "special_titles": compilation_result.special_titles,
    }


@router.post("/completed/{log_id}/purify")
async def purify_completed_log(
    *,
    db: Session = Depends(get_session),
    log_id: str,
    purification_items: list[str],
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    完成ログの汚染を浄化

    浄化アイテムとSPを消費して、ログの汚染度を下げる
    """
    # ログと所有権の確認
    stmt = (
        select(CompletedLog)
        .join(Character)
        .where(
            and_(
                CompletedLog.id == log_id,
                Character.user_id == current_user.id,
            )
        )
    )
    result = db.exec(stmt)
    db_log = result.first()
    if not db_log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Completed log not found",
        )

    # キャラクターの取得
    character = db.exec(select(Character).where(Character.id == db_log.creator_id)).first()

    # 浄化サービスの実行
    purification_service = ContaminationPurificationService(db)

    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found",
        )

    try:
        purification_result = await purification_service.purify_completed_log(
            log_id=log_id, character=character, purification_items=purification_items
        )

        return {
            "original_contamination": purification_result.original_contamination,
            "purified_contamination": purification_result.purified_contamination,
            "purification_rate": purification_result.purification_rate,
            "sp_cost": purification_result.sp_cost,
            "items_consumed": purification_result.items_consumed,
            "new_traits": purification_result.new_traits,
            "special_effects": purification_result.special_effects,
        }
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/fragments/create-purification-item")
async def create_purification_item_from_fragments(
    *,
    db: Session = Depends(get_session),
    fragment_ids: list[str],
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    フラグメントから浄化アイテムを作成

    ポジティブなフラグメントを組み合わせて浄化アイテムを生成
    """
    if len(fragment_ids) < 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least 3 fragments are required to create a purification item",
        )

    # フラグメントの取得と所有権確認
    fragments = []
    for frag_id in fragment_ids:
        stmt = (
            select(LogFragment)
            .join(Character)
            .where(and_(LogFragment.id == frag_id, Character.user_id == current_user.id))
        )
        fragment = db.exec(stmt).first()
        if not fragment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"Fragment {frag_id} not found or not owned by user"
            )
        fragments.append(fragment)

    # キャラクターの取得
    character = db.exec(select(Character).where(Character.id == fragments[0].character_id)).first()

    # 浄化アイテムの作成
    purification_service = ContaminationPurificationService(db)

    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found",
        )

    item = await purification_service.create_purification_item(character=character, fragments=fragments)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not enough positive fragments to create a purification item",
        )

    return {"item_name": item.name, "description": item.description, "rarity": item.rarity, "effects": item.effects}
