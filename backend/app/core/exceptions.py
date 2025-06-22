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


class AuthenticationError(LogverseError):
    """認証エラー"""

    def __init__(self, message: str = "Authentication failed"):
        super().__init__(message, code="AUTH_ERROR")


class AuthorizationError(LogverseError):
    """認可エラー"""

    def __init__(self, message: str = "Insufficient permissions"):
        super().__init__(message, code="AUTHZ_ERROR")


class ValidationError(LogverseError):
    """バリデーションエラー"""

    def __init__(self, message: str, field: Optional[str] = None):
        details = {"field": field} if field else {}
        super().__init__(message, code="VALIDATION_ERROR", details=details)


class ResourceNotFoundError(LogverseError):
    """リソース不在エラー"""

    def __init__(self, resource_type: str, resource_id: str):
        message = f"{resource_type} with id '{resource_id}' not found"
        super().__init__(
            message, code="RESOURCE_NOT_FOUND", details={"resource_type": resource_type, "resource_id": resource_id}
        )


class ResourceConflictError(LogverseError):
    """リソース競合エラー"""

    def __init__(self, message: str, resource_type: Optional[str] = None):
        details = {"resource_type": resource_type} if resource_type else {}
        super().__init__(message, code="RESOURCE_CONFLICT", details=details)


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


class GameLogicError(LogverseError):
    """ゲームロジックエラー"""

    def __init__(self, message: str, action: Optional[str] = None):
        details = {"action": action} if action else {}
        super().__init__(message, code="GAME_LOGIC_ERROR", details=details)


class SessionError(LogverseError):
    """セッションエラー"""

    def __init__(self, message: str, session_id: Optional[str] = None):
        details = {"session_id": session_id} if session_id else {}
        super().__init__(message, code="SESSION_ERROR", details=details)


class WebSocketError(LogverseError):
    """WebSocketエラー"""

    def __init__(self, message: str, connection_id: Optional[str] = None):
        details = {"connection_id": connection_id} if connection_id else {}
        super().__init__(message, code="WEBSOCKET_ERROR", details=details)


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
        "AUTH_ERROR": status.HTTP_401_UNAUTHORIZED,
        "AUTHZ_ERROR": status.HTTP_403_FORBIDDEN,
        "VALIDATION_ERROR": status.HTTP_400_BAD_REQUEST,
        "RESOURCE_NOT_FOUND": status.HTTP_404_NOT_FOUND,
        "RESOURCE_CONFLICT": status.HTTP_409_CONFLICT,
        "DATABASE_ERROR": status.HTTP_500_INTERNAL_SERVER_ERROR,
        "AI_SERVICE_ERROR": status.HTTP_503_SERVICE_UNAVAILABLE,
        "GAME_LOGIC_ERROR": status.HTTP_400_BAD_REQUEST,
        "SESSION_ERROR": status.HTTP_400_BAD_REQUEST,
        "WEBSOCKET_ERROR": status.HTTP_400_BAD_REQUEST,
        "SP_SYSTEM_ERROR": status.HTTP_500_INTERNAL_SERVER_ERROR,
    }

    status_code = status_code_map.get(exc.code or "", status.HTTP_500_INTERNAL_SERVER_ERROR)

    return HTTPException(
        status_code=status_code, detail={"message": exc.message, "code": exc.code, "details": exc.details}
    )
