#!/usr/bin/env python3
"""
ユーザー作成スクリプト
"""

import asyncio
import os
import sys
from getpass import getpass

# パスを追加
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from sqlmodel import Session

from app.core.database import engine
from app.core.logging import get_logger, setup_logging
from app.schemas.user import UserCreate
from app.services.user_service import UserService


async def main():
    """メイン処理"""
    # ログ設定
    setup_logging()
    logger = get_logger(__name__)

    try:
        print("=== ユーザー作成 ===")

        # ユーザー情報を入力
        username = input("ユーザー名: ")
        email = input("メールアドレス: ")
        password = getpass("パスワード: ")

        if not username or not email or not password:
            print("すべての項目を入力してください")
            sys.exit(1)

        # データベースセッション作成
        with Session(engine) as session:
            user_service = UserService(session)

            # ユーザー存在チェック
            existing_user = await user_service.get_by_username(username)
            if existing_user:
                print(f"ユーザー名 '{username}' は既に存在します")
                sys.exit(1)

            existing_user = await user_service.get_by_email(email)
            if existing_user:
                print(f"メールアドレス '{email}' は既に存在します")
                sys.exit(1)

            # ユーザー作成
            user_create = UserCreate(username=username, email=email, password=password)

            user = await user_service.create(user_create)

            print("✅ ユーザーが作成されました:")
            print(f"   ID: {user.id}")
            print(f"   ユーザー名: {user.username}")
            print(f"   メールアドレス: {user.email}")

            logger.info("User created via script", user_id=user.id, username=username)

    except Exception as e:
        logger.error("User creation failed", error=str(e))
        print(f"❌ エラー: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
