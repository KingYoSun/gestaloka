"""
Neo4j統合テストの基底クラス

実際のNeo4jインスタンスを使用したテストの共通設定を提供
"""


import pytest
from neomodel import db

from app.db.neo4j_models import NPC, Location, Player
from tests.integration.neo4j_connection import ensure_test_connection
from tests.integration.neo4j_test_utils import cleanup_all_neo4j_data, cleanup_test_data


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


class BaseNeo4jIntegrationTest:
    """Neo4j統合テストの基底クラス"""

    @classmethod
    def setup_class(cls):
        """テストクラスのセットアップ"""
        # テスト用接続を確実に設定
        ensure_test_connection()

    def setup_method(self, method):
        """各テストメソッドのセットアップ"""
        # より徹底的なクリーンアップを実行
        cleanup_all_neo4j_data()

    def teardown_method(self, method):
        """各テストメソッドのクリーンアップ"""
        # 明示的に全ノードを削除
        cleanup_all_neo4j_data()

    def _cleanup_test_data(self):
        """テストデータのクリーンアップ（互換性のため残す）"""
        cleanup_test_data()

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
