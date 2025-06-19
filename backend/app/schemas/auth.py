"""
認証関連スキーマ
"""

from typing import Optional

from pydantic import BaseModel, EmailStr, Field, validator

from app.schemas.user import User
from app.utils.validation import validate_password


class Token(BaseModel):
    """トークンスキーマ"""

    access_token: str
    token_type: str = "bearer"
    user: User


class TokenData(BaseModel):
    """トークンデータスキーマ"""

    user_id: Optional[str] = None


class UserLogin(BaseModel):
    """ユーザーログインスキーマ"""

    username: str = Field(..., description="ユーザー名")
    password: str = Field(..., description="パスワード")


class UserRegister(BaseModel):
    """ユーザー登録スキーマ"""

    username: str = Field(..., min_length=3, max_length=50, description="ユーザー名")
    email: EmailStr = Field(..., description="メールアドレス")
    password: str = Field(..., min_length=8, max_length=100, description="パスワード")
    confirm_password: str = Field(..., description="パスワード確認")

    @validator("password")
    def validate_password_strength(cls, v):  # noqa: N805
        """パスワード強度チェック"""
        return validate_password(v)

    @validator("confirm_password")
    def validate_passwords_match(cls, v, values):  # noqa: N805
        """パスワード一致チェック"""
        if "password" in values and v != values["password"]:
            raise ValueError("パスワードが一致しません")
        return v


class PasswordReset(BaseModel):
    """パスワードリセットスキーマ"""

    email: EmailStr = Field(..., description="メールアドレス")


class PasswordResetConfirm(BaseModel):
    """パスワードリセット確認スキーマ"""

    token: str = Field(..., description="リセットトークン")
    new_password: str = Field(..., min_length=8, max_length=100, description="新しいパスワード")

    @validator("new_password")
    def validate_new_password_strength(cls, v):  # noqa: N805
        """新しいパスワードの強度チェック"""
        return validate_password(v, "new_password")
