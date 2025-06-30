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
        with patch("app.services.game_session.BattleService") as mock_battle_service_class:
            # BattleServiceのモック設定
            mock_battle_service = mock_battle_service_class.return_value
            mock_battle_service.check_battle_trigger.return_value = True

            # 戦闘データのモック
            from app.schemas.battle import BattleData, BattleState, Combatant

            mock_battle_data = BattleData(
                state=BattleState.PLAYER_TURN,
                turn_count=0,
                combatants=[
                    Combatant(
                        id="player_1",
                        name="テストヒーロー",
                        type="player",
                        hp=80,
                        max_hp=100,
                        mp=50,
                        max_mp=60,
                        attack=15,
                        defense=8,
                        speed=12,
                        status_effects=[],
                    ),
                    Combatant(
                        id="enemy_1",
                        name="ゴブリン",
                        type="monster",
                        level=3,
                        hp=40,
                        max_hp=40,
                        mp=0,
                        max_mp=0,
                        attack=10,
                        defense=5,
                        speed=8,
                        status_effects=[],
                    ),
                ],
                turn_order=["player_1", "enemy_1"],
                current_turn_index=0,
                battle_log=[],
            )
            mock_battle_service.initialize_battle.return_value = mock_battle_data
            mock_battle_service.get_battle_choices.return_value = [
                ActionChoice(id="battle_attack", text="攻撃する"),
                ActionChoice(id="battle_defend", text="防御する"),
                ActionChoice(id="battle_escape", text="逃げる"),
            ]

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

    # WebSocketのモック（現在は使用されていない）
    # mock_websocket = AsyncMock()

    # アクション実行
    result = await game_session_service.execute_action(
        session=test_game_session,
        action_request=request,
    )

    # 戦闘がトリガーされたことを確認
    assert result.metadata is not None
    assert "battle_data" in result.metadata
    battle_data = result.metadata["battle_data"]
    assert battle_data is not None
    assert len(battle_data["combatants"]) >= 2
    assert battle_data["combatants"][1]["name"] == "ゴブリン"
    assert battle_data["combatants"][1]["hp"] == 40
    assert battle_data["combatants"][0]["hp"] == 80


@pytest.fixture
def game_session_service_in_battle(session: Session, mock_coordinator_ai):
    """戦闘中のゲームセッションサービス"""
    with patch("app.services.game_session.CoordinatorAI", return_value=mock_coordinator_ai):
        with patch("app.services.game_session.BattleService") as mock_battle_service_class:
            # BattleServiceのモック設定
            mock_battle_service = mock_battle_service_class.return_value
            mock_battle_service.check_battle_trigger.return_value = False  # すでに戦闘中

            # 戦闘アクション処理のモック
            from app.schemas.battle import BattleData, BattleResult, BattleState, Combatant

            mock_battle_result = BattleResult(
                success=True,
                damage=15,
                healing=None,
                status_changes=[],
                narrative="テストヒーローの攻撃！ゴブリンに15のダメージ！",
                side_effects=[],
            )

            # 更新された戦闘データ
            updated_battle_data = BattleData(
                state=BattleState.ENEMY_TURN,
                turn_count=2,
                combatants=[
                    Combatant(
                        id="player_1",
                        name="テストヒーロー",
                        type="player",
                        hp=70,  # ダメージを受けた
                        max_hp=100,
                        mp=50,
                        max_mp=60,
                        attack=15,
                        defense=8,
                        speed=12,
                        status_effects=[],
                    ),
                    Combatant(
                        id="enemy_1",
                        name="ゴブリン",
                        type="monster",
                        level=3,
                        hp=25,  # ダメージを受けた
                        max_hp=40,
                        mp=0,
                        max_mp=0,
                        attack=10,
                        defense=5,
                        speed=8,
                        status_effects=[],
                    ),
                ],
                turn_order=["player_1", "enemy_1"],
                current_turn_index=1,
                battle_log=[
                    {
                        "turn": 1,
                        "actor": "player_1",
                        "action": "attack",
                        "result": "テストヒーローの攻撃！ゴブリンに15のダメージ！",
                    }
                ],
            )

            mock_battle_service.process_battle_action.return_value = (
                mock_battle_result,
                updated_battle_data,
            )
            mock_battle_service.check_battle_end.return_value = (False, None, None)
            mock_battle_service.advance_turn.return_value = ("enemy_1", False)
            mock_battle_service.get_battle_choices.return_value = [
                ActionChoice(id="battle_attack", text="攻撃する"),
                ActionChoice(id="battle_defend", text="防御する"),
                ActionChoice(id="battle_escape", text="逃げる"),
            ]

            service = GameSessionService(db=session)
            # CoordinatorAIを直接モックに置き換える
            service.coordinator = mock_coordinator_ai
            return service


@pytest.mark.asyncio
async def test_battle_action_execution(
    session: Session,
    test_game_session: GameSession,
    game_session_service_in_battle: GameSessionService,
):
    """戦闘中のアクション実行テスト"""
    # 戦闘状態を設定
    battle_state = {
        "state": "player_turn",
        "turn_count": 1,
        "combatants": [
            {
                "id": "player_1",
                "name": "テストヒーロー",
                "type": "player",
                "hp": 80,
                "max_hp": 100,
                "mp": 50,
                "max_mp": 60,
                "attack": 15,
                "defense": 8,
                "speed": 12,
                "status_effects": [],
            },
            {
                "id": "enemy_1",
                "name": "ゴブリン",
                "type": "monster",
                "level": 3,
                "hp": 40,
                "max_hp": 40,
                "mp": 0,
                "max_mp": 0,
                "attack": 10,
                "defense": 5,
                "speed": 8,
                "status_effects": [],
            },
        ],
        "turn_order": ["player_1", "enemy_1"],
        "current_turn_index": 0,
        "battle_log": [],
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

    # CoordinatorAIのモックレスポンスを設定
    from app.ai.coordination_models import Choice, FinalResponse

    # 戦闘中の選択肢を設定
    mock_coordinator_ai = game_session_service_in_battle.coordinator
    mock_coordinator_ai.process_action.return_value = FinalResponse(
        narrative="テストヒーローの攻撃！ゴブリンに15のダメージ！\nゴブリンの反撃！テストヒーローに10のダメージ！",
        choices=[
            Choice(id="battle_attack", text="攻撃する"),
            Choice(id="battle_defend", text="防御する"),
            Choice(id="battle_escape", text="逃げる"),
        ],
        state_changes={
            "battle_continues": True,
        },
        metadata={},
    )

    result = await game_session_service_in_battle.execute_action(
        session=test_game_session,
        action_request=request,
    )

    # 戦闘が継続していることを確認
    assert result.metadata is not None
    assert "battle_data" in result.metadata
    battle_data = result.metadata["battle_data"]
    assert battle_data is not None
    assert battle_data["state"] in ["player_turn", "enemy_turn", "in_progress"]

    # 戦闘選択肢が返されることを確認
    assert len(result.choices) == 3
    assert any(c.text == "攻撃する" for c in result.choices)
    assert any(c.text == "防御する" for c in result.choices)
    assert any(c.text == "逃げる" for c in result.choices)
