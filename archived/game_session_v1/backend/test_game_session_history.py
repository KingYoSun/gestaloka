"""
セッション履歴APIのテスト
"""

import uuid
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.deps import get_current_active_user, get_current_user
from app.models.character import (
    SESSION_STATUS_ACTIVE,
    SESSION_STATUS_COMPLETED,
    SESSION_STATUS_ENDING_PROPOSED,
    Character,
    GameSession,
)
from app.models.user import User


class TestSessionHistoryAPI:
    """セッション履歴APIのテスト"""

    @pytest.fixture
    def test_user(self, session: Session) -> User:
        """テスト用ユーザー"""
        user = User(
            id=str(uuid.uuid4()),
            email="test@example.com",
            username="testuser",
            hashed_password="hashed",
            is_active=True,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return user

    @pytest.fixture
    def auth_headers(self, client: TestClient, test_user: User) -> dict[str, str]:
        """認証ヘッダー"""

        # テスト用に依存性を上書き
        def override_get_current_user():
            return test_user

        def override_get_current_active_user():
            return test_user

        client.app.dependency_overrides[get_current_user] = override_get_current_user
        client.app.dependency_overrides[get_current_active_user] = override_get_current_active_user

        # ダミーのトークンヘッダーを返す
        return {"Authorization": f"Bearer test-token-{test_user.id}"}

    @pytest.fixture
    def test_character(self, session: Session, test_user: User) -> Character:
        """テスト用キャラクター"""
        character = Character(
            id=str(uuid.uuid4()),
            user_id=test_user.id,
            name="テストキャラクター",
            location="nexus",
            is_active=True,
        )
        session.add(character)
        session.commit()
        session.refresh(character)
        return character

    @pytest.fixture
    def test_sessions(self, session: Session, test_character: Character) -> list[GameSession]:
        """テスト用セッション群"""
        sessions = []
        base_time = datetime.utcnow() - timedelta(days=30)

        # 様々なステータスのセッションを作成
        for i in range(25):  # ページネーションテスト用に多めに作成
            status = SESSION_STATUS_COMPLETED
            if i < 3:
                status = SESSION_STATUS_ACTIVE
            elif i < 5:
                status = SESSION_STATUS_ENDING_PROPOSED

            game_session = GameSession(
                id=str(uuid.uuid4()),
                character_id=test_character.id,
                session_number=i + 1,
                session_status=status,
                is_active=(status == SESSION_STATUS_ACTIVE),
                turn_count=10 + i * 5,
                word_count=1000 + i * 200,
                play_duration_minutes=30 + i * 10,
                result_summary=f"セッション{i+1}の結果" if status == SESSION_STATUS_COMPLETED else None,
                created_at=base_time + timedelta(days=i),
                updated_at=base_time + timedelta(days=i, hours=2),
                result_processed_at=base_time + timedelta(days=i, hours=3)
                if status == SESSION_STATUS_COMPLETED
                else None,
            )
            sessions.append(game_session)
            session.add(game_session)

        session.commit()
        return sessions

    def test_get_session_history_success(
        self,
        client: TestClient,
        test_user: User,
        test_character: Character,
        test_sessions: list[GameSession],
        auth_headers: dict[str, str],
    ):
        """セッション履歴取得の成功テスト"""
        response = client.get(
            f"/api/v1/game/sessions/history?character_id={test_character.id}",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert "sessions" in data
        assert "total" in data
        assert "page" in data
        assert "per_page" in data
        assert "has_next" in data
        assert "has_prev" in data

        assert data["total"] == 25
        assert data["page"] == 1
        assert data["per_page"] == 20
        assert data["has_next"] is True
        assert data["has_prev"] is False
        assert len(data["sessions"]) == 20

    def test_get_session_history_pagination(
        self,
        client: TestClient,
        test_user: User,
        test_character: Character,
        test_sessions: list[GameSession],
        auth_headers: dict[str, str],
    ):
        """ページネーションのテスト"""
        # 2ページ目を取得
        response = client.get(
            f"/api/v1/game/sessions/history?character_id={test_character.id}&page=2&per_page=10",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert data["page"] == 2
        assert data["per_page"] == 10
        assert data["has_next"] is True
        assert data["has_prev"] is True
        assert len(data["sessions"]) == 10

    def test_get_session_history_with_status_filter(
        self,
        client: TestClient,
        test_user: User,
        test_character: Character,
        test_sessions: list[GameSession],
        auth_headers: dict[str, str],
    ):
        """ステータスフィルタのテスト"""
        response = client.get(
            f"/api/v1/game/sessions/history?character_id={test_character.id}&status={SESSION_STATUS_ACTIVE}",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert data["total"] == 3
        assert len(data["sessions"]) == 3

        # 全てアクティブセッションであることを確認
        for session in data["sessions"]:
            assert session["session_status"] == SESSION_STATUS_ACTIVE

    def test_get_session_history_no_sessions(
        self,
        client: TestClient,
        test_user: User,
        test_character: Character,
        auth_headers: dict[str, str],
    ):
        """セッションが存在しない場合のテスト"""
        response = client.get(
            f"/api/v1/game/sessions/history?character_id={test_character.id}",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert data["total"] == 0
        assert len(data["sessions"]) == 0
        assert data["has_next"] is False
        assert data["has_prev"] is False

    def test_get_session_history_unauthorized_character(
        self,
        client: TestClient,
        test_user: User,
        session: Session,
        auth_headers: dict[str, str],
    ):
        """他のユーザーのキャラクターの履歴取得を試みるテスト"""
        # 別のユーザーを作成
        other_user = User(
            id=str(uuid.uuid4()),
            email="other@example.com",
            username="otheruser",
            hashed_password="hashed",
            is_active=True,
        )
        session.add(other_user)

        # 別のユーザーのキャラクターを作成
        other_character = Character(
            id=str(uuid.uuid4()),
            user_id=other_user.id,
            name="他のキャラクター",
            location="nexus",
            is_active=True,
        )
        session.add(other_character)
        session.commit()

        response = client.get(
            f"/api/v1/game/sessions/history?character_id={other_character.id}",
            headers=auth_headers,
        )

        assert response.status_code == 404

    def test_get_session_history_invalid_character(
        self,
        client: TestClient,
        test_user: User,
        auth_headers: dict[str, str],
    ):
        """存在しないキャラクターIDでのテスト"""
        response = client.get(
            f"/api/v1/game/sessions/history?character_id={uuid.uuid4()}",
            headers=auth_headers,
        )

        assert response.status_code == 404

    def test_get_session_history_sorting(
        self,
        client: TestClient,
        test_user: User,
        test_character: Character,
        test_sessions: list[GameSession],
        auth_headers: dict[str, str],
    ):
        """セッションが新しい順にソートされているかのテスト"""
        response = client.get(
            f"/api/v1/game/sessions/history?character_id={test_character.id}",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        sessions = data["sessions"]
        # 作成日時が降順になっているか確認
        for i in range(len(sessions) - 1):
            assert sessions[i]["created_at"] >= sessions[i + 1]["created_at"]
