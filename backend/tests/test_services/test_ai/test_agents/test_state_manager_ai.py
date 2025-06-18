"""
状態管理AIのテスト
"""

import pytest

from app.services.ai.agents.state_manager import StateManagerAgent
from app.services.ai.prompt_manager import PromptContext


def test_state_manager_response_parsing():
    """状態管理AIのレスポンス解析テスト"""
    agent = StateManagerAgent()

    # JSON形式のレスポンステスト
    json_response = """
    ```json
    {
        "success": true,
        "parameter_changes": {
            "hp": -10,
            "stamina": -5
        },
        "triggered_events": [{
            "type": "damage_taken",
            "description": "岩を持ち上げる際に軽い怪我をしました"
        }],
        "new_relationships": [],
        "reason": "力強く岩を持ち上げましたが、若干の負傷を負いました"
    }
    ```
    """

    result = agent._parse_response(json_response)

    assert result.success is True
    assert result.parameter_changes["hp"] == -10
    assert result.parameter_changes["stamina"] == -5
    assert len(result.triggered_events) == 1
    assert result.triggered_events[0]["type"] == "damage_taken"
    assert result.reason == "力強く岩を持ち上げましたが、若干の負傷を負いました"

    # フォールバック解析のテスト
    text_response = "行動は成功しました。HP -5、MP -10"

    fallback_result = agent._parse_response(text_response)

    assert fallback_result.success is True
    assert fallback_result.parameter_changes["hp"] == -5
    assert fallback_result.parameter_changes["mp"] == -10


@pytest.mark.asyncio
async def test_state_manager_environment_modifiers():
    """環境修正値の計算テスト"""
    agent = StateManagerAgent()

    # 夜の森でのテスト
    context_night_forest = PromptContext(
        character_name="テストキャラクター",
        character_stats={"hp": 100, "max_hp": 100, "mp": 50, "max_mp": 100},
        location="深い森",
        world_state={"time_of_day": "夜", "weather": "晴れ"},
    )

    modifiers = agent._calculate_environment_modifiers(context_night_forest)

    # 夜の修正値確認
    assert modifiers["visibility"] == 0.7
    assert modifiers["stealth"] == 1.3
    assert modifiers["nature_affinity"] == 1.2  # 森の修正

    # 雨の都市でのテスト
    context_rain_city = PromptContext(
        character_name="テストキャラクター",
        character_stats={"hp": 100, "max_hp": 100, "mp": 50, "max_mp": 100},
        location="大都市",
        world_state={"time_of_day": "昼", "weather": "雨"},
    )

    modifiers = agent._calculate_environment_modifiers(context_rain_city)

    # 雨と都市の修正値確認
    assert modifiers["physical_action"] == 0.8
    assert modifiers["fire_magic"] == 0.5
    assert modifiers["social_action"] == 1.2


def test_state_manager_rule_loading():
    """ゲームルールのロードテスト"""
    agent = StateManagerAgent()

    # ルールが正しくロードされているか確認
    assert agent.rules["base_success_rate"] == 0.7
    assert agent.rules["difficulty_modifiers"]["easy"] == 0.8
    assert agent.rules["difficulty_modifiers"]["medium"] == 1.0
    assert agent.rules["difficulty_modifiers"]["hard"] == 1.5

    # アクションコストの確認
    assert agent.rules["action_costs"]["physical"]["stamina"] == 10
    assert agent.rules["action_costs"]["magical"]["mp"] == 20

    # ステータス上限の確認
    assert agent.rules["status_limits"]["hp"]["max"] == 9999
    assert agent.rules["status_limits"]["sanity"]["min"] == 0


@pytest.mark.asyncio
async def test_state_manager_action_calculation():
    """行動成功率計算のテスト"""
    agent = StateManagerAgent()

    # レベル10のキャラクターで中難易度の行動
    result = await agent.calculate_action_result(character_stats={"level": 10}, action="攻撃する", difficulty="medium")

    # 成功率の計算確認（基本0.7 × 難易度1.0 × レベル修正1.18）
    expected_rate = 0.7 * 1.0 * (1.0 + (10 - 1) * 0.02)
    assert abs(result["success_rate"] - expected_rate) < 0.001

    # 追加修正値のテスト
    result_with_modifiers = await agent.calculate_action_result(
        character_stats={"level": 5},
        action="魔法を使う",
        difficulty="hard",
        modifiers={"magical_power": 1.5, "concentration": 0.8},
    )

    # 修正値が適用されているか確認
    # 基本: 0.7 × 難易度hard: 1.5 × レベル修正: 1.08 × magical_power: 1.5 × concentration: 0.8
    # = 0.7 * 1.5 * 1.08 * 1.5 * 0.8 = 1.3608
    # ただし、1.0でクリップされる
    assert result_with_modifiers["success_rate"] == 1.0  # 上限でクリップ
