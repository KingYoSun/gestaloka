"""
共通のHTTPExceptionパターンを提供するユーティリティ
"""

from collections.abc import Callable
from functools import wraps
from typing import Any, NoReturn, TypeVar

from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.core.exceptions import InsufficientSPError, SPSystemError
from app.core.logging import get_logger

logger = get_logger(__name__)


def raise_not_found(detail: str = "Resource not found") -> NoReturn:
    """404エラーを送出する共通関数"""
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def raise_forbidden(detail: str = "Access forbidden") -> NoReturn:
    """403エラーを送出する共通関数"""
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def raise_bad_request(detail: str = "Bad request") -> NoReturn:
    """400エラーを送出する共通関数"""
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def raise_internal_error(detail: str = "Internal server error") -> NoReturn:
    """500エラーを送出する共通関数"""
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=detail)


def get_or_404(
    db: Session,
    model: type[SQLModel],
    id: Any,
    detail: str | None = None
) -> SQLModel:
    """
    IDでモデルを取得し、存在しない場合は404エラーを送出
    
    Args:
        db: データベースセッション
        model: SQLModelクラス
        id: 取得するモデルのID
        detail: エラーメッセージ（省略時はデフォルトメッセージ）
        
    Returns:
        取得したモデルインスタンス
        
    Raises:
        HTTPException: モデルが存在しない場合
    """
    obj = db.get(model, id)
    if not obj:
        if detail is None:
            detail = f"{model.__name__} not found"
        raise_not_found(detail)
    return obj


def get_by_condition_or_404(
    db: Session,
    statement: Any,
    detail: str | None = None
) -> Any:
    """
    条件でモデルを取得し、存在しない場合は404エラーを送出
    
    Args:
        db: データベースセッション
        statement: SQLModel select文
        detail: エラーメッセージ（省略時はデフォルトメッセージ）
        
    Returns:
        取得したモデルインスタンス
        
    Raises:
        HTTPException: モデルが存在しない場合
    """
    obj = db.exec(statement).first()
    if not obj:
        if detail is None:
            detail = "Resource not found"
        raise_not_found(detail)
    return obj


T = TypeVar('T')


def handle_sp_errors(func: Callable[..., T]) -> Callable[..., T]:
    """
    SP関連のエラーを自動的にHTTPExceptionに変換するデコレータ
    
    InsufficientSPError → 400 Bad Request
    SPSystemError → 500 Internal Server Error
    """
    @wraps(func)
    async def wrapper(*args, **kwargs) -> T:
        try:
            return await func(*args, **kwargs)
        except InsufficientSPError as e:
            # ユーザーIDを取得（current_userがある場合）
            user_id = None
            for arg in args:
                if hasattr(arg, 'id'):
                    user_id = arg.id
                    break
            if not user_id and 'current_user' in kwargs:
                user_id = kwargs['current_user'].id

            logger.warning(
                "Insufficient SP",
                user_id=user_id,
                error=str(e),
            )
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
        except SPSystemError as e:
            # ユーザーIDを取得（current_userがある場合）
            user_id = None
            for arg in args:
                if hasattr(arg, 'id'):
                    user_id = arg.id
                    break
            if not user_id and 'current_user' in kwargs:
                user_id = kwargs['current_user'].id

            logger.error(
                f"SP system error in {func.__name__}",
                user_id=user_id,
                error=str(e),
            )
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    return wrapper
