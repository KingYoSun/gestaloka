"""
ユーザーロールモデル
"""

from datetime import datetime, UTC
from enum import Enum
from typing import Optional
from uuid import uuid4

from sqlmodel import Field, SQLModel


class RoleType(str, Enum):
    """ロールタイプ"""

    ADMIN = "admin"
    PLAYER = "player"
    MODERATOR = "moderator"


class UserRole(SQLModel, table=True):
    """ユーザーロール"""

    __tablename__ = "user_roles"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, index=True)
    user_id: str = Field(foreign_key="users.id", nullable=False, index=True)
    role: RoleType = Field(nullable=False)
    granted_at: datetime = Field(default_factory=lambda: datetime.now(UTC), nullable=False)
    granted_by: Optional[str] = Field(default=None, foreign_key="users.id")
