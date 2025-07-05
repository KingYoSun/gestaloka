#!/usr/bin/env python3
"""テストユーザーとキャラクターを作成するスクリプト"""
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlmodel import Session, select
from app.core.database import engine
from app.models.user import User
from app.models.character import Character
from app.utils.security import get_password_hash
from datetime import datetime
import uuid

def create_test_data():
    with Session(engine) as db:
        # テストユーザーの確認/作成
        existing_user = db.exec(select(User).where(User.email == "test@example.com")).first()
        
        if not existing_user:
            test_user = User(
                id=str(uuid.uuid4()),
                username="testuser",
                email="test@example.com",
                hashed_password=get_password_hash("password123"),
                is_active=True,
                is_verified=True,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(test_user)
            db.commit()
            print(f"Created test user: {test_user.email}")
        else:
            test_user = existing_user
            print(f"Test user already exists: {test_user.email}")
        
        # キャラクターの確認/作成
        existing_char = db.exec(select(Character).where(Character.user_id == test_user.id)).first()
        
        if not existing_char:
            test_character = Character(
                id=str(uuid.uuid4()),
                user_id=test_user.id,
                name="テストキャラクター",
                level=1,
                experience=0,
                strength=10,
                dexterity=10,
                intelligence=10,
                luck=10,
                health=100,
                max_health=100,
                is_active=True,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(test_character)
            db.commit()
            print(f"Created test character: {test_character.name}")
        else:
            print(f"Character already exists: {existing_char.name}")

if __name__ == "__main__":
    create_test_data()