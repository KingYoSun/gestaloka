"""
カスタム例外定義
"""

from typing import Any, Optional

from fastapi import HTTPException, status


class LogverseError(Exception):
    """ログバースの基本例外クラス"""

    def __init__(self, message: str, code: Optional[str] = None, details: Optional[dict[str, Any]] = None):
        self.message = message
        self.code = code
        self.details = details or {}
        super().__init__(self.message)


class DatabaseError(LogverseError):
    """データベースエラー"""

    def __init__(self, message: str, operation: Optional[str] = None):
        details = {"operation": operation} if operation else {}
        super().__init__(message, code="DATABASE_ERROR", details=details)


class AIServiceError(LogverseError):
    """AI サービスエラー"""

    def __init__(self, message: str, service: Optional[str] = None):
        details = {"service": service} if service else {}
        super().__init__(message, code="AI_SERVICE_ERROR", details=details)


class AITimeoutError(AIServiceError):
    """AI サービスタイムアウトエラー"""

    def __init__(self, message: str = "AI service request timed out"):
        super().__init__(message, service="timeout")


class AIRateLimitError(AIServiceError):
    """AI サービスレート制限エラー"""

    def __init__(self, message: str = "AI service rate limit exceeded"):
        super().__init__(message, service="rate_limit")


class SPSystemError(LogverseError):
    """SPシステムエラー"""

    def __init__(self, message: str, operation: Optional[str] = None):
        details = {"operation": operation} if operation else {}
        super().__init__(message, code="SP_SYSTEM_ERROR", details=details)


class InsufficientSPError(SPSystemError):
    """SP残高不足エラー"""

    def __init__(self, message: str = "Insufficient SP balance"):
        super().__init__(message, operation="consume")


# HTTPException マッピング
def to_http_exception(exc: LogverseError) -> HTTPException:
    """
    カスタム例外をHTTPExceptionに変換

    Args:
        exc: LogverseError

    Returns:
        HTTPException
    """
    status_code_map = {
        "DATABASE_ERROR": status.HTTP_500_INTERNAL_SERVER_ERROR,
        "AI_SERVICE_ERROR": status.HTTP_503_SERVICE_UNAVAILABLE,
        "SP_SYSTEM_ERROR": status.HTTP_500_INTERNAL_SERVER_ERROR,
    }

    status_code = status_code_map.get(exc.code or "", status.HTTP_500_INTERNAL_SERVER_ERROR)

    return HTTPException(
        status_code=status_code, detail={"message": exc.message, "code": exc.code, "details": exc.details}
    )
