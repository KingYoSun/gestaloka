"""
認証エンドポイント
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlmodel import Session

from app.core.database import get_session
from app.core.logging import get_logger
from app.schemas.auth import Token, UserRegister
from app.schemas.user import User, UserCreate
from app.services.auth_service import AuthService
from app.services.user_service import UserService

router = APIRouter()
logger = get_logger(__name__)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


@router.post("/register", response_model=User, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserRegister, db: Session = Depends(get_session)) -> Any:
    """新規ユーザー登録"""
    try:
        user_service = UserService(db)
        # auth_service = AuthService(db)  # TODO: 実装時に使用

        # ユーザー存在チェック
        if await user_service.get_by_email(user_data.email):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="このメールアドレスは既に登録されています"
            )

        if await user_service.get_by_username(user_data.username):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="このユーザー名は既に使用されています")

        # ユーザー作成
        user_create = UserCreate(username=user_data.username, email=user_data.email, password=user_data.password)
        user = await user_service.create(user_create)

        logger.info("User registered", user_id=user.id, username=user.username)
        return user

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Registration failed", error=str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="ユーザー登録に失敗しました")


@router.post("/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_session)) -> Any:
    """ユーザーログイン"""
    try:
        auth_service = AuthService(db)

        # 認証
        user = await auth_service.authenticate(username=form_data.username, password=form_data.password)

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="ユーザー名またはパスワードが正しくありません",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # トークン生成
        access_token = auth_service.create_access_token(user.id)

        logger.info("User logged in", user_id=user.id, username=user.username)

        return Token(access_token=access_token, token_type="bearer", user=user)

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Login failed", error=str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="ログインに失敗しました")


@router.post("/logout")
async def logout(token: str = Depends(oauth2_scheme), db: Session = Depends(get_session)) -> Any:
    """ユーザーログアウト"""
    try:
        auth_service = AuthService(db)
        user = await auth_service.get_current_user(token)
        if user:
            logger.info("User logged out", user_id=user.id)
        # TODO: トークン無効化の実装
        return {"message": "ログアウトしました"}

    except Exception as e:
        logger.error("Logout failed", error=str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="ログアウトに失敗しました")


async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_session)) -> User:
    """現在のユーザーを取得（依存関数）"""
    try:
        auth_service = AuthService(db)
        user = await auth_service.get_current_user(token)

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="認証が必要です",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return user

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Token validation failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="無効なトークンです",
            headers={"WWW-Authenticate": "Bearer"},
        )


@router.get("/me", response_model=User)
async def get_current_user_info(current_user: User = Depends(get_current_user)) -> Any:
    """現在のユーザー情報を取得"""
    return current_user
