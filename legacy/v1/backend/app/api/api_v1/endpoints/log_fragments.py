"""
ログフラグメント管理APIエンドポイント
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, and_, col, select

from app.api.deps import get_user_character
from app.core.database import get_session as get_db
from app.models import Character, LogFragment, LogFragmentRarity
from app.schemas.log_fragment import (
    LogFragmentDetail,
    LogFragmentListResponse,
    LogFragmentStatistics,
)

router = APIRouter()


@router.get("/{character_id}/fragments", response_model=LogFragmentListResponse)
async def get_character_fragments(
    *,
    db: Session = Depends(get_db),
    current_character: Character = Depends(get_user_character),
    rarity: Optional[LogFragmentRarity] = Query(None, description="レアリティでフィルタ"),
    keyword: Optional[str] = Query(None, description="キーワードで検索"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> LogFragmentListResponse:
    """キャラクターが所有するログフラグメントを取得"""
    # クエリ構築
    query = select(LogFragment).where(LogFragment.character_id == current_character.id)

    # フィルタリング
    if rarity:
        query = query.where(LogFragment.rarity == rarity)

    if keyword:
        # キーワードで部分一致検索（メインキーワードまたはキーワードリスト内）
        query = query.where(col(LogFragment.keyword).contains(keyword) | col(LogFragment.keywords).contains(keyword))

    # 総数を取得
    count_query = select(LogFragment).where(LogFragment.character_id == current_character.id)
    if rarity:
        count_query = count_query.where(LogFragment.rarity == rarity)
    if keyword:
        count_query = count_query.where(
            col(LogFragment.keyword).contains(keyword) | col(LogFragment.keywords).contains(keyword)
        )

    total = len(db.exec(count_query).all())

    # ページネーション適用
    query = query.order_by(col(LogFragment.created_at).desc()).offset(offset).limit(limit)
    fragments = db.exec(query).all()

    # 統計情報を計算
    stats_query = select(LogFragment).where(LogFragment.character_id == current_character.id)
    all_fragments = db.exec(stats_query).all()

    rarity_counts = {
        LogFragmentRarity.COMMON: 0,
        LogFragmentRarity.UNCOMMON: 0,
        LogFragmentRarity.RARE: 0,
        LogFragmentRarity.EPIC: 0,
        LogFragmentRarity.LEGENDARY: 0,
    }

    for fragment in all_fragments:
        rarity_counts[fragment.rarity] += 1

    statistics = LogFragmentStatistics(
        total_fragments=len(all_fragments),
        by_rarity=rarity_counts,
        unique_keywords=len({f.keyword for f in all_fragments if f.keyword}),
    )

    return LogFragmentListResponse(
        fragments=[LogFragmentDetail.model_validate(f) for f in fragments],
        total=total,
        statistics=statistics,
    )


@router.get("/{character_id}/fragments/{fragment_id}", response_model=LogFragmentDetail)
async def get_fragment_detail(
    fragment_id: str,
    *,
    db: Session = Depends(get_db),
    current_character: Character = Depends(get_user_character),
) -> LogFragmentDetail:
    """特定のログフラグメントの詳細を取得"""
    fragment = db.exec(
        select(LogFragment).where(
            and_(
                LogFragment.id == fragment_id,
                LogFragment.character_id == current_character.id,
            )
        )
    ).first()

    if not fragment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Fragment not found or not owned by character",
        )

    return LogFragmentDetail.model_validate(fragment)
