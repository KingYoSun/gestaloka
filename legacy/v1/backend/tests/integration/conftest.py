"""
統合テスト用の共通設定

PostgreSQLとNeo4jの両方のデータベースクリーンアップを提供
"""

import pytest
from neomodel import db

from tests.integration.neo4j_connection import ensure_test_connection
from tests.integration.neo4j_test_utils import cleanup_all_neo4j_data


@pytest.fixture
def neo4j_test_db():
    """テスト用Neo4j接続のフィクスチャー"""
    # テスト用接続を確実に設定
    ensure_test_connection()

    # テストごとに全データをクリーンアップ（より確実）
    cleanup_all_neo4j_data()

    yield db

    # テスト後のクリーンアップ
    cleanup_all_neo4j_data()


@pytest.fixture(scope="function")
def clean_databases():
    """
    PostgreSQLとNeo4j両方をクリーンにするフィクスチャー

    各テストの前後で両方のデータベースを完全にクリーンアップ
    """
    # Neo4jのクリーンアップ
    ensure_test_connection()
    cleanup_all_neo4j_data()

    # PostgreSQLのクリーンアップはisolated_postgres_testで行う

    yield

    # テスト後のクリーンアップ
    cleanup_all_neo4j_data()


@pytest.fixture(scope="function")
def test_db_session():
    """
    クリーンなPostgreSQLセッションを提供するフィクスチャー

    各テストに対して独立したデータベース環境を提供
    """
    # 直接データベース接続を作成
    from sqlalchemy import create_engine
    from sqlmodel import Session, SQLModel

    from tests.integration.postgres_test_utils import cleanup_all_postgres_data, get_test_database_url

    database_url = get_test_database_url()
    engine = create_engine(database_url, pool_pre_ping=True)

    # データクリーンアップ
    cleanup_all_postgres_data(engine)

    # モデルをインポート（必要最小限のみ）

    # テーブル作成
    SQLModel.metadata.create_all(engine)

    # セッション作成
    session = Session(engine)

    try:
        yield session
    finally:
        session.close()
        cleanup_all_postgres_data(engine)
        engine.dispose()


# @pytest.fixture(autouse=True)
# def auto_cleanup_for_integration_tests(request):
#     """
#     統合テストマーカーが付いたテストで自動的にクリーンアップを実行
#     """
#     if request.node.get_closest_marker("integration"):
#         # テスト前のクリーンアップ
#         ensure_test_connection()
#         cleanup_all_neo4j_data()
#
#         yield
#
#         # テスト後のクリーンアップ
#         cleanup_all_neo4j_data()
#     else:
#         yield
