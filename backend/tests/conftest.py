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

# モデルのインポート（関係解決のため）
from app.models.character import Character  # noqa
from app.models.location import Location  # noqa
from app.models.log import CompletedLog  # noqa
from app.models.sp import PlayerSP  # noqa
from app.models.story_arc import StoryArc  # noqa
from app.models.user import User  # noqa

# テスト環境設定定数
TEST_DB_NAME = "gestaloka_test"
TEST_DB_USER = "test_user"
TEST_DB_PASSWORD = "test_password"
TEST_NEO4J_USER = "neo4j"
TEST_NEO4J_PASSWORD = "test_password"

# データベース接続設定
DB_POOL_SIZE = 5
DB_MAX_OVERFLOW = 10

# 環境判定ヘルパー関数
def is_docker_env() -> bool:
    """Docker環境で実行されているかを判定"""
    return bool(os.environ.get("DOCKER_ENV"))

# データベースURL構築ヘルパー関数
def get_postgres_url(database: str = TEST_DB_NAME, user: str = TEST_DB_USER, password: str = TEST_DB_PASSWORD) -> str:
    """環境に応じたPostgreSQLのURLを構築"""
    host = "postgres" if is_docker_env() else "localhost"
    return f"postgresql://{user}:{password}@{host}:5432/{database}"

# テストデータベースURL
TEST_DATABASE_URL = get_postgres_url()


@pytest.fixture(scope="session")
def test_engine():
    """テスト用データベースエンジン（セッション全体で1回だけ作成）"""
    # まず、メインデータベースに接続してテストデータベースを作成
    main_db_url = get_postgres_url(database="postgres", user="postgres", password="postgres_root_password")
    main_engine = create_engine(main_db_url)

    with main_engine.connect() as conn:
        # 他の接続を切断
        conn.execute(text("COMMIT"))

        # テストデータベースが存在するか確認
        result = conn.execute(text(f"SELECT 1 FROM pg_database WHERE datname = '{TEST_DB_NAME}'"))
        db_exists = result.scalar() is not None

        if not db_exists:
            # データベースが存在しない場合のみ作成
            conn.execute(text(f"CREATE DATABASE {TEST_DB_NAME}"))
            print(f"Test database '{TEST_DB_NAME}' created.")

    main_engine.dispose()

    # テストデータベースエンジンを作成
    engine = create_engine(
        TEST_DATABASE_URL,
        pool_pre_ping=True,
        pool_size=DB_POOL_SIZE,
        max_overflow=DB_MAX_OVERFLOW,
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


# テスト環境の設定
def setup_test_environment() -> None:
    """テスト用環境変数の設定"""
    # 基本設定
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    os.environ["ENVIRONMENT"] = "test"

    # Neo4j設定
    neo4j_host = "neo4j-test" if is_docker_env() else "localhost"
    neo4j_port = "7687" if is_docker_env() else "7688"
    os.environ["NEO4J_URI"] = f"bolt://{neo4j_host}:{neo4j_port}"
    os.environ["NEO4J_USER"] = TEST_NEO4J_USER
    os.environ["NEO4J_PASSWORD"] = TEST_NEO4J_PASSWORD
    os.environ["NEO4J_TEST_URL"] = f"bolt://{TEST_NEO4J_USER}:{TEST_NEO4J_PASSWORD}@{neo4j_host}:{neo4j_port}"

    # Redis設定
    redis_host = "redis-test" if is_docker_env() else "localhost"
    redis_port = "6379" if is_docker_env() else "6380"
    os.environ["REDIS_URL"] = f"redis://{redis_host}:{redis_port}/0"

# 環境変数の設定を実行
setup_test_environment()
