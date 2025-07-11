"""
ゲームエンドポイント
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import get_character_session, get_current_active_user, get_user_character
from app.core.database import get_session
from app.core.logging import get_logger
from app.models.character import GameSession
from app.models.game_message import GameMessage
from app.schemas.game_session import (
    ActionExecuteRequest,
    ActionExecuteResponse,
    GameActionRequest,
    GameActionResponse,
    GameSessionCreate,
    GameSessionListResponse,
    GameSessionResponse,
    GameSessionUpdate,
    SessionContinueRequest,
    SessionEndingAcceptResponse,
    SessionEndingProposal,
    SessionEndingRejectResponse,
    SessionHistoryResponse,
    SessionResultResponse,
)
from app.schemas.user import User
from app.services.game_session import GameSessionService

router = APIRouter()
logger = get_logger(__name__)


@router.get("/sessions", response_model=GameSessionListResponse)
async def get_game_sessions(
    current_user: User = Depends(get_current_active_user), db: Session = Depends(get_session)
) -> GameSessionListResponse:
    """ゲームセッション一覧取得"""
    service = GameSessionService(db)
    return service.get_user_sessions(current_user.id)


@router.get("/sessions/history", response_model=SessionHistoryResponse)
async def get_session_history(
    character_id: str,
    page: int = 1,
    per_page: int = 20,
    status: Optional[str] = None,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session),
) -> SessionHistoryResponse:
    """キャラクターのセッション履歴を取得"""
    # キャラクターの所有権確認
    character = await get_user_character(character_id, db, current_user)

    service = GameSessionService(db)
    result = service.get_session_history(character_id=character.id, page=page, per_page=per_page, status_filter=status)

    return SessionHistoryResponse(**result)


@router.post("/sessions/continue", response_model=GameSessionResponse)
async def continue_game_session(
    request: SessionContinueRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session),
) -> GameSessionResponse:
    """前回のセッション結果を引き継いで新しいセッションを開始"""
    # キャラクターの所有権確認
    character = await get_user_character(request.character_id, db, current_user)

    # 前回のセッションの所有権も確認
    session_stmt = select(GameSession).where(
        GameSession.id == request.previous_session_id, GameSession.character_id == character.id
    )
    previous_session = db.exec(session_stmt).first()
    if not previous_session:
        raise HTTPException(status_code=403, detail="指定されたセッションへのアクセス権限がありません")

    service = GameSessionService(db)
    return await service.continue_session(character, request.previous_session_id)


@router.post("/sessions", response_model=GameSessionResponse)
async def create_game_session(
    session_data: GameSessionCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session),
) -> GameSessionResponse:
    """ゲームセッション作成"""
    # キャラクターの所有権確認
    character = await get_user_character(session_data.character_id, db, current_user)
    service = GameSessionService(db)
    return await service.create_session(character, session_data)


@router.get("/sessions/{session_id}", response_model=GameSessionResponse)
async def get_game_session(
    session_id: str, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_session)
) -> GameSessionResponse:
    """特定のゲームセッション取得"""
    # セッションのアクセス権確認
    session = await get_character_session(session_id, db, current_user)
    service = GameSessionService(db)
    return service.get_session_response(session)


@router.put("/sessions/{session_id}", response_model=GameSessionResponse)
async def update_game_session(
    session_id: str,
    update_data: GameSessionUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session),
) -> GameSessionResponse:
    """ゲームセッション更新"""
    # セッションのアクセス権確認
    session = await get_character_session(session_id, db, current_user)
    service = GameSessionService(db)
    return service.update_session(session, update_data)


@router.post("/sessions/{session_id}/end", response_model=GameSessionResponse)
async def end_game_session(
    session_id: str, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_session)
) -> GameSessionResponse:
    """ゲームセッション終了"""
    # セッションのアクセス権確認
    session = await get_character_session(session_id, db, current_user)
    service = GameSessionService(db)
    return service.end_session(session)


@router.post("/sessions/{session_id}/action", response_model=GameActionResponse)
async def execute_game_action(
    session_id: str,
    action: GameActionRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session),
) -> GameActionResponse:
    """ゲーム内アクション実行（AI統合後に実装）"""
    # セッションのアクセス権確認
    await get_character_session(session_id, db, current_user)
    # TODO: AI統合後に実装
    logger.info("Game action requested", session_id=session_id, user_id=current_user.id, action=action.action_text)

    return GameActionResponse(
        session_id=session_id,
        action_result=f"あなたは「{action.action_text}」を実行しました。（AI統合後に本格実装予定）",
        new_scene="物語が続いています...",
        choices=["選択肢1", "選択肢2", "選択肢3"],
        character_status={"health": 100, "mp": 90},
    )


@router.post("/sessions/{session_id}/execute", response_model=ActionExecuteResponse)
async def execute_action(
    session_id: str,
    action_request: ActionExecuteRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session),
) -> ActionExecuteResponse:
    """プレイヤーアクションを実行しAI応答を生成"""
    # セッションのアクセス権確認
    session = await get_character_session(session_id, db, current_user)
    service = GameSessionService(db)
    return await service.execute_action(session, action_request)


@router.get("/sessions/{session_id}/ending-proposal", response_model=Optional[SessionEndingProposal])
async def get_ending_proposal(
    session_id: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session),
) -> Optional[SessionEndingProposal]:
    """セッション終了提案を取得"""
    # セッションのアクセス権確認
    session = await get_character_session(session_id, db, current_user)

    # キャラクター取得
    character = await get_user_character(session.character_id, db, current_user)

    service = GameSessionService(db)
    return await service.get_ending_proposal(session_id, character)


@router.post("/sessions/{session_id}/accept-ending", response_model=SessionEndingAcceptResponse)
async def accept_ending(
    session_id: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session),
) -> SessionEndingAcceptResponse:
    """セッション終了を承認"""
    # セッションのアクセス権確認
    session = await get_character_session(session_id, db, current_user)

    # キャラクター取得
    character = await get_user_character(session.character_id, db, current_user)

    service = GameSessionService(db)
    return await service.accept_ending(session_id, character)


@router.post("/sessions/{session_id}/reject-ending", response_model=SessionEndingRejectResponse)
async def reject_ending(
    session_id: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session),
) -> SessionEndingRejectResponse:
    """セッション終了を拒否（継続）"""
    # セッションのアクセス権確認
    session = await get_character_session(session_id, db, current_user)

    # キャラクター取得
    character = await get_user_character(session.character_id, db, current_user)

    service = GameSessionService(db)
    return await service.reject_ending(session_id, character)


@router.get("/sessions/{session_id}/result", response_model=Optional[SessionResultResponse])
async def get_session_result(
    session_id: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session),
) -> Optional[SessionResultResponse]:
    """セッション結果を取得"""
    # セッションのアクセス権確認
    session = await get_character_session(session_id, db, current_user)

    # キャラクター取得
    character = await get_user_character(session.character_id, db, current_user)

    service = GameSessionService(db)
    result = await service.get_session_result(session_id, character)

    if not result:
        raise HTTPException(status_code=404, detail="Session result not found or not processed yet")

    return result
