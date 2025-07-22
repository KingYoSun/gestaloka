"""
Game Session API endpoints

ゲームセッション関連のRESTful APIエンドポイント
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_db,
    get_current_active_user,
    get_user_character,
    get_character_session,
)
from app.core.exceptions import DatabaseError
from app.utils.exceptions import raise_not_found, raise_forbidden, raise_bad_request
from app.core.logging import get_logger
from app.models.user import User
from app.models.character import Character
from app.models.game_session import GameSession
from app.schemas.game_session import (
    GameSessionCreate,
    GameSessionResponse,
    SessionHistoryResponse,
    SessionHistoryItem,
    SessionContinueRequest,
    SessionResultResponse,
    EndSessionRequest,
)
from app.services.game_session_service import GameSessionService

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
            session_status=session.session_status.value,
            current_scene=session.current_scene,
            turn_count=session.turn_count,
            word_count=session.word_count,
            play_duration_minutes=session.play_duration_minutes,
            is_first_session=session.is_first_session,
            created_at=session.created_at,
            updated_at=session.updated_at,
            ended_at=session.ended_at
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error creating session: {str(e)}")
        raise DatabaseError(f"Failed to create session: {str(e)}")


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
            session_status=session.session_status.value,
            current_scene=session.current_scene,
            turn_count=session.turn_count,
            word_count=session.word_count,
            play_duration_minutes=session.play_duration_minutes,
            is_first_session=session.is_first_session,
            created_at=session.created_at,
            updated_at=session.updated_at,
            ended_at=session.ended_at
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error getting session: {str(e)}")
        raise DatabaseError(f"Failed to get session: {str(e)}")


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
                character_id=str(session.character_id),
                session_number=session.session_number,
                is_active=session.is_active,
                session_status=session.session_status.value,
                turn_count=session.turn_count,
                play_duration_minutes=session.play_duration_minutes,
                created_at=session.created_at,
                ended_at=session.ended_at,
                result_summary=session.result_summary
            )
            for session in sessions
        ]
        
        return SessionHistoryResponse(
            items=items,
            total=total,
            skip=skip,
            limit=limit
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error getting session history: {str(e)}")
        raise DatabaseError(f"Failed to get session history: {str(e)}")


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
            session_status=updated_session.session_status.value,
            current_scene=updated_session.current_scene,
            turn_count=updated_session.turn_count,
            word_count=updated_session.word_count,
            play_duration_minutes=updated_session.play_duration_minutes,
            is_first_session=updated_session.is_first_session,
            created_at=updated_session.created_at,
            updated_at=updated_session.updated_at,
            ended_at=updated_session.ended_at
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error continuing session: {str(e)}")
        raise DatabaseError(f"Failed to continue session: {str(e)}")


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
            character_id=str(result.character_id),
            session_number=result.session_number,
            turn_count=result.turn_count,
            word_count=result.word_count,
            play_duration_minutes=result.play_duration_minutes,
            sp_consumed=result.sp_consumed,
            story_summary=result.story_summary,
            key_events=result.key_events,
            character_growth=result.character_growth,
            acquired_items=result.acquired_items,
            acquired_titles=result.acquired_titles,
            log_fragments_earned=result.log_fragments_earned,
            ending_reason=result.ending_reason,
            created_at=result.created_at
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error ending session: {str(e)}")
        raise DatabaseError(f"Failed to end session: {str(e)}")


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
        character = await get_user_character(
            character_id=character_id,
            session=db,
            current_user=current_user
        )
        
        # アクティブセッションを検索
        from sqlalchemy import select, and_
        stmt = select(GameSession).where(
            and_(
                GameSession.character_id == character_id,
                GameSession.is_active == True
            )
        )
        result = await db.execute(stmt)
        session = result.scalar_one_or_none()
        
        if not session:
            return None
        
        return GameSessionResponse(
            id=str(session.id),
            character_id=str(session.character_id),
            session_number=session.session_number,
            is_active=session.is_active,
            session_status=session.session_status.value,
            current_scene=session.current_scene,
            turn_count=session.turn_count,
            word_count=session.word_count,
            play_duration_minutes=session.play_duration_minutes,
            is_first_session=session.is_first_session,
            created_at=session.created_at,
            updated_at=session.updated_at,
            ended_at=session.ended_at
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error getting active session: {str(e)}")
        raise DatabaseError(f"Failed to get active session: {str(e)}")