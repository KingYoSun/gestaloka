"""
カスタム例外のテスト
"""

from fastapi import status

from app.core.exceptions import (
    AIRateLimitError,
    AIServiceError,
    AITimeoutError,
    DatabaseError,
    InsufficientSPError,
    LogverseError,
    SPSystemError,
    to_http_exception,
)


class TestLogverseError:
    """LogverseError基本例外クラスのテスト"""

    def test_init_basic(self):
        """基本的な初期化テスト"""
        error = LogverseError("Test message")
        assert error.message == "Test message"
        assert error.code is None
        assert error.details == {}

    def test_init_with_code(self):
        """コード付き初期化テスト"""
        error = LogverseError("Test message", code="TEST_ERROR")
        assert error.message == "Test message"
        assert error.code == "TEST_ERROR"
        assert error.details == {}

    def test_init_with_details(self):
        """詳細情報付き初期化テスト"""
        details = {"field": "test_field", "value": 123}
        error = LogverseError("Test message", details=details)
        assert error.message == "Test message"
        assert error.code is None
        assert error.details == details


class TestDatabaseError:
    """DatabaseErrorのテスト"""

    def test_init_basic(self):
        """基本的な初期化テスト"""
        error = DatabaseError("Database connection failed")
        assert error.message == "Database connection failed"
        assert error.code == "DATABASE_ERROR"
        assert error.details == {}

    def test_init_with_operation(self):
        """操作名付き初期化テスト"""
        error = DatabaseError("Query failed", operation="insert")
        assert error.message == "Query failed"
        assert error.code == "DATABASE_ERROR"
        assert error.details == {"operation": "insert"}


class TestAIServiceError:
    """AIServiceErrorのテスト"""

    def test_init_basic(self):
        """基本的な初期化テスト"""
        error = AIServiceError("AI service unavailable")
        assert error.message == "AI service unavailable"
        assert error.code == "AI_SERVICE_ERROR"
        assert error.details == {}

    def test_init_with_service(self):
        """サービス名付き初期化テスト"""
        error = AIServiceError("Generation failed", service="gemini")
        assert error.message == "Generation failed"
        assert error.code == "AI_SERVICE_ERROR"
        assert error.details == {"service": "gemini"}


class TestAITimeoutError:
    """AITimeoutErrorのテスト"""

    def test_init_default(self):
        """デフォルト初期化テスト"""
        error = AITimeoutError()
        assert error.message == "AI service request timed out"
        assert error.code == "AI_SERVICE_ERROR"
        assert error.details == {"service": "timeout"}

    def test_init_custom_message(self):
        """カスタムメッセージ付き初期化テスト"""
        error = AITimeoutError("Custom timeout message")
        assert error.message == "Custom timeout message"
        assert error.code == "AI_SERVICE_ERROR"
        assert error.details == {"service": "timeout"}


class TestAIRateLimitError:
    """AIRateLimitErrorのテスト"""

    def test_init_default(self):
        """デフォルト初期化テスト"""
        error = AIRateLimitError()
        assert error.message == "AI service rate limit exceeded"
        assert error.code == "AI_SERVICE_ERROR"
        assert error.details == {"service": "rate_limit"}

    def test_init_custom_message(self):
        """カスタムメッセージ付き初期化テスト"""
        error = AIRateLimitError("Custom rate limit message")
        assert error.message == "Custom rate limit message"
        assert error.code == "AI_SERVICE_ERROR"
        assert error.details == {"service": "rate_limit"}


class TestSPSystemError:
    """SPSystemErrorのテスト"""

    def test_init_basic(self):
        """基本的な初期化テスト"""
        error = SPSystemError("SP calculation failed")
        assert error.message == "SP calculation failed"
        assert error.code == "SP_SYSTEM_ERROR"
        assert error.details == {}

    def test_init_with_operation(self):
        """操作名付き初期化テスト"""
        error = SPSystemError("SP update failed", operation="daily_recovery")
        assert error.message == "SP update failed"
        assert error.code == "SP_SYSTEM_ERROR"
        assert error.details == {"operation": "daily_recovery"}


class TestInsufficientSPError:
    """InsufficientSPErrorのテスト"""

    def test_init_default(self):
        """デフォルト初期化テスト"""
        error = InsufficientSPError()
        assert error.message == "Insufficient SP balance"
        assert error.code == "SP_SYSTEM_ERROR"
        assert error.details == {"operation": "consume"}

    def test_init_custom_message(self):
        """カスタムメッセージ付き初期化テスト"""
        error = InsufficientSPError("Need 10 SP but only have 5")
        assert error.message == "Need 10 SP but only have 5"
        assert error.code == "SP_SYSTEM_ERROR"
        assert error.details == {"operation": "consume"}


class TestToHttpException:
    """to_http_exception関数のテスト"""

    def test_database_error_conversion(self):
        """DatabaseErrorの変換テスト"""
        error = DatabaseError("DB error", operation="select")
        http_exc = to_http_exception(error)

        assert http_exc.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert http_exc.detail["message"] == "DB error"
        assert http_exc.detail["code"] == "DATABASE_ERROR"
        assert http_exc.detail["details"] == {"operation": "select"}

    def test_ai_service_error_conversion(self):
        """AIServiceErrorの変換テスト"""
        error = AIServiceError("AI error", service="gemini")
        http_exc = to_http_exception(error)

        assert http_exc.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
        assert http_exc.detail["message"] == "AI error"
        assert http_exc.detail["code"] == "AI_SERVICE_ERROR"
        assert http_exc.detail["details"] == {"service": "gemini"}

    def test_sp_system_error_conversion(self):
        """SPSystemErrorの変換テスト"""
        error = SPSystemError("SP error", operation="consume")
        http_exc = to_http_exception(error)

        assert http_exc.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert http_exc.detail["message"] == "SP error"
        assert http_exc.detail["code"] == "SP_SYSTEM_ERROR"
        assert http_exc.detail["details"] == {"operation": "consume"}

    def test_unknown_error_conversion(self):
        """未知のエラーコードの変換テスト"""
        error = LogverseError("Unknown error", code="UNKNOWN_ERROR")
        http_exc = to_http_exception(error)

        assert http_exc.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert http_exc.detail["message"] == "Unknown error"
        assert http_exc.detail["code"] == "UNKNOWN_ERROR"
        assert http_exc.detail["details"] == {}

    def test_no_code_error_conversion(self):
        """コードなしエラーの変換テスト"""
        error = LogverseError("No code error")
        http_exc = to_http_exception(error)

        assert http_exc.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert http_exc.detail["message"] == "No code error"
        assert http_exc.detail["code"] is None
        assert http_exc.detail["details"] == {}


class TestInheritance:
    """継承関係のテスト"""

    def test_all_errors_inherit_from_logverse_error(self):
        """全てのカスタム例外がLogverseErrorを継承していることを確認"""
        errors = [
            DatabaseError("test"),
            AIServiceError("test"),
            AITimeoutError(),
            AIRateLimitError(),
            SPSystemError("test"),
            InsufficientSPError(),
        ]

        for error in errors:
            assert isinstance(error, LogverseError)

    def test_ai_errors_inherit_from_ai_service_error(self):
        """AI関連エラーがAIServiceErrorを継承していることを確認"""
        assert isinstance(AITimeoutError(), AIServiceError)
        assert isinstance(AIRateLimitError(), AIServiceError)

    def test_sp_errors_inherit_from_sp_system_error(self):
        """SP関連エラーがSPSystemErrorを継承していることを確認"""
        assert isinstance(InsufficientSPError(), SPSystemError)
