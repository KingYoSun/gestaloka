"""
派遣ログAIシミュレーションのテスト
"""

from datetime import datetime, UTC
from unittest.mock import MagicMock, patch

import pytest
from sqlmodel import Session

from app.models.log import CompletedLog, CompletedLogStatus
from app.models.log_dispatch import (
    DispatchObjectiveType,
    DispatchStatus,
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
        creator_id="test-player",
        core_fragment_id="test-fragment-id",
        name="テスト冒険者",
        description="テスト用の冒険者ログ",
        skills=["探索", "戦闘", "交渉"],
        personality_traits=["勇敢", "好奇心旺盛"],
        behavior_patterns={},
        contamination_level=0.3,
        status=CompletedLogStatus.COMPLETED,
        created_at=datetime.utcnow(),
    )


@pytest.fixture
def mock_dispatch_explore(mock_completed_log):
    """探索型の派遣"""
    return LogDispatch(
        id="test-dispatch-explore",
        completed_log_id=mock_completed_log.id,
        dispatcher_id="test-player",
        objective_type=DispatchObjectiveType.EXPLORE,
        objective_detail="未知の場所を探索",
        initial_location="未知の森",
        dispatch_duration_days=7,
        sp_cost=10,
        status=DispatchStatus.DISPATCHED,
        dispatched_at=datetime.now(UTC),
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
        dispatcher_id="test-player",
        objective_type=DispatchObjectiveType.INTERACT,
        objective_detail="他のキャラクターとの交流",
        initial_location="商業地区",
        dispatch_duration_days=5,
        sp_cost=10,
        status=DispatchStatus.DISPATCHED,
        dispatched_at=datetime.now(UTC),
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

            # ランダム関数をモックして、必ず遭遇が発生するようにする
            with patch("app.services.ai.dispatch_simulator.random.random", return_value=0.1):
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
    cautious_log = CompletedLog(
        id="cautious-log-id",
        creator_id="test-creator",
        core_fragment_id="test-fragment",
        name="慎重な探索者",
        description="慎重で計画的な探索者",
        skills=[],
        personality_traits=["慎重", "計画的"],
        behavior_patterns={},
        contamination_level=0.1,
        status=CompletedLogStatus.ACTIVE,
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
    contaminated_log = CompletedLog(
        id="contaminated-log-id",
        creator_id="test-creator",
        core_fragment_id="test-fragment",
        name="混沌の使者",
        description="高度に汚染されたログ",
        skills=[],
        personality_traits=["混沌"],
        behavior_patterns={},
        contamination_level=0.8,
        status=CompletedLogStatus.ACTIVE,
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
        objective_type=DispatchObjectiveType.GUARD,
        objective_detail="エリアの警備",
        initial_location="拠点",
        dispatch_duration_days=3,
        sp_cost=10,
        status=DispatchStatus.DISPATCHED,
        current_location="警備地点",
        dispatched_at=datetime.now(UTC),
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

    # 実際のモデルインスタンスを作成
    mock_dispatch = LogDispatch(
        id="trade-dispatch",
        completed_log_id="test-log-id",
        dispatcher_id="test-dispatcher-id",
        objective_type=DispatchObjectiveType.TRADE,
        objective_detail="商取引活動",
        initial_location="市場エリア",
        dispatch_duration_days=7,
        sp_cost=50,
        status=DispatchStatus.DISPATCHED,
        travel_log=[],
        dispatched_at=datetime.now(UTC),
    )

    mock_log = CompletedLog(
        id="test-log-id",
        creator_id="test-creator-id",
        core_fragment_id="test-fragment-id",
        name="商人テスト",
        description="テスト用商人ログ",
        skills=["商才"],
        personality_traits=["商売上手"],
        behavior_patterns={},
        contamination_level=0.2,
        status=CompletedLogStatus.ACTIVE,
    )

    mock_db = MagicMock()

    # AIレスポンスのモック
    with patch.object(
        simulator.dramatist,
        "process",
        return_value=MagicMock(narrative="巧みな交渉により大きな利益を得た。"),
    ):
        activity = await simulator.simulate_activity(
            mock_dispatch,
            mock_log,
            mock_db,
        )

        # 商業活動特有の検証
        assert activity.action == "商取引の実施"
        assert "ゴールドの利益" in activity.result
        assert activity.success_level > 0.3  # 商取引の基本成功率
        assert "trade" in activity.experience_gained

        # 経済詳細がtravel_logに記録されているか確認
        assert len(mock_dispatch.travel_log) > 0
        last_log = mock_dispatch.travel_log[-1]
        assert "economic_transaction" in last_log
        assert "value" in last_log["economic_transaction"]
        assert "profit" in last_log["economic_transaction"]


@pytest.mark.asyncio
async def test_memory_preservation_activity():
    """記憶保存活動シミュレーションのテスト"""
    simulator = DispatchSimulator()

    # 実際のモデルインスタンスを作成
    mock_dispatch = LogDispatch(
        id="memory-dispatch",
        completed_log_id="test-log-id-2",
        dispatcher_id="test-dispatcher-id-2",
        objective_type=DispatchObjectiveType.MEMORY_PRESERVE,
        objective_detail="記憶保存活動",
        initial_location="記憶の泉",
        dispatch_duration_days=3,
        sp_cost=30,
        status=DispatchStatus.DISPATCHED,
        travel_log=[],
        dispatched_at=datetime.now(UTC),
    )

    # 高汚染度は記憶との親和性が高い
    mock_log = CompletedLog(
        id="test-log-id-2",
        creator_id="test-creator-id-2",
        core_fragment_id="test-fragment-id-2",
        name="記憶の守護者",
        description="記憶を守る者",
        skills=[],
        personality_traits=["共感的"],
        behavior_patterns={},
        contamination_level=0.8,
        status=CompletedLogStatus.ACTIVE,
    )

    mock_db = MagicMock()

    with patch.object(
        simulator.dramatist,
        "process",
        return_value=MagicMock(narrative="失われた記憶と深く共鳴した。"),
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

        # 記憶保存詳細がtravel_logに記録されているか確認
        assert len(mock_dispatch.travel_log) > 0
        last_log = mock_dispatch.travel_log[-1]
        assert "memory_preservation" in last_log
        assert "memories_found" in last_log["memory_preservation"]
        assert "memories_preserved" in last_log["memory_preservation"]
