"""
派遣ログ相互作用システムのテスト
"""

import asyncio
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlmodel import Session

from app.models.log import CompletedLog
from app.models.log_dispatch import (
    DispatchObjectiveType,
    DispatchStatus,
    LogDispatch,
)
from app.services.ai.dispatch_interaction import (
    DispatchInteraction,
    DispatchInteractionManager,
    InteractionOutcome,
)


@pytest.fixture
def mock_log_1():
    """テスト用の完成ログ1"""
    return CompletedLog(
        id="log-1",
        name="冒険者A",
        personality="友好的、社交的",
        skills=["交渉", "探索"],
        contamination_level=0.2,
        fragments_used=3,
        status="completed",
        player_id="player-1",
    )


@pytest.fixture
def mock_log_2():
    """テスト用の完成ログ2"""
    return CompletedLog(
        id="log-2",
        name="冒険者B",
        personality="慎重、知的",
        skills=["研究", "探索"],
        contamination_level=0.3,
        fragments_used=4,
        status="completed",
        player_id="player-2",
    )


@pytest.fixture
def mock_dispatch_1(mock_log_1):
    """テスト用の派遣1（交流型）"""
    return LogDispatch(
        id="dispatch-1",
        completed_log_id=mock_log_1.id,
        player_id="player-1",
        objective_type=DispatchObjectiveType.INTERACT,
        objective_details={},
        destination="市場",
        sp_cost=10,
        status=DispatchStatus.DISPATCHED,
        dispatched_at=datetime.utcnow(),
        travel_log=[
            {
                "timestamp": datetime.utcnow().isoformat(),
                "location": "市場",
                "action": "到着",
                "result": "賑わっている",
            }
        ],
        discovered_locations=[],
        collected_items=[],
    )


@pytest.fixture
def mock_dispatch_2(mock_log_2):
    """テスト用の派遣2（交流型）"""
    return LogDispatch(
        id="dispatch-2",
        completed_log_id=mock_log_2.id,
        player_id="player-2",
        objective_type=DispatchObjectiveType.INTERACT,
        objective_details={},
        destination="市場",
        sp_cost=10,
        status=DispatchStatus.DISPATCHED,
        dispatched_at=datetime.utcnow(),
        travel_log=[
            {
                "timestamp": datetime.utcnow().isoformat(),
                "location": "市場",
                "action": "到着",
                "result": "情報収集中",
            }
        ],
        discovered_locations=[],
        collected_items=[],
    )


@pytest.mark.asyncio
async def test_should_interact_same_location():
    """同じ場所での相互作用判定テスト"""
    manager = DispatchInteractionManager()
    
    dispatch_1 = MagicMock(
        player_id="player-1",
        objective_type=DispatchObjectiveType.INTERACT,
        travel_log=[{"location": "市場"}],
    )
    
    dispatch_2 = MagicMock(
        player_id="player-2",
        objective_type=DispatchObjectiveType.INTERACT,
        travel_log=[{"location": "市場"}],
    )
    
    # モックで最後の相互作用時間を設定
    with patch.object(
        manager,
        "_hours_since_last_interaction",
        return_value=24,
    ):
        # 同じ場所にいる場合、相互作用の可能性がある
        should_interact = manager._should_interact(dispatch_1, dispatch_2)
        
        # 交流型同士は80%の確率なので、複数回実行して確認
        interactions = [
            manager._should_interact(dispatch_1, dispatch_2)
            for _ in range(100)
        ]
        interaction_rate = sum(interactions) / len(interactions)
        
        assert 0.7 < interaction_rate < 0.9  # 約80%


def test_should_not_interact_same_player():
    """同じプレイヤーの派遣は相互作用しない"""
    manager = DispatchInteractionManager()
    
    dispatch_1 = MagicMock(player_id="player-1")
    dispatch_2 = MagicMock(player_id="player-1")
    
    assert not manager._should_interact(dispatch_1, dispatch_2)


def test_should_not_interact_different_location():
    """異なる場所では相互作用しない"""
    manager = DispatchInteractionManager()
    
    dispatch_1 = MagicMock(
        player_id="player-1",
        travel_log=[{"location": "森"}],
    )
    
    dispatch_2 = MagicMock(
        player_id="player-2",
        travel_log=[{"location": "山"}],
    )
    
    assert not manager._should_interact(dispatch_1, dispatch_2)


def test_interaction_probability_by_objective_type():
    """目的タイプによる相互作用確率のテスト"""
    manager = DispatchInteractionManager()
    
    # 交流型同士
    prob = manager._calculate_interaction_probability(
        DispatchObjectiveType.INTERACT,
        DispatchObjectiveType.INTERACT,
    )
    assert prob == 0.8
    
    # 商業型同士
    prob = manager._calculate_interaction_probability(
        DispatchObjectiveType.TRADE,
        DispatchObjectiveType.TRADE,
    )
    assert prob == 0.6
    
    # 守護型との組み合わせ
    prob = manager._calculate_interaction_probability(
        DispatchObjectiveType.GUARD,
        DispatchObjectiveType.INTERACT,
    )
    assert prob == 0.1
    
    # 研究型同士
    prob = manager._calculate_interaction_probability(
        DispatchObjectiveType.RESEARCH,
        DispatchObjectiveType.RESEARCH,
    )
    assert prob == 0.5


@pytest.mark.asyncio
async def test_process_interaction_success(
    mock_dispatch_1,
    mock_dispatch_2,
    mock_log_1,
    mock_log_2,
):
    """相互作用処理の成功テスト"""
    manager = DispatchInteractionManager()
    
    # DBモックの設定
    mock_db = MagicMock(spec=Session)
    mock_db.get.side_effect = lambda model, id: {
        mock_log_1.id: mock_log_1,
        mock_log_2.id: mock_log_2,
    }.get(id)
    
    # 脚本家AIのモック
    with patch.object(
        manager.dramatist,
        "process",
        return_value=MagicMock(
            narrative="二人の冒険者は意気投合し、情報を交換した。"
        ),
    ):
        interaction = await manager._process_interaction(
            mock_dispatch_1,
            mock_dispatch_2,
            mock_db,
        )
        
        # 相互作用が作成されることを確認
        assert isinstance(interaction, DispatchInteraction)
        assert interaction.dispatch_id_1 == mock_dispatch_1.id
        assert interaction.dispatch_id_2 == mock_dispatch_2.id
        assert interaction.location == "市場"
        assert interaction.narrative == "二人の冒険者は意気投合し、情報を交換した。"


def test_determine_interaction_type():
    """相互作用タイプの決定テスト"""
    manager = DispatchInteractionManager()
    
    # 商人同士
    dispatch_1 = MagicMock(objective_type=DispatchObjectiveType.TRADE)
    dispatch_2 = MagicMock(objective_type=DispatchObjectiveType.TRADE)
    log_1 = MagicMock(contamination_level=0.2)
    log_2 = MagicMock(contamination_level=0.3)
    
    # 複数回実行して、取引か競争のいずれかになることを確認
    types = set()
    for _ in range(20):
        interaction_type = manager._determine_interaction_type(
            dispatch_1,
            dispatch_2,
            log_1,
            log_2,
        )
        types.add(interaction_type)
    
    assert "trade_negotiation" in types or "trade_competition" in types
    
    # 研究者同士
    dispatch_1.objective_type = DispatchObjectiveType.RESEARCH
    dispatch_2.objective_type = DispatchObjectiveType.RESEARCH
    
    interaction_type = manager._determine_interaction_type(
        dispatch_1,
        dispatch_2,
        log_1,
        log_2,
    )
    assert interaction_type == "knowledge_exchange"


def test_interaction_outcome_trade():
    """商業相互作用の結果テスト"""
    manager = DispatchInteractionManager()
    
    log_1 = MagicMock(skills=["商才"])
    log_2 = MagicMock(skills=[])
    
    # 商談の結果
    outcome = manager._determine_interaction_outcome(
        "trade_negotiation",
        log_1,
        log_2,
    )
    
    # 商才スキルがあるので成功率が高い
    success_count = 0
    for _ in range(100):
        outcome = manager._determine_interaction_outcome(
            "trade_negotiation",
            log_1,
            log_2,
        )
        if outcome.success:
            success_count += 1
    
    assert success_count > 70  # 80%程度の成功率


def test_compatibility_calculation():
    """相性計算のテスト"""
    manager = DispatchInteractionManager()
    
    # 似た性格と共通スキル
    log_1 = MagicMock(
        personality="友好的、知的",
        skills=["探索", "研究"],
        contamination_level=0.3,
    )
    
    log_2 = MagicMock(
        personality="知的、慎重",
        skills=["研究", "分析"],
        contamination_level=0.4,
    )
    
    compatibility = manager._calculate_compatibility(log_1, log_2)
    
    # ある程度の相性があるはず
    assert 0.5 < compatibility < 0.8
    
    # 汚染度の差が大きい場合
    log_1.contamination_level = 0.1
    log_2.contamination_level = 0.9
    
    compatibility = manager._calculate_compatibility(log_1, log_2)
    
    # 相性が下がるはず
    assert compatibility < 0.5


@pytest.mark.asyncio
async def test_check_and_process_interactions():
    """相互作用チェックと処理の統合テスト"""
    manager = DispatchInteractionManager()
    
    # アクティブな派遣のモック
    active_dispatches = [
        MagicMock(
            id="d1",
            player_id="p1",
            objective_type=DispatchObjectiveType.INTERACT,
            status=DispatchStatus.DISPATCHED,
            travel_log=[{"location": "市場"}],
        ),
        MagicMock(
            id="d2",
            player_id="p2",
            objective_type=DispatchObjectiveType.INTERACT,
            status=DispatchStatus.DISPATCHED,
            travel_log=[{"location": "市場"}],
        ),
        MagicMock(
            id="d3",
            player_id="p3",
            objective_type=DispatchObjectiveType.EXPLORE,
            status=DispatchStatus.DISPATCHED,
            travel_log=[{"location": "森"}],
        ),
    ]
    
    mock_db = MagicMock()
    mock_db.exec.return_value.all.return_value = active_dispatches
    
    with patch.object(
        manager,
        "_should_interact",
        side_effect=lambda d1, d2: (
            d1.id == "d1" and d2.id == "d2"  # d1とd2のみ相互作用
        ),
    ):
        with patch.object(
            manager,
            "_process_interaction",
            return_value=MagicMock(spec=DispatchInteraction),
        ):
            interactions = await manager.check_and_process_interactions(mock_db)
            
            # 1つの相互作用が処理される
            assert len(interactions) == 1


def test_hours_since_last_interaction():
    """最後の相互作用からの経過時間計算テスト"""
    manager = DispatchInteractionManager()
    
    # 6時間前の相互作用記録
    past_interaction_time = datetime.utcnow() - timedelta(hours=6)
    
    dispatch_1 = MagicMock(
        id="d1",
        travel_log=[
            {
                "timestamp": past_interaction_time.isoformat(),
                "special_type": "dispatch_interaction",
                "action": "派遣ログとの遭遇: [派遣ログ] 冒険者B",
            },
        ],
    )
    
    dispatch_2 = MagicMock(id="d2")
    
    hours = manager._hours_since_last_interaction(dispatch_1, dispatch_2)
    
    # 約6時間
    assert 5.9 < hours < 6.1
    
    # 相互作用記録なしの場合
    dispatch_1.travel_log = []
    hours = manager._hours_since_last_interaction(dispatch_1, dispatch_2)
    
    assert hours == 999


def test_interaction_impact_application():
    """相互作用の影響適用テスト"""
    manager = DispatchInteractionManager()
    
    dispatch = MagicMock(
        collected_items=[],
        objective_details={},
    )
    log = MagicMock(name="冒険者A")
    
    # アイテム交換を含む結果
    outcome = InteractionOutcome(
        success=True,
        relationship_change=0.5,
        items_exchanged=[
            {"from": "冒険者A", "item": "薬草", "quantity": 3},
            {"from": "冒険者B", "item": "地図", "quantity": 1},
        ],
        knowledge_shared=["隠された道"],
        alliance_formed=True,
    )
    
    impact = manager._apply_interaction_impact(
        dispatch,
        log,
        outcome,
        is_initiator=True,
    )
    
    # 影響の検証
    assert impact["relationship_change"] == 0.5
    assert impact["success"] is True
    assert "items_lost" in impact  # 薬草を失う
    assert len(dispatch.collected_items) == 1  # 地図を得る
    assert dispatch.collected_items[0]["item"] == "地図"
    assert "knowledge_gained" in impact
    assert "alliance_formed" in impact