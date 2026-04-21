"""
セキュリティユーティリティ
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Optional

from jose import jwt

from app.core.config import settings


def generate_uuid() -> str:
    """UUIDを生成"""
    return str(uuid.uuid4())


def create_access_token(
    subject: str, expires_delta: Optional[timedelta] = None, additional_claims: Optional[dict[str, Any]] = None
) -> str:
    """アクセストークンを作成"""
    if expires_delta:
        expire = datetime.now(UTC) + expires_delta
    else:
        expire = datetime.now(UTC) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode = {"exp": expire, "sub": str(subject), "iat": datetime.now(UTC), "type": "access"}

    if additional_claims:
        to_encode.update(additional_claims)

    encoded_jwt: str = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt


