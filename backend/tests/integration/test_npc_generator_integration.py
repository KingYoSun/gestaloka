"""
NPCGeneratorの統合テスト

実際のNeo4jインスタンスを使用してNPC生成機能をテスト
"""

import uuid
from contextlib import contextmanager
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import Session

from app.models.character import Character, GameSession
from app.models.log import (
    CompletedLog,
    CompletedLogStatus,
    EmotionalValence,
    LogFragment,
    LogFragmentRarity,
)
from app.models.user import User
from app.services.npc_generator import NPCGenerator
from tests.integration.base_neo4j_test import BaseNeo4jIntegrationTest
from tests.integration.neo4j_connection import ensure_test_connection
from tests.integration.neo4j_test_utils import cleanup_all_neo4j_data


@contextmanager
def setup_test_neo4j():
    """テスト用Neo4j設定をセットアップするコンテキストマネージャー"""
    from neomodel import config as neo_config
    from neomodel import db as neo_db

    # 現在の設定を保存
    original_url = neo_config.DATABASE_URL

    # テスト用接続を確実に設定
    ensure_test_connection()

    # データベースをクリーンアップ
    cleanup_all_neo4j_data()

    try:
        yield
    finally:
        # クリーンアップ
        cleanup_all_neo4j_data()

        # 元の設定に戻す
        neo_config.DATABASE_URL = original_url
        if hasattr(neo_db, "_driver") and neo_db._driver:
            neo_db._driver.close()
            neo_db._driver = None


@pytest.mark.neo4j
@pytest.mark.integration
class TestNPCGeneratorIntegration(BaseNeo4jIntegrationTest):
    """NPCGenerator統合テストクラス"""

    @pytest.fixture(autouse=True)
    def cleanup_databases(self):
        """各テストメソッドの前後でデータベースをクリーンアップ"""
        # Neo4jのクリーンアップ
        ensure_test_connection()
        cleanup_all_neo4j_data()

        yield

        # テスト後のクリーンアップ
        cleanup_all_neo4j_data()

    # test_sessionフィクスチャーを削除し、conftest.pyのtest_db_sessionを使用

    @pytest.fixture
    def test_user(self, test_db_session: Session) -> User:
        """テスト用ユーザー"""
        user = User(
            id=str(uuid.uuid4()),
            username="test_user",
            email="test@example.com",
            hashed_password="hashed",
            is_active=True,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        test_db_session.add(user)
        test_db_session.commit()
        test_db_session.refresh(user)
        return user

    @pytest.fixture
    def test_character(self, test_db_session: Session, test_user: User) -> Character:
        """テスト用キャラクター"""
        from app.models.character import Character

        character = Character(
            id=str(uuid.uuid4()),
            user_id=str(test_user.id),
            name="テストキャラクター",
            description="テスト用のキャラクター",
            location="初期位置",
            is_active=True,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        test_db_session.add(character)
        test_db_session.commit()
        test_db_session.refresh(character)
        return character

    @pytest.fixture
    def test_session_obj(self, test_db_session: Session, test_character: Character) -> GameSession:
        """テスト用ゲームセッション"""
        from app.models.character import GameSession

        game_session = GameSession(
            id=str(uuid.uuid4()),
            character_id=test_character.id,
            is_active=True,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        test_db_session.add(game_session)
        test_db_session.commit()
        test_db_session.refresh(game_session)
        return game_session

    @pytest.fixture
    def test_log_fragment(
        self, test_db_session: Session, test_character: Character, test_session_obj: GameSession
    ) -> LogFragment:
        """テスト用ログフラグメント"""
        from app.models.log import LogFragment

        fragment = LogFragment(
            id=str(uuid.uuid4()),
            character_id=test_character.id,
            session_id=test_session_obj.id,
            action_description="英雄的な行動",
            keywords=["勇敢", "戦士"],
            emotional_valence=EmotionalValence.POSITIVE,
            rarity=LogFragmentRarity.RARE,
            importance_score=0.8,
            created_at=datetime.utcnow(),
        )
        test_db_session.add(fragment)
        test_db_session.commit()
        test_db_session.refresh(fragment)
        return fragment

    @pytest.fixture
    def completed_log(
        self, test_db_session: Session, test_character: Character, test_log_fragment: LogFragment
    ) -> CompletedLog:
        """テスト用完成ログ"""
        log = CompletedLog(
            id=str(uuid.uuid4()),
            creator_id=test_character.id,
            core_fragment_id=test_log_fragment.id,
            name="テスト冒険者",
            title="伝説の戦士",
            description="数多くの冒険を経験した戦士",
            personality_traits=["勇敢", "正義感が強い", "仲間思い"],
            behavior_patterns=["困っている人を助ける", "戦いを好む", "正々堂々とした勝負を好む"],
            skills=["剣術", "防御術", "リーダーシップ"],
            contamination_level=0,
            status=CompletedLogStatus.ACTIVE,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        test_db_session.add(log)
        test_db_session.commit()
        test_db_session.refresh(log)
        return log

    @pytest.fixture
    def npc_generator(self, test_db_session: Session, neo4j_test_db) -> NPCGenerator:
        """テスト用NPCGenerator"""
        # Neo4j接続が正しく設定されていることを確認
        generator = NPCGenerator(test_db_session)
        yield generator
        # クリーンアップ
        test_db_session.rollback()  # 未コミットの変更をロールバック

    def test_generate_npc_from_log_with_real_neo4j(
        self,
        neo4j_test_db,
        npc_generator: NPCGenerator,
        completed_log: CompletedLog,
    ):
        """実際のNeo4jを使用したNPC生成テスト"""
        # NPCManagerAgentのモックのみ使用（AIコンポーネントのみモック）
        with patch.object(npc_generator, "_npc_manager", new=AsyncMock()):
            # neomodelの設定を一時的に変更
            from neomodel import config as neo_config
            from neomodel import db as neo_db

            # 現在の設定を保存
            original_url = neo_config.DATABASE_URL

            try:
                # テスト用URLに変更
                test_url = "bolt://neo4j:test_password@neo4j-test:7687"
                neo_config.DATABASE_URL = test_url

                # 既存の接続をクリア
                if hasattr(neo_db, "_driver") and neo_db._driver:
                    neo_db._driver.close()
                    neo_db._driver = None

                # NPCを生成
                npc_profile = npc_generator.generate_npc_from_log(
                    completed_log_id=completed_log.id,
                    target_location_name="テスト広場",
                )
            finally:
                # 元の設定に戻す
                neo_config.DATABASE_URL = original_url
                if hasattr(neo_db, "_driver") and neo_db._driver:
                    neo_db._driver.close()
                    neo_db._driver = None

            # 結果を検証
            assert npc_profile is not None
            assert npc_profile.name == "テスト冒険者"
            assert npc_profile.title == "伝説の戦士"
            assert npc_profile.npc_type == "LOG_NPC"
            assert npc_profile.current_location == "テスト広場"
            assert npc_profile.is_active is True

            # Neo4jでNPCが実際に作成されたことを確認
            created_npc = npc_generator.get_npc_by_id(npc_profile.npc_id)
            assert created_npc is not None
            assert created_npc.name == "テスト冒険者"
            assert created_npc.title == "伝説の戦士"
            assert len(created_npc.personality_traits) == 3
            assert len(created_npc.behavior_patterns) == 3
            assert len(created_npc.skills) == 3

            # ロケーションとの関係性を確認
            location_rels = list(created_npc.current_location.all())
            assert len(location_rels) == 1
            assert location_rels[0].name == "テスト広場"

    def test_get_npcs_in_location_with_real_neo4j(
        self,
        neo4j_test_db,
        npc_generator: NPCGenerator,
        test_character: Character,
        test_log_fragment: LogFragment,
    ):
        """実際のNeo4jを使用した場所別NPC取得テスト"""
        with patch.object(npc_generator, "_npc_manager", new=AsyncMock()):
            with setup_test_neo4j():
                # データベースは既にクリーンなので、特定の削除は不要

                # 複数のNPCを異なる場所に生成
                locations = ["テスト広場", "テスト酒場", "テスト広場"]
                npc_profiles = []

                for i, location in enumerate(locations):
                    # 新しいログを作成
                    log = CompletedLog(
                        id=str(uuid.uuid4()),
                        creator_id=test_character.id,
                        core_fragment_id=test_log_fragment.id,
                        name=f"テストNPC{i+1}",
                        title=f"テストタイトル{i+1}",
                        description=f"テスト説明{i+1}",
                        personality_traits=["trait1"],
                        behavior_patterns=["pattern1"],
                        skills=["skill1"],
                        contamination_level=0,
                        status=CompletedLogStatus.ACTIVE,
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow(),
                    )
                    npc_generator.session.add(log)
                    npc_generator.session.commit()

                    # NPCを生成
                    profile = npc_generator.generate_npc_from_log(
                        completed_log_id=log.id,
                        target_location_name=location,
                    )
                    npc_profiles.append(profile)

                # テスト広場のNPCを取得
                npcs_in_square = npc_generator.get_npcs_in_location("テスト広場")
                assert len(npcs_in_square) == 2
                npc_names = {npc.name for npc in npcs_in_square}
                assert "テストNPC1" in npc_names
                assert "テストNPC3" in npc_names

                # テスト酒場のNPCを取得
                npcs_in_tavern = npc_generator.get_npcs_in_location("テスト酒場")
                assert len(npcs_in_tavern) == 1
                assert npcs_in_tavern[0].name == "テストNPC2"

    def test_move_npc_with_real_neo4j(
        self,
        neo4j_test_db,
        npc_generator: NPCGenerator,
        completed_log: CompletedLog,
    ):
        """実際のNeo4jを使用したNPC移動テスト"""
        with patch.object(npc_generator, "_npc_manager", new=AsyncMock()):
            # NPCを生成
            npc_profile = npc_generator.generate_npc_from_log(
                completed_log_id=completed_log.id,
                target_location_name="開始地点",
            )

            # 初期位置を確認
            npcs_at_start = npc_generator.get_npcs_in_location("開始地点")
            assert len(npcs_at_start) == 1
            assert npcs_at_start[0].npc_id == npc_profile.npc_id

            # NPCを移動
            success = npc_generator.move_npc(npc_profile.npc_id, "目的地")
            assert success is True

            # 移動後の位置を確認
            npcs_at_start_after = npc_generator.get_npcs_in_location("開始地点")
            assert len(npcs_at_start_after) == 0

            npcs_at_destination = npc_generator.get_npcs_in_location("目的地")
            assert len(npcs_at_destination) == 1
            assert npcs_at_destination[0].npc_id == npc_profile.npc_id
