"""
テスト設定
"""

import os
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, create_engine, text

from alembic import command
from alembic.config import Config
from app.core.database import get_session
from app.main import app

# テストデータベースURL（開発用PostgreSQLコンテナを使用）
# Docker内で実行する場合はpostgres、ローカルで実行する場合はlocalhost
if os.environ.get("DOCKER_ENV"):
    TEST_DATABASE_URL = "postgresql://test_user:test_password@postgres:5432/gestaloka_test"
else:
    TEST_DATABASE_URL = "postgresql://test_user:test_password@localhost:5432/gestaloka_test"


@pytest.fixture(scope="session")
def test_engine():
    """テスト用データベースエンジン（セッション全体で1回だけ作成）"""
    # まず、メインデータベースに接続してテストデータベースを作成
    if os.environ.get("DOCKER_ENV"):
        main_db_url = "postgresql://postgres:postgres_root_password@postgres:5432/postgres"
    else:
        main_db_url = "postgresql://postgres:postgres_root_password@localhost:5432/postgres"
    main_engine = create_engine(main_db_url)

    with main_engine.connect() as conn:
        # 他の接続を切断
        conn.execute(text("COMMIT"))

        # テストデータベースが存在するか確認
        result = conn.execute(text("SELECT 1 FROM pg_database WHERE datname = 'gestaloka_test'"))
        db_exists = result.scalar() is not None

        if not db_exists:
            # データベースが存在しない場合のみ作成
            conn.execute(text("CREATE DATABASE gestaloka_test"))
            print("Test database created.")

    main_engine.dispose()

    # テストデータベースエンジンを作成
    engine = create_engine(
        TEST_DATABASE_URL,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )

    # テーブルが存在するか確認
    with engine.connect() as conn:
        result = conn.execute(
            text("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users')")
        )
        tables_exist = result.scalar()

    if not tables_exist:
        # テーブルが存在しない場合のみマイグレーション実行
        print("Running migrations...")
        alembic_ini_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "alembic.ini")
        alembic_cfg = Config(alembic_ini_path)
        alembic_cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)

        # 最新のマイグレーションを適用
        command.upgrade(alembic_cfg, "head")
        print("Migrations completed.")

    yield engine

    # テスト終了後のクリーンアップ
    engine.dispose()


@pytest.fixture(scope="function")
def session(test_engine) -> Generator[Session, None, None]:
    """テスト用データベースセッション（各テストで新しいトランザクション）"""
    connection = test_engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection)

    yield session

    # ロールバックしてデータをクリーンアップ
    session.rollback()  # セッションレベルでロールバック
    session.close()
    if transaction.is_active:  # トランザクションがまだアクティブな場合のみ
        transaction.rollback()
    connection.close()


@pytest.fixture(scope="function")
def client(session: Session) -> Generator[TestClient, None, None]:
    """テスト用FastAPIクライアント"""

    def get_session_override():
        return session

    app.dependency_overrides[get_session] = get_session_override

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


@pytest.fixture
def test_user_data():
    """テスト用ユーザーデータ"""
    return {"username": "testuser", "email": "test@example.com", "password": "TestPassword123!"}


@pytest.fixture
def test_character_data():
    """テスト用キャラクターデータ"""
    return {
        "name": "テストキャラクター",
        "description": "テスト用のキャラクターです",
        "appearance": "勇敢そうな外見",
        "personality": "好奇心旺盛で勇敢",
        "location": "starting_village",
    }


# 環境変数の設定（テスト実行前）
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["ENVIRONMENT"] = "test"

# Neo4j設定（テスト用）
# テスト用Neo4jコンテナを使用（ポート7688）
os.environ["NEO4J_URI"] = "bolt://neo4j-test:7687"
os.environ["NEO4J_USER"] = "neo4j"
os.environ["NEO4J_PASSWORD"] = "test_password"
os.environ["NEO4J_TEST_URL"] = "bolt://neo4j:test_password@neo4j-test:7687"
