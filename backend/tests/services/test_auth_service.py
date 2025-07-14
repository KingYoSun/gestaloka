"""
認証サービスのユニットテスト
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import Mock, patch

import pytest
from jose import jwt
from sqlmodel import Session

from app.core.config import settings
from app.models.user import User as UserModel
from app.schemas.user import User
from app.services.auth_service import AuthService


class TestAuthService:
    """AuthServiceのテストクラス"""

    @pytest.fixture
    def mock_db(self):
        """モックデータベースセッション"""
        return Mock(spec=Session)

    @pytest.fixture
    def auth_service(self, mock_db):
        """AuthServiceインスタンス"""
        return AuthService(mock_db)

    @pytest.mark.asyncio
    async def test_authenticate_success(self, auth_service, mock_db):
        """認証成功のテスト"""
        # モックユーザーの準備
        mock_user = User(
            id="test-user-id",
            username="testuser",
            email="test@example.com",
            is_active=True,
            is_verified=False,
            roles=[],
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        mock_user_model = UserModel(
            id="test-user-id",
            username="testuser",
            email="test@example.com",
            is_active=True,
            is_verified=False,
            is_superuser=False,
            hashed_password="hashed_password_123",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )

        # UserServiceのモック
        with patch.object(auth_service.user_service, "get_by_username", return_value=mock_user):
            with patch.object(auth_service.user_service, "verify_password", return_value=True):
                # データベースクエリのモック
                mock_result = Mock()
                mock_result.first.return_value = mock_user_model
                mock_db.exec.return_value = mock_result

                # 認証実行
                result = await auth_service.authenticate("testuser", "password123")

                # 検証
                assert result is not None
                assert result.id == "test-user-id"
                assert result.username == "testuser"

    @pytest.mark.asyncio
    async def test_authenticate_user_not_found(self, auth_service):
        """ユーザーが見つからない場合のテスト"""
        # UserServiceのモック
        with patch.object(auth_service.user_service, "get_by_username", return_value=None):
            with patch.object(auth_service.user_service, "get_by_email", return_value=None):
                result = await auth_service.authenticate("nonexistent", "password123")
                assert result is None

    @pytest.mark.asyncio
    async def test_authenticate_invalid_password(self, auth_service, mock_db):
        """パスワードが無効な場合のテスト"""
        # モックユーザーの準備
        mock_user = User(
            id="test-user-id",
            username="testuser",
            email="test@example.com",
            is_active=True,
            is_verified=False,
            roles=[],
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        mock_user_model = UserModel(
            id="test-user-id",
            username="testuser",
            hashed_password="hashed_password_123",
        )

        # UserServiceのモック
        with patch.object(auth_service.user_service, "get_by_username", return_value=mock_user):
            with patch.object(auth_service.user_service, "verify_password", return_value=False):
                # データベースクエリのモック
                mock_result = Mock()
                mock_result.first.return_value = mock_user_model
                mock_db.exec.return_value = mock_result

                result = await auth_service.authenticate("testuser", "wrong_password")
                assert result is None

    @pytest.mark.asyncio
    async def test_authenticate_inactive_user(self, auth_service, mock_db):
        """非アクティブユーザーの認証テスト"""
        # モックユーザーの準備（非アクティブ）
        mock_user = User(
            id="test-user-id",
            username="testuser",
            email="test@example.com",
            is_active=False,  # 非アクティブ
            is_verified=False,
            roles=[],
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        mock_user_model = UserModel(
            id="test-user-id",
            username="testuser",
            hashed_password="hashed_password_123",
        )

        # UserServiceのモック
        with patch.object(auth_service.user_service, "get_by_username", return_value=mock_user):
            with patch.object(auth_service.user_service, "verify_password", return_value=True):
                # データベースクエリのモック
                mock_result = Mock()
                mock_result.first.return_value = mock_user_model
                mock_db.exec.return_value = mock_result

                result = await auth_service.authenticate("testuser", "password123")
                assert result is None

    @pytest.mark.asyncio
    async def test_authenticate_by_email(self, auth_service, mock_db):
        """メールアドレスでの認証テスト"""
        # モックユーザーの準備
        mock_user = User(
            id="test-user-id",
            username="testuser",
            email="test@example.com",
            is_active=True,
            is_verified=False,
            roles=[],
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        mock_user_model = UserModel(
            id="test-user-id",
            username="testuser",
            hashed_password="hashed_password_123",
        )

        # UserServiceのモック
        with patch.object(auth_service.user_service, "get_by_username", return_value=None):
            with patch.object(auth_service.user_service, "get_by_email", return_value=mock_user):
                with patch.object(auth_service.user_service, "verify_password", return_value=True):
                    # データベースクエリのモック
                    mock_result = Mock()
                    mock_result.first.return_value = mock_user_model
                    mock_db.exec.return_value = mock_result

                    result = await auth_service.authenticate("test@example.com", "password123")
                    assert result is not None
                    assert result.email == "test@example.com"

    @pytest.mark.asyncio
    async def test_authenticate_exception_handling(self, auth_service):
        """認証中の例外処理テスト"""
        # UserServiceのモックで例外を発生させる
        with patch.object(auth_service.user_service, "get_by_username", side_effect=Exception("DB Error")):
            result = await auth_service.authenticate("testuser", "password123")
            assert result is None

    def test_create_access_token(self, auth_service):
        """アクセストークン作成のテスト"""
        user_id = "test-user-id"
        token = auth_service.create_access_token(user_id)

        # トークンをデコードして検証
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        assert payload["sub"] == user_id
        assert payload["type"] == "access"
        assert "exp" in payload
        assert "iat" in payload

    def test_create_access_token_with_custom_expiry(self, auth_service):
        """カスタム有効期限でのアクセストークン作成テスト"""
        user_id = "test-user-id"
        expires_delta = timedelta(hours=1)
        token = auth_service.create_access_token(user_id, expires_delta)

        # トークンをデコードして検証
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        assert payload["sub"] == user_id

        # 有効期限が約1時間後であることを確認
        exp_time = datetime.fromtimestamp(payload["exp"], UTC)
        expected_time = datetime.now(UTC) + timedelta(hours=1)
        assert abs((exp_time - expected_time).total_seconds()) < 60  # 1分以内の差

    def test_create_access_token_exception(self, auth_service):
        """トークン作成中の例外処理テスト"""
        with patch("app.services.auth_service.jwt.encode", side_effect=Exception("Encoding error")):
            with pytest.raises(Exception):
                auth_service.create_access_token("test-user-id")

    @pytest.mark.asyncio
    async def test_get_current_user_success(self, auth_service):
        """現在のユーザー取得成功のテスト"""
        # 有効なトークンを作成
        user_id = "test-user-id"
        token = auth_service.create_access_token(user_id)

        # モックユーザー
        mock_user = User(
            id=user_id,
            username="testuser",
            email="test@example.com",
            is_active=True,
            is_verified=False,
            roles=[],
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )

        # UserServiceのモック
        with patch.object(auth_service.user_service, "get_by_id", return_value=mock_user):
            result = await auth_service.get_current_user(token)
            assert result is not None
            assert result.id == user_id

    @pytest.mark.asyncio
    async def test_get_current_user_invalid_token(self, auth_service):
        """無効なトークンでのユーザー取得テスト"""
        invalid_token = "invalid.token.here"
        result = await auth_service.get_current_user(invalid_token)
        assert result is None

    @pytest.mark.asyncio
    async def test_get_current_user_expired_token(self, auth_service):
        """期限切れトークンでのユーザー取得テスト"""
        # 期限切れのトークンを作成
        user_id = "test-user-id"
        expired_token = auth_service.create_access_token(user_id, timedelta(seconds=-1))

        result = await auth_service.get_current_user(expired_token)
        assert result is None

    @pytest.mark.asyncio
    async def test_get_current_user_invalid_type(self, auth_service):
        """無効なトークンタイプでのユーザー取得テスト"""
        # typeが"access"でないトークンを作成
        payload = {
            "sub": "test-user-id",
            "exp": datetime.now(UTC) + timedelta(minutes=30),
            "iat": datetime.now(UTC),
            "type": "refresh",  # 無効なタイプ
        }
        invalid_type_token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

        result = await auth_service.get_current_user(invalid_type_token)
        assert result is None

    @pytest.mark.asyncio
    async def test_get_current_user_user_not_found(self, auth_service):
        """トークンのユーザーが見つからない場合のテスト"""
        # 有効なトークンを作成
        user_id = "test-user-id"
        token = auth_service.create_access_token(user_id)

        # UserServiceのモック（ユーザーが見つからない）
        with patch.object(auth_service.user_service, "get_by_id", return_value=None):
            result = await auth_service.get_current_user(token)
            assert result is None

    @pytest.mark.asyncio
    async def test_get_current_user_inactive(self, auth_service):
        """非アクティブユーザーのトークンテスト"""
        # 有効なトークンを作成
        user_id = "test-user-id"
        token = auth_service.create_access_token(user_id)

        # モック非アクティブユーザー
        mock_user = User(
            id=user_id,
            username="testuser",
            email="test@example.com",
            is_active=False,  # 非アクティブ
            is_verified=False,
            roles=[],
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )

        # UserServiceのモック
        with patch.object(auth_service.user_service, "get_by_id", return_value=mock_user):
            result = await auth_service.get_current_user(token)
            # 非アクティブでもトークンが有効なら返す（実装に依存）
            assert result is not None  # 現在の実装では非アクティブチェックはしていない

    def test_revoke_token_not_implemented(self, auth_service):
        """トークン無効化メソッドのテスト（未実装）"""
        # revoke_tokenメソッドが実装されているか確認
        # 現在の実装では存在しないので、存在確認のみ
        assert hasattr(auth_service, "revoke_token") is False

