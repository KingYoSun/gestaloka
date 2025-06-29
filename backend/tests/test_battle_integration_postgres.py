"""
戦闘システムの統合テスト（PostgreSQL版）
"""

import json
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import Session

from app.models.character import Character, CharacterStats, GameSession
from app.models.user import User
from app.schemas.battle import BattleState
from app.schemas.game_session import ActionChoice, ActionExecuteRequest
from app.services.game_session import GameSessionService


@pytest.fixture
def test_user(session: Session):
    """テスト用ユーザー"""
    user = User(
        id=str(uuid.uuid4()),
        username="test_user",
        email="test@example.com",
        hashed_password="hashed_password",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@pytest.fixture
def test_character(session: Session, test_user: User):
    """テスト用キャラクター"""
    character = Character(
        id=str(uuid.uuid4()),
        user_id=test_user.id,
        name="テストヒーロー",
        description="勇敢な冒険者",
        location="forest",
    )
    session.add(character)
    session.commit()
    session.refresh(character)
    
    # キャラクターステータスを作成
    stats = CharacterStats(
        id=str(uuid.uuid4()),
        character_id=character.id,
        level=5,
        health=80,
        max_health=100,
        energy=50,
        max_energy=60,
        attack=15,
        defense=8,
        agility=12,
    )
    session.add(stats)
    session.commit()
    session.refresh(stats)
    
    character.stats = stats
    return character


@pytest.fixture
def test_game_session(session: Session, test_character: Character):
    """テスト用ゲームセッション"""
    game_session = GameSession(
        id=str(uuid.uuid4()),
        character_id=test_character.id,
        is_active=True,
        current_scene="森の中",
        session_data=json.dumps(
            {
                "messages": [],
                "turn_count": 0,
                "battle_data": None,
            }
        ),
    )
    session.add(game_session)
    session.commit()
    session.refresh(game_session)
    
    # リレーションシップを設定
    game_session.character = test_character
    return game_session


@pytest.fixture
def mock_coordinator_ai():
    """モックCoordinatorAI"""
    mock = AsyncMock()
    from app.ai.coordination_models import Choice, FinalResponse

    mock.process_action.return_value = FinalResponse(
        narrative="森を探索していると、突然ゴブリンが襲いかかってきた！",
        choices=[
            Choice(id="1", text="戦う"),
            Choice(id="2", text="逃げる"),
            Choice(id="3", text="話しかける"),
        ],
        state_changes={
            "battle_trigger": {
                "enemy": "ゴブリン",
                "enemy_level": 3,
            },
            "enemy_data": {
                "name": "ゴブリン",
                "level": 3,
                "hp": 40,
                "attack": 10,
                "defense": 5,
            },
        },
        metadata={},
    )
    mock.initialize_session = AsyncMock()
    return mock


@pytest.fixture
def game_session_service(session: Session, mock_coordinator_ai):
    """ゲームセッションサービス"""
    with patch("app.services.game_session.CoordinatorAI", return_value=mock_coordinator_ai):
        service = GameSessionService(db=session)
        # CoordinatorAIを直接モックに置き換える
        service.coordinator = mock_coordinator_ai
        return service


@pytest.mark.asyncio
async def test_battle_trigger_from_action(
    session: Session,
    test_game_session: GameSession,
    game_session_service: GameSessionService,
    mock_coordinator_ai,
):
    """アクションから戦闘がトリガーされるテスト"""
    # アクション実行リクエスト
    request = ActionExecuteRequest(
        action_text="森の奥へ進む",
        action_type="custom",
        choice_id=None,
    )

    # WebSocketのモック
    mock_websocket = AsyncMock()

    # アクション実行
    result = await game_session_service.execute_action(
        session=test_game_session,
        action_request=request,
    )

    # 戦闘がトリガーされたことを確認
    assert result.battle_state is not None
    assert result.battle_state.enemy_name == "ゴブリン"
    assert result.battle_state.enemy_stats.hp == 40
    assert result.battle_state.player_stats.hp == 80

    # WebSocketイベントが送信されたことを確認
    mock_websocket.emit.assert_called()


@pytest.mark.asyncio
async def test_battle_action_execution(
    session: Session,
    test_game_session: GameSession,
    game_session_service: GameSessionService,
):
    """戦闘中のアクション実行テスト"""
    # 戦闘状態を設定
    battle_state = {
        "active": True,
        "enemy_name": "ゴブリン",
        "enemy_stats": {"hp": 40, "max_hp": 40, "attack": 10, "defense": 5},
        "player_stats": {"hp": 80, "max_hp": 100},
    }
    
    session_data = json.loads(test_game_session.session_data)
    session_data["battle_data"] = battle_state
    test_game_session.session_data = json.dumps(session_data)
    session.add(test_game_session)
    session.commit()

    # 攻撃アクション
    request = ActionExecuteRequest(
        action_text="攻撃する",
        action_type="choice",
        choice_id="attack",
    )

    mock_websocket = AsyncMock()

    # モックの戦闘サービス
    with patch("app.services.game_session.BattleService") as mock_battle_service:
        mock_battle = mock_battle_service.return_value
        mock_battle.execute_action.return_value = BattleState(
            active=True,
            enemy_name="ゴブリン",
            enemy_stats={"hp": 25, "max_hp": 40, "attack": 10, "defense": 5},
            player_stats={"hp": 70, "max_hp": 100},
            turn=2,
            battle_log=["プレイヤーの攻撃！15ダメージ！", "ゴブリンの攻撃！10ダメージ！"],
        )

        result = await game_session_service.execute_action(
            session=test_game_session,
            action_request=request,
        )

        # 戦闘が継続していることを確認
        assert result.battle_state is not None
        assert result.battle_state.active is True
        assert result.battle_state.enemy_stats["hp"] == 25
        assert result.battle_state.player_stats["hp"] == 70