"""
世界の意識AI (The World) のテスト
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.ai.agents.the_world import TheWorldAI, WorldEvent, WorldState
from app.services.ai.prompt_manager import PromptContext


@pytest.fixture
def mock_gemini_client():
    """モックGeminiクライアント"""
    client = MagicMock()
    return client


@pytest.fixture
def mock_prompt_manager():
    """モックプロンプトマネージャー"""
    manager = MagicMock()
    return manager


@pytest.fixture
def the_world_ai(mock_gemini_client, mock_prompt_manager):
    """TheWorldAIインスタンス"""
    return TheWorldAI(
        gemini_client=mock_gemini_client,
        prompt_manager=mock_prompt_manager,
    )


@pytest.fixture
def sample_context():
    """サンプルコンテキスト"""
    return PromptContext(
        character_name="テストプレイヤー",
        character_stats={"level": 5, "hp": 100},
        location="王都エルサレム",
        recent_actions=[
            "宿屋で休憩した",
            "商人と取引した",
            "ゴブリンと戦闘した",
            "街の衛兵と会話した",
            "魔法を使って火を起こした",
        ],
        world_state={},
        session_history=[],
        additional_context={},
    )


class TestTheWorldAI:
    """TheWorldAIのテスト"""

    def test_initialization(self, the_world_ai):
        """初期化のテスト"""
        assert the_world_ai.world_state is not None
        assert isinstance(the_world_ai.world_state, WorldState)
        assert 0.0 <= the_world_ai.world_state.peace_level <= 1.0
        assert 0.0 <= the_world_ai.world_state.resource_abundance <= 1.0
        assert 0.0 <= the_world_ai.world_state.magical_activity <= 1.0
        assert 0.0 <= the_world_ai.world_state.corruption_level <= 1.0
        assert len(the_world_ai.event_templates) > 0

    def test_event_templates_initialization(self, the_world_ai):
        """イベントテンプレートの初期化テスト"""
        templates = the_world_ai.event_templates
        
        # 基本的なイベントが含まれているか確認
        assert "blood_moon" in templates
        assert "harvest_festival" in templates
        assert "faction_war" in templates
        assert "magical_surge" in templates
        assert "plague_outbreak" in templates
        
        # イベントの構造確認
        blood_moon = templates["blood_moon"]
        assert isinstance(blood_moon, WorldEvent)
        assert blood_moon.type == "celestial"
        assert blood_moon.severity == 6
        assert blood_moon.duration_hours == 12

    def test_check_prerequisites(self, the_world_ai):
        """前提条件チェックのテスト"""
        # 血月イベントの前提条件テスト
        blood_moon = the_world_ai.event_templates["blood_moon"]
        
        # 汚染度が低い場合はFalse
        the_world_ai.world_state.corruption_level = 0.3
        assert not the_world_ai._check_prerequisites(blood_moon)
        
        # 汚染度が高い場合はTrue
        the_world_ai.world_state.corruption_level = 0.7
        assert the_world_ai._check_prerequisites(blood_moon)

    def test_check_prerequisites_faction_war(self, the_world_ai):
        """勢力間戦争の前提条件チェックテスト"""
        faction_war = the_world_ai.event_templates["faction_war"]
        
        # 勢力間緊張度が低い場合
        the_world_ai.world_state.faction_tensions = {"faction1_faction2": 0.5}
        assert not the_world_ai._check_prerequisites(faction_war)
        
        # 勢力間緊張度が高い場合
        the_world_ai.world_state.faction_tensions = {"faction1_faction2": 0.9}
        assert the_world_ai._check_prerequisites(faction_war)

    @pytest.mark.asyncio
    async def test_update_world_state(self, the_world_ai, sample_context):
        """世界状態更新のテスト"""
        initial_peace = the_world_ai.world_state.peace_level
        
        # 戦闘行動が多い場合
        combat_context = sample_context.model_copy(
            update={
                "recent_actions": [
                    "ゴブリンと戦った",
                    "盗賊を攻撃した",
                    "魔物と戦闘した",
                    "衛兵と戦った",
                    "決闘した",
                ]
            }
        )
        
        with patch.object(the_world_ai, "_analyze_world_trends", new_callable=AsyncMock):
            await the_world_ai._update_world_state(combat_context)
        
        # 平和度が下がるはず
        assert the_world_ai.world_state.peace_level < initial_peace

    @pytest.mark.asyncio
    async def test_analyze_world_trends(self, the_world_ai, sample_context):
        """世界トレンド分析のテスト"""
        # モックレスポンス
        mock_response = json.dumps({
            "peace_level_change": 0.05,
            "resource_abundance_change": -0.02,
            "magical_activity_change": 0.1,
            "corruption_level_change": -0.03,
            "analysis": "平和的な活動が増加し、魔法の使用も活発化している"
        })
        
        with patch.object(the_world_ai, "generate_response", new_callable=AsyncMock, return_value=mock_response):
            initial_peace = the_world_ai.world_state.peace_level
            initial_magic = the_world_ai.world_state.magical_activity
            
            await the_world_ai._analyze_world_trends(sample_context)
            
            # 状態が更新されているか確認
            assert the_world_ai.world_state.peace_level > initial_peace
            assert the_world_ai.world_state.magical_activity > initial_magic

    def test_parse_choices(self, the_world_ai):
        """選択肢解析のテスト"""
        # 様々な形式の選択肢
        response = """
1. 血月の影響から身を守るために聖域を探す
2. この機会に魔法の力を高めるため瞑想する
3. 街の人々を守るために警備に協力する
"""
        choices = the_world_ai._parse_choices(response)
        
        assert len(choices) == 3
        assert choices[0].text == "血月の影響から身を守るために聖域を探す"
        assert choices[1].text == "この機会に魔法の力を高めるため瞑想する"
        assert choices[2].text == "街の人々を守るために警備に協力する"

    def test_parse_choices_default(self, the_world_ai):
        """デフォルト選択肢のテスト"""
        # 解析できない形式
        response = "何か不明な文章"
        choices = the_world_ai._parse_choices(response)
        
        assert len(choices) == 3
        assert choices[0].id == "observe"
        assert choices[1].id == "investigate"
        assert choices[2].id == "react"

    @pytest.mark.asyncio
    async def test_process_status_update(self, the_world_ai, sample_context):
        """ステータスアップデート処理のテスト"""
        # イベントトリガーがない場合の処理
        with patch.object(the_world_ai, "_update_world_state", new_callable=AsyncMock):
            with patch.object(the_world_ai, "_check_event_triggers", return_value=[]):
                with patch.object(the_world_ai, "_create_status_response", new_callable=AsyncMock) as mock_status:
                    mock_response = MagicMock(
                        agent_role="the_world",
                        narrative="世界は平穏な時を刻んでいる...",
                    )
                    mock_status.return_value = mock_response
                    
                    response = await the_world_ai.process(sample_context)
                    
                    assert response is not None
                    assert response == mock_response
                    mock_status.assert_called_once()

    @pytest.mark.asyncio
    async def test_process_event_trigger(self, the_world_ai, sample_context):
        """イベントトリガー処理のテスト"""
        # 血月イベントをトリガー可能にする
        the_world_ai.world_state.corruption_level = 0.7
        blood_moon = the_world_ai.event_templates["blood_moon"]
        
        with patch.object(the_world_ai, "_update_world_state", new_callable=AsyncMock):
            with patch.object(the_world_ai, "_check_event_triggers", return_value=[blood_moon]):
                with patch.object(the_world_ai, "_select_and_generate_event", new_callable=AsyncMock) as mock_select:
                    with patch.object(the_world_ai, "_create_event_response", new_callable=AsyncMock) as mock_create:
                        mock_select.return_value = blood_moon
                        mock_response = MagicMock(
                            agent_role="the_world",
                            narrative="血月が空に昇り始めた...",
                        )
                        mock_create.return_value = mock_response
                        
                        response = await the_world_ai.process(sample_context)
                        
                        assert response is not None
                        assert response == mock_response
                        mock_select.assert_called_once()
                        mock_create.assert_called_once()

    @pytest.mark.asyncio
    async def test_cleanup_expired_events(self, the_world_ai):
        """期限切れイベントのクリーンアップテスト"""
        from datetime import datetime, timedelta
        
        # 期限切れイベントを追加
        expired_time = (datetime.now() - timedelta(hours=25)).isoformat()
        the_world_ai.world_state.event_history.append({
            "id": "blood_moon",
            "name": "血月の夜",
            "started_at": expired_time,
            "location": "王都",
        })
        the_world_ai.world_state.active_events.append("blood_moon")
        
        await the_world_ai.cleanup_expired_events()
        
        # アクティブイベントから削除されているか確認
        assert "blood_moon" not in the_world_ai.world_state.active_events