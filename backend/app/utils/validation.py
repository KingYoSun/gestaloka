"""
共通バリデーション関数
"""
from typing import Optional

from pydantic import ValidationError


def validate_password(password: str, field_name: str = "password") -> str:
    """
    パスワードの共通バリデーション
    
    Args:
        password: 検証するパスワード
        field_name: エラーメッセージで使用するフィールド名
        
    Returns:
        検証済みのパスワード
        
    Raises:
        ValueError: パスワードが要件を満たさない場合
    """
    if len(password) < 8:
        raise ValueError(f"{field_name} must be at least 8 characters long")
    if not any(char.isupper() for char in password):
        raise ValueError(f"{field_name} must contain at least one uppercase letter")
    if not any(char.islower() for char in password):
        raise ValueError(f"{field_name} must contain at least one lowercase letter")
    if not any(char.isdigit() for char in password):
        raise ValueError(f"{field_name} must contain at least one digit")
    return password