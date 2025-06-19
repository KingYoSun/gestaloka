"""
Neo4j統合テスト用の共通フィクスチャー

全てのNeo4j統合テストで使用される共通設定とフィクスチャーを提供
"""

import os
from contextlib import contextmanager

import pytest
from neomodel import config as neo_config
from neomodel import db as neo_db

from tests.integration.neo4j_test_utils import (
    cleanup_all_neo4j_data,
    isolated_neo4j_test,
    track_neo4j_state,
)


@pytest.fixture(scope="session")
def neo4j_test_config():
    """Neo4jテスト設定"""
    return {
        "url": os.getenv(
            "NEO4J_TEST_URL",
            "bolt://neo4j:test_password@neo4j-test:7687"
        ),
        "username": os.getenv("NEO4J_TEST_USERNAME", "neo4j"),
        "password": os.getenv("NEO4J_TEST_PASSWORD", "test_password"),
    }


@pytest.fixture
def clean_neo4j_db(neo4j_test_config):
    """
    クリーンなNeo4jデータベースを提供するフィクスチャー
    
    各テストの前後で完全なクリーンアップを実行
    """
    # テスト用設定を適用
    neo_config.DATABASE_URL = neo4j_test_config["url"]
    
    # テスト前のクリーンアップ
    cleanup_all_neo4j_data()
    
    yield neo_db
    
    # テスト後のクリーンアップ
    cleanup_all_neo4j_data()


@pytest.fixture
def neo4j_stats():
    """Neo4jの状態変化を追跡するフィクスチャー"""
    with track_neo4j_state() as stats:
        yield stats


@contextmanager
def neo4j_test_session(cleanup_before: bool = True, cleanup_after: bool = True):
    """
    Neo4jテストセッションのコンテキストマネージャー
    
    Args:
        cleanup_before: テスト前にクリーンアップを実行
        cleanup_after: テスト後にクリーンアップを実行
    """
    with isolated_neo4j_test(cleanup_before, cleanup_after):
        yield neo_db


# pytest設定
def pytest_configure(config):
    """pytest設定のカスタマイズ"""
    config.addinivalue_line(
        "markers", "neo4j: mark test as requiring Neo4j database"
    )


@pytest.fixture(autouse=True)
def auto_cleanup_neo4j(request):
    """
    Neo4jマーカーが付いたテストで自動的にクリーンアップを実行
    """
    if request.node.get_closest_marker("neo4j"):
        # テスト前のクリーンアップ
        cleanup_all_neo4j_data()
        
        yield
        
        # テスト後のクリーンアップ
        cleanup_all_neo4j_data()
    else:
        yield