"""
派遣ログAIシミュレーションのテスト
"""

from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from sqlmodel import Session

from app.models.log import CompletedLog
from app.models.log_dispatch import (
    DispatchObjectiveType,
    LogDispatch,
)
from app.services.ai.dispatch_simulator import (
    ActivityContext,
    DispatchSimulator,
    SimulatedActivity,
)


@pytest.fixture
def mock_completed_log():
    """テスト用の完成ログ"""
    return CompletedLog(
        id="test-log-id",
        name="テスト冒険者",
        personality="勇敢、好奇心旺盛",
        skills=["探索", "戦闘", "交渉"],
        contamination_level=0.3,
        fragments_used=3,
        status="completed",
        player_id="test-player",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )


@pytest.fixture
def mock_dispatch_explore(mock_completed_log):
    """探索型の派遣"""
    return LogDispatch(
        id="test-dispatch-explore",
        completed_log_id=mock_completed_log.id,
        player_id="test-player",
        objective_type=DispatchObjectiveType.EXPLORE,
        objective_details={},
        destination="未知の森",
        sp_cost=10,
        dispatched_at=datetime.utcnow(),
        travel_log=[],
        discovered_locations=[],
        collected_items=[],
    )


@pytest.fixture
def mock_dispatch_interact(mock_completed_log):
    """交流型の派遣"""
    return LogDispatch(
        id="test-dispatch-interact",
        completed_log_id=mock_completed_log.id,
        player_id="test-player",
        objective_type=DispatchObjectiveType.INTERACT,
        objective_details={},
        destination="商業地区",
        sp_cost=10,
        dispatched_at=datetime.utcnow(),
        travel_log=[],
        discovered_locations=[],
        collected_items=[],
    )


@pytest.fixture
def mock_dramatist_response():
    """モックの脚本家AIレスポンス"""
    return MagicMock(
        narrative="テスト冒険者は慎重に周囲を探索し、古代の遺跡を発見した。",
        metadata={"location_name": "忘れられた神殿"},
    )


@pytest.mark.asyncio
async def test_simulate_exploration_activity(
    mock_dispatch_explore,
    mock_completed_log,
    mock_dramatist_response,
):
    """探索活動のシミュレーションテスト"""
    simulator = DispatchSimulator()

    # モックの設定
    with patch.object(
        simulator.dramatist,
        "process",
        return_value=mock_dramatist_response,
    ):
        # DBセッションのモック
        mock_db = MagicMock(spec=Session)

        # シミュレーション実行
        activity = await simulator.simulate_activity(
            dispatch=mock_dispatch_explore,
            completed_log=mock_completed_log,
            db=mock_db,
        )

        # 結果の検証
        assert isinstance(activity, SimulatedActivity)
        assert activity.action == "周辺地域の詳細な調査"
        assert activity.narrative == mock_dramatist_response.narrative
        assert activity.success_level >= 0.5
        assert "exploration" in activity.experience_gained


@pytest.mark.asyncio
async def test_simulate_interaction_with_encounter(
    mock_dispatch_interact,
    mock_completed_log,
):
    """遭遇を含む交流活動のシミュレーションテスト"""
    simulator = DispatchSimulator()

    # 遭遇が発生するようにモック設定
    from app.models.log_dispatch import DispatchEncounter
    mock_encounter_obj = DispatchEncounter(
        id="encounter-1",
        dispatch_id="test-dispatch-interact",
        encountered_character_id=None,
        encountered_npc_name="商人ギルド員",
        location="商業地区",
        interaction_type="商談",
        interaction_summary="商談を行った",
        outcome="friendly",
        relationship_change=0.3,
        items_exchanged=[],
        occurred_at=datetime.utcnow(),
    )
    
    with patch.object(simulator, "_create_ai_driven_encounter") as mock_encounter:
        mock_encounter.return_value = mock_encounter_obj
        
        with patch.object(simulator, "_generate_encounter_narrative") as mock_narrative:
            mock_narrative.return_value = "商人ギルド員との商談が行われた。"

            mock_db = MagicMock(spec=Session)

            # シミュレーション実行
            activity = await simulator.simulate_activity(
                dispatch=mock_dispatch_interact,
                completed_log=mock_completed_log,
                db=mock_db,
            )

            # 結果の検証
            assert activity.encounter is not None
            assert "商人ギルド員" in activity.action
            assert activity.success_level > 0.7
            assert len(activity.relationship_changes) > 0


@pytest.mark.asyncio
async def test_personality_modifiers():
    """性格による活動調整のテスト"""
    simulator = DispatchSimulator()

    # 慎重な性格のログ
    cautious_log = MagicMock(
        personality_traits=["慎重", "計画的"],
        contamination_level=0.1,
    )

    # 基本的な活動
    base_activity = SimulatedActivity(
        timestamp=datetime.utcnow(),
        location="テスト場所",
        action="テスト行動",
        result="テスト結果",
        narrative="テスト物語",
        success_level=0.9,
    )

    # 性格による調整を適用
    modified_activity = simulator._apply_personality_modifiers(
        base_activity,
        cautious_log,
    )

    # 慎重な性格は成功率を抑制する
    assert modified_activity.success_level <= 0.8
    assert modified_activity.success_level >= 0.4


@pytest.mark.asyncio
async def test_high_contamination_effects():
    """高汚染度の影響テスト"""
    simulator = DispatchSimulator()

    # 高汚染度のログ
    contaminated_log = MagicMock(
        personality="混沌",
        contamination_level=0.8,
    )

    base_activity = SimulatedActivity(
        timestamp=datetime.utcnow(),
        location="テスト場所",
        action="テスト行動",
        result="テスト結果",
        narrative="テスト物語",
        success_level=0.5,
    )

    # 10回実行して、予測不能な効果が発生することを確認
    strange_effects_count = 0
    for _ in range(10):
        modified = simulator._apply_personality_modifiers(
            base_activity.model_copy(),
            contaminated_log,
        )
        if "奇妙な感覚" in modified.narrative:
            strange_effects_count += 1

    # 高汚染度では約20%の確率で奇妙な効果
    assert strange_effects_count > 0


@pytest.mark.asyncio
async def test_fallback_simulation():
    """エラー時のフォールバックシミュレーションテスト"""
    simulator = DispatchSimulator()

    # AIがエラーを起こすようにモック
    with patch.object(
        simulator,
        "simulate_activity",
        side_effect=Exception("AI Error"),
    ):
        from app.tasks.dispatch_tasks import simulate_dispatch_activity_fallback

        mock_dispatch = MagicMock(
            objective_type=DispatchObjectiveType.EXPLORE,
            travel_log=[],
            discovered_locations=[],
        )
        mock_log = MagicMock()
        mock_db = MagicMock()

        # フォールバック実行
        activity = simulate_dispatch_activity_fallback(
            mock_dispatch,
            mock_log,
            mock_db,
        )

        # 基本的な活動が生成されることを確認
        assert isinstance(activity, dict)
        assert "timestamp" in activity
        assert "location" in activity
        assert "action" in activity
        assert "result" in activity


def test_activity_context_building(mock_completed_log):
    """活動コンテキスト構築のテスト"""
    simulator = DispatchSimulator()

    # LogDispatchオブジェクトを作成
    mock_dispatch = LogDispatch(
        id="test-dispatch-guard",
        completed_log_id=mock_completed_log.id,
        dispatcher_id="test-player",
        player_id="test-player",
        objective_type=DispatchObjectiveType.GUARD,
        objective_detail="エリアの警備",
        initial_location="拠点",
        destination="警備地点",
        sp_cost=10,
        status="dispatched",
        current_location="警備地点",
        dispatched_at=datetime.utcnow(),
        travel_log=[
            {"action": "出発", "result": "順調"},
            {"action": "巡回開始", "result": "異常なし"},
        ],
        discovered_locations=[],
        collected_items=[],
    )

    # コンテキスト構築
    context = simulator._build_activity_context(mock_dispatch, mock_completed_log)

    # 検証
    assert isinstance(context, ActivityContext)
    assert context.dispatch == mock_dispatch
    assert context.completed_log == mock_completed_log
    assert len(context.previous_activities) == 2
    assert context.encounter_potential <= 0.2  # 守護型は低い遭遇率


@pytest.mark.asyncio
async def test_trade_activity_simulation():
    """商業活動シミュレーションのテスト"""
    simulator = DispatchSimulator()

    mock_dispatch = MagicMock(
        id="trade-dispatch",
        objective_type=DispatchObjectiveType.TRADE,
        objective_details={},
        travel_log=[],
    )

    mock_log = MagicMock(
        name="商人テスト",
        skills=["商才"],
        personality="商売上手",
        contamination_level=0.2,
    )

    mock_db = MagicMock()

    # AIレスポンスのモック
    with patch.object(
        simulator.dramatist,
        "process",
        return_value=MagicMock(
            narrative="巧みな交渉により大きな利益を得た。"
        ),
    ):
        activity = await simulator.simulate_activity(
            mock_dispatch,
            mock_log,
            mock_db,
        )

        # 商業活動特有の検証
        assert activity.action == "商取引の実施"
        assert "ゴールドの利益" in activity.result
        assert activity.success_level > 0.5  # 商才スキルによるボーナス
        assert "trade" in activity.experience_gained

        # 経済詳細が更新されているか確認
        assert "economic_details" in mock_dispatch.objective_details
        assert "transactions" in mock_dispatch.objective_details["economic_details"]


@pytest.mark.asyncio
async def test_memory_preservation_activity():
    """記憶保存活動シミュレーションのテスト"""
    simulator = DispatchSimulator()

    mock_dispatch = MagicMock(
        objective_type=DispatchObjectiveType.MEMORY_PRESERVE,
        objective_details={},
        travel_log=[],
    )

    # 高汚染度は記憶との親和性が高い
    mock_log = MagicMock(
        contamination_level=0.8,
        personality="共感的",
        skills=[],
    )

    mock_db = MagicMock()

    with patch.object(
        simulator.dramatist,
        "process",
        return_value=MagicMock(
            narrative="失われた記憶と深く共鳴した。"
        ),
    ):
        activity = await simulator.simulate_activity(
            mock_dispatch,
            mock_log,
            mock_db,
        )

        # 記憶保存活動の検証
        assert "記憶の収集と保存" in activity.action
        assert "個の記憶を発見" in activity.result
        assert "memory_work" in activity.experience_gained

        # 記憶保存詳細の更新確認
        assert "memory_details" in mock_dispatch.objective_details
