"""
動的クエストシステムのAPIエンドポイント
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.deps import get_user_character as get_current_character, get_db
from app.core.logger import get_logger  # type: ignore
from app.models.character import Character
from app.models.quest import Quest, QuestOrigin, QuestProposal, QuestStatus
from app.services.quest_service import QuestService
from app.services.websocket_service import WebSocketService

logger = get_logger(__name__)
router = APIRouter()


@router.get("/{character_id}/proposals", response_model=list[QuestProposal])
async def get_quest_proposals(
    character_id: str,
    session_id: str,
    db: Session = Depends(get_db),
    current_character: Character = Depends(get_current_character)
):
    """
    最近の行動を分析してクエストを提案する

    Args:
        character_id: キャラクターID
        session_id: 現在のセッションID

    Returns:
        提案されたクエストのリスト
    """
    if current_character.id != character_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="他のキャラクターのクエスト提案は取得できません"
        )

    quest_service = QuestService(db)
    proposals = await quest_service.analyze_and_propose_quests(
        character_id=character_id,
        session_id=session_id
    )

    return proposals


@router.post("/{character_id}/create", response_model=Quest)
def create_quest(
    character_id: str,
    title: str,
    description: str,
    origin: QuestOrigin = QuestOrigin.PLAYER_DECLARED,
    session_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_character: Character = Depends(get_current_character)
):
    """
    新しいクエストを作成する

    Args:
        character_id: キャラクターID
        title: クエストタイトル
        description: クエストの説明
        origin: クエストの発生源
        session_id: セッションID（オプション）

    Returns:
        作成されたクエスト
    """
    if current_character.id != character_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="他のキャラクターのクエストは作成できません"
        )

    quest_service = QuestService(db)
    quest = quest_service.create_quest(
        character_id=character_id,
        title=title,
        description=description,
        origin=origin,
        session_id=session_id
    )

    # WebSocket通知
    websocket_service = WebSocketService()
    websocket_service.notify_quest_created(character_id, quest)

    return quest


@router.post("/{character_id}/quests/{quest_id}/accept", response_model=Quest)
def accept_quest(
    character_id: str,
    quest_id: str,
    db: Session = Depends(get_db),
    current_character: Character = Depends(get_current_character)
):
    """
    提案されたクエストを受諾する

    Args:
        character_id: キャラクターID
        quest_id: クエストID

    Returns:
        更新されたクエスト
    """
    if current_character.id != character_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="他のキャラクターのクエストは受諾できません"
        )

    quest_service = QuestService(db)
    quest = quest_service.accept_quest(quest_id)

    if not quest:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="クエストが見つかりません"
        )

    # WebSocket通知
    websocket_service = WebSocketService()
    websocket_service.notify_quest_updated(character_id, quest)

    return quest


@router.post("/{character_id}/quests/{quest_id}/update", response_model=Quest)
async def update_quest_progress(
    character_id: str,
    quest_id: str,
    db: Session = Depends(get_db),
    current_character: Character = Depends(get_current_character)
):
    """
    クエストの進行状況を更新する

    Args:
        character_id: キャラクターID
        quest_id: クエストID

    Returns:
        更新されたクエスト
    """
    if current_character.id != character_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="他のキャラクターのクエストは更新できません"
        )

    quest_service = QuestService(db)
    quest = await quest_service.update_quest_progress(
        quest_id=quest_id,
        character_id=character_id
    )

    if not quest:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="クエストが見つかりません"
        )

    # WebSocket通知
    websocket_service = WebSocketService()
    websocket_service.notify_quest_updated(character_id, quest)

    # クエスト完了時の追加通知
    if quest.status == QuestStatus.COMPLETED:
        websocket_service.notify_quest_completed(character_id, quest)

    return quest


@router.get("/{character_id}/quests", response_model=list[Quest])
def get_character_quests(
    character_id: str,
    status: Optional[QuestStatus] = None,
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_character: Character = Depends(get_current_character)
):
    """
    キャラクターのクエストを取得する

    Args:
        character_id: キャラクターID
        status: フィルタリングするステータス（オプション）
        limit: 取得数制限
        offset: オフセット

    Returns:
        クエストのリスト
    """
    if current_character.id != character_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="他のキャラクターのクエストは取得できません"
        )

    quest_service = QuestService(db)
    quests = quest_service.get_character_quests(
        character_id=character_id,
        status=status,
        limit=limit,
        offset=offset
    )

    return quests


@router.post("/{character_id}/quests/infer", response_model=Optional[Quest])
async def infer_implicit_quest(
    character_id: str,
    session_id: str,
    db: Session = Depends(get_db),
    current_character: Character = Depends(get_current_character)
):
    """
    プレイヤーの行動から暗黙的なクエストを推測する

    Args:
        character_id: キャラクターID
        session_id: セッションID

    Returns:
        推測されたクエスト（作成された場合）
    """
    if current_character.id != character_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="他のキャラクターのクエストは推測できません"
        )

    quest_service = QuestService(db)
    quest = await quest_service.infer_implicit_quest(
        character_id=character_id,
        session_id=session_id
    )

    if quest:
        # WebSocket通知
        websocket_service = WebSocketService()
        websocket_service.notify_quest_created(character_id, quest)

    return quest

