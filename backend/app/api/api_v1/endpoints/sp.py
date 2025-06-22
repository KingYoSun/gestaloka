"""
SPシステムのAPIエンドポイント
"""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_
from sqlmodel import Session, col, select

from app.api.deps import get_current_active_user, get_db
from app.core.exceptions import InsufficientSPError, SPSystemError
from app.core.logging import get_logger
from app.models.sp import SPTransaction, SPTransactionType
from app.models.user import User
from app.schemas.sp import (
    PlayerSPRead,
    PlayerSPSummary,
    SPConsumeRequest,
    SPConsumeResponse,
    SPDailyRecoveryResponse,
    SPTransactionRead,
)
from app.services.sp_service import SPService

router = APIRouter()
logger = get_logger(__name__)


@router.get("/balance", response_model=PlayerSPRead)
async def get_sp_balance(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    現在のSP残高と詳細情報を取得

    Returns:
        PlayerSPRead: SP残高の詳細情報
    """
    try:
        service = SPService(db)
        player_sp = await service.get_balance(current_user.id)
        return player_sp
    except SPSystemError as e:
        logger.error(
            "Failed to get SP balance",
            user_id=current_user.id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/balance/summary", response_model=PlayerSPSummary)
async def get_sp_balance_summary(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    SP残高の概要を取得（軽量版）

    Returns:
        PlayerSPSummary: SP残高の概要
    """
    try:
        service = SPService(db)
        player_sp = await service.get_balance(current_user.id)
        return PlayerSPSummary.model_validate(player_sp)
    except SPSystemError as e:
        logger.error(
            "Failed to get SP balance summary",
            user_id=current_user.id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/consume", response_model=SPConsumeResponse)
async def consume_sp(
    request: SPConsumeRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    SPを消費

    Args:
        request: SP消費リクエスト

    Returns:
        SPConsumeResponse: 消費結果

    Raises:
        HTTPException: SP不足または処理エラー
    """
    try:
        service = SPService(db)
        transaction = await service.consume_sp(
            user_id=current_user.id,
            amount=request.amount,
            transaction_type=request.transaction_type,
            description=request.description,
            related_entity_type=request.related_entity_type,
            related_entity_id=request.related_entity_id,
            metadata=request.metadata,
        )

        return SPConsumeResponse(
            success=True,
            transaction_id=transaction.id,
            balance_before=transaction.balance_before,
            balance_after=transaction.balance_after,
            message=f"SP {abs(transaction.amount)} を消費しました",
        )

    except InsufficientSPError as e:
        logger.warning(
            "Insufficient SP",
            user_id=current_user.id,
            requested_amount=request.amount,
            error=str(e),
        )
        raise HTTPException(status_code=400, detail=str(e))
    except SPSystemError as e:
        logger.error(
            "Failed to consume SP",
            user_id=current_user.id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/daily-recovery", response_model=SPDailyRecoveryResponse)
async def process_daily_recovery(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    日次SP回復処理

    Returns:
        SPDailyRecoveryResponse: 回復結果

    Note:
        - 1日1回のみ実行可能
        - 連続ログインボーナスも同時に処理
        - サブスクリプションボーナスも適用
    """
    try:
        service = SPService(db)
        result = await service.process_daily_recovery(current_user.id)

        if not result["success"]:
            raise HTTPException(status_code=400, detail=result["message"])

        return SPDailyRecoveryResponse(**result)

    except SPSystemError as e:
        logger.error(
            "Failed to process daily recovery",
            user_id=current_user.id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/transactions", response_model=list[SPTransactionRead])
async def get_transaction_history(
    transaction_type: SPTransactionType | None = Query(None),
    start_date: datetime | None = Query(None),
    end_date: datetime | None = Query(None),
    related_entity_type: str | None = Query(None),
    related_entity_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    SP取引履歴を取得

    Args:
        transaction_type: 取引種別でフィルター
        start_date: 開始日時
        end_date: 終了日時
        related_entity_type: 関連エンティティ種別
        related_entity_id: 関連エンティティID
        limit: 取得件数上限
        offset: オフセット

    Returns:
        list[SPTransactionRead]: 取引履歴のリスト
    """
    try:
        service = SPService(db)
        transactions = await service.get_transaction_history(
            user_id=current_user.id,
            transaction_type=transaction_type,
            start_date=start_date,
            end_date=end_date,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
            limit=limit,
            offset=offset,
        )
        return transactions

    except SPSystemError as e:
        logger.error(
            "Failed to get transaction history",
            user_id=current_user.id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/transactions/{transaction_id}", response_model=SPTransactionRead)
async def get_transaction_detail(
    transaction_id: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Any:
    """
    特定の取引詳細を取得

    Args:
        transaction_id: 取引ID

    Returns:
        SPTransactionRead: 取引詳細

    Raises:
        HTTPException: 取引が見つからない場合
    """
    try:
        stmt = select(SPTransaction).where(
            and_(
                col(SPTransaction.id) == transaction_id,
                col(SPTransaction.user_id) == current_user.id,
            )
        )
        transaction = db.exec(stmt).first()

        if not transaction:
            raise HTTPException(
                status_code=404,
                detail="指定された取引が見つかりません",
            )

        return transaction

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get transaction detail",
            user_id=current_user.id,
            transaction_id=transaction_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=500,
            detail="取引詳細の取得に失敗しました",
        )
