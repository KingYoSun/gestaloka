#!/usr/bin/env python3
"""テスト用のキャラクターとゲームセッションを作成するスクリプト"""

import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio
from datetime import datetime
from uuid import uuid4

from sqlalchemy import select
from sqlmodel import Session

from app.core.database import engine
from app.models.character import Character, GameSession
from app.models.user import User
from app.schemas.character import CharacterStats, Skill


async def create_test_character_and_session():
    """テスト用のキャラクターとゲームセッションを作成する"""
    with Session(engine) as session:
        # 既存のユーザーを取得（テスト用ユーザー）
        user_query = session.exec(select(User).where(User.email == "test@example.com"))
        user = user_query.first() if user_query else None

        if not user:
            # テストユーザーが存在しない場合は作成
            print("テストユーザーを作成中...")
            user = User(
                id=str(uuid4()),
                email="test@example.com",
                username="testuser",
                hashed_password="$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW",  # secret
                is_active=True,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(user)
            session.commit()
            session.refresh(user)
            print(f"✅ テストユーザーを作成しました: {user.username}")

        # 既存のキャラクターをチェック
        existing_chars = session.exec(
            select(Character).where(Character.user_id == user.id)
        ).all()

        if existing_chars:
            print(f"既に{len(existing_chars)}個のキャラクターが存在します")

            # 既存のセッションをチェック
            existing_sessions = session.exec(select(GameSession)).all()
            if existing_sessions:
                print(f"既に{len(existing_sessions)}個のゲームセッションが存在します")
                return

        # テストキャラクターのデータ
        test_characters = [
            {
                "name": "エリス・ブレイブハート",
                "description": "勇敢な女性戦士。正義感が強く、困っている人を見過ごせない性格。",
                "appearance": "銀色の鎧を身にまとい、長い金髪を風になびかせる凛々しい姿。瞳は澄んだ青色。",
                "personality": "勇敢で正義感が強い。仲間思いで、時に無鉄砲な行動を取ることも。",
                "skills": [
                    {"name": "剣術", "level": 8, "description": "剣を使った戦闘技術"},
                    {"name": "盾術", "level": 7, "description": "盾を使った防御技術"},
                    {"name": "応急手当", "level": 5, "description": "簡単な治療技術"}
                ]
            },
            {
                "name": "シャドウ・ウィスパー",
                "description": "謎多き盗賊。影のように静かに行動し、情報収集を得意とする。",
                "appearance": "黒いフードで顔を隠し、軽装の革鎧を着用。鋭い緑の瞳が闇の中で光る。",
                "personality": "冷静沈着で観察力が鋭い。他人を簡単に信用しないが、一度信頼した相手には忠実。",
                "skills": [
                    {"name": "隠密", "level": 9, "description": "音を立てずに行動する技術"},
                    {"name": "鍵開け", "level": 8, "description": "錠前を開ける技術"},
                    {"name": "情報収集", "level": 7, "description": "情報を集める技術"}
                ]
            },
            {
                "name": "アルカディウス・セージ",
                "description": "古代の知識を求める賢者。魔法の研究に人生を捧げている。",
                "appearance": "長い白髭を蓄えた老人。青いローブに身を包み、水晶の杖を携えている。",
                "personality": "知識欲が旺盛で、新しい発見に目を輝かせる。優しく穏やかだが、研究のこととなると熱くなる。",
                "skills": [
                    {"name": "火炎魔法", "level": 9, "description": "火を操る魔法"},
                    {"name": "治癒魔法", "level": 7, "description": "傷を癒す魔法"},
                    {"name": "古代言語", "level": 10, "description": "古代の文字を読む技術"}
                ]
            }
        ]

        created_characters = []

        # キャラクターを作成
        for char_data in test_characters:
            # 初期ステータス
            initial_stats = CharacterStats(
                health=100,
                max_health=100,
                stamina=100,
                max_stamina=100,
                mana=50,
                max_mana=50,
                experience=0,
                level=1
            )

            # スキル
            skills = [Skill(**skill_data) for skill_data in char_data["skills"]]

            character = Character(
                id=str(uuid4()),
                user_id=user.id,
                name=char_data["name"],
                description=char_data["description"],
                appearance=char_data["appearance"],
                personality=char_data["personality"],
                location="始まりの街",
                is_active=True,
                stats=initial_stats,
                skills=skills,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )

            session.add(character)
            created_characters.append(character)
            print(f"✅ キャラクターを作成しました: {character.name}")

        # 各キャラクターにゲームセッションを作成
        for character in created_characters:
            game_session = GameSession(
                id=str(uuid4()),
                character_id=character.id,
                is_active=True,
                current_scene="街の広場で新たな冒険の準備をしている",
                session_data='{"turn": 1, "time_of_day": "morning", "weather": "clear"}',
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(game_session)
            print(f"✅ ゲームセッションを作成しました: {character.name}のセッション")

        session.commit()

        print("\n=== 作成完了 ===")
        print(f"キャラクター数: {len(created_characters)}")
        print(f"ゲームセッション数: {len(created_characters)}")
        print("\nこれでログフラグメントのテストデータを作成できます。")


if __name__ == "__main__":
    asyncio.run(create_test_character_and_session())
