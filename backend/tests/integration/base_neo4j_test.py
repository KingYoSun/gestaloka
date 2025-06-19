"""
Neo4j統合テストの基底クラス

実際のNeo4jインスタンスを使用したテストの共通設定を提供
"""

import os
from typing import Generator

import pytest
from neomodel import config, db

from app.core.config import settings
from app.db.neo4j_models import Location, NPC, Player


class BaseNeo4jIntegrationTest:
    """Neo4j統合テストの基底クラス"""

    @classmethod
    def setup_class(cls):
        """テストクラスのセットアップ"""
        # テスト用Neo4j接続設定
        test_neo4j_uri = os.getenv("TEST_NEO4J_URI", "bolt://localhost:7688")
        test_neo4j_username = os.getenv("NEO4J_USERNAME", "neo4j")
        test_neo4j_password = os.getenv("NEO4J_PASSWORD", "test_password")

        # neomodel設定
        config.DATABASE_URL = f"{test_neo4j_uri}"
        config.USERNAME = test_neo4j_username
        config.PASSWORD = test_neo4j_password

    def setup_method(self, method):
        """各テストメソッドのセットアップ"""
        # テストデータをクリーンアップ
        self._cleanup_test_data()

    def teardown_method(self, method):
        """各テストメソッドのクリーンアップ"""
        # 明示的にノードを削除
        self._cleanup_test_data()

    def _cleanup_test_data(self):
        """テストデータのクリーンアップ"""
        # Cypherクエリで全テストノードを削除
        try:
            # 関係性も含めて削除
            db.cypher_query(
                """
                MATCH (n)
                WHERE n.npc_id STARTS WITH 'test_' 
                   OR n.player_id STARTS WITH 'test_'
                   OR n.location_id STARTS WITH 'test_'
                DETACH DELETE n
                """
            )
        except Exception:
            # クリーンアップ失敗は無視
            pass

    @staticmethod
    def create_test_location(name: str = "test_location", layer: int = 0) -> Location:
        """テスト用ロケーションを作成"""
        location = Location(
            location_id=f"test_location_{name}",
            name=name,
            layer=layer,
            description=f"Test location {name}",
        ).save()
        return location

    @staticmethod
    def create_test_npc(
        npc_id: str = "test_npc_001",
        name: str = "Test NPC",
        location: Location = None,
    ) -> NPC:
        """テスト用NPCを作成"""
        npc = NPC(
            npc_id=npc_id,
            name=name,
            title="Test Title",
            personality_traits=["friendly", "curious"],
            behavior_patterns=["greeting", "storytelling"],
            skills=["conversation", "knowledge"],
            appearance="A friendly test NPC",
            backstory="Created for testing",
            npc_type="LOG_NPC",
            persistence_level=1,
            contamination_level=0,
            original_player="test_player",
            log_source="test_log",
            is_active=True,
        ).save()

        if location:
            npc.current_location.connect(location, {"is_current": True})

        return npc

    @staticmethod
    def create_test_player(
        player_id: str = "test_player_001",
        name: str = "Test Player",
    ) -> Player:
        """テスト用プレイヤーを作成"""
        player = Player(
            player_id=player_id,
            name=name,
            current_session_id="test_session",
        ).save()
        return player



# pytest用のフィクスチャ
@pytest.fixture
def neo4j_test_db():
    """Neo4jテストデータベースのフィクスチャ"""
    # セットアップ
    test = BaseNeo4jIntegrationTest()
    test.setup_class()
    test.setup_method(None)

    yield test

    # クリーンアップ
    test.teardown_method(None)