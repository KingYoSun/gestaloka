"""テスト用称号作成スクリプト

使用方法:
    docker-compose exec -T backend python scripts/create_test_titles.py [email]

引数:
    email: ユーザーのメールアドレス（省略時は test@example.com）
"""

import json
import os
import sys
import uuid
from datetime import datetime

import psycopg2


def create_test_titles(user_email="test@example.com"):
    """テスト用の称号を直接SQLで作成"""
    # 環境変数からデータベースURLを取得、なければデフォルト値を使用
    database_url = os.environ.get(
        "DATABASE_URL", "postgresql://gestaloka_user:gestaloka_password@postgres:5432/gestaloka"
    )
    conn = psycopg2.connect(database_url)
    cur = conn.cursor()

    try:
        # 指定されたユーザーのキャラクターIDを取得
        cur.execute(
            """
            SELECT c.id, c.name
            FROM characters c
            JOIN users u ON c.user_id = u.id
            WHERE u.email = %s
            LIMIT 1
        """,
            (user_email,),
        )
        result = cur.fetchone()

        if not result:
            print(f"ユーザー '{user_email}' のキャラクターが見つかりません。")
            # 利用可能なユーザーを表示
            cur.execute("""
                SELECT u.email, c.name
                FROM users u
                LEFT JOIN characters c ON u.id = c.user_id
                ORDER BY u.email
            """)
            users = cur.fetchall()
            if users:
                print("\n利用可能なユーザー:")
                for email, char_name in users:
                    if char_name:
                        print(f"  - {email} (キャラクター: {char_name})")
                    else:
                        print(f"  - {email} (キャラクターなし)")
            return

        character_id, character_name = result
        print(f"キャラクター '{character_name}' (ID: {character_id}) に称号を作成します。")

        # 既存の称号を削除
        cur.execute("DELETE FROM character_titles WHERE character_id = %s", (character_id,))

        # テスト用の称号を作成
        test_titles = [
            {
                "id": str(uuid.uuid4()),
                "character_id": character_id,
                "title": "英雄的犠牲者",
                "description": "勇気と犠牲の記憶を組み合わせて獲得した称号",
                "acquired_at": "編纂コンボボーナス",
                "effects": json.dumps({"攻撃力": "+10%", "防御力": "+5%"}),
                "is_equipped": False,
            },
            {
                "id": str(uuid.uuid4()),
                "character_id": character_id,
                "title": "三徳の守護者",
                "description": "勇気・友情・知恵の記憶を組み合わせて獲得した称号",
                "acquired_at": "編纂コンボボーナス",
                "effects": json.dumps({"全能力": "+15%", "SP回復": "+20%"}),
                "is_equipped": True,
            },
            {
                "id": str(uuid.uuid4()),
                "character_id": character_id,
                "title": "記憶の探求者",
                "description": "100個の記憶フラグメントを収集して獲得した称号",
                "acquired_at": "実績達成",
                "effects": json.dumps({"フラグメント発見率": "+30%"}),
                "is_equipped": False,
            },
            {
                "id": str(uuid.uuid4()),
                "character_id": character_id,
                "title": "伝説の編纂者",
                "description": "レジェンダリーレアリティのログを編纂して獲得した称号",
                "acquired_at": "編纂成功",
                "effects": json.dumps({"編纂SP消費": "-25%", "成功率": "+10%"}),
                "is_equipped": False,
            },
        ]

        # 称号を挿入
        for title in test_titles:
            cur.execute(
                """
                INSERT INTO character_titles
                (id, character_id, title, description, acquired_at, effects, is_equipped, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
                (
                    title["id"],
                    title["character_id"],
                    title["title"],
                    title["description"],
                    title["acquired_at"],
                    title["effects"],
                    title["is_equipped"],
                    datetime.utcnow(),
                    datetime.utcnow(),
                ),
            )

        conn.commit()
        print(f"\n✅ {len(test_titles)} 個の称号を作成しました。")

        # 作成した称号を表示
        print("\n作成した称号:")
        for title in test_titles:
            equipped = "【装備中】" if title["is_equipped"] else ""
            print(f"  - {title['title']} {equipped}")
            print(f"    {title['description']}")
            if title["effects"]:
                effects = json.loads(title["effects"])
                print(f"    効果: {', '.join([f'{k}: {v}' for k, v in effects.items()])}")
            print()

    except Exception as e:
        print(f"❌ エラーが発生しました: {e}")
        conn.rollback()
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    # コマンドライン引数からメールアドレスを取得
    email = sys.argv[1] if len(sys.argv) > 1 else "test@example.com"
    create_test_titles(email)
