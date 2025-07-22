"""
Game Session API endpoints

ゲームセッション関連のRESTful APIエンドポイント
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_character_session,
    get_current_active_user,
    get_db,
    get_user_character,
)
from app.core.exceptions import DatabaseError
from app.core.logging import get_logger
from app.models.character import Character
from app.models.game_session import GameSession
from app.models.user import User
from app.schemas.game_session import (
    EndSessionRequest,
    GameSessionCreate,
    GameSessionResponse,
    SessionContinueRequest,
    SessionHistoryItem,
    SessionHistoryResponse,
    SessionResultResponse,
)
from app.services.game_session_service import GameSessionService
from app.utils.exceptions import raise_not_found

logger = get_logger(__name__)
router = APIRouter()

# サービスインスタンス
game_session_service = GameSessionService()


@router.post("/sessions", response_model=GameSessionResponse)
async def create_session(
    request: GameSessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    character: Character = Depends(get_user_character)
) -> GameSessionResponse:
    """
    新規ゲームセッションを作成

    - **character_id**: セッションを開始するキャラクターのID
    - **current_scene**: 開始シーン（省略時はtown_square）
    """
    try:
        logger.info(f"Creating game session for character: {character.id}")

        session = await game_session_service.create_session(
            db=db,
            character_id=str(character.id),
            request=request
        )

        return GameSessionResponse(
            id=str(session.id),
            character_id=str(session.character_id),
            session_number=session.session_number,
            is_active=session.is_active,
            session_status=session.session_status,
            current_scene=session.current_scene,
            turn_count=session.turn_count,
            word_count=session.word_count,
            play_duration_minutes=session.play_duration_minutes,
            is_first_session=session.is_first_session,
            created_at=session.created_at,
            updated_at=session.updated_at,
            ended_at=session.updated_at if not session.is_active else None
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error creating session: {e!s}")
        raise DatabaseError(f"Failed to create session: {e!s}")


@router.get("/sessions/{session_id}", response_model=GameSessionResponse)
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    session: GameSession = Depends(get_character_session)
) -> GameSessionResponse:
    """
    セッションの詳細情報を取得

    - **session_id**: 取得するセッションのID
    """
    try:
        return GameSessionResponse(
            id=str(session.id),
            character_id=str(session.character_id),
            session_number=session.session_number,
            is_active=session.is_active,
            session_status=session.session_status,
            current_scene=session.current_scene,
            turn_count=session.turn_count,
            word_count=session.word_count,
            play_duration_minutes=session.play_duration_minutes,
            is_first_session=session.is_first_session,
            created_at=session.created_at,
            updated_at=session.updated_at,
            ended_at=session.updated_at if not session.is_active else None
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error getting session: {e!s}")
        raise DatabaseError(f"Failed to get session: {e!s}")


@router.get("/sessions/history", response_model=SessionHistoryResponse)
async def get_session_history(
    character_id: Optional[str] = Query(None, description="Filter by character ID"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=100, description="Maximum number of records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
) -> SessionHistoryResponse:
    """
    セッション履歴を取得

    - **character_id**: 特定のキャラクターでフィルター（省略可）
    - **skip**: スキップするレコード数
    - **limit**: 取得する最大レコード数
    """
    try:
        sessions, total = await game_session_service.get_session_history(
            db=db,
            user_id=str(current_user.id),
            character_id=character_id,
            skip=skip,
            limit=limit
        )

        items = [
            SessionHistoryItem(
                id=str(session.id),
                session_number=session.session_number,
                session_status=session.session_status,
                turn_count=session.turn_count,
                word_count=session.word_count,
                play_duration_minutes=session.play_duration_minutes,
                created_at=session.created_at,
                updated_at=session.updated_at,
                result_processed_at=session.updated_at if not session.is_active else None,
                result_summary=session.result_summary
            )
            for session in sessions
        ]

        return SessionHistoryResponse(
            sessions=items,
            total=total,
            page=(skip // limit) + 1,
            per_page=limit,
            has_next=(skip + limit) < total,
            has_prev=skip > 0
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error getting session history: {e!s}")
        raise DatabaseError(f"Failed to get session history: {e!s}")


@router.post("/sessions/{session_id}/continue", response_model=GameSessionResponse)
async def continue_session(
    session_id: str,
    request: SessionContinueRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    session: GameSession = Depends(get_character_session)
) -> GameSessionResponse:
    """
    既存セッションを継続

    - **session_id**: 継続するセッションのID
    """
    try:
        logger.info(f"Continuing session: {session_id}")

        updated_session = await game_session_service.continue_session(
            db=db,
            session_id=session_id,
            request=request
        )

        return GameSessionResponse(
            id=str(updated_session.id),
            character_id=str(updated_session.character_id),
            session_number=updated_session.session_number,
            is_active=updated_session.is_active,
            session_status=updated_session.session_status,
            current_scene=updated_session.current_scene,
            turn_count=updated_session.turn_count,
            word_count=updated_session.word_count,
            play_duration_minutes=updated_session.play_duration_minutes,
            is_first_session=updated_session.is_first_session,
            created_at=updated_session.created_at,
            updated_at=updated_session.updated_at,
            ended_at=updated_session.updated_at if not updated_session.is_active else None
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error continuing session: {e!s}")
        raise DatabaseError(f"Failed to continue session: {e!s}")


@router.post("/sessions/{session_id}/end", response_model=SessionResultResponse)
async def end_session(
    session_id: str,
    request: EndSessionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    session: GameSession = Depends(get_character_session)
) -> SessionResultResponse:
    """
    セッションを終了

    - **session_id**: 終了するセッションのID
    - **reason**: 終了理由（省略可）
    """
    try:
        logger.info(f"Ending session: {session_id}")

        result = await game_session_service.end_session(
            db=db,
            session_id=session_id,
            reason=request.reason
        )

        return SessionResultResponse(
            id=str(result.id),
            session_id=str(result.session_id),
            story_summary=result.story_summary,
            key_events=result.key_events,
            experience_gained=result.experience_gained,
            skills_improved=result.skills_improved,
            items_acquired=result.items_acquired,
            continuation_context=result.continuation_context,
            unresolved_plots=result.unresolved_plots,
            created_at=result.created_at
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error ending session: {e!s}")
        raise DatabaseError(f"Failed to end session: {e!s}")


@router.get("/sessions/active", response_model=Optional[GameSessionResponse])
async def get_active_session(
    character_id: str = Query(..., description="Character ID to check for active session"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
) -> Optional[GameSessionResponse]:
    """
    指定されたキャラクターのアクティブなセッションを取得

    - **character_id**: チェックするキャラクターのID
    """
    try:
        # キャラクターの所有権確認
        stmt = select(Character).where(
            Character.id == character_id,
            Character.user_id == str(current_user.id)
        )
        result = await db.execute(stmt)
        character = result.scalar_one_or_none()

        if not character:
            raise_not_found("Character not found or not owned by user")

        # アクティブセッションを検索
        session_stmt = select(GameSession).where(
            and_(
                GameSession.character_id == character_id,
                GameSession.is_active == True  # noqa: E712
            )
        )
        session_result = await db.execute(session_stmt)
        session = session_result.scalar_one_or_none()

        if not session:
            return None

        return GameSessionResponse(
            id=str(session.id),
            character_id=str(session.character_id),
            session_number=session.session_number,
            is_active=session.is_active,
            session_status=session.session_status,
            current_scene=session.current_scene,
            turn_count=session.turn_count,
            word_count=session.word_count,
            play_duration_minutes=session.play_duration_minutes,
            is_first_session=session.is_first_session,
            created_at=session.created_at,
            updated_at=session.updated_at,
            ended_at=session.updated_at if not session.is_active else None
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error getting active session: {e!s}")
        raise DatabaseError(f"Failed to get active session: {e!s}")
