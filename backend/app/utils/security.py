"""
セキュリティユーティリティ
"""

import secrets
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

from jose import jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def generate_uuid() -> str:
    """UUIDを生成"""
    return str(uuid.uuid4())


def generate_random_string(length: int = 32) -> str:
    """ランダム文字列を生成"""
    return secrets.token_urlsafe(length)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """パスワードを検証"""
    result: bool = pwd_context.verify(plain_password, hashed_password)
    return result


def get_password_hash(password: str) -> str:
    """パスワードをハッシュ化"""
    hashed: str = pwd_context.hash(password)
    return hashed


def create_access_token(
    subject: str, expires_delta: Optional[timedelta] = None, additional_claims: Optional[dict[str, Any]] = None
) -> str:
    """アクセストークンを作成"""
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode = {"exp": expire, "sub": str(subject), "iat": datetime.utcnow(), "type": "access"}

    if additional_claims:
        to_encode.update(additional_claims)

    encoded_jwt: str = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt


def verify_token(token: str) -> Optional[dict[str, Any]]:
    """トークンを検証"""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload  # type: ignore[no-any-return]
    except jwt.JWTError:
        return None


def is_safe_url(url: str, allowed_hosts: set) -> bool:
    """URLが安全かチェック"""
    from urllib.parse import urlparse

    try:
        parsed = urlparse(url)
        return parsed.netloc in allowed_hosts
    except Exception:
        return False


def sanitize_filename(filename: str) -> str:
    """ファイル名をサニタイズ"""
    import re

    # 危険な文字を除去
    filename = re.sub(r"[^\w\-_\.]", "", filename)

    # 長さ制限
    if len(filename) > 255:
        name, ext = filename.rsplit(".", 1) if "." in filename else (filename, "")
        filename = name[: 255 - len(ext) - 1] + "." + ext if ext else name[:255]

    return filename


def generate_csrf_token() -> str:
    """CSRFトークンを生成"""
    return secrets.token_urlsafe(32)


def constant_time_compare(val1: str, val2: str) -> bool:
    """定数時間での文字列比較"""
    return secrets.compare_digest(val1, val2)
