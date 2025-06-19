"""
ゲームセッションサービスとCoordinatorAIの統合テスト
"""

import json
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.models.character import Character, CharacterStats, GameSession
from app.schemas.game_session import ActionExecuteRequest, GameSessionCreate
from app.services.game_session import GameSessionService


class TestGameSessionCoordinatorIntegration:
    """ゲームセッションとCoordinatorAIの統合テスト"""

    @pytest.fixture
    def mock_db(self):
        """モックデータベースセッション"""
        db = MagicMock(spec=Session)
        return db

    @pytest.fixture
    def mock_character(self):
        """テスト用キャラクター"""
        character = MagicMock(spec=Character)
        character.id = "char_001"
        character.user_id = "user_001"
        character.name = "テストキャラクター"
        character.location = "starting_village"
        character.level = 1
        character.experience = 0
        character.appearance = "普通の冒険者"
        character.personality = "勇敢で好奇心旺盛"
        character.backstory = "平凡な村の出身"
        return character

    @pytest.fixture
    def mock_character_stats(self):
        """テスト用キャラクターステータス"""
        stats = CharacterStats(
            id="stats_001",
            character_id="char_001",
            health=100,
            max_health=100,
            energy=100,
            max_energy=100,
            level=1,
            experience=0,
        )
        return stats

    @pytest.fixture
    def mock_websocket_manager(self):
        """モックWebSocketマネージャー"""
        manager = AsyncMock()
        return manager

    @pytest.fixture
    def game_session_service(self, mock_db, mock_websocket_manager):
        """ゲームセッションサービス"""
        return GameSessionService(mock_db, mock_websocket_manager)

    @pytest.mark.asyncio
    async def test_create_session_with_coordinator(
        self, game_session_service, mock_db, mock_character, mock_websocket_manager
    ):
        """CoordinatorAIを使ったセッション作成テスト"""
        # モックの設定
        mock_db.get.return_value = mock_character

        # check_character_ownershipとSessionクエリのためのモック設定
        exec_call_count = 0

        def exec_side_effect(query):
            nonlocal exec_call_count
            exec_call_count += 1
            result_mock = MagicMock()

            # 最初の呼び出しはcheck_character_ownership
            if exec_call_count == 1:
                result_mock.first.return_value = mock_character
            # 2番目の呼び出しは既存セッションの検索
            else:
                result_mock.all.return_value = []
                result_mock.first.return_value = None
            return result_mock

        mock_db.exec.side_effect = exec_side_effect

        # セッション作成用のモック
        def add_side_effect(obj):
            if isinstance(obj, GameSession):
                obj.created_at = datetime.utcnow()
                obj.updated_at = datetime.utcnow()

        mock_db.add.side_effect = add_side_effect

        # セッション作成
        session_data = GameSessionCreate(character_id="char_001")
        response = await game_session_service.create_session(mock_character, session_data)

        # 検証
        assert response.character_id == "char_001"
        assert response.character_name == "テストキャラクター"
        assert response.is_active is True
        assert response.turn_number == 0

        # CoordinatorAIが初期化されていることを確認
        assert game_session_service.coordinator is not None
        assert len(game_session_service.coordinator.agents) == 6

    @pytest.mark.asyncio
    async def test_execute_action_with_coordinator(
        self, game_session_service, mock_db, mock_character, mock_character_stats
    ):
        """CoordinatorAIを使ったアクション実行テスト"""
        # モックゲームセッション
        mock_session = GameSession(
            id="session_001",
            character_id="char_001",
            is_active=True,
            current_scene="村の中心にいます",
            session_data=json.dumps({"turn_count": 5, "actions_history": []}),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )

        # モックの設定
        exec_results = [
            mock_character,  # 最初のCharacter取得
            mock_character_stats,  # CharacterStats取得
        ]
        
        def exec_side_effect(stmt):
            result = MagicMock()
            if exec_results:
                result.first.return_value = exec_results.pop(0)
            else:
                result.first.return_value = None
            return result
            
        mock_db.exec.side_effect = exec_side_effect

        # CoordinatorAIのモック
        from app.ai.coordination_models import Choice, FinalResponse

        mock_response = FinalResponse(
            narrative="北へ向かって歩き始めました。",
            choices=[Choice(id="c1", text="さらに北へ進む"), Choice(id="c2", text="村に戻る")],
            state_changes={"stamina": -5},
            events=[],
            metadata={},
        )

        with patch.object(
            game_session_service.coordinator, "process_action", return_value=mock_response
        ) as mock_process:
            # アクション実行
            action_request = ActionExecuteRequest(action_text="北へ移動する", action_type="movement")

            response = await game_session_service.execute_action(mock_session, action_request)

            # 検証
            assert response.narrative == "北へ向かって歩き始めました。"
            assert len(response.choices) == 2
            assert response.success is True
            assert response.turn_number == 6  # turn_countが増加

            # CoordinatorAIが呼ばれたことを確認
            assert mock_process.called
            call_args = mock_process.call_args[0]
            assert call_args[0].action_text == "北へ移動する"
            assert call_args[0].action_type == "movement"

    @pytest.mark.asyncio
    async def test_coordinator_error_handling(
        self, game_session_service, mock_db, mock_character, mock_character_stats
    ):
        """CoordinatorAIのエラーハンドリングテスト"""
        # モックゲームセッション
        mock_session = GameSession(
            id="session_002",
            character_id="char_001",
            is_active=True,
            current_scene="森の中にいます",
            session_data=json.dumps({"turn_count": 10, "actions_history": []}),
        )

        # モックの設定
        exec_results = [
            mock_character,  # 最初のCharacter取得
            mock_character_stats,  # CharacterStats取得
        ]
        
        def exec_side_effect(stmt):
            result = MagicMock()
            if exec_results:
                result.first.return_value = exec_results.pop(0)
            else:
                result.first.return_value = None
            return result
            
        mock_db.exec.side_effect = exec_side_effect

        # CoordinatorAIでエラーを発生させる
        with patch.object(game_session_service.coordinator, "process_action", side_effect=Exception("AI処理エラー")):
            # アクション実行
            action_request = ActionExecuteRequest(action_text="危険な行動をする", action_type="dangerous")

            # エラーが適切に処理されることを確認
            with pytest.raises(HTTPException) as exc_info:
                await game_session_service.execute_action(mock_session, action_request)

            assert exc_info.value.status_code == 500
            assert "アクションの実行に失敗しました" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_session_persistence_with_coordinator(
        self, game_session_service, mock_db, mock_character, mock_character_stats
    ):
        """CoordinatorAIの状態が維持されることのテスト"""
        # モックゲームセッション
        mock_session = GameSession(
            id="session_003",
            character_id="char_001",
            is_active=True,
            current_scene="酒場にいます",
            session_data=json.dumps({"turn_count": 0, "actions_history": []}),
        )

        # モックの設定
        exec_results = [
            mock_character,  # 最初のCharacter取得
            mock_character_stats,  # CharacterStats取得
        ]
        
        def exec_side_effect(stmt):
            result = MagicMock()
            if exec_results:
                result.first.return_value = exec_results.pop(0)
            else:
                result.first.return_value = None
            return result
            
        mock_db.exec.side_effect = exec_side_effect

        # 初回のアクション実行
        with patch.object(game_session_service.coordinator, "initialize_session") as mock_init:
            action_request1 = ActionExecuteRequest(action_text="酒を注文する", action_type="interaction")

            # process_actionのモック
            from app.ai.coordination_models import FinalResponse

            mock_response1 = FinalResponse(
                narrative="バーテンダーが酒を差し出した。", choices=[], state_changes={}, events=[], metadata={}
            )

            with patch.object(game_session_service.coordinator, "process_action", return_value=mock_response1):
                await game_session_service.execute_action(mock_session, action_request1)

            # 初回は初期化が呼ばれる
            assert mock_init.called

        # 2回目のアクション実行（同じセッション）
        exec_results2 = [
            mock_character,  # 最初のCharacter取得
            mock_character_stats,  # CharacterStats取得
        ]
        
        def exec_side_effect2(stmt):
            result = MagicMock()
            if exec_results2:
                result.first.return_value = exec_results2.pop(0)
            else:
                result.first.return_value = None
            return result
            
        mock_db.exec.side_effect = exec_side_effect2

        with patch.object(game_session_service.coordinator, "initialize_session") as mock_init2:
            # shared_contextが存在することをシミュレート
            game_session_service.coordinator.shared_context = MagicMock()

            action_request2 = ActionExecuteRequest(action_text="バーテンダーと話す", action_type="dialogue")

            mock_response2 = FinalResponse(
                narrative="バーテンダーが笑顔で応じた。", choices=[], state_changes={}, events=[], metadata={}
            )

            with patch.object(game_session_service.coordinator, "process_action", return_value=mock_response2):
                await game_session_service.execute_action(mock_session, action_request2)

            # 2回目は初期化が呼ばれない
            assert not mock_init2.called
