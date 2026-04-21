"""
Neo4j統合テスト用接続管理

テスト用Neo4jインスタンスへの接続を管理
"""

import os
import time
from contextlib import contextmanager

from neomodel import config as neo_config
from neomodel import db as neo_db


def get_test_neo4j_url() -> str:
    """テスト用Neo4j URLを取得"""
    # 環境変数から設定を取得
    host = os.getenv("NEO4J_TEST_HOST", "neo4j-test")
    port = os.getenv("NEO4J_TEST_PORT", "7687")
    username = os.getenv("NEO4J_TEST_USERNAME", "neo4j")
    password = os.getenv("NEO4J_TEST_PASSWORD", "test_password")

    # neomodelはURLパラメータをサポートしないため、基本的なURLのみを返す
    return f"bolt://{username}:{password}@{host}:{port}"


def ensure_test_connection():
    """テスト用Neo4j接続を確実に設定"""
    test_url = get_test_neo4j_url()

    # 現在の設定と異なる場合のみ変更
    if neo_config.DATABASE_URL != test_url:
        neo_config.DATABASE_URL = test_url

        # 既存の接続をクリア
        if hasattr(neo_db, "_driver") and neo_db._driver:
            try:
                neo_db._driver.close()
                # ドライバーの完全なクローズを待つ
                time.sleep(0.1)
            except Exception:
                pass
            neo_db._driver = None


@contextmanager
def test_neo4j_connection():
    """
    テスト用Neo4j接続のコンテキストマネージャー

    with test_neo4j_connection():
        # テストコード
    """
    # 元の設定を保存
    original_url = neo_config.DATABASE_URL
    original_driver = getattr(neo_db, "_driver", None)

    try:
        # テスト用接続を設定
        ensure_test_connection()
        yield neo_db
    finally:
        # 元の設定に戻す
        neo_config.DATABASE_URL = original_url

        # 接続をクリア
        if hasattr(neo_db, "_driver") and neo_db._driver:
            try:
                neo_db._driver.close()
            except Exception:
                pass
            neo_db._driver = None

        # 元のドライバーがあれば復元
        if original_driver:
            neo_db._driver = original_driver


def verify_test_connection(retries: int = 3) -> bool:
    """テスト用Neo4j接続を検証"""
    for attempt in range(retries):
        try:
            ensure_test_connection()
            # 簡単なクエリで接続を確認
            result, _ = neo_db.cypher_query("RETURN 1 as test")
            return result[0][0] == 1
        except Exception as e:
            if attempt < retries - 1:
                print(f"Neo4j test connection attempt {attempt + 1} failed: {e}. Retrying...")
                time.sleep(1)
            else:
                print(f"Neo4j test connection verification failed after {retries} attempts: {e}")
                return False
    return False
