"""
混沌AI (The Anomaly) のテスト
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.ai.agents.anomaly import AnomalyAgent, AnomalyEvent
from app.services.ai.prompt_manager import AIAgentRole, PromptContext


@pytest.fixture
def mock_context():
    """テスト用のプロンプトコンテキスト"""
    return PromptContext(
        character_name="テストプレイヤー",
        character_stats={"hp": 100, "max_hp": 100, "mp": 80, "max_mp": 100, "sanity": 90},
        location="古代遺跡",
        recent_actions=["遺跡の扉を開けた", "禁呪を唱えた", "次元の裂け目を覗いた"],
        world_state={"stability": 0.7, "log_npc_density": 0.3, "log_corruption_level": 0.2},
        session_history=[
            {"role": "user", "content": "遺跡を探索する"},
            {"role": "assistant", "content": "あなたは古代遺跡の奥深くへと進みます..."},
        ],
        additional_context={
            "nearby_npcs": [
                {"name": "古代の守護者", "type": "npc"},
                {"name": "迷えるログ", "type": "log"},
            ]
        },
    )


@pytest.fixture
def anomaly_agent():
    """混沌AIエージェントのフィクスチャ"""
    mock_gemini = MagicMock()
    mock_prompt_manager = MagicMock()
    return AnomalyAgent(gemini_client=mock_gemini, prompt_manager=mock_prompt_manager)


class TestAnomalyAgent:
    """混沌AIエージェントのテスト"""

    def test_initialization(self, anomaly_agent):
        """初期化のテスト"""
        assert anomaly_agent.role == AIAgentRole.ANOMALY
        assert anomaly_agent.event_probability == 0.15
        assert anomaly_agent.cooldown_turns == 10
        assert anomaly_agent.last_event_turn == -float("inf")

    def test_should_trigger_event_cooldown(self, anomaly_agent, mock_context):
        """クールダウン中はイベントが発生しないことのテスト"""
        # 最近イベントが発生した設定
        anomaly_agent.last_event_turn = 10
        mock_context.session_history = [{"role": "user", "content": f"行動{i}"} for i in range(12)]

        # クールダウン中（12 - 10 = 2 < 5）
        assert not anomaly_agent._should_trigger_event(mock_context)

    @patch("random.random")
    def test_should_trigger_event_probability(self, mock_random, anomaly_agent, mock_context):
        """確率によるイベント発生のテスト"""
        # クールダウンを無効化
        anomaly_agent.last_event_turn = -100

        # 確率以下の場合は発生
        mock_random.return_value = 0.1
        assert anomaly_agent._should_trigger_event(mock_context)

        # 確率以上の場合は発生しない
        mock_random.return_value = 0.9
        assert not anomaly_agent._should_trigger_event(mock_context)

    def test_calculate_chaos_level(self, anomaly_agent, mock_context):
        """混沌レベル計算のテスト"""
        chaos_level = anomaly_agent._calculate_chaos_level(mock_context)

        # 基本値0.3 + 不安定度0.09 + 禁呪0.1 + ログ密度0.06 = 0.55
        assert 0.5 <= chaos_level <= 0.6

    def test_determine_event_type(self, anomaly_agent, mock_context):
        """イベントタイプ決定のテスト"""
        chaos_level = 0.6

        # ランダム性があるため、関数が正常に動作することを確認
        event_type = anomaly_agent._determine_event_type(mock_context, chaos_level)
        valid_types = [
            "reality_glitch",
            "time_anomaly",
            "dimensional_rift",
            "log_corruption",
            "causality_break",
            "memory_distortion",
            "entity_duplication",
            "law_reversal",
        ]
        assert event_type in valid_types

    def test_determine_intensity(self, anomaly_agent):
        """イベント強度決定のテスト"""
        assert anomaly_agent._determine_intensity(0.2) == "low"
        assert anomaly_agent._determine_intensity(0.5) == "medium"
        assert anomaly_agent._determine_intensity(0.7) == "high"
        assert anomaly_agent._determine_intensity(0.9) == "extreme"

    def test_enhance_context_for_event(self, anomaly_agent, mock_context):
        """イベント生成用コンテキスト拡張のテスト"""
        enhanced = anomaly_agent._enhance_context_for_event(mock_context, "reality_glitch", "high")

        assert enhanced.additional_context["anomaly_type"] == "reality_glitch"
        assert enhanced.additional_context["intensity"] == "high"
        assert "物理法則" in enhanced.additional_context["anomaly_template"]

    def test_parse_event_response(self, anomaly_agent):
        """イベントレスポンス解析のテスト"""
        raw_response = """空間が歪み、重力が逆転し始めた。
上下の概念が曖昧になり、地面が天井のように感じられる。

【効果】
重力反転: 0.8
移動困難: true
混乱状態: 0.5

【期間】3ターン"""

        event_data = anomaly_agent._parse_event_response(raw_response, "law_reversal", "high")

        assert "空間が歪み" in event_data["description"]
        assert "重力反転" in event_data["effects"]
        assert event_data["duration"] == 3

    def test_get_default_effects(self, anomaly_agent):
        """デフォルト効果取得のテスト"""
        effects = anomaly_agent._get_default_effects("reality_glitch", "medium")

        assert "physics_distortion" in effects
        assert effects["physics_distortion"] == 1.0
        assert "random_teleport" in effects

    def test_check_log_rampage(self, anomaly_agent, mock_context):
        """ログ暴走チェックのテスト"""
        # ログNPCがいない場合
        mock_context.additional_context["nearby_npcs"] = []
        assert not anomaly_agent._check_log_rampage(mock_context)

        # ログNPCがいる場合（確率的なので必ずしもTrueではない）
        mock_context.additional_context["nearby_npcs"] = [{"name": "ログNPC1", "type": "log"}]
        result = anomaly_agent._check_log_rampage(mock_context)
        assert isinstance(result, bool)

    def test_generate_event_choices(self, anomaly_agent):
        """イベント選択肢生成のテスト"""
        event = AnomalyEvent(
            event_type="reality_glitch",
            intensity="high",
            description="現実が歪んでいる",
            effects={"physics_distortion": 1.5},
        )

        choices = anomaly_agent._generate_event_choices(event)

        assert len(choices) == 3
        assert all(choice.id for choice in choices)
        assert all(choice.text for choice in choices)
        assert all(choice.difficulty in ["easy", "medium", "hard"] for choice in choices)

    def test_build_response(self, anomaly_agent, mock_context):
        """レスポンス構築のテスト"""
        event = AnomalyEvent(
            event_type="time_anomaly",
            intensity="medium",
            description="時間が歪み始めた",
            effects={"time_dilation": 1.0},
            duration=5,
        )

        response = anomaly_agent._build_response(event, mock_context)

        assert response.agent_role == "anomaly"
        assert response.narrative == "時間が歪み始めた"
        assert len(response.choices) == 3
        assert response.state_changes["anomaly_active"] is True
        assert response.state_changes["anomaly_duration"] == 5
        assert response.metadata["event_type"] == "time_anomaly"

    def test_create_empty_response(self, anomaly_agent):
        """空レスポンス作成のテスト"""
        response = anomaly_agent._create_empty_response()

        assert response.agent_role == "anomaly"
        assert response.narrative is None
        assert response.choices is None
        assert response.metadata["event_triggered"] is False

    @pytest.mark.asyncio
    async def test_process_no_event(self, anomaly_agent, mock_context):
        """イベントが発生しない場合のprocess()テスト"""
        # イベントが発生しないように設定
        with patch.object(anomaly_agent, "_should_trigger_event", return_value=False):
            response = await anomaly_agent.process(mock_context)

            assert response.agent_role == "anomaly"
            assert response.narrative is None
            assert response.metadata["event_triggered"] is False

    @pytest.mark.asyncio
    async def test_process_with_event(self, anomaly_agent, mock_context):
        """イベントが発生する場合のprocess()テスト"""
        # モックの設定
        anomaly_agent.generate_response = AsyncMock(
            return_value="""現実の法則が崩壊し、物理的な常識が通用しなくなった。
重力は気まぐれに方向を変え、時間は不規則に流れ始める。

【効果】
重力混乱: 0.8
時間歪曲: 0.5

【期間】4ターン"""
        )

        with patch.object(anomaly_agent, "_should_trigger_event", return_value=True):
            response = await anomaly_agent.process(mock_context)

            assert response.agent_role == "anomaly"
            assert response.narrative is not None
            assert "現実の法則が崩壊" in response.narrative
            assert len(response.choices) == 3
            assert response.state_changes["anomaly_active"] is True

    @pytest.mark.asyncio
    async def test_generate_anomaly_event(self, anomaly_agent, mock_context):
        """混沌イベント生成のテスト"""
        anomaly_agent.generate_response = AsyncMock(
            return_value="""次元の境界が薄れ、異世界の存在が侵入してきた。

【効果】
次元侵食: 1.5
異界の存在: 3体

【期間】6ターン"""
        )

        event = await anomaly_agent._generate_anomaly_event(mock_context, "dimensional_rift", 0.7)

        assert event.event_type == "dimensional_rift"
        assert event.intensity == "high"
        assert event.duration == 6
        assert "次元侵食" in event.effects

    @pytest.mark.asyncio
    async def test_enhance_to_log_rampage(self, anomaly_agent, mock_context):
        """ログ暴走強化のテスト"""
        base_event = AnomalyEvent(
            event_type="log_corruption",
            intensity="medium",
            description="ログが汚染された",
            effects={"data_corruption": 1.0},
        )

        anomaly_agent.generate_response = AsyncMock(
            return_value="ログNPCが暴走し、現実を書き換え始めた！過去の記録が実体化し、矛盾する複数の真実が同時に存在する。"
        )

        enhanced = await anomaly_agent._enhance_to_log_rampage(mock_context, base_event)

        assert enhanced.event_type == "log_rampage"
        assert enhanced.intensity == "extreme"
        assert enhanced.effects["log_rampage"] is True
        assert enhanced.effects["hostile_log_npcs"] is True
