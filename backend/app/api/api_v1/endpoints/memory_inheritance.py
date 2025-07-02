"""記憶継承APIエンドポイント"""


from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.core.auth import get_current_user
from app.core.database import get_session
from app.models.user import User
from app.models.character import Character
from app.schemas.memory_inheritance import (
    InheritanceHistoryEntry,
    MemoryCombinationPreview,
    MemoryInheritanceRequest,
    MemoryInheritanceResult,
)
from app.services.memory_inheritance_service import MemoryInheritanceService

router = APIRouter()


@router.get(
    "/characters/{character_id}/memory-inheritance/preview",
    response_model=MemoryCombinationPreview,
    summary="記憶組み合わせのプレビュー取得",
    description="指定した記憶フラグメントの組み合わせで可能な継承タイプとその効果をプレビュー"
)
def get_combination_preview(
    character_id: str,
    fragment_ids: list[str],
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
) -> MemoryCombinationPreview:
    """記憶組み合わせのプレビューを取得"""
    # キャラクター所有権チェック
    character = session.get(Character, character_id)
    if not character or character.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="このキャラクターへのアクセス権限がありません"
        )

    if len(fragment_ids) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="記憶の組み合わせには最低2つのフラグメントが必要です"
        )

    service = MemoryInheritanceService(session)
    try:
        return service.get_combination_preview(character_id, fragment_ids)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post(
    "/characters/{character_id}/memory-inheritance/execute",
    response_model=MemoryInheritanceResult,
    summary="記憶継承の実行",
    description="指定した記憶フラグメントを組み合わせて新しい価値を創造"
)
async def execute_inheritance(
    character_id: str,
    request: MemoryInheritanceRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
) -> MemoryInheritanceResult:
    """記憶継承を実行"""
    # キャラクター所有権チェック
    character = session.get(Character, character_id)
    if not character or character.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="このキャラクターへのアクセス権限がありません"
        )

    service = MemoryInheritanceService(session)
    try:
        result = await service.execute_inheritance(character_id, request)
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"記憶継承の実行に失敗しました: {e!s}"
        )


@router.get(
    "/characters/{character_id}/memory-inheritance/history",
    response_model=list[InheritanceHistoryEntry],
    summary="記憶継承履歴の取得",
    description="過去の記憶継承履歴を取得"
)
def get_inheritance_history(
    character_id: str,
    limit: int = 50,
    offset: int = 0,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
) -> list[InheritanceHistoryEntry]:
    """記憶継承履歴を取得"""
    # キャラクター所有権チェック
    character = session.get(Character, character_id)
    if not character or character.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="このキャラクターへのアクセス権限がありません"
        )

    # メタデータから履歴を取得
    history = []
    if character.character_metadata and "inheritance_history" in character.character_metadata:
        all_history = character.character_metadata["inheritance_history"]
        # 新しい順にソート
        all_history.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        # ページング
        history = all_history[offset:offset + limit]

    return [InheritanceHistoryEntry(**entry) for entry in history]


@router.get(
    "/characters/{character_id}/memory-inheritance/enhancements",
    response_model=list[dict],
    summary="ログ強化情報の取得",
    description="キャラクターが保有するログ強化効果の一覧を取得"
)
def get_log_enhancements(
    character_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
) -> list[dict]:
    """ログ強化情報を取得"""
    # キャラクター所有権チェック
    character = session.get(Character, character_id)
    if not character or character.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="このキャラクターへのアクセス権限がありません"
        )

    # メタデータから強化情報を取得
    enhancements = []
    if character.character_metadata and "log_enhancements" in character.character_metadata:
        enhancements = character.character_metadata["log_enhancements"]

    return enhancements
