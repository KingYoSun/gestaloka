"""
ゲームエンドポイント
"""

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.api_v1.endpoints.auth import get_current_user
from app.core.database import get_session
from app.core.logging import get_logger
from app.schemas.game_session import (
    ActionExecuteRequest,
    ActionExecuteResponse,
    GameActionRequest,
    GameActionResponse,
    GameSessionCreate,
    GameSessionListResponse,
    GameSessionResponse,
    GameSessionUpdate,
)
from app.schemas.user import User
from app.services.game_session import GameSessionService

router = APIRouter()
logger = get_logger(__name__)


@router.get("/sessions", response_model=GameSessionListResponse)
async def get_game_sessions(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_session)
) -> GameSessionListResponse:
    """ゲームセッション一覧取得"""
    service = GameSessionService(db)
    return service.get_user_sessions(current_user.id)


@router.post("/sessions", response_model=GameSessionResponse)
async def create_game_session(
    session_data: GameSessionCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)
) -> GameSessionResponse:
    """ゲームセッション作成"""
    service = GameSessionService(db)
    return await service.create_session(current_user.id, session_data)


@router.get("/sessions/{session_id}", response_model=GameSessionResponse)
async def get_game_session(
    session_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)
) -> GameSessionResponse:
    """特定のゲームセッション取得"""
    service = GameSessionService(db)
    return service.get_session(session_id, current_user.id)


@router.put("/sessions/{session_id}", response_model=GameSessionResponse)
async def update_game_session(
    session_id: str,
    update_data: GameSessionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> GameSessionResponse:
    """ゲームセッション更新"""
    service = GameSessionService(db)
    return service.update_session(session_id, current_user.id, update_data)


@router.post("/sessions/{session_id}/end", response_model=GameSessionResponse)
async def end_game_session(
    session_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)
) -> GameSessionResponse:
    """ゲームセッション終了"""
    service = GameSessionService(db)
    return service.end_session(session_id, current_user.id)


@router.post("/sessions/{session_id}/action", response_model=GameActionResponse)
async def execute_game_action(
    session_id: str,
    action: GameActionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> GameActionResponse:
    """ゲーム内アクション実行（AI統合後に実装）"""
    # TODO: AI統合後に実装
    logger.info("Game action requested", session_id=session_id, user_id=current_user.id, action=action.action_text)

    return GameActionResponse(
        session_id=session_id,
        action_result=f"あなたは「{action.action_text}」を実行しました。（AI統合後に本格実装予定）",
        new_scene="物語が続いています...",
        choices=["選択肢1", "選択肢2", "選択肢3"],
        character_status={"health": 100, "energy": 90},
    )


@router.post("/sessions/{session_id}/execute", response_model=ActionExecuteResponse)
async def execute_action(
    session_id: str,
    action_request: ActionExecuteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> ActionExecuteResponse:
    """プレイヤーアクションを実行しAI応答を生成"""
    service = GameSessionService(db)
    return await service.execute_action(session_id, current_user.id, action_request)
