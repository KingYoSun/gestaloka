"""
ゲームセッションAPIエンドポイントのテスト
"""

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models.character import Character
from app.models.game_session import GameSession, SessionStatus
from app.models.location import Location
from app.models.sp import PlayerSP
from app.models.user import User as UserModel


class TestGameSessionEndpoints:
    """ゲームセッションエンドポイントのテストクラス"""

    @pytest.fixture
    def mock_auth(self, client: TestClient, session: Session):
        """認証のモック設定"""
        from app.api.deps import get_current_user

        def get_test_user():
            # テスト用ユーザーを返す
            statement = select(UserModel).where(UserModel.username == "game_testuser")
            result = session.execute(statement)
            user = result.scalars().first()
            if not user:
                user = UserModel(
                    id="test-user-game",
                    username="game_testuser",
                    email="game_test@example.com",
                    hashed_password="dummy",
                )
                session.add(user)
                session.commit()
            return user

        client.app.dependency_overrides[get_current_user] = get_test_user
        yield
        client.app.dependency_overrides.clear()

    @pytest.fixture
    async def test_user(self, session: Session) -> UserModel:
        """テスト用ユーザー作成"""
        # 既存のユーザーを確認
        statement = select(UserModel).where(UserModel.username == "game_testuser")
        result = session.execute(statement)
        user_model = result.scalars().first()

        if not user_model:
            # ユーザーが存在しない場合は作成
            user_model = UserModel(
                id="test-user-game",
                username="game_testuser",
                email="game_test@example.com",
                hashed_password="dummy",
            )
            session.add(user_model)
            session.commit()
            session.refresh(user_model)

        return user_model

    @pytest.fixture
    def auth_headers(self, test_user: UserModel) -> dict[str, str]:
        """認証ヘッダー作成"""
        return {"Authorization": f"Bearer test-token-{test_user.id}"}

    @pytest.fixture
    def location(self, session: Session) -> Location:
        """テスト用ロケーション作成"""
        location = Location(
            id=str(uuid.uuid4()),
            name="Town Square",
            description="中央広場",
            location_type="town",
            x_coordinate=0,
            y_coordinate=0,
            hierarchy_level=1,
            danger_level="safe"
        )
        session.add(location)
        session.commit()
        session.refresh(location)
        return location

    @pytest.fixture
    def character(self, session: Session, test_user: UserModel, location: Location) -> Character:
        """テスト用キャラクターを作成"""
        character = Character(
            id=str(uuid.uuid4()),
            user_id=test_user.id,
            name="Test Character",
            description="テスト用キャラクター",
            gender="male",
            age=20,
            race="human",
            current_location_id=location.id,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session.add(character)

        # PlayerSPも作成
        player_sp = PlayerSP(
            id=str(uuid.uuid4()),
            player_id=test_user.id,
            current_sp=100,
            max_sp=100,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session.add(player_sp)

        session.commit()
        session.refresh(character)
        return character

    @pytest.fixture
    def game_session(self, session: Session, character: Character) -> GameSession:
        """テスト用ゲームセッション作成"""
        game_session = GameSession(
            id=str(uuid.uuid4()),
            character_id=character.id,
            session_number=1,
            is_active=True,
            session_status=SessionStatus.ACTIVE,
            current_scene="town_square",
            turn_count=0,
            word_count=0,
            play_duration_minutes=0,
            is_first_session=True,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session.add(game_session)
        session.commit()
        session.refresh(game_session)
        return game_session

    @patch("app.services.game_session_service.GameSessionService.create_session")
    async def test_create_session_success(
        self,
        mock_create_session: AsyncMock,
        client: TestClient,
        mock_auth,
        character: Character,
        auth_headers: dict[str, str],
    ):
        """セッション作成成功テスト"""
        # モックの設定
        mock_session = MagicMock()
        mock_session.id = str(uuid.uuid4())
        mock_session.character_id = character.id
        mock_session.session_number = 1
        mock_session.is_active = True
        mock_session.session_status = SessionStatus.ACTIVE.value
        mock_session.current_scene = "town_square"
        mock_session.turn_count = 0
        mock_session.word_count = 0
        mock_session.play_duration_minutes = 0
        mock_session.is_first_session = True
        mock_session.created_at = datetime.now(UTC)
        mock_session.updated_at = datetime.now(UTC)
        mock_session.ended_at = None

        mock_create_session.return_value = mock_session

        # リクエスト実行
        response = client.post(
            f"/api/v1/game/sessions?character_id={character.id}",
            json={"current_scene": "town_square"},
            headers=auth_headers,
        )

        # 検証
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["character_id"] == str(character.id)
        assert data["is_active"] is True
        assert data["session_status"] == "active"
        assert data["current_scene"] == "town_square"

    def test_create_session_unauthorized(
        self,
        client: TestClient,
        character: Character,
    ):
        """認証なしでセッション作成テスト"""
        response = client.post(
            f"/api/v1/game/sessions?character_id={character.id}",
            json={"current_scene": "town_square"},
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_get_session_success(
        self,
        client: TestClient,
        mock_auth,
        game_session: GameSession,
        auth_headers: dict[str, str],
    ):
        """セッション詳細取得成功テスト"""
        response = client.get(
            f"/api/v1/game/sessions/{game_session.id}",
            headers=auth_headers,
        )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["id"] == str(game_session.id)
        assert data["character_id"] == str(game_session.character_id)
        assert data["is_active"] is True

    def test_get_session_not_found(
        self,
        client: TestClient,
        mock_auth,
        auth_headers: dict[str, str],
    ):
        """存在しないセッション取得テスト"""
        fake_id = str(uuid.uuid4())
        response = client.get(
            f"/api/v1/game/sessions/{fake_id}",
            headers=auth_headers,
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @patch("app.services.game_session_service.GameSessionService.get_session_history")
    async def test_get_session_history_success(
        self,
        mock_get_history: AsyncMock,
        client: TestClient,
        mock_auth,
        game_session: GameSession,
        auth_headers: dict[str, str],
    ):
        """セッション履歴取得成功テスト"""
        # モックの設定
        mock_get_history.return_value = ([game_session], 1)

        # リクエスト実行
        response = client.get(
            "/api/v1/game/sessions/history",
            headers=auth_headers,
        )

        # 検証
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["total"] == 1
        assert len(data["sessions"]) == 1
        assert data["sessions"][0]["id"] == str(game_session.id)

    def test_get_session_history_with_filters(
        self,
        client: TestClient,
        mock_auth,
        character: Character,
        auth_headers: dict[str, str],
    ):
        """フィルター付きセッション履歴取得テスト"""
        response = client.get(
            f"/api/v1/game/sessions/history?character_id={character.id}&skip=0&limit=10",
            headers=auth_headers,
        )
        assert response.status_code == status.HTTP_200_OK

    @patch("app.services.game_session_service.GameSessionService.continue_session")
    async def test_continue_session_success(
        self,
        mock_continue_session: AsyncMock,
        client: TestClient,
        mock_auth,
        game_session: GameSession,
        auth_headers: dict[str, str],
    ):
        """セッション継続成功テスト"""
        # モックの設定
        mock_continue_session.return_value = game_session

        # リクエスト実行
        response = client.post(
            f"/api/v1/game/sessions/{game_session.id}/continue",
            json={},
            headers=auth_headers,
        )

        # 検証
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["id"] == str(game_session.id)
        assert data["is_active"] is True

    def test_continue_session_not_active(
        self,
        client: TestClient,
        mock_auth,
        session: Session,
        character: Character,
        auth_headers: dict[str, str],
    ):
        """非アクティブセッションの継続テスト"""
        # 非アクティブなセッションを作成
        inactive_session = GameSession(
            id=str(uuid.uuid4()),
            character_id=character.id,
            session_number=1,
            is_active=False,
            session_status=SessionStatus.COMPLETED.value,
            current_scene="town_square",
            turn_count=5,
            word_count=100,
            play_duration_minutes=30,
            is_first_session=True,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            ended_at=datetime.now(UTC),
        )
        session.add(inactive_session)
        session.commit()

        response = client.post(
            f"/api/v1/game/sessions/{inactive_session.id}/continue",
            json={},
            headers=auth_headers,
        )

        # 非アクティブセッションへのアクセスは404を返すはず
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @patch("app.services.game_session_service.GameSessionService.end_session")
    async def test_end_session_success(
        self,
        mock_end_session: AsyncMock,
        client: TestClient,
        mock_auth,
        game_session: GameSession,
        auth_headers: dict[str, str],
    ):
        """セッション終了成功テスト"""
        # モックの設定
        mock_result = MagicMock()
        mock_result.id = str(uuid.uuid4())
        mock_result.session_id = game_session.id
        mock_result.story_summary = "冒険の概要"
        mock_result.key_events = ["イベント1", "イベント2"]
        mock_result.experience_gained = 100
        mock_result.skills_improved = {"strength": 1}
        mock_result.items_acquired = []
        mock_result.continuation_context = "player_requested"
        mock_result.unresolved_plots = []
        mock_result.created_at = datetime.now(UTC)

        mock_end_session.return_value = mock_result

        # リクエスト実行
        response = client.post(
            f"/api/v1/game/sessions/{game_session.id}/end",
            json={"reason": "player_requested"},
            headers=auth_headers,
        )

        # 検証
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["session_id"] == str(game_session.id)
        assert data["story_summary"] == "冒険の概要"
        assert data["continuation_context"] == "player_requested"

    def test_end_session_already_ended(
        self,
        client: TestClient,
        mock_auth,
        session: Session,
        character: Character,
        auth_headers: dict[str, str],
    ):
        """既に終了したセッションの終了テスト"""
        # 終了済みセッションを作成
        ended_session = GameSession(
            id=str(uuid.uuid4()),
            character_id=character.id,
            session_number=1,
            is_active=False,
            session_status=SessionStatus.COMPLETED.value,
            current_scene="town_square",
            turn_count=5,
            word_count=100,
            play_duration_minutes=30,
            is_first_session=True,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            ended_at=datetime.now(UTC),
        )
        session.add(ended_session)
        session.commit()

        response = client.post(
            f"/api/v1/game/sessions/{ended_session.id}/end",
            json={"reason": "player_requested"},
            headers=auth_headers,
        )

        # 終了済みセッションへのアクセスは404を返すはず
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_get_active_session_exists(
        self,
        client: TestClient,
        mock_auth,
        game_session: GameSession,
        character: Character,
        auth_headers: dict[str, str],
    ):
        """アクティブセッション存在時の取得テスト"""
        response = client.get(
            f"/api/v1/game/sessions/active?character_id={character.id}",
            headers=auth_headers,
        )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["id"] == str(game_session.id)
        assert data["character_id"] == str(character.id)
        assert data["is_active"] is True

    def test_get_active_session_not_exists(
        self,
        client: TestClient,
        mock_auth,
        session: Session,
        test_user: UserModel,
        location: Location,
        auth_headers: dict[str, str],
    ):
        """アクティブセッションが存在しない場合のテスト"""
        # アクティブセッションを持たないキャラクターを作成
        character_no_session = Character(
            id=str(uuid.uuid4()),
            user_id=test_user.id,
            name="No Session Character",
            description="セッションなしキャラクター",
            gender="female",
            age=25,
            race="elf",
            current_location_id=location.id,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session.add(character_no_session)
        session.commit()

        response = client.get(
            f"/api/v1/game/sessions/active?character_id={character_no_session.id}",
            headers=auth_headers,
        )

        # キャラクターが存在しない、または権限がない場合は404を返す
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_get_active_session_other_user_character(
        self,
        client: TestClient,
        mock_auth,
        session: Session,
        location: Location,
        auth_headers: dict[str, str],
    ):
        """他ユーザーのキャラクターのアクティブセッション取得テスト"""
        # 別ユーザーを作成
        other_user = UserModel(
            id="other-user-game",
            username="other_game_user",
            email="other_game@example.com",
            hashed_password="dummy",
        )
        session.add(other_user)

        # 別ユーザーのキャラクターを作成
        other_character = Character(
            id=str(uuid.uuid4()),
            user_id=other_user.id,
            name="Other User Character",
            description="他ユーザーのキャラクター",
            gender="male",
            age=30,
            race="dwarf",
            current_location_id=location.id,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session.add(other_character)
        session.commit()

        response = client.get(
            f"/api/v1/game/sessions/active?character_id={other_character.id}",
            headers=auth_headers,
        )

        # 他ユーザーのキャラクターへのアクセスは404を返すはず
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_all_endpoints_require_authentication(
        self,
        client: TestClient,
        game_session: GameSession,
        character: Character,
    ):
        """全エンドポイントの認証要求テスト"""
        # 認証なしでアクセスしてみる
        endpoints = [
            ("POST", f"/api/v1/game/sessions?character_id={character.id}", {"current_scene": "town_square"}),
            ("GET", f"/api/v1/game/sessions/{game_session.id}", None),
            ("GET", "/api/v1/game/sessions/history", None),
            ("POST", f"/api/v1/game/sessions/{game_session.id}/continue", {}),
            ("POST", f"/api/v1/game/sessions/{game_session.id}/end", {"reason": "test"}),
            ("GET", f"/api/v1/game/sessions/active?character_id={character.id}", None),
        ]

        for method, url, json_data in endpoints:
            if method == "GET":
                response = client.get(url)
            else:  # POST
                response = client.post(url, json=json_data)

            assert response.status_code == status.HTTP_401_UNAUTHORIZED, f"Failed for {method} {url}"
