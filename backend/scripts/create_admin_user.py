#!/usr/bin/env python3
"""
管理者ユーザー作成スクリプト
"""

import asyncio
import sys
from pathlib import Path

# プロジェクトルートをPythonパスに追加
sys.path.append(str(Path(__file__).parent.parent))

from sqlmodel import Session, select, create_engine

from app.core.config import settings
from app.models.user import User
from app.models.user_role import UserRole, RoleType
from app.schemas.user import UserCreate
from app.services.user_service import UserService
from app.utils.security import generate_uuid


async def create_admin_user():
    """管理者ユーザーを作成"""
    engine = create_engine(settings.DATABASE_URL, echo=False)
    
    # ユーザー情報を設定（実際の運用では環境変数から取得するべき）
    admin_username = "admin"
    admin_email = "admin@example.com"
    admin_password = "Admin123456!"  # 本番環境では強力なパスワードを使用
    
    with Session(engine) as db:
        # 既存のadminユーザーをチェック
        user_service = UserService(db)
        existing_user = await user_service.get_by_username(admin_username)
        
        if existing_user:
            print(f"Admin user '{admin_username}' already exists")
            
            # adminロールを持っているかチェック
            stmt = select(UserRole).where(
                UserRole.user_id == existing_user.id,
                UserRole.role == RoleType.ADMIN
            )
            admin_role = db.exec(stmt).first()
            
            if not admin_role:
                # adminロールを付与
                admin_role = UserRole(
                    id=generate_uuid(),
                    user_id=existing_user.id,
                    role=RoleType.ADMIN
                )
                db.add(admin_role)
                db.commit()
                print(f"Admin role granted to user '{admin_username}'")
            else:
                print(f"User '{admin_username}' already has admin role")
        else:
            # 新規adminユーザーを作成
            user_create = UserCreate(
                username=admin_username,
                email=admin_email,
                password=admin_password
            )
            
            # ユーザーを作成（デフォルトでplayerロールが付与される）
            new_user = await user_service.create(user_create)
            
            # adminロールを追加
            admin_role = UserRole(
                id=generate_uuid(),
                user_id=new_user.id,
                role=RoleType.ADMIN
            )
            db.add(admin_role)
            db.commit()
            
            print(f"Admin user created successfully:")
            print(f"  Username: {admin_username}")
            print(f"  Email: {admin_email}")
            print(f"  Password: {admin_password}")
            print(f"  Roles: player, admin")
            print("\n⚠️  Please change the password immediately after first login!")


if __name__ == "__main__":
    asyncio.run(create_admin_user())