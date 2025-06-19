"""
ログシステムAPIエンドポイント

プレイヤーの行動履歴をログとして記録し、
完成ログの編纂・契約管理を行うエンドポイント群
"""

from datetime import datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, and_, select

from app.api.api_v1.endpoints.auth import get_current_user
from app.core.database import get_session
from app.models.character import Character, GameSession
from app.models.log import (
    CompletedLog,
    CompletedLogStatus,
    CompletedLogSubFragment,
    EmotionalValence,
    LogContract,
    LogContractStatus,
    LogFragment,
)
from app.schemas.log import (
    CompletedLogCreate,
    CompletedLogRead,
    CompletedLogUpdate,
    LogContractCreate,
    LogContractRead,
    LogFragmentCreate,
    LogFragmentRead,
)
from app.schemas.user import User
from app.tasks.log_tasks import generate_npc_from_completed_log

router = APIRouter()


@router.post("/fragments", response_model=LogFragmentRead)
def create_log_fragment(
    *,
    db: Session = Depends(get_session),
    fragment_in: LogFragmentCreate,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    ログの欠片を作成

    重要な行動や決断から生成される記録の断片。
    GMのAIによって自動生成される。
    """
    # キャラクターの所有権確認
    stmt = select(Character).where(
        and_(
            Character.id == fragment_in.character_id,
            Character.user_id == current_user.id,
        )
    )
    result = db.exec(stmt)
    character = result.first()
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found",
        )

    # ゲームセッションの確認
    session_stmt = select(GameSession).where(
        and_(
            GameSession.id == fragment_in.session_id,
            GameSession.character_id == fragment_in.character_id,
            GameSession.is_active.is_(True),
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
def get_character_fragments(
    *,
    db: Session = Depends(get_session),
    character_id: str,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    キャラクターのログフラグメント一覧を取得
    """
    # キャラクターの所有権確認
    stmt = select(Character).where(
        and_(
            Character.id == character_id,
            Character.user_id == current_user.id,
        )
    )
    result = db.exec(stmt)
    character = result.first()
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found",
        )

    # フラグメント取得
    fragment_stmt = (
        select(LogFragment).where(LogFragment.character_id == character_id).order_by(LogFragment.created_at.desc())
    )  # type: ignore
    result = db.exec(fragment_stmt)
    fragments = result.all()

    return fragments


@router.post("/completed", response_model=CompletedLogRead)
def create_completed_log(
    *,
    db: Session = Depends(get_session),
    log_in: CompletedLogCreate,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    完成ログを作成（ログフラグメントの編纂）

    複数のログフラグメントを組み合わせて、
    他プレイヤーの世界でNPCとして活動可能な完全な記録を作成。
    """
    # キャラクターの所有権確認
    stmt = select(Character).where(
        and_(
            Character.id == log_in.creator_id,
            Character.user_id == current_user.id,
        )
    )
    result = db.exec(stmt)
    character = result.first()
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found",
        )

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

    # 汚染度の計算
    all_fragments = [core_fragment, *sub_fragments]
    negative_count = sum(
        1
        for f in all_fragments
        if f.emotional_valence == EmotionalValence.NEGATIVE  # type: ignore
    )
    total_count = len(all_fragments)
    contamination_level = negative_count / total_count if total_count > 0 else 0.0

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
        contamination_level=contamination_level,
        status=CompletedLogStatus.DRAFT,
        created_at=datetime.utcnow(),
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

    db.commit()
    db.refresh(db_log)

    return db_log


@router.patch("/completed/{log_id}", response_model=CompletedLogRead)
def update_completed_log(
    *,
    db: Session = Depends(get_session),
    log_id: str,
    log_in: CompletedLogUpdate,
    current_user: User = Depends(get_current_user),
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
def get_character_completed_logs(
    *,
    db: Session = Depends(get_session),
    character_id: str,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    キャラクターの完成ログ一覧を取得
    """
    # キャラクターの所有権確認
    stmt = select(Character).where(
        and_(
            Character.id == character_id,
            Character.user_id == current_user.id,
        )
    )
    result = db.exec(stmt)
    character = result.first()
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found",
        )

    # 完成ログ取得
    log_stmt = (
        select(CompletedLog).where(CompletedLog.creator_id == character_id).order_by(CompletedLog.created_at.desc())
    )  # type: ignore
    result = db.exec(log_stmt)
    logs = result.all()

    return logs


@router.post("/contracts", response_model=LogContractRead)
def create_log_contract(
    *,
    db: Session = Depends(get_session),
    contract_in: LogContractCreate,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    ログ契約を作成

    完成ログを他プレイヤーの世界に送り出す際の契約。
    """
    # 完成ログと所有権の確認
    stmt = (
        select(CompletedLog)
        .join(Character)
        .where(
            and_(
                CompletedLog.id == contract_in.completed_log_id,
                Character.user_id == current_user.id,
                CompletedLog.status == CompletedLogStatus.COMPLETED,
            )
        )
    )
    result = db.exec(stmt)
    completed_log = result.first()
    if not completed_log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Completed log not found or not in completed status",
        )

    # 契約作成
    db_contract = LogContract(
        id=str(uuid4()),
        **contract_in.model_dump(),
        creator_id=completed_log.creator_id,
        status=LogContractStatus.PENDING,
        created_at=datetime.utcnow(),
    )
    db.add(db_contract)

    # 完成ログのステータス更新
    completed_log.status = CompletedLogStatus.CONTRACTED

    db.commit()
    db.refresh(db_contract)

    return db_contract


@router.get("/contracts/market", response_model=list[LogContractRead])
def get_market_contracts(
    *,
    db: Session = Depends(get_session),
    skip: int = 0,
    limit: int = 20,
) -> Any:
    """
    マーケットに公開されている契約一覧を取得
    """
    stmt = (
        select(LogContract)
        .where(
            and_(
                LogContract.is_public.is_(True),
                LogContract.status == LogContractStatus.PENDING,
            )
        )
        .offset(skip)
        .limit(limit)
        .order_by(LogContract.created_at.desc())
    )  # type: ignore
    result = db.exec(stmt)
    contracts = result.all()

    return contracts


@router.post("/contracts/{contract_id}/accept", response_model=LogContractRead)
def accept_log_contract(
    *,
    db: Session = Depends(get_session),
    contract_id: str,
    character_id: str,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    ログ契約を受け入れる

    他プレイヤーが作成したログをNPCとして自分の世界に迎え入れる。
    """
    # キャラクターの所有権確認
    stmt = select(Character).where(
        and_(
            Character.id == character_id,
            Character.user_id == current_user.id,
        )
    )
    result = db.exec(stmt)
    character = result.first()
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found",
        )

    # 契約の確認
    contract_stmt = select(LogContract).where(
        and_(
            LogContract.id == contract_id,
            LogContract.status == LogContractStatus.PENDING,
            LogContract.is_public.is_(True),
        )
    )
    result = db.exec(contract_stmt)
    contract = result.first()
    if not contract:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contract not found or not available",
        )

    # 契約受入
    contract.host_character_id = character_id
    contract.status = LogContractStatus.ACTIVE
    contract.activated_at = datetime.utcnow()

    # 有効期限の設定
    from datetime import timedelta

    contract.expires_at = datetime.utcnow() + timedelta(
        hours=1  # TODO: activity_duration_hoursフィールドの実装
    )

    # 完成ログのステータス更新
    log_update_stmt = select(CompletedLog).where(CompletedLog.id == contract.completed_log_id)
    result = db.exec(log_update_stmt)
    completed_log = result.first()
    if completed_log:
        completed_log.status = CompletedLogStatus.ACTIVE

    db.commit()
    db.refresh(contract)

    # バックグラウンドでNPC生成タスクを起動
    generate_npc_from_completed_log.delay(
        str(contract.completed_log_id),
        "共通広場",  # TODO: キャラクターの現在地を取得
    )

    return contract
