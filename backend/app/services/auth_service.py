"""
認証サービス
"""

from datetime import UTC, datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
from sqlmodel import Session

from app.core.config import settings
from app.core.logging import LoggerMixin
from app.schemas.user import User
from app.services.user_service import UserService


class AuthService(LoggerMixin):
    """認証関連サービス"""

    def __init__(self, db: Session):
        super().__init__()
        self.db = db
        self.user_service = UserService(db)

    async def authenticate(self, username: str, password: str) -> Optional[User]:
        """ユーザー認証"""
        try:
            # ユーザー名またはメールアドレスで検索
            user = await self.user_service.get_by_username(username)
            if not user:
                user = await self.user_service.get_by_email(username)

            if not user:
                self.log_warning("Authentication failed - user not found", username=username)
                return None

            # ユーザーモデルを取得してパスワード検証
            from sqlmodel import select

            from app.models.user import User as UserModel

            statement = select(UserModel).where(UserModel.id == user.id)
            result = self.db.exec(statement)
            user_model = result.first()

            if not user_model or not self.user_service.verify_password(password, user_model.hashed_password):
                self.log_warning("Authentication failed - invalid password", username=username)
                return None

            if not user.is_active:
                self.log_warning("Authentication failed - user inactive", username=username)
                return None

            self.log_info("Authentication successful", user_id=user.id, username=username)
            return user

        except Exception as e:
            self.log_error("Authentication error", username=username, error=str(e))
            return None

    def create_access_token(self, user_id: str, expires_delta: Optional[timedelta] = None) -> str:
        """アクセストークンを作成"""
        try:
            if expires_delta:
                expire = datetime.now(UTC) + expires_delta
            else:
                expire = datetime.now(UTC) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

            to_encode = {"sub": user_id, "exp": expire, "iat": datetime.now(UTC), "type": "access"}

            encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

            self.log_info("Access token created", user_id=user_id, expires_at=expire.isoformat())
            return encoded_jwt  # type: ignore[no-any-return]

        except Exception as e:
            self.log_error("Failed to create access token", user_id=user_id, error=str(e))
            raise

    async def get_current_user(self, token: str) -> Optional[User]:
        """トークンから現在のユーザーを取得"""
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
            user_id: str = payload.get("sub")
            token_type: str = payload.get("type")

            if user_id is None or token_type != "access":
                self.log_warning("Invalid token payload", payload=payload)
                return None

        except JWTError as e:
            self.log_warning("JWT decode error", error=str(e))
            return None

        user = await self.user_service.get_by_id(user_id)
        if user is None:
            self.log_warning("User not found from token", user_id=user_id)
            return None

        return user

    def verify_token(self, token: str) -> Optional[dict]:
        """トークンを検証"""
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
            return payload  # type: ignore[no-any-return]
        except JWTError as e:
            self.log_warning("Token verification failed", error=str(e))
            return None
