"""
権限チェックユーティリティ
"""

from typing import Optional

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.models.character import Character
from app.models.game_session import GameSession


def check_character_ownership(
    db: Session, character_id: str, user_id: str, raise_on_not_found: bool = True
) -> Optional[Character]:
    """
    キャラクターの所有権を確認

    Args:
        db: データベースセッション
        character_id: キャラクターID
        user_id: ユーザーID
        raise_on_not_found: 見つからない場合に例外を発生させるか

    Returns:
        Character: キャラクターオブジェクト（見つかった場合）
        None: 見つからなかった場合（raise_on_not_found=Falseの場合）

    Raises:
        HTTPException: キャラクターが見つからない、または権限がない場合
    """
    character = db.exec(select(Character).where(Character.id == character_id, Character.user_id == user_id)).first()

    if not character and raise_on_not_found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Character not found or access denied")

    return character


def check_session_ownership(
    db: Session, session_id: str, user_id: str, raise_on_not_found: bool = True
) -> Optional[tuple[GameSession, Character]]:
    """
    ゲームセッションの所有権を確認

    Args:
        db: データベースセッション
        session_id: セッションID
        user_id: ユーザーID
        raise_on_not_found: 見つからない場合に例外を発生させるか

    Returns:
        tuple[GameSession, Character]: セッションとキャラクターのタプル（見つかった場合）
        None: 見つからなかった場合（raise_on_not_found=Falseの場合）

    Raises:
        HTTPException: セッションが見つからない、または権限がない場合
    """
    result = db.exec(
        select(GameSession, Character).join(Character).where(GameSession.id == session_id, Character.user_id == user_id)
    ).first()

    if not result and raise_on_not_found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found or access denied")

    return result
