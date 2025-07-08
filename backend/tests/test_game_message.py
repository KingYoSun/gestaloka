"""
ゲームメッセージのテスト
"""

import json
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlmodel import Session, select

from app.models.character import Character, GameSession
from app.models.game_message import (
    MESSAGE_TYPE_GM_NARRATIVE,
    MESSAGE_TYPE_PLAYER_ACTION,
    MESSAGE_TYPE_SYSTEM_EVENT,
    SENDER_TYPE_GM,
    SENDER_TYPE_PLAYER,
    SENDER_TYPE_SYSTEM,
    GameMessage,
)
from app.models.user import User
from app.schemas.game_session import ActionExecuteRequest, GameSessionCreate
from app.services.game_session import GameSessionService


class TestGameMessage:
    """ゲームメッセージのテスト"""

    @pytest.fixture
    def mock_user(self):
        """テスト用ユーザー"""
        return User(
            id="user_001",
            username="testuser",
            email="test@example.com",
            hashed_password="hashed_password",
        )

    @pytest.fixture
    def mock_character(self, mock_user):
        """テスト用キャラクター"""
        return Character(
            id="char_001",
            user_id=mock_user.id,
            name="テストキャラクター",
            location="starting_village",
        )

    @pytest.fixture
    def mock_session(self, mock_character):
        """テスト用ゲームセッション"""
        return GameSession(
            id="session_001",
            character_id=mock_character.id,
            is_active=True,
            session_status="active",
            session_number=1,
            is_first_session=True,
            turn_count=0,
            word_count=0,
            play_duration_minutes=0,
            ending_proposal_count=0,
            session_data=json.dumps({"turn_count": 0, "actions_history": []}),
        )

    def test_save_message_basic(self, session: Session, mock_user, mock_character, mock_session):
        """基本的なメッセージ保存のテスト"""
        # モックデータをデータベースに保存
        session.add(mock_user)
        session.add(mock_character)
        session.add(mock_session)
        session.commit()

        # GameSessionServiceのインスタンスを作成
        service = GameSessionService(session)

        # メッセージを保存
        message = service.save_message(
            session_id=mock_session.id,
            message_type=MESSAGE_TYPE_PLAYER_ACTION,
            sender_type=SENDER_TYPE_PLAYER,
            content="テストアクション",
            turn_number=1,
            metadata={"test": True, "action_type": "free_action"},
        )

        # メッセージが正しく作成されたか確認
        assert message.id is not None
        assert message.session_id == mock_session.id
        assert message.message_type == MESSAGE_TYPE_PLAYER_ACTION
        assert message.sender_type == SENDER_TYPE_PLAYER
        assert message.content == "テストアクション"
        assert message.turn_number == 1
        assert message.message_metadata == {"test": True, "action_type": "free_action"}
        assert isinstance(message.created_at, datetime)

    def test_save_multiple_message_types(self, session: Session, mock_user, mock_character, mock_session):
        """異なるメッセージタイプの保存テスト"""
        # モックデータをデータベースに保存
        session.add(mock_user)
        session.add(mock_character)
        session.add(mock_session)
        session.commit()

        service = GameSessionService(session)

        # プレイヤーアクションメッセージ
        player_msg = service.save_message(
            session_id=mock_session.id,
            message_type=MESSAGE_TYPE_PLAYER_ACTION,
            sender_type=SENDER_TYPE_PLAYER,
            content="北へ向かう",
            turn_number=1,
            metadata={"action_type": "choice_action", "choice_id": "go_north"},
        )

        # GMナラティブメッセージ
        gm_msg = service.save_message(
            session_id=mock_session.id,
            message_type=MESSAGE_TYPE_GM_NARRATIVE,
            sender_type=SENDER_TYPE_GM,
            content="あなたは北の森へと足を踏み入れた。",
            turn_number=1,
            metadata={"choices": [{"id": "explore", "text": "探索する"}]},
        )

        # システムイベントメッセージ
        system_msg = service.save_message(
            session_id=mock_session.id,
            message_type=MESSAGE_TYPE_SYSTEM_EVENT,
            sender_type=SENDER_TYPE_SYSTEM,
            content="セッション #1 を開始しました。",
            turn_number=0,
            metadata={"session_number": 1, "is_first_session": True},
        )

        # メッセージが正しく保存されたか確認
        session.add_all([player_msg, gm_msg, system_msg])
        session.commit()

        # データベースから取得して確認
        messages = session.exec(
            select(GameMessage).where(GameMessage.session_id == mock_session.id).order_by(GameMessage.created_at)
        ).all()

        assert len(messages) == 3
        assert messages[0].message_type == MESSAGE_TYPE_PLAYER_ACTION
        assert messages[1].message_type == MESSAGE_TYPE_GM_NARRATIVE
        assert messages[2].message_type == MESSAGE_TYPE_SYSTEM_EVENT

    @pytest.mark.asyncio
    async def test_create_session_saves_system_message(self, session: Session, mock_user, mock_character):
        """セッション作成時にシステムメッセージが保存されるかテスト"""
        # データベースにキャラクターを追加
        session.add(mock_user)
        session.add(mock_character)
        session.commit()

        # GameSessionServiceのインスタンスを作成
        service = GameSessionService(session)

        # セッションを作成
        session_data = GameSessionCreate(character_id=mock_character.id)
        session_response = await service.create_session(mock_character, session_data)

        # システムメッセージが保存されたか確認
        messages = session.exec(
            select(GameMessage)
            .where(GameMessage.session_id == session_response.id)
            .where(GameMessage.message_type == MESSAGE_TYPE_SYSTEM_EVENT)
        ).all()

        assert len(messages) == 1
        assert messages[0].sender_type == SENDER_TYPE_SYSTEM
        assert "セッション #1 を開始しました。" in messages[0].content
        assert messages[0].turn_number == 0
        assert messages[0].message_metadata["is_first_session"] is True

    @pytest.mark.asyncio
    async def test_execute_action_saves_messages(self, session: Session, mock_user, mock_character, mock_session):
        """アクション実行時にメッセージが保存されるかテスト"""
        # データベースにデータを追加
        session.add(mock_user)
        session.add(mock_character)
        session.add(mock_session)
        session.commit()

        # GameSessionServiceのインスタンスを作成
        service = GameSessionService(session)

        # CoordinatorAIのモック
        mock_coordinator_response = MagicMock()
        mock_coordinator_response.narrative = "テストナラティブ"
        mock_coordinator_response.choices = []
        mock_coordinator_response.state_changes = {"success": True}

        with patch.object(service.coordinator, "initialize_session", new_callable=AsyncMock):
            with patch.object(service.coordinator, "process_action", new_callable=AsyncMock) as mock_process:
                mock_process.return_value = mock_coordinator_response

                # SP消費のモック
                with patch("app.services.sp_service.SPService") as mock_sp_service:
                    mock_sp_instance = MagicMock()
                    mock_sp_service.return_value = mock_sp_instance
                    mock_sp_instance.consume_sp = AsyncMock()

                    # WebSocketイベントのモック
                    with patch("app.services.game_session.GameEventEmitter") as mock_emitter:
                        mock_emitter.emit_narrative_update = AsyncMock()
                        mock_emitter.emit_action_result = AsyncMock()
                        mock_emitter.emit_player_status_update = AsyncMock()

                        # クエストサービスのモック
                        with patch("app.services.quest_service.QuestService") as mock_quest_service:
                            mock_quest_instance = MagicMock()
                            mock_quest_service.return_value = mock_quest_instance
                            mock_quest_instance.infer_implicit_quest = AsyncMock(return_value=None)
                            mock_quest_instance.update_quest_progress = AsyncMock(return_value=None)

                            # アクションを実行
                            action_request = ActionExecuteRequest(
                                action_type="free_action", action_text="テストアクション"
                            )

                            await service.execute_action(mock_session, action_request)

        # メッセージが保存されたか確認
        messages = session.exec(
            select(GameMessage)
            .where(GameMessage.session_id == mock_session.id)
            .order_by(GameMessage.turn_number, GameMessage.created_at)
        ).all()

        # プレイヤーアクションとGMナラティブの2つのメッセージが保存されるはず
        assert len(messages) >= 2

        # プレイヤーアクションメッセージの確認
        player_messages = [m for m in messages if m.message_type == MESSAGE_TYPE_PLAYER_ACTION]
        assert len(player_messages) >= 1
        assert player_messages[0].content == "テストアクション"
        assert player_messages[0].sender_type == SENDER_TYPE_PLAYER
        assert player_messages[0].turn_number == 1

        # GMナラティブメッセージの確認
        gm_messages = [m for m in messages if m.message_type == MESSAGE_TYPE_GM_NARRATIVE]
        assert len(gm_messages) >= 1
        assert gm_messages[0].content == "テストナラティブ"
        assert gm_messages[0].sender_type == SENDER_TYPE_GM
        assert gm_messages[0].turn_number == 1

    def test_end_session_saves_system_message(self, session: Session, mock_user, mock_character, mock_session):
        """セッション終了時にシステムメッセージが保存されるかテスト"""
        # データベースにデータを追加
        session.add(mock_user)
        session.add(mock_character)
        session.add(mock_session)
        session.commit()

        # GameSessionServiceのインスタンスを作成
        service = GameSessionService(session)

        # セッションを終了
        service.end_session(mock_session)

        # システムメッセージが保存されたか確認
        messages = session.exec(
            select(GameMessage)
            .where(GameMessage.session_id == mock_session.id)
            .where(GameMessage.message_type == MESSAGE_TYPE_SYSTEM_EVENT)
            .where(GameMessage.content.contains("終了"))
        ).all()

        assert len(messages) == 1
        assert messages[0].sender_type == SENDER_TYPE_SYSTEM
        assert "セッション #1 を終了しました。" in messages[0].content
        assert messages[0].turn_number == 0  # 初期状態のturn_count

    def test_message_metadata_storage(self, session: Session, mock_user, mock_character, mock_session):
        """メタデータが正しく保存されるかテスト"""
        # モックデータをデータベースに保存
        session.add(mock_user)
        session.add(mock_character)
        session.add(mock_session)
        session.commit()

        service = GameSessionService(session)

        # 複雑なメタデータを含むメッセージを保存
        complex_metadata = {
            "choices": [
                {"id": "choice1", "text": "選択肢1", "description": "説明1"},
                {"id": "choice2", "text": "選択肢2", "description": "説明2"},
            ],
            "state_changes": {"hp": -10, "location": "forest", "items": ["sword", "potion"]},
            "battle_data": {"enemy": "ゴブリン", "damage_dealt": 15, "damage_received": 10},
        }

        message = service.save_message(
            session_id=mock_session.id,
            message_type=MESSAGE_TYPE_GM_NARRATIVE,
            sender_type=SENDER_TYPE_GM,
            content="戦闘が発生した！",
            turn_number=5,
            metadata=complex_metadata,
        )

        # データベースに保存
        session.add(message)
        session.commit()
        session.refresh(message)

        # メタデータが正しく保存・取得できるか確認
        assert message.message_metadata == complex_metadata
        assert message.message_metadata["choices"][0]["id"] == "choice1"
        assert message.message_metadata["state_changes"]["hp"] == -10
        assert message.message_metadata["battle_data"]["enemy"] == "ゴブリン"

    def test_get_session_messages(self, session: Session, mock_user, mock_character, mock_session):
        """セッションのメッセージ履歴を取得するテスト"""
        # モックデータをデータベースに保存
        session.add(mock_user)
        session.add(mock_character)
        session.add(mock_session)
        session.commit()

        service = GameSessionService(session)

        # 複数のメッセージを保存
        for i in range(5):
            # プレイヤーアクション
            service.save_message(
                session_id=mock_session.id,
                message_type=MESSAGE_TYPE_PLAYER_ACTION,
                sender_type=SENDER_TYPE_PLAYER,
                content=f"アクション {i+1}",
                turn_number=i + 1,
                metadata={"action_number": i + 1},
            )

            # GMレスポンス
            service.save_message(
                session_id=mock_session.id,
                message_type=MESSAGE_TYPE_GM_NARRATIVE,
                sender_type=SENDER_TYPE_GM,
                content=f"ナラティブ {i+1}",
                turn_number=i + 1,
                metadata={"narrative_number": i + 1},
            )

        session.commit()

        # セッションのメッセージを取得
        messages = session.exec(
            select(GameMessage)
            .where(GameMessage.session_id == mock_session.id)
            .order_by(GameMessage.turn_number, GameMessage.created_at)
        ).all()

        # 10個のメッセージが保存されているか確認
        assert len(messages) == 10

        # ターン番号順に並んでいるか確認
        for i in range(5):
            assert messages[i * 2].turn_number == i + 1
            assert messages[i * 2].message_type == MESSAGE_TYPE_PLAYER_ACTION
            assert messages[i * 2 + 1].turn_number == i + 1
            assert messages[i * 2 + 1].message_type == MESSAGE_TYPE_GM_NARRATIVE
