"""
統合テスト用の共通設定

PostgreSQLとNeo4jの両方のデータベースクリーンアップを提供
"""

import pytest

from tests.integration.neo4j_connection import ensure_test_connection
from tests.integration.neo4j_test_utils import cleanup_all_neo4j_data
from tests.integration.postgres_test_utils import isolated_postgres_test


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
    with isolated_postgres_test(recreate=True) as session:
        yield session


@pytest.fixture(autouse=True)
def auto_cleanup_for_integration_tests(request):
    """
    統合テストマーカーが付いたテストで自動的にクリーンアップを実行
    """
    if request.node.get_closest_marker("integration"):
        # テスト前のクリーンアップ
        ensure_test_connection()
        cleanup_all_neo4j_data()

        yield

        # テスト後のクリーンアップ
        cleanup_all_neo4j_data()
    else:
        yield


