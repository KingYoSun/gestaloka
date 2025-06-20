#!/usr/bin/env python3
"""シンプルなテストデータ作成スクリプト（APIを使用）"""

import asyncio
import aiohttp
import json
from datetime import datetime

# APIのベースURL
BASE_URL = "http://localhost:8000"

# テスト用の認証情報
TEST_USER = {
    "email": "test@example.com",
    "password": "testpassword123"  # 8文字以上必須
}

# テストキャラクターのデータ
TEST_CHARACTER = {
    "name": "テスト戦士エリス",
    "description": "勇敢な女性戦士。正義感が強く、困っている人を見過ごせない性格。",
    "appearance": "銀色の鎧を身にまとい、長い金髪を風になびかせる凛々しい姿。",
    "personality": "勇敢で正義感が強い。仲間思い。",
    "stats": {
        "health": 100,
        "max_health": 100,
        "stamina": 100,
        "max_stamina": 100,
        "mana": 50,
        "max_mana": 50,
        "experience": 0,
        "level": 1
    },
    "skills": [
        {"name": "剣術", "level": 8, "description": "剣を使った戦闘技術"},
        {"name": "盾術", "level": 7, "description": "盾を使った防御技術"},
        {"name": "応急手当", "level": 5, "description": "簡単な治療技術"}
    ]
}

# ログフラグメントのテストデータ
TEST_FRAGMENTS = [
    {
        "action_description": "荒野の獣との戦闘で巧みな戦術を用いて勝利した",
        "keywords": ["戦闘", "戦術", "勝利"],
        "emotional_valence": "positive",
        "context_data": {"location": "荒野", "weather": "晴れ"}
    },
    {
        "action_description": "困っている旅人を助け、感謝の言葉を受けた",
        "keywords": ["善行", "助け", "感謝"],
        "emotional_valence": "positive",
        "context_data": {"location": "街道", "weather": "曇り"}
    },
    {
        "action_description": "油断から敵の罠にかかり、重傷を負った",
        "keywords": ["失敗", "罠", "負傷"],
        "emotional_valence": "negative",
        "context_data": {"location": "洞窟", "weather": "不明"}
    },
    {
        "action_description": "古代の遺跡で貴重な遺物を発見した",
        "keywords": ["探索", "発見", "遺跡"],
        "emotional_valence": "positive",
        "context_data": {"location": "遺跡", "weather": "霧"}
    },
    {
        "action_description": "静かな夜に星空を眺めて過ごした",
        "keywords": ["休息", "平穏", "内省"],
        "emotional_valence": "neutral",
        "context_data": {"location": "野営地", "weather": "晴れ"}
    },
]


async def main():
    """メイン処理"""
    async with aiohttp.ClientSession() as session:
        print("=== テストデータ作成開始 ===\n")
        
        # 1. ユーザー登録またはログイン
        print("1. ユーザー認証...")
        
        # まずログインを試みる
        login_response = await session.post(
            f"{BASE_URL}/api/v1/auth/login",
            data={"username": TEST_USER["email"], "password": TEST_USER["password"]}
        )
        
        if login_response.status == 200:
            auth_data = await login_response.json()
            print("✅ ログイン成功")
        else:
            # ログイン失敗したら新規登録
            print("新規ユーザー登録中...")
            register_response = await session.post(
                f"{BASE_URL}/api/v1/auth/register",
                json={
                    "email": TEST_USER["email"],
                    "username": "testuser",
                    "password": TEST_USER["password"],
                    "confirm_password": TEST_USER["password"]
                }
            )
            
            if register_response.status == 201 or register_response.status == 200:
                print("✅ ユーザー登録成功")
                # 再度ログイン
                login_response = await session.post(
                    f"{BASE_URL}/api/v1/auth/login",
                    data={"username": TEST_USER["email"], "password": TEST_USER["password"]}
                )
                auth_data = await login_response.json()
            else:
                print("❌ ユーザー登録失敗")
                error_text = await register_response.text()
                print(f"エラー: {error_text}")
                return
        
        # 認証ヘッダーを設定
        headers = {"Authorization": f"Bearer {auth_data['access_token']}"}
        
        # 2. キャラクター作成
        print("\n2. キャラクター作成...")
        char_response = await session.post(
            f"{BASE_URL}/api/v1/characters",
            json=TEST_CHARACTER,
            headers=headers
        )
        
        if char_response.status == 201 or char_response.status == 200:
            character_data = await char_response.json()
            character_id = character_data["id"]
            print(f"✅ キャラクター作成成功: {character_data['name']} (ID: {character_id})")
        else:
            print("❌ キャラクター作成失敗")
            error_text = await char_response.text()
            print(f"エラー: {error_text}")
            return
        
        # 3. ゲームセッション作成
        print("\n3. ゲームセッション作成...")
        session_response = await session.post(
            f"{BASE_URL}/api/v1/sessions",
            json={"character_id": character_id},
            headers=headers
        )
        
        if session_response.status == 201 or session_response.status == 200:
            session_data = await session_response.json()
            session_id = session_data["id"]
            print(f"✅ ゲームセッション作成成功 (ID: {session_id})")
        else:
            print("❌ ゲームセッション作成失敗")
            return
        
        # 4. ログフラグメント作成
        print("\n4. ログフラグメント作成...")
        for i, fragment in enumerate(TEST_FRAGMENTS):
            fragment_data = {
                "character_id": character_id,
                "session_id": session_id,
                **fragment
            }
            
            fragment_response = await session.post(
                f"{BASE_URL}/api/v1/logs/fragments",
                json=fragment_data,
                headers=headers
            )
            
            if fragment_response.status == 201 or fragment_response.status == 200:
                print(f"✅ フラグメント {i+1}/{len(TEST_FRAGMENTS)} 作成成功")
            else:
                print(f"❌ フラグメント {i+1} 作成失敗")
        
        print("\n=== テストデータ作成完了 ===")
        print(f"作成されたデータ:")
        print(f"- ユーザー: {TEST_USER['email']}")
        print(f"- キャラクター: {TEST_CHARACTER['name']} (ID: {character_id})")
        print(f"- ゲームセッション: ID {session_id}")
        print(f"- ログフラグメント: {len(TEST_FRAGMENTS)}個")
        print("\nブラウザで http://localhost:3000/logs にアクセスして確認してください。")


if __name__ == "__main__":
    asyncio.run(main())