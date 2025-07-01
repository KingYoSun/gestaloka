"""
NPCジェネレーターのテスト
"""

import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlmodel import Session

from app.models.log import CompletedLog, CompletedLogStatus
from app.schemas.npc_schemas import NPCProfile
from app.services.npc_generator import NPCGenerator


@pytest.fixture
def mock_completed_log():
    """テスト用のCompletedLogを作成"""
    return CompletedLog(
        id=uuid.uuid4(),
        creator_id=str(uuid.uuid4()),
        core_fragment_id=str(uuid.uuid4()),
        name="影の商人ザイン",
        title="第三階層の密売人",
        description="闇に生きる商人",
        personality_traits=["狡猾", "用心深い", "商売熱心"],
        behavior_patterns=["夜間のみ活動", "高額商品を扱う"],
        skills=["交渉術", "鑑定"],
        contamination_level=45,
        status=CompletedLogStatus.ACTIVE,
        created_at=datetime.utcnow(),
    )


def test_generate_npc_from_log(mock_completed_log):
    """CompletedLogからNPCを生成するテスト"""
    # モックセッション
    mock_session = MagicMock(spec=Session)
    mock_session.exec.return_value.first.return_value = mock_completed_log

    # Neo4jモックを設定
    with patch("app.services.npc_generator.get_neo4j_session"):
        with patch("app.services.npc_generator.create_npc_from_log") as mock_create_npc:
            with patch("app.services.npc_generator.Location"):
                with patch("app.services.npc_generator.NPCManagerAgent") as mock_agent_class:
                    # モックNPCノードを設定
                    mock_npc_node = MagicMock()
                    mock_npc_node.npc_id = f"log_npc_{mock_completed_log.id}"
                    mock_npc_node.name = mock_completed_log.name
                    mock_npc_node.title = mock_completed_log.title
                    mock_npc_node.personality_traits = mock_completed_log.personality_traits
                    mock_npc_node.behavior_patterns = mock_completed_log.behavior_patterns
                    mock_npc_node.skills = mock_completed_log.skills
                    mock_npc_node.appearance = mock_completed_log.description
                    mock_npc_node.backstory = mock_completed_log.description
                    mock_npc_node.persistence_level = 6
                    mock_npc_node.contamination_level = mock_completed_log.contamination_level
                    mock_npc_node.original_player = mock_completed_log.creator_id
                    mock_npc_node.log_source = str(mock_completed_log.id)
                    mock_create_npc.return_value = mock_npc_node

                    # モックエージェントを設定
                    mock_agent = AsyncMock()
                    mock_agent.register_npc = AsyncMock()
                    mock_agent_class.return_value = mock_agent

                    # NPCGeneratorを作成
                    generator = NPCGenerator(mock_session)

                    # NPCを生成
                    result = generator.generate_npc_from_log(
                        completed_log_id=mock_completed_log.id, target_location_name="共通広場"
                    )

                    # 結果を検証
                    assert isinstance(result, NPCProfile)
                    assert result.npc_id == f"log_npc_{mock_completed_log.id}"
                    assert result.name == mock_completed_log.name
                    assert result.title == mock_completed_log.title
                    assert result.npc_type == "LOG_NPC"
                    assert result.personality_traits == mock_completed_log.personality_traits
                    assert result.behavior_patterns == mock_completed_log.behavior_patterns
                    assert result.contamination_level == mock_completed_log.contamination_level
                    assert result.current_location == "共通広場"

                    # モックが呼ばれたことを確認
                    mock_create_npc.assert_called_once()
                    # register_npcは統合版では呼ばれない（TODO削除されているため）

def test_get_npc_by_id():
    """IDでNPCを取得するテスト"""
    mock_session = MagicMock(spec=Session)

    with patch("app.services.npc_generator.get_neo4j_session"):
        with patch("app.services.npc_generator.NPC") as mock_npc_class:
            # モックNPCを設定
            mock_npc = MagicMock()
            mock_npc.npc_id = "test_npc_id"
            mock_npc.name = "テストNPC"
            mock_npc_class.nodes.get_or_none.return_value = mock_npc

            generator = NPCGenerator(mock_session)
            result = generator.get_npc_by_id("test_npc_id")

            assert result == mock_npc
            mock_npc_class.nodes.get_or_none.assert_called_once_with(npc_id="test_npc_id")


def test_move_npc():
    """NPCを移動するテスト"""
    mock_session = MagicMock(spec=Session)

    with patch("app.services.npc_generator.get_neo4j_session"):
        with patch("app.services.npc_generator.NPC") as mock_npc_class:
            with patch("app.services.npc_generator.Location") as mock_location_class:
                # モックNPCを設定
                mock_npc = MagicMock()
                mock_npc.npc_id = "test_npc_id"
                mock_npc.current_location = MagicMock()
                mock_npc.current_location.all.return_value = []
                mock_npc.current_location.connect = MagicMock()

                mock_npc_class.nodes.get_or_none.return_value = mock_npc

                # モック場所を設定
                mock_location = MagicMock()
                mock_location.name = "新しい場所"
                mock_location_class.nodes.get_or_none.return_value = mock_location

                generator = NPCGenerator(mock_session)
                result = generator.move_npc("test_npc_id", "新しい場所")

                assert result is True
                mock_npc.current_location.connect.assert_called_once()
