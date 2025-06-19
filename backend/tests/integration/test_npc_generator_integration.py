"""
NPCGeneratorの統合テスト

実際のNeo4jインスタンスを使用してNPC生成機能をテスト
"""

import uuid
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import Session, create_engine

from app.models.log import CompletedLog, CompletedLogStatus, LogContract, LogContractStatus
from app.models.user import User
from app.services.npc_generator import NPCGenerator
from tests.integration.base_neo4j_test import BaseNeo4jIntegrationTest, neo4j_test_db


class TestNPCGeneratorIntegration(BaseNeo4jIntegrationTest):
    """NPCGenerator統合テストクラス"""

    @pytest.fixture
    def test_session(self):
        """テスト用SQLセッション"""
        import os
        from sqlmodel import SQLModel
        
        # テスト用PostgreSQLを使用
        database_url = os.getenv(
            "DATABASE_URL", 
            "postgresql://test_user:test_password@postgres-test:5432/gestaloka_test"
        )
        engine = create_engine(database_url)
        
        # テスト用にクリーンなデータベースを準備
        from sqlalchemy import text
        
        # 既存のスキーマをドロップ（ENUMタイプも含む）
        with engine.connect() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE"))
            conn.execute(text("CREATE SCHEMA public"))
            conn.commit()
        
        # Alembicを使用してマイグレーションを適用
        from alembic import command
        from alembic.config import Config
        
        alembic_cfg = Config("/app/alembic.ini")
        alembic_cfg.set_main_option("sqlalchemy.url", database_url)
        
        # マイグレーションを最新に
        command.upgrade(alembic_cfg, "head")

        with Session(engine) as session:
            yield session

    @pytest.fixture
    def test_user(self, test_session: Session) -> User:
        """テスト用ユーザー"""
        user = User(
            id=uuid.uuid4(),
            username="test_user",
            email="test@example.com",
            hashed_password="hashed",
            is_active=True,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        test_session.add(user)
        test_session.commit()
        test_session.refresh(user)
        return user

    @pytest.fixture
    def completed_log(self, test_session: Session, test_user: User) -> CompletedLog:
        """テスト用完成ログ"""
        log = CompletedLog(
            id=uuid.uuid4(),
            creator_id=test_user.id,
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
        test_session.add(log)
        test_session.commit()
        test_session.refresh(log)
        return log

    @pytest.fixture
    def npc_generator(self, test_session: Session) -> NPCGenerator:
        """テスト用NPCGenerator"""
        return NPCGenerator(test_session)

    @pytest.mark.asyncio
    async def test_generate_npc_from_log_with_real_neo4j(
        self,
        neo4j_test_db,
        npc_generator: NPCGenerator,
        completed_log: CompletedLog,
    ):
        """実際のNeo4jを使用したNPC生成テスト"""
        # NPCManagerAgentのモックのみ使用（AIコンポーネントのみモック）
        with patch.object(npc_generator, "_npc_manager", new=AsyncMock()):
            # NPCを生成
            npc_profile = await npc_generator.generate_npc_from_log(
                completed_log_id=completed_log.id,
                target_location_name="テスト広場",
            )

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

    @pytest.mark.asyncio
    async def test_get_npcs_in_location_with_real_neo4j(
        self,
        neo4j_test_db,
        npc_generator: NPCGenerator,
        completed_log: CompletedLog,
    ):
        """実際のNeo4jを使用した場所別NPC取得テスト"""
        with patch.object(npc_generator, "_npc_manager", new=AsyncMock()):
            # 複数のNPCを異なる場所に生成
            locations = ["テスト広場", "テスト酒場", "テスト広場"]
            npc_profiles = []

            for i, location in enumerate(locations):
                # 新しいログを作成
                log = CompletedLog(
                    id=uuid.uuid4(),
                    creator_id=completed_log.creator_id,
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
                profile = await npc_generator.generate_npc_from_log(
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

    @pytest.mark.asyncio
    async def test_move_npc_with_real_neo4j(
        self,
        neo4j_test_db,
        npc_generator: NPCGenerator,
        completed_log: CompletedLog,
    ):
        """実際のNeo4jを使用したNPC移動テスト"""
        with patch.object(npc_generator, "_npc_manager", new=AsyncMock()):
            # NPCを生成
            npc_profile = await npc_generator.generate_npc_from_log(
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

    @pytest.mark.asyncio
    async def test_process_accepted_contracts_with_real_neo4j(
        self,
        neo4j_test_db,
        npc_generator: NPCGenerator,
        test_user: User,
    ):
        """実際のNeo4jを使用した契約処理テスト"""
        with patch.object(npc_generator, "_npc_manager", new=AsyncMock()):
            # 複数の完成ログと契約を作成
            for i in range(3):
                # 完成ログを作成
                log = CompletedLog(
                    id=uuid.uuid4(),
                    creator_id=test_user.id,
                    name=f"契約NPC{i+1}",
                    title=f"契約タイトル{i+1}",
                    description=f"契約説明{i+1}",
                    personality_traits=["trait1"],
                    behavior_patterns=["pattern1"],
                    skills=["skill1"],
                    contamination_level=0,
                    status=CompletedLogStatus.ACTIVE,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                npc_generator.session.add(log)

                # 契約を作成（最初の2つはACCEPTED、最後の1つはPENDING）
                contract = LogContract(
                    id=uuid.uuid4(),
                    completed_log_id=log.id,
                    publisher_id=test_user.id,
                    contractor_id=test_user.id if i < 2 else None,
                    status=LogContractStatus.ACCEPTED if i < 2 else LogContractStatus.PENDING,
                    reward_amount=100,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                npc_generator.session.add(contract)

            npc_generator.session.commit()

            # 契約を処理
            await npc_generator.process_accepted_contracts()

            # 結果を確認
            # DEPLOYEDステータスの契約が2つあるはず
            deployed_contracts = npc_generator.session.query(LogContract).filter(
                LogContract.status == LogContractStatus.DEPLOYED
            ).all()
            assert len(deployed_contracts) == 2

            # NPCが実際に生成されているか確認
            npcs_in_square = npc_generator.get_npcs_in_location("共通広場")
            assert len(npcs_in_square) == 2
            npc_names = {npc.name for npc in npcs_in_square}
            assert "契約NPC1" in npc_names
            assert "契約NPC2" in npc_names

            # PENDINGの契約は処理されていないことを確認
            pending_contracts = npc_generator.session.query(LogContract).filter(
                LogContract.status == LogContractStatus.PENDING
            ).all()
            assert len(pending_contracts) == 1