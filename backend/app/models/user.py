"""
ユーザーモデル
"""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.character import Character


class User(SQLModel, table=True):
    """ユーザーモデル"""

    __tablename__ = "users"

    id: str = Field(primary_key=True, index=True)
    username: str = Field(unique=True, index=True, max_length=50)
    email: str = Field(unique=True, index=True, max_length=255)
    hashed_password: str = Field(max_length=255)
    is_active: bool = Field(default=True)
    is_verified: bool = Field(default=False)
    is_superuser: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # リレーション
    characters: list["Character"] = Relationship(back_populates="user")

    def __repr__(self) -> str:
        return f"<User(id={self.id}, username={self.username})>"
