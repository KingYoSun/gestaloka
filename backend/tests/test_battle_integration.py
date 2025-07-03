"""
戦闘システムの統合テスト
"""

import json
from datetime import datetime
from unittest.mock import AsyncMock, Mock, patch

import pytest
from sqlmodel import Session

from app.models.character import Character, CharacterStats, GameSession
from app.schemas.battle import BattleState
from app.schemas.game_session import ActionChoice, ActionExecuteRequest
from app.services.game_session import GameSessionService


@pytest.fixture
def mock_db():
    """モックデータベースセッション"""
    return Mock(spec=Session)


@pytest.fixture
def mock_coordinator_ai():
    """モックCoordinatorAI"""
    mock = AsyncMock()
    # 返り値をMockオブジェクトに変更
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
        session_data=json.dumps(
            {
                "messages": [],
                "turn_count": 0,
                "battle_data": None,
            }
        ),
        character=mock_character,
    )


@pytest.fixture
def game_session_service(mock_db, mock_coordinator_ai):
    """GameSessionServiceのフィクスチャ"""
    with patch("app.services.game_session.DramatistAgent"):
        with patch("app.services.game_session.StateManagerAgent"):
            with patch("app.services.game_session.HistorianAgent"):
                with patch("app.services.game_session.NPCManagerAgent"):
                    with patch("app.services.game_session.TheWorldAI"):
                        with patch("app.services.game_session.AnomalyAgent"):
                            with patch("app.services.game_session.CoordinatorAI") as mock_coordinator:
                                mock_coordinator.return_value = mock_coordinator_ai
                                with patch("app.services.game_session.QuestService") as mock_quest_service_class:
                                    # QuestServiceのモック設定
                                    mock_quest_service = mock_quest_service_class.return_value
                                    mock_quest_service.infer_implicit_quest = AsyncMock(return_value=None)
                                    mock_quest_service.check_quest_completion = AsyncMock(return_value=[])

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

                                        # process_battle_actionのモック
                                        from app.schemas.battle import BattleResult

                                        mock_battle_result = BattleResult(
                                        success=True,
                                        damage=15,
                                        healing=None,
                                        status_changes=[],
                                        narrative="テストヒーローの攻撃！ゴブリンに15のダメージ！",
                                        side_effects=[],
                                    )
                                        mock_battle_service.process_battle_action.return_value = (
                                            mock_battle_result,
                                            mock_battle_data,
                                        )

                                        # check_battle_endのモック
                                        mock_battle_service.check_battle_end.return_value = (False, None, None)

                                        # advance_turnのモック
                                        mock_battle_service.advance_turn.return_value = ("enemy_1", False)

                                        service = GameSessionService(mock_db)
                                        return service


# テスト用のデータベースモック設定ヘルパー
def setup_db_mocks(mock_db, mock_game_session, mock_character):
    """データベースモックを設定"""

    # 呼び出し回数を追跡
    call_count = 0

    # セッションとキャラクター取得のモック
    def exec_side_effect(stmt):
        nonlocal call_count
        call_count += 1

        # select文に応じて異なる結果を返す
        stmt_str = str(stmt)
        result = Mock()

        if "game_session" in stmt_str.lower() and "join" in stmt_str.lower():
            # GameSessionとCharacterのjoinクエリ
            result.first.return_value = (mock_game_session, mock_character)
        elif "dispatch" in stmt_str.lower() and "completed_log" in stmt_str.lower():
            # DispatchとCompletedLogのjoinクエリ（NPC遭遇チェック用）
            result.all.return_value = []  # 空のリストを返す（遭遇なし）
        elif "player_sp" in stmt_str.lower():
            # PlayerSPクエリ用のモック
            from app.models.sp import PlayerSP
            mock_player_sp = PlayerSP(
                id="sp_1",
                user_id="user_1",
                current_sp=100,
                max_sp=100,
                last_recovery_at=datetime.utcnow(),
            )
            result.first.return_value = mock_player_sp
        elif "locations" in stmt_str.lower():
            # Location query (for SP calculation)
            from app.models.location import DangerLevel, Location, LocationType
            mock_location = Location(
                id=1,
                name="森の入り口",
                description="静かな森の入り口",
                location_type=LocationType.WILD,
                hierarchy_level=1,
                danger_level=DangerLevel.LOW,
                x_coordinate=0,
                y_coordinate=0,
            )
            result.first.return_value = mock_location
        elif "character" in stmt_str.lower() and "character_stats" not in stmt_str.lower():
            # Characterクエリ
            result.first.return_value = mock_character
        elif "character_stats" in stmt_str.lower():
            # CharacterStatsクエリ
            result.first.return_value = mock_character.stats
        elif "action_log" in stmt_str.lower():
            # ActionLogクエリ（クエストサービス用）
            result.all.return_value = []  # 空のリストを返す
        elif "quest" in stmt_str.lower():
            # Questクエリ
            result.all.return_value = []  # 空のリストを返す
            result.first.return_value = None
        else:
            # デフォルト
            result.first.return_value = None
            result.all.return_value = []  # デフォルトでall()は空リストを返す

        return result

    mock_db.exec.side_effect = exec_side_effect

    # その他のメソッド
    mock_db.add = Mock()
    mock_db.commit = Mock()
    mock_db.get.return_value = mock_game_session


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
        setup_db_mocks(mock_db, mock_game_session, mock_character)

        # アクション実行
        request = ActionExecuteRequest(
            session_id="session_1",
            action_text="森を探索する",
        )

        result = await game_session_service.execute_action(
            mock_game_session,
            request,
        )

        # 戦闘が開始されたことを確認
        assert "ゴブリン" in result.narrative
        assert result.metadata.get("battle_data") is not None

        # セッションデータの更新を確認
        mock_db.add.assert_called()
        # SP消費処理で追加のcommitが発生するため、複数回呼ばれることを許容
        assert mock_db.commit.call_count >= 1

        # 戦闘データが保存されていることを確認
        session_data = json.loads(mock_game_session.session_data)
        assert session_data["battle_data"] is not None
        assert session_data["battle_data"]["state"] in ["starting", "player_turn", "in_progress"]

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

        mock_game_session.session_data = json.dumps(
            {
                "messages": [],
                "turn_count": 5,
                "battle_data": battle_data,
            }
        )

        # データベースモックの設定
        setup_db_mocks(mock_db, mock_game_session, mock_character)

        # 攻撃アクション実行
        request = ActionExecuteRequest(
            session_id="session_1",
            action_text="攻撃する",
            choice_id="1",
        )

        result = await game_session_service.execute_action(
            mock_game_session,
            request,
        )

        # 戦闘が継続していることを確認
        assert result.metadata.get("battle_data") is not None
        battle_data = result.metadata.get("battle_data")
        assert battle_data["state"] in ["enemy_turn", "player_turn", "in_progress"]

        # 戦闘選択肢が返されることを確認
        assert len(result.choices) == 3
        assert any(c.text == "攻撃する" for c in result.choices)
        assert any(c.text == "防御する" for c in result.choices)
        assert any(c.text == "逃げる" for c in result.choices)

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

        mock_game_session.session_data = json.dumps(
            {
                "messages": [],
                "turn_count": 10,
                "battle_data": battle_data,
            }
        )

        # 勝利後のAI応答を設定
        from app.ai.coordination_models import Choice, FinalResponse

        mock_coordinator_ai.process_action.return_value = FinalResponse(
            narrative="ゴブリンを倒した！経験値30と30ゴールドを獲得した。",
            choices=[
                Choice(id="1", text="森を探索する"),
                Choice(id="2", text="村に戻る"),
                Choice(id="3", text="休憩する"),
            ],
            state_changes={
                "parameter_changes": {
                    "experience": 30,
                    "gold": 30,
                },
            },
            metadata={},
        )

        # データベースモックの設定
        setup_db_mocks(mock_db, mock_game_session, mock_character)

        # アクション実行（戦闘終了判定が行われる）
        request = ActionExecuteRequest(
            session_id="session_1",
            action_text="攻撃する",
            choice_id="1",
        )

        result = await game_session_service.execute_action(
            mock_game_session,
            request,
        )

        # 戦闘が終了したことを確認
        assert "勝利" in result.narrative or "倒した" in result.narrative

        # 通常の選択肢に戻ったことを確認
        assert len(result.choices) == 3
        assert not any("攻撃する" in c.text for c in result.choices)

    @pytest.mark.asyncio
    async def test_battle_escape_action(
        self,
        mock_game_session,
        mock_character,
        mock_db,
        mock_coordinator_ai,
    ):
        """逃走アクションのテスト"""
        # 逃走専用のBattleServiceモックを作成
        with patch("app.services.game_session.DramatistAgent"):
            with patch("app.services.game_session.StateManagerAgent"):
                with patch("app.services.game_session.HistorianAgent"):
                    with patch("app.services.game_session.NPCManagerAgent"):
                        with patch("app.services.game_session.TheWorldAI"):
                            with patch("app.services.game_session.AnomalyAgent"):
                                with patch("app.services.game_session.CoordinatorAI") as mock_coordinator:
                                    mock_coordinator.return_value = mock_coordinator_ai
                                    with patch("app.services.game_session.BattleService") as mock_battle_service_class:
                                        # BattleServiceのモック設定
                                        mock_battle_service = mock_battle_service_class.return_value

                                        # 戦闘データのモック
                                        from app.schemas.battle import BattleData, BattleResult, BattleState, Combatant

                                        # 逃走成功の結果を設定
                                        escape_battle_data = BattleData(
                                            state=BattleState.ENDING,  # 逃走成功で終了
                                            turn_count=2,
                                            combatants=[
                                                Combatant(
                                                    id="player_1",
                                                    name="テストヒーロー",
                                                    type="player",
                                                    hp=60,
                                                    max_hp=100,
                                                    mp=40,
                                                    max_mp=60,
                                                    attack=15,
                                                    defense=8,
                                                    speed=12,
                                                    status_effects=[],
                                                ),
                                                Combatant(
                                                    id="enemy_1",
                                                    name="オーク",
                                                    type="monster",
                                                    level=5,
                                                    hp=80,
                                                    max_hp=80,
                                                    mp=0,
                                                    max_mp=0,
                                                    attack=18,
                                                    defense=10,
                                                    speed=8,
                                                    status_effects=[],
                                                ),
                                            ],
                                            turn_order=["player_1", "enemy_1"],
                                            current_turn_index=0,
                                            battle_log=[],
                                        )

                                        mock_escape_result = BattleResult(
                                            success=True,
                                            damage=None,
                                            healing=None,
                                            status_changes=[],
                                            narrative="テストヒーローは戦闘から逃走した！",
                                            side_effects=[],
                                        )

                                        mock_battle_service.process_battle_action.return_value = (
                                            mock_escape_result,
                                            escape_battle_data,
                                        )
                                        mock_battle_service.check_battle_end.return_value = (
                                            True,
                                            None,
                                            None,
                                        )  # 戦闘終了

                                        service = GameSessionService(mock_db)

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

                                        mock_game_session.session_data = json.dumps(
                                            {
                                                "messages": [],
                                                "turn_count": 8,
                                                "battle_data": battle_data,
                                            }
                                        )

                                        # 逃走成功後のAI応答を設定
                                        from app.ai.coordination_models import Choice, FinalResponse

                                        mock_coordinator_ai.process_action.return_value = FinalResponse(
                                            narrative="なんとか逃げ切ることができた！",
                                            choices=[
                                                Choice(id="1", text="安全な場所を探す"),
                                                Choice(id="2", text="村に戻る"),
                                                Choice(id="3", text="別の道を探す"),
                                            ],
                                            state_changes={},
                                            metadata={},
                                        )

                                        # データベースモックの設定
                                        setup_db_mocks(mock_db, mock_game_session, mock_character)

                                        # 逃走アクション実行
                                        request = ActionExecuteRequest(
                                            session_id="session_1",
                                            action_text="逃げる",
                                            choice_id="3",
                                        )

                                        result = await service.execute_action(
                                            mock_game_session,
                                            request,
                                        )

                                        # 戦闘が終了したことを確認（逃走成功の場合）
                                        assert "逃げ切る" in result.narrative or "逃走" in result.narrative
                                        assert len(result.choices) == 3
                                        # 通常の選択肢に戻っていることを確認
                                        assert not any("攻撃する" in c.text for c in result.choices)
                                        assert any(
                                            "安全" in c.text or "村" in c.text or "別の道" in c.text
                                            for c in result.choices
                                        )

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
        setup_db_mocks(mock_db, mock_game_session, mock_character)

        # 戦闘開始アクション
        request = ActionExecuteRequest(
            session_id="session_1",
            action_text="敵に攻撃を仕掛ける",
        )

        await game_session_service.execute_action(
            mock_game_session,
            request,
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
        mock_coordinator_ai,
    ):
        """WebSocketイベント送信のテスト"""
        # WebSocketエミッターのモック
        with patch("app.services.game_session.GameEventEmitter") as mock_emitter_class:
            mock_emitter = Mock()
            mock_emitter.emit_custom_event = AsyncMock()
            mock_emitter_class.emit_custom_event = AsyncMock()
            mock_emitter_class.emit_narrative_update = AsyncMock()
            mock_emitter_class.emit_action_result = AsyncMock()
            mock_emitter_class.emit_player_status_update = AsyncMock()

            # サービスを再作成（エミッターのモックを適用）
            with patch("app.services.game_session.DramatistAgent"):
                with patch("app.services.game_session.StateManagerAgent"):
                    with patch("app.services.game_session.HistorianAgent"):
                        with patch("app.services.game_session.NPCManagerAgent"):
                            with patch("app.services.game_session.TheWorldAI"):
                                with patch("app.services.game_session.AnomalyAgent"):
                                    with patch("app.services.game_session.CoordinatorAI") as mock_coordinator:
                                        mock_coordinator.return_value = mock_coordinator_ai
                                        with patch(
                                            "app.services.game_session.BattleService"
                                        ) as mock_battle_service_class:
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

                                            service = GameSessionService(mock_db)

                                            # データベースモックの設定
                                            setup_db_mocks(mock_db, mock_game_session, mock_character)

                                            # 戦闘開始アクション
                                            request = ActionExecuteRequest(
                                                session_id="session_1",
                                                action_text="森を探索する",
                                            )

                                            await service.execute_action(
                                                mock_game_session,
                                                request,
                                            )

                                            # カスタムイベントが送信されたことを確認
                                            # GameEventEmitterは静的メソッドなので、クラスに対してアサート
                                            mock_emitter_class.emit_custom_event.assert_called()
                                            if mock_emitter_class.emit_custom_event.call_args:
                                                call_args = mock_emitter_class.emit_custom_event.call_args
                                                assert call_args[0][0] == "session_1"  # session_id
                                                assert call_args[0][1] == "battle_start"  # event_type
                                                assert "battle_data" in call_args[0][2]  # event_data
