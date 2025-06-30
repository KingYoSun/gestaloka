"""
ユーザーロールモデル
"""

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlmodel import Field, SQLModel


class RoleType(str, Enum):
    """ロールタイプ"""
    ADMIN = "admin"
    PLAYER = "player"
    MODERATOR = "moderator"


class UserRole(SQLModel, table=True):
    """ユーザーロール"""
    __tablename__ = "user_roles"

    id: Optional[str] = Field(default=None, primary_key=True, nullable=False, index=True)
    user_id: str = Field(foreign_key="users.id", nullable=False, index=True)
    role: RoleType = Field(nullable=False)
    granted_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    granted_by: Optional[str] = Field(default=None, foreign_key="users.id")
