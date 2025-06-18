"""
歴史家AI (Historian) のテスト
"""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.services.ai.agents.historian import ActionType, HistorianAgent, HistorianAnalysis, HistoricalRecord
from app.services.ai.prompt_manager import AIAgentRole, PromptContext


@pytest.fixture
def historian_agent():
    """歴史家AIのフィクスチャ"""
    return HistorianAgent()


@pytest.fixture
def sample_context():
    """サンプルコンテキスト"""
    return PromptContext(
        character_name="テストプレイヤー",
        character_id="player_123",
        location="始まりの村",
        session_id="session_123",
        recent_actions=["村の広場に到着"],
        world_state={"time": "朝", "weather": "晴れ", "active_events": []},
    )


@pytest.mark.asyncio
async def test_historian_initialization(historian_agent):
    """歴史家AIの初期化テスト"""
    assert historian_agent.role == AIAgentRole.HISTORIAN
    assert historian_agent.records_cache == {}


@pytest.mark.asyncio
async def test_process_success(historian_agent, sample_context):
    """process メソッドの成功テスト"""
    # モックレスポンスの設定
    mock_analysis_response = """IMPORTANCE: 7
CATEGORIES: exploration, social
LOG_POTENTIAL: 0.8
SUMMARY: プレイヤーが村の長老と重要な会話をした
CONSEQUENCES: 村のクエストが開始された, 長老との信頼関係が向上
WARNINGS: なし"""

    with patch.object(historian_agent, "generate_response", new_callable=AsyncMock) as mock_generate:
        mock_generate.return_value = mock_analysis_response

        result = await historian_agent.process(
            context=sample_context,
            action_type=ActionType.NPC_INTERACTION,
            action_details={"action": "長老との会話", "dialogue": "古の予言について尋ねる", "target": "村の長老"},
        )

    assert result.agent_role == AIAgentRole.HISTORIAN.value
    assert result.narrative is not None
    assert "【注目すべき行動】" in result.narrative
    assert result.metadata["importance_level"] == 7
    assert "exploration" in result.metadata["categorization"]
    assert result.metadata["log_fragment_potential"] == 0.8

    # キャッシュに記録されていることを確認
    assert len(historian_agent.records_cache) == 1
    record = next(iter(historian_agent.records_cache.values()))
    assert record.actor_id == "player_123"
    assert record.importance_level == 7


@pytest.mark.asyncio
async def test_process_with_warnings(historian_agent, sample_context):
    """一貫性警告を含む process テスト"""
    mock_analysis_response = """IMPORTANCE: 5
CATEGORIES: movement
LOG_POTENTIAL: 0.3
SUMMARY: プレイヤーが遠く離れた場所に突然出現
CONSEQUENCES: なし
WARNINGS: 場所の一貫性: 瞬間移動のような移動が検出されました"""

    with patch.object(historian_agent, "generate_response", new_callable=AsyncMock) as mock_generate:
        mock_generate.return_value = mock_analysis_response

        result = await historian_agent.process(
            context=sample_context, action_type=ActionType.PLAYER_ACTION, action_details={"action": "魔法の塔に移動"}
        )

    assert len(result.metadata["consistency_warnings"]) == 1
    assert "瞬間移動" in result.metadata["consistency_warnings"][0]


@pytest.mark.asyncio
async def test_process_invalid_context(historian_agent):
    """無効なコンテキストでの process テスト"""
    invalid_context = PromptContext(
        character_name="",  # 無効な名前
        location="",  # 無効な場所
    )

    result = await historian_agent.process(context=invalid_context)

    assert result.agent_role == AIAgentRole.HISTORIAN.value
    assert result.metadata["error"] == "Invalid context"


@pytest.mark.asyncio
async def test_analyze_action_error_handling(historian_agent, sample_context):
    """エラー処理のテスト"""
    with patch.object(historian_agent, "generate_response", new_callable=AsyncMock) as mock_generate:
        mock_generate.side_effect = Exception("API Error")

        analysis = await historian_agent._analyze_action(
            context=sample_context, action_type=ActionType.PLAYER_ACTION, action_details={"action": "テスト行動"}
        )

    assert analysis.importance_level == 3
    assert ActionType.PLAYER_ACTION.value in analysis.categorization
    assert len(analysis.consistency_warnings) > 0
    assert "分析エラー" in analysis.consistency_warnings[0]


def test_parse_analysis_response(historian_agent):
    """分析レスポンスのパースのテスト"""
    response = """IMPORTANCE: 8
CATEGORIES: combat, epic
LOG_POTENTIAL: 0.95
SUMMARY: 竜との戦闘が開始された
CONSEQUENCES: 王都の一部が破壊された, 市民が避難開始
WARNINGS: なし"""

    analysis = historian_agent._parse_analysis_response(response)

    assert analysis.importance_level == 8
    assert "combat" in analysis.categorization
    assert "epic" in analysis.categorization
    assert analysis.log_fragment_potential == 0.95
    assert analysis.summary == "竜との戦闘が開始された"
    assert len(analysis.consequences) == 2
    assert len(analysis.consistency_warnings) == 0


def test_parse_analysis_response_partial(historian_agent):
    """部分的なレスポンスのパースのテスト"""
    response = """IMPORTANCE: 5
SUMMARY: テスト行動"""

    analysis = historian_agent._parse_analysis_response(response)

    assert analysis.importance_level == 5
    assert analysis.summary == "テスト行動"
    # デフォルト値の確認
    assert analysis.log_fragment_potential == 0.5
    assert analysis.categorization == []


def test_create_record(historian_agent, sample_context):
    """記録作成のテスト"""
    analysis = HistorianAnalysis(
        importance_level=7,
        categorization=["exploration", "social"],
        log_fragment_potential=0.8,
        summary="重要な会話",
        consequences=["クエスト開始"],
        consistency_warnings=[],
    )

    record = historian_agent._create_record(
        context=sample_context,
        action_type=ActionType.NPC_INTERACTION,
        action_details={"action": "会話", "target": "長老"},
        analysis=analysis,
    )

    assert record.session_id == "session_123"
    assert record.actor_id == "player_123"
    assert record.action_type == ActionType.NPC_INTERACTION
    assert record.importance_level == 7
    assert "exploration" in record.tags
    assert record.log_fragment_potential == 0.8


def test_extract_participants(historian_agent, sample_context):
    """参加者抽出のテスト"""
    # target を含む場合
    participants = historian_agent._extract_participants(sample_context, {"target": "村の長老"})
    assert "テストプレイヤー" in participants
    assert "村の長老" in participants

    # participants を含む場合
    participants = historian_agent._extract_participants(sample_context, {"participants": ["NPC1", "NPC2"]})
    assert "テストプレイヤー" in participants
    assert "NPC1" in participants
    assert "NPC2" in participants

    # 重複除去の確認
    participants = historian_agent._extract_participants(
        sample_context, {"target": "テストプレイヤー", "participants": ["テストプレイヤー"]}
    )
    assert participants.count("テストプレイヤー") == 1


def test_generate_historical_narrative(historian_agent):
    """歴史的物語生成のテスト"""
    # 高重要度
    record = Mock(importance_level=9)
    analysis = Mock(summary="英雄的な行動")
    narrative = historian_agent._generate_historical_narrative(record, analysis)
    assert "【重要な出来事】" in narrative

    # 中重要度
    record = Mock(importance_level=6)
    analysis = Mock(summary="注目すべき行動")
    narrative = historian_agent._generate_historical_narrative(record, analysis)
    assert "【注目すべき行動】" in narrative

    # 低重要度
    record = Mock(importance_level=3)
    analysis = Mock(summary="日常的な行動")
    narrative = historian_agent._generate_historical_narrative(record, analysis)
    assert "【記録】" in narrative


def test_get_character_history(historian_agent):
    """キャラクター履歴取得のテスト"""
    # テスト用の記録を追加
    for i in range(5):
        record = HistoricalRecord(
            session_id="session_123",
            actor_id="player_123",
            action_type=ActionType.PLAYER_ACTION,
            action_details={"action": f"行動{i}"},
            location={"name": "テスト場所"},
            participants=[],
            timestamp=datetime.utcnow() - timedelta(hours=i),
            importance_level=i + 1,
            tags=["test"],
            consequences=[],
            log_fragment_potential=0.5,
        )
        historian_agent.records_cache[record.id] = record

    # 別のキャラクターの記録も追加
    other_record = HistoricalRecord(
        session_id="session_123",
        actor_id="player_456",
        action_type=ActionType.PLAYER_ACTION,
        action_details={"action": "他の行動"},
        location={"name": "別の場所"},
        participants=[],
        timestamp=datetime.utcnow(),
        importance_level=5,
        tags=["other"],
        consequences=[],
        log_fragment_potential=0.5,
    )
    historian_agent.records_cache[other_record.id] = other_record

    # player_123の履歴を取得
    history = historian_agent.get_character_history("player_123", limit=3)

    assert len(history) == 3
    assert all(record.actor_id == "player_123" for record in history)
    # 新しい順にソートされていることを確認
    assert history[0].timestamp > history[1].timestamp
    assert history[1].timestamp > history[2].timestamp


def test_get_log_fragment_candidates(historian_agent):
    """ログの欠片候補取得のテスト"""
    # 高ポテンシャルの記録
    high_potential_record = HistoricalRecord(
        session_id="session_123",
        actor_id="player_123",
        action_type=ActionType.WORLD_EVENT,
        action_details={"event": "竜の襲来"},
        location={"name": "王都"},
        participants=["player_123", "npc_dragon"],
        timestamp=datetime.utcnow(),
        importance_level=10,
        tags=["epic", "combat"],
        consequences=["王都の一部が破壊された"],
        log_fragment_potential=0.95,
    )
    historian_agent.records_cache[high_potential_record.id] = high_potential_record

    # 低ポテンシャルの記録
    low_potential_record = HistoricalRecord(
        session_id="session_123",
        actor_id="player_123",
        action_type=ActionType.PLAYER_ACTION,
        action_details={"action": "休憩"},
        location={"name": "宿屋"},
        participants=["player_123"],
        timestamp=datetime.utcnow(),
        importance_level=2,
        tags=["rest"],
        consequences=[],
        log_fragment_potential=0.2,
    )
    historian_agent.records_cache[low_potential_record.id] = low_potential_record

    candidates = historian_agent.get_log_fragment_candidates("session_123", threshold=0.7)

    assert len(candidates) == 1
    assert candidates[0].id == high_potential_record.id
    assert candidates[0].log_fragment_potential >= 0.7


def test_check_consistency(historian_agent, sample_context):
    """一貫性チェックのテスト"""
    # 場所の矛盾をチェック
    new_action = {"rapid_location_change": True}

    warnings = historian_agent.check_consistency(new_action, sample_context)

    assert len(warnings) == 1
    assert "場所の一貫性" in warnings[0]
    assert "瞬間移動" in warnings[0]
