"""
ユーザーサービス
"""

from typing import Optional

from passlib.context import CryptContext
from sqlmodel import Session, select

from app.core.logging import get_logger
from app.models.user import User as UserModel
from app.models.user_role import RoleType, UserRole
from app.schemas.user import User, UserCreate, UserUpdate
from app.utils.security import generate_uuid

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
logger = get_logger(__name__)


class UserService:
    """ユーザー関連サービス"""

    def __init__(self, db: Session):
        self.db = db

    async def _get_user_roles(self, user_id: str) -> list[str]:
        """ユーザーのロールを取得"""
        try:
            statement = select(UserRole).where(UserRole.user_id == user_id)
            result = self.db.exec(statement)
            roles = result.all()
            return [role.role.value for role in roles]
        except Exception as e:
            logger.error("Failed to get user roles", user_id=user_id, error=str(e))
            return []

    async def get_by_id(self, user_id: str) -> Optional[User]:
        """IDでユーザーを取得"""
        try:
            statement = select(UserModel).where(UserModel.id == user_id)
            result = self.db.exec(statement)
            user = result.first()
            if not user:
                return None

            # ロール情報を取得
            roles = await self._get_user_roles(user_id)

            # Userスキーマに変換
            user_schema = User.model_validate(user)
            user_schema.roles = roles
            return user_schema
        except Exception as e:
            logger.error("Failed to get user by ID", user_id=user_id, error=str(e))
            raise

    async def get_by_username(self, username: str) -> Optional[User]:
        """ユーザー名でユーザーを取得"""
        try:
            statement = select(UserModel).where(UserModel.username == username)
            result = self.db.exec(statement)
            user = result.first()
            if not user:
                return None

            # ロール情報を取得
            roles = await self._get_user_roles(user.id)

            # Userスキーマに変換
            user_schema = User.model_validate(user)
            user_schema.roles = roles
            return user_schema
        except Exception as e:
            logger.error("Failed to get user by username", username=username, error=str(e))
            raise

    async def get_by_email(self, email: str) -> Optional[User]:
        """メールアドレスでユーザーを取得"""
        try:
            statement = select(UserModel).where(UserModel.email == email)
            result = self.db.exec(statement)
            user = result.first()
            if not user:
                return None

            # ロール情報を取得
            roles = await self._get_user_roles(user.id)

            # Userスキーマに変換
            user_schema = User.model_validate(user)
            user_schema.roles = roles
            return user_schema
        except Exception as e:
            logger.error("Failed to get user by email", email=email, error=str(e))
            raise

    async def create(self, user_create: UserCreate) -> User:
        """新しいユーザーを作成"""
        try:
            # ユーザー名の重複チェック
            existing_user = await self.get_by_username(user_create.username)
            if existing_user:
                raise ValueError(f"Username '{user_create.username}' already exists")

            # メールアドレスの重複チェック
            existing_email = await self.get_by_email(user_create.email)
            if existing_email:
                raise ValueError(f"Email '{user_create.email}' already exists")

            # パスワードをハッシュ化
            hashed_password = pwd_context.hash(user_create.password)

            # ユーザーモデルを作成
            user_model = UserModel(
                id=generate_uuid(),
                username=user_create.username,
                email=user_create.email,
                hashed_password=hashed_password,
                is_active=True,
                is_verified=False,
            )

            self.db.add(user_model)
            self.db.commit()
            self.db.refresh(user_model)

            # デフォルトのplayerロールを付与
            default_role = UserRole(id=generate_uuid(), user_id=user_model.id, role=RoleType.PLAYER)
            self.db.add(default_role)
            self.db.commit()

            logger.info("User created", user_id=user_model.id, username=user_create.username)

            # ロール情報を含めて返す
            user_schema = User.model_validate(user_model)
            user_schema.roles = [RoleType.PLAYER.value]
            return user_schema

        except Exception as e:
            self.db.rollback()
            logger.error("Failed to create user", username=user_create.username, error=str(e))
            raise

    async def update(self, user_id: str, user_update: UserUpdate) -> Optional[User]:
        """ユーザー情報を更新"""
        try:
            statement = select(UserModel).where(UserModel.id == user_id)
            result = self.db.exec(statement)
            user = result.first()

            if not user:
                return None

            # 更新データを適用
            if user_update.username is not None:
                # ユーザー名の重複チェック（自分自身は除外）
                existing_user = await self.get_by_username(user_update.username)
                if existing_user and existing_user.id != user_id:
                    raise ValueError(f"Username '{user_update.username}' already exists")
                user.username = user_update.username

            if user_update.email is not None:
                # メールアドレスの重複チェック（自分自身は除外）
                existing_email = await self.get_by_email(user_update.email)
                if existing_email and existing_email.id != user_id:
                    raise ValueError(f"Email '{user_update.email}' already exists")
                user.email = user_update.email

            self.db.add(user)
            self.db.commit()
            self.db.refresh(user)

            logger.info("User updated", user_id=user_id)
            return User.model_validate(user)

        except Exception as e:
            self.db.rollback()
            logger.error("Failed to update user", user_id=user_id, error=str(e))
            raise

    async def delete(self, user_id: str) -> bool:
        """ユーザーを削除"""
        try:
            statement = select(UserModel).where(UserModel.id == user_id)
            result = self.db.exec(statement)
            user = result.first()

            if not user:
                return False

            # ソフトデリート（is_activeをFalseにする）
            user.is_active = False
            self.db.add(user)
            self.db.commit()

            logger.info("User deleted", user_id=user_id)
            return True

        except Exception as e:
            self.db.rollback()
            logger.error("Failed to delete user", user_id=user_id, error=str(e))
            raise

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """パスワードを検証"""
        result: bool = pwd_context.verify(plain_password, hashed_password)
        return result

    def get_password_hash(self, password: str) -> str:
        """パスワードをハッシュ化"""
        hashed: str = pwd_context.hash(password)
        return hashed
