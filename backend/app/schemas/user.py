"""
ユーザー関連スキーマ
"""

from datetime import datetime
from typing import ClassVar, Optional

from pydantic import BaseModel, EmailStr, Field, validator

from app.utils.validation import validate_password


class UserBase(BaseModel):
    """ユーザーベーススキーマ"""

    username: str = Field(..., min_length=3, max_length=50, description="ユーザー名")
    email: EmailStr = Field(..., description="メールアドレス")


class UserCreate(UserBase):
    """ユーザー作成スキーマ"""

    password: str = Field(..., min_length=8, max_length=100, description="パスワード")

    @validator("password")
    def validate_password_strength(cls, v):  # noqa: N805
        return validate_password(v)


class UserUpdate(BaseModel):
    """ユーザー更新スキーマ"""

    username: Optional[str] = Field(None, min_length=3, max_length=50)
    email: Optional[EmailStr] = None


class UserPasswordUpdate(BaseModel):
    """パスワード更新スキーマ"""

    current_password: str = Field(..., description="現在のパスワード")
    new_password: str = Field(..., min_length=8, max_length=100, description="新しいパスワード")

    @validator("new_password")
    def validate_new_password_strength(cls, v):  # noqa: N805
        return validate_password(v, "new_password")


class User(UserBase):
    """ユーザースキーマ（レスポンス用）"""

    id: str
    is_active: bool = True
    is_verified: bool = False
    roles: list[str] = Field(default_factory=list, description="ユーザーのロール一覧")
    created_at: datetime
    updated_at: datetime

    model_config: ClassVar = {"from_attributes": True}


class UserInDB(User):
    """DB内ユーザースキーマ"""

    hashed_password: str
