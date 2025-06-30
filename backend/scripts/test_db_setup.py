#!/usr/bin/env python
"""
テストデータベースのセットアップスクリプト
"""

import os
import sys
from pathlib import Path

# プロジェクトのルートパスを追加
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine, text

from alembic import command
from alembic.config import Config

# 環境変数チェック
if os.environ.get("DOCKER_ENV") or os.path.exists("/.dockerenv"):
    MAIN_DB_URL = "postgresql://gestaloka_user:gestaloka_password@postgres:5432/gestaloka"
    TEST_DB_URL = "postgresql://gestaloka_user:gestaloka_password@postgres:5432/gestaloka_test"
else:
    MAIN_DB_URL = "postgresql://gestaloka_user:gestaloka_password@localhost:5432/gestaloka"
    TEST_DB_URL = "postgresql://gestaloka_user:gestaloka_password@localhost:5432/gestaloka_test"


def setup_test_database():
    """テストデータベースを作成してマイグレーションを適用"""
    print("Setting up test database...")

    # メインデータベースに接続
    engine = create_engine(MAIN_DB_URL)

    with engine.connect() as conn:
        # 既存の接続を切断
        conn.execute(text("COMMIT"))
        conn.execute(text("""
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = 'gestaloka_test' AND pid <> pg_backend_pid()
        """))
        conn.execute(text("COMMIT"))

        # データベースを削除して再作成
        try:
            conn.execute(text("DROP DATABASE IF EXISTS gestaloka_test"))
        except Exception as e:
            print(f"Warning: {e}")
        conn.execute(text("COMMIT"))
        conn.execute(text("CREATE DATABASE gestaloka_test"))
        print("Test database created.")

    engine.dispose()

    # Alembicでマイグレーション実行
    alembic_cfg = Config(str(Path(__file__).parent.parent / "alembic.ini"))
    alembic_cfg.set_main_option("sqlalchemy.url", TEST_DB_URL)

    # 環境変数も設定
    os.environ["DATABASE_URL"] = TEST_DB_URL

    # 最新のマイグレーションを適用
    print("Running migrations...")
    print(f"Using database URL: {TEST_DB_URL}")
    command.upgrade(alembic_cfg, "head")
    print("Migrations completed.")

    # 確認
    test_engine = create_engine(TEST_DB_URL)
    with test_engine.connect() as conn:
        result = conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))
        tables = [row[0] for row in result]
        print(f"Tables created: {tables}")


if __name__ == "__main__":
    setup_test_database()
