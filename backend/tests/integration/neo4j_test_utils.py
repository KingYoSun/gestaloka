"""
Neo4j統合テスト用ユーティリティ

テストデータの完全なクリーンアップとセットアップを提供
"""

from contextlib import contextmanager

from neomodel import config as neo_config
from neomodel import db as neo_db


def cleanup_all_neo4j_data():
    """
    Neo4jの全データを削除する

    警告: このメソッドは全てのノードとリレーションシップを削除します。
    テスト環境でのみ使用してください。
    """
    try:
        # 現在の接続がテスト用Neo4jを指していることを確認
        if "neo4j-test" not in neo_config.DATABASE_URL and "7688" not in neo_config.DATABASE_URL:
            print(f"Warning: Not connected to test Neo4j instance. Skipping cleanup. Current URL: {neo_config.DATABASE_URL}")
            return

        # まず全ての関係性を削除
        neo_db.cypher_query("MATCH ()-[r]->() DELETE r")

        # 次に全てのノードを削除
        neo_db.cypher_query("MATCH (n) DELETE n")
    except Exception as e:
        print(f"Neo4j cleanup error: {e}")
        # エラーが発生しても続行


def cleanup_test_data():
    """
    テストデータのみを削除する

    test_プレフィックスを持つノードと、
    テスト中に作成された可能性のある関連ノードを削除
    """
    try:
        # テストプレフィックスを持つノードとその関係を削除
        neo_db.cypher_query(
            """
            MATCH (n)
            WHERE n.npc_id STARTS WITH 'test_'
               OR n.player_id STARTS WITH 'test_'
               OR n.location_id STARTS WITH 'test_'
               OR n.session_id STARTS WITH 'test_'
               OR n.character_id STARTS WITH 'test_'
               OR n.name STARTS WITH 'Test'
               OR n.name STARTS WITH 'test'
            DETACH DELETE n
            """
        )

        # 孤立したノード（関係を持たないノード）を削除
        neo_db.cypher_query(
            """
            MATCH (n)
            WHERE NOT (n)--()
            DELETE n
            """
        )
    except Exception as e:
        print(f"Neo4j test cleanup error: {e}")


def count_all_nodes() -> int:
    """Neo4j内の全ノード数を取得"""
    try:
        result, _ = neo_db.cypher_query("MATCH (n) RETURN count(n) as count")
        return result[0][0] if result else 0
    except Exception:
        return -1


def count_all_relationships() -> int:
    """Neo4j内の全リレーションシップ数を取得"""
    try:
        result, _ = neo_db.cypher_query("MATCH ()-[r]->() RETURN count(r) as count")
        return result[0][0] if result else 0
    except Exception:
        return -1


@contextmanager
def neo4j_test_transaction():
    """
    Neo4jのテストトランザクション

    トランザクション内での操作を提供し、
    エラー時は自動的にロールバック
    """
    try:
        with neo_db.transaction:
            yield neo_db
    except Exception:
        # トランザクションは自動的にロールバックされる
        raise


@contextmanager
def isolated_neo4j_test(cleanup_before: bool = True, cleanup_after: bool = True):
    """
    分離されたNeo4jテスト環境を提供

    Args:
        cleanup_before: テスト前にクリーンアップを実行
        cleanup_after: テスト後にクリーンアップを実行
    """
    if cleanup_before:
        cleanup_all_neo4j_data()

    try:
        yield
    finally:
        if cleanup_after:
            cleanup_all_neo4j_data()


class Neo4jTestStats:
    """Neo4jテスト統計情報"""

    def __init__(self):
        self.initial_nodes = 0
        self.initial_relationships = 0
        self.final_nodes = 0
        self.final_relationships = 0

    def capture_initial(self):
        """初期状態を記録"""
        self.initial_nodes = count_all_nodes()
        self.initial_relationships = count_all_relationships()

    def capture_final(self):
        """最終状態を記録"""
        self.final_nodes = count_all_nodes()
        self.final_relationships = count_all_relationships()

    def get_diff(self) -> dict:
        """差分を取得"""
        return {
            "nodes_added": self.final_nodes - self.initial_nodes,
            "relationships_added": self.final_relationships - self.initial_relationships,
            "final_nodes": self.final_nodes,
            "final_relationships": self.final_relationships
        }

    def has_leaks(self) -> bool:
        """データリークがあるかチェック"""
        return self.final_nodes > self.initial_nodes or self.final_relationships > self.initial_relationships


@contextmanager
def track_neo4j_state():
    """
    Neo4jの状態変化を追跡

    テスト前後のノード数とリレーションシップ数を記録し、
    データリークを検出
    """
    stats = Neo4jTestStats()
    stats.capture_initial()

    try:
        yield stats
    finally:
        stats.capture_final()
        if stats.has_leaks():
            diff = stats.get_diff()
            print(f"Warning: Neo4j data leak detected - {diff}")
