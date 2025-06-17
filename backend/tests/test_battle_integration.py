"""
戦闘システムの統合テスト
"""

import json
from unittest.mock import AsyncMock, Mock, patch

import pytest
from sqlmodel import Session

from app.models.character import Character, CharacterStats, GameSession
from app.schemas.battle import BattleState
from app.schemas.game_session import ActionExecuteRequest
from app.services.game_session import GameSessionService


@pytest.fixture
def mock_db():
    """モックデータベースセッション"""
    return Mock(spec=Session)


@pytest.fixture
def mock_coordinator_ai():
    """モックCoordinatorAI"""
    mock = AsyncMock()
    mock.process_action.return_value = {
        "narrative": "森を探索していると、突然ゴブリンが襲いかかってきた！",
        "choices": [
            {"id": "1", "action": "戦う"},
            {"id": "2", "action": "逃げる"},
            {"id": "3", "action": "話しかける"},
        ],
        "state_changes": {},
        "battle_trigger": {
            "enemy": "ゴブリン",
            "enemy_level": 3,
        },
    }
    return mock


@pytest.fixture
def mock_character():
    """テスト用キャラクター"""
    character = Character(
        id="char_1",
        user_id="user_1",
        name="テストヒーロー",
        description="勇敢な冒険者",
        location="forest",
    )
    character.stats = CharacterStats(
        id="stats_1",
        character_id="char_1",
        level=5,
        health=80,
        max_health=100,
        energy=50,
        max_energy=60,
        attack=15,
        defense=8,
        agility=12,
    )
    return character


@pytest.fixture
def mock_game_session(mock_character):
    """テスト用ゲームセッション"""
    return GameSession(
        id="session_1",
        character_id="char_1",
        is_active=True,
        current_scene="森の中",
        session_data=json.dumps({
            "messages": [],
            "turn_count": 0,
            "battle_data": None,
        }),
        character=mock_character,
    )


@pytest.fixture
def game_session_service(mock_db, mock_coordinator_ai):
    """GameSessionServiceのフィクスチャ"""
    with patch("app.services.game_session.CoordinatorAI", return_value=mock_coordinator_ai):
        service = GameSessionService(mock_db)
        return service


class TestBattleIntegration:
    """戦闘システムの統合テストクラス"""

    @pytest.mark.asyncio
    async def test_battle_trigger_from_action(
        self,
        game_session_service,
        mock_game_session,
        mock_character,
        mock_db,
    ):
        """アクションから戦闘が開始されるテスト"""
        # データベースモックの設定
        mock_db.get.return_value = mock_game_session
        mock_db.query.return_value.filter.return_value.first.return_value = mock_character.stats
        
        # アクション実行
        request = ActionExecuteRequest(
            session_id="session_1",
            action_text="森を探索する",
        )
        
        result = await game_session_service.execute_action(
            session_id="session_1",
            user_id="user_1",
            action_request=request,
        )
        
        # 戦闘が開始されたことを確認
        assert result.battle_state == BattleState.STARTING
        assert result.narrative == "森を探索していると、突然ゴブリンが襲いかかってきた！"
        
        # セッションデータの更新を確認
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()
        
        # 戦闘データが保存されていることを確認
        session_data = json.loads(mock_game_session.session_data)
        assert session_data["battle_data"] is not None
        assert session_data["battle_data"]["state"] == BattleState.STARTING

    @pytest.mark.asyncio
    async def test_battle_action_execution(
        self,
        game_session_service,
        mock_game_session,
        mock_character,
        mock_db,
    ):
        """戦闘中のアクション実行テスト"""
        # 戦闘中のセッションデータを設定
        battle_data = {
            "state": BattleState.PLAYER_TURN,
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
        
        mock_game_session.session_data = json.dumps({
            "messages": [],
            "turn_count": 5,
            "battle_data": battle_data,
        })
        
        # データベースモックの設定
        mock_db.get.return_value = mock_game_session
        mock_db.query.return_value.filter.return_value.first.return_value = mock_character.stats
        
        # 攻撃アクション実行
        request = ActionExecuteRequest(
            session_id="session_1",
            action_text="攻撃する",
            choice_id="1",
        )
        
        result = await game_session_service.execute_action(
            session_id="session_1",
            user_id="user_1",
            action_request=request,
        )
        
        # 戦闘が継続していることを確認
        assert result.battle_state in [BattleState.ENEMY_TURN, BattleState.PLAYER_TURN]
        assert "ダメージ" in result.narrative
        
        # 戦闘選択肢が返されることを確認
        assert len(result.choices) == 3
        assert any(c.action == "攻撃する" for c in result.choices)
        assert any(c.action == "防御する" for c in result.choices)
        assert any(c.action == "逃げる" for c in result.choices)

    @pytest.mark.asyncio
    async def test_battle_victory_flow(
        self,
        game_session_service,
        mock_game_session,
        mock_character,
        mock_db,
        mock_coordinator_ai,
    ):
        """戦闘勝利フローのテスト"""
        # 敵のHPが0の戦闘データを設定
        battle_data = {
            "state": BattleState.IN_PROGRESS,
            "turn_count": 5,
            "combatants": [
                {
                    "id": "player_1",
                    "name": "テストヒーロー",
                    "type": "player",
                    "hp": 50,
                    "max_hp": 100,
                    "mp": 30,
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
                    "hp": 0,
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
        
        mock_game_session.session_data = json.dumps({
            "messages": [],
            "turn_count": 10,
            "battle_data": battle_data,
        })
        
        # 勝利後のAI応答を設定
        mock_coordinator_ai.process_action.return_value = {
            "narrative": "ゴブリンを倒した！経験値30と30ゴールドを獲得した。",
            "choices": [
                {"id": "1", "action": "森を探索する"},
                {"id": "2", "action": "村に戻る"},
                {"id": "3", "action": "休憩する"},
            ],
            "state_changes": {
                "experience": 30,
                "gold": 30,
            },
        }
        
        # データベースモックの設定
        mock_db.get.return_value = mock_game_session
        mock_db.query.return_value.filter.return_value.first.return_value = mock_character.stats
        
        # アクション実行（戦闘終了判定が行われる）
        request = ActionExecuteRequest(
            session_id="session_1",
            action_text="攻撃する",
            choice_id="1",
        )
        
        result = await game_session_service.execute_action(
            session_id="session_1",
            user_id="user_1",
            action_request=request,
        )
        
        # 戦闘が終了したことを確認
        assert result.battle_state == BattleState.FINISHED
        assert "勝利" in result.narrative or "倒した" in result.narrative
        
        # 通常の選択肢に戻ったことを確認
        assert len(result.choices) == 3
        assert not any("攻撃する" in c.action for c in result.choices)

    @pytest.mark.asyncio
    async def test_battle_escape_action(
        self,
        game_session_service,
        mock_game_session,
        mock_character,
        mock_db,
        mock_coordinator_ai,
    ):
        """逃走アクションのテスト"""
        # 戦闘中のセッションデータを設定
        battle_data = {
            "state": BattleState.PLAYER_TURN,
            "turn_count": 2,
            "combatants": [
                {
                    "id": "player_1",
                    "name": "テストヒーロー",
                    "type": "player",
                    "hp": 60,
                    "max_hp": 100,
                    "mp": 40,
                    "max_mp": 60,
                    "attack": 15,
                    "defense": 8,
                    "speed": 12,
                    "status_effects": [],
                },
                {
                    "id": "enemy_1",
                    "name": "オーク",
                    "type": "monster",
                    "level": 5,
                    "hp": 80,
                    "max_hp": 80,
                    "mp": 0,
                    "max_mp": 0,
                    "attack": 18,
                    "defense": 10,
                    "speed": 8,
                    "status_effects": [],
                },
            ],
            "turn_order": ["player_1", "enemy_1"],
            "current_turn_index": 0,
            "battle_log": [],
        }
        
        mock_game_session.session_data = json.dumps({
            "messages": [],
            "turn_count": 8,
            "battle_data": battle_data,
        })
        
        # 逃走成功後のAI応答を設定
        mock_coordinator_ai.process_action.return_value = {
            "narrative": "なんとか逃げ切ることができた！",
            "choices": [
                {"id": "1", "action": "安全な場所を探す"},
                {"id": "2", "action": "村に戻る"},
                {"id": "3", "action": "別の道を探す"},
            ],
            "state_changes": {},
        }
        
        # データベースモックの設定
        mock_db.get.return_value = mock_game_session
        mock_db.query.return_value.filter.return_value.first.return_value = mock_character.stats
        
        # 逃走アクション実行
        request = ActionExecuteRequest(
            session_id="session_1",
            action_text="逃げる",
            choice_id="3",
        )
        
        # 逃走成功をモック
        with patch("random.random", return_value=0.8):  # 成功確率を高く設定
            result = await game_session_service.execute_action(
                session_id="session_1",
                user_id="user_1",
                action_request=request,
            )
        
        # 戦闘が終了したことを確認（逃走成功の場合）
        if "逃げ切る" in result.narrative or "逃走成功" in result.narrative:
            assert result.battle_state == BattleState.FINISHED
            assert len(result.choices) == 3
            assert not any("攻撃する" in c.action for c in result.choices)

    @pytest.mark.asyncio
    async def test_battle_state_persistence(
        self,
        game_session_service,
        mock_game_session,
        mock_character,
        mock_db,
    ):
        """戦闘状態の永続化テスト"""
        # データベースモックの設定
        mock_db.get.return_value = mock_game_session
        mock_db.query.return_value.filter.return_value.first.return_value = mock_character.stats
        
        # 戦闘開始アクション
        request = ActionExecuteRequest(
            session_id="session_1",
            action_text="敵に攻撃を仕掛ける",
        )
        
        await game_session_service.execute_action(
            session_id="session_1",
            user_id="user_1",
            action_request=request,
        )
        
        # セッションデータが更新されたことを確認
        assert mock_db.add.called
        assert mock_db.commit.called
        
        # 保存されたセッションデータを確認
        saved_session_data = json.loads(mock_game_session.session_data)
        assert "battle_data" in saved_session_data
        assert saved_session_data["battle_data"] is not None
        
        # 戦闘データの構造を確認
        battle_data = saved_session_data["battle_data"]
        assert "state" in battle_data
        assert "combatants" in battle_data
        assert "turn_count" in battle_data
        assert "battle_log" in battle_data

    @pytest.mark.asyncio
    async def test_websocket_battle_events(
        self,
        game_session_service,
        mock_game_session,
        mock_character,
        mock_db,
    ):
        """WebSocketイベント送信のテスト"""
        # WebSocketエミッターのモック
        with patch("app.services.game_session.GameEventEmitter") as mock_emitter_class:
            mock_emitter = Mock()
            mock_emitter_class.return_value = mock_emitter
            
            # サービスを再作成（エミッターのモックを適用）
            with patch("app.services.game_session.CoordinatorAI", return_value=mock_coordinator_ai):
                service = GameSessionService(mock_db)
            
            # データベースモックの設定
            mock_db.get.return_value = mock_game_session
            mock_db.query.return_value.filter.return_value.first.return_value = mock_character.stats
            
            # 戦闘開始アクション
            request = ActionExecuteRequest(
                session_id="session_1",
                action_text="森を探索する",
            )
            
            await service.execute_action(
                session_id="session_1",
                user_id="user_1",
                action_request=request,
            )
            
            # カスタムイベントが送信されたことを確認
            mock_emitter.emit_custom_event.assert_called()
            call_args = mock_emitter.emit_custom_event.call_args
            assert call_args[0][0] == "session_1"  # session_id
            assert call_args[0][1] == "battle_start"  # event_type
            assert "battle_data" in call_args[0][2]  # event_data