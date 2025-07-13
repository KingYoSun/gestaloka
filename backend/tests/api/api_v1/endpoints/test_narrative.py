"""
物語主導型探索システムAPIエンドポイントのテスト
"""

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import (
    Character,
    CharacterLocationHistory,
    Location,
    LocationConnection,
    PlayerSP,
)
from app.models.user import User as UserModel
from app.schemas.narrative import LocationEvent


class TestNarrativeEndpoints:
    """物語エンドポイントのテストクラス"""

    @pytest.fixture
    def mock_auth(self, client: TestClient, session: Session):
        """認証のモック設定"""
        from app.api.deps import get_current_user

        def get_test_user():
            # テスト用ユーザーを返す
            statement = select(UserModel).where(UserModel.username == "narrative_testuser")
            result = session.execute(statement)
            user = result.scalars().first()
            if not user:
                user = UserModel(
                    id="test-user-narrative",
                    username="narrative_testuser",
                    email="narrative_test@example.com",
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
        statement = select(UserModel).where(UserModel.username == "narrative_testuser")
        result = session.execute(statement)
        user_model = result.scalars().first()

        if not user_model:
            # ユーザーが存在しない場合は作成
            user_model = UserModel(
                id="test-user-narrative",
                username="narrative_testuser",
                email="narrative_test@example.com",
                hashed_password="dummy",
            )
            session.add(user_model)
            session.commit()
            session.refresh(user_model)

        return user_model

    @pytest.fixture
    def auth_headers(self, test_user: UserModel) -> dict[str, str]:
        """認証ヘッダー作成"""
        # 実際の実装では、JWTトークンを生成する
        # ここでは簡略化
        return {"Authorization": f"Bearer test-token-{test_user.id}"}

    @pytest.fixture
    def character(self, session: Session, test_user: UserModel) -> Character:
        """テスト用キャラクターを作成"""
        location = Location(
            id=str(uuid.uuid4()),
            name="Test Location",
            description="テスト用の場所",
            location_type="town",
            x_coordinate=0,
            y_coordinate=0,
            hierarchy_level=1,
            danger_level="safe"
        )
        session.add(location)
        session.commit()

        character = Character(
            id=str(uuid.uuid4()),
            user_id=test_user.id,
            name="Test Character",
            location_id=location.id,
            location=location.name
        )
        session.add(character)
        session.commit()
        return character

    @pytest.fixture
    def connected_location(self, session: Session) -> Location:
        """接続された場所を作成"""
        location = Location(
            id=str(uuid.uuid4()),
            name="Connected Location",
            description="接続されたテスト用の場所",
            location_type="wild",
            x_coordinate=1,
            y_coordinate=0,
            hierarchy_level=1,
            danger_level="safe"
        )
        session.add(location)
        session.commit()
        return location

    @pytest.fixture
    def location_connection(self, session: Session, character: Character, connected_location: Location) -> LocationConnection:
        """場所間の接続を作成"""
        connection = LocationConnection(
            id=str(uuid.uuid4()),
            from_location_id=character.location_id,
            to_location_id=connected_location.id,
            path_type="direct",
            is_blocked=False
        )
        session.add(connection)
        session.commit()
        return connection

    @pytest.fixture
    def player_sp(self, session: Session, test_user: UserModel) -> PlayerSP:
        """テスト用PlayerSPを作成"""
        player_sp = PlayerSP(
            id=str(uuid.uuid4()),
            user_id=test_user.id,
            current_sp=100,
            max_sp=100
        )
        session.add(player_sp)
        session.commit()
        return player_sp

    @pytest.mark.asyncio
    async def test_perform_narrative_action_success(
        self, client: TestClient, auth_headers: dict[str, str], character: Character, player_sp: PlayerSP, connected_location: Location, session: Session, mock_auth
    ):
        """物語アクションの実行に成功"""
        action_request = {
            "text": "周囲を探索する",
            "context": {"action_type": "explore"}
        }

        # GM AIサービスのモック
        with patch("app.api.api_v1.endpoints.narrative.GMAIService") as mock_gm_ai:
            mock_result = MagicMock()
            mock_result.narrative = "あなたは周囲を注意深く観察した。"
            mock_result.location_changed = True
            mock_result.new_location_id = connected_location.id
            mock_result.sp_cost = 10
            mock_result.events = [LocationEvent(type="discovery", title="発見", description="新しい場所を発見")]
            mock_result.movement_description = "新しい場所へ移動した"

            mock_instance = MagicMock()
            mock_instance.process_narrative_action = AsyncMock(return_value=mock_result)
            mock_gm_ai.return_value = mock_instance

            # WebSocketサービスのモック
            with patch("app.api.api_v1.endpoints.narrative.WebSocketService") as mock_ws:
                mock_ws_instance = MagicMock()
                mock_ws_instance.broadcast_to_user = AsyncMock()
                mock_ws.return_value = mock_ws_instance

                response = client.post(
                    f"/api/v1/narrative/{character.id}/action",
                    json=action_request,
                    headers=auth_headers
                )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["narrative"] == mock_result.narrative
        assert data["location_changed"] is True
        assert data["sp_consumed"] == 10
        assert len(data["events"]) == 1

        # キャラクターの位置が更新されたか確認
        session.refresh(character)
        assert character.location_id == connected_location.id

    @pytest.mark.asyncio
    async def test_perform_narrative_action_insufficient_sp(
        self, client: TestClient, auth_headers: dict[str, str], character: Character, session: Session, mock_auth
    ):
        """SP不足の場合のアクション実行"""
        # PlayerSPを低い値で作成
        player_sp = PlayerSP(
            id=str(uuid.uuid4()),
            user_id=character.user_id,
            current_sp=5,
            max_sp=100
        )
        session.add(player_sp)
        session.commit()

        action_request = {
            "text": "遠くへ移動する",
            "context": {}
        }

        with patch("app.api.api_v1.endpoints.narrative.GMAIService") as mock_gm_ai:
            mock_result = MagicMock()
            mock_result.narrative = "遠くへ移動しようとした。"
            mock_result.location_changed = True
            mock_result.new_location_id = str(uuid.uuid4())
            mock_result.sp_cost = 20  # 現在のSPより多い
            mock_result.events = []

            mock_instance = MagicMock()
            mock_instance.process_narrative_action = AsyncMock(return_value=mock_result)
            mock_gm_ai.return_value = mock_instance

            response = client.post(
                f"/api/v1/narrative/{character.id}/action",
                json=action_request,
                headers=auth_headers
            )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "疲労を感じ" in data["narrative"]
        assert data["location_changed"] is False
        assert data["sp_consumed"] == 0

    @pytest.mark.asyncio
    async def test_perform_narrative_action_forbidden(
        self, client: TestClient, auth_headers: dict[str, str], character: Character, test_user: UserModel, session: Session, mock_auth
    ):
        """他のキャラクターへのアクション実行は禁止"""
        # 別のユーザーを作成
        other_user = UserModel(
            id=str(uuid.uuid4()),
            username="other_user",
            email="other@example.com",
            hashed_password="dummy"
        )
        session.add(other_user)
        session.commit()
        
        # 別のキャラクターを作成
        other_character = Character(
            id=str(uuid.uuid4()),
            user_id=other_user.id,
            name="Other Character",
            location_id=character.location_id,
            hp=100,
            energy=100,
            attack=10,
            defense=5
        )
        session.add(other_character)
        session.commit()

        action_request = {
            "text": "何かする",
            "context": {}
        }

        response = client.post(
            f"/api/v1/narrative/{other_character.id}/action",
            json=action_request,
            headers=auth_headers
        )

        # セキュリティ上の理由から、他のユーザーのキャラクターの存在を明かさない
        # 404 Not Foundを返す
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.asyncio
    async def test_get_available_actions(
        self, client: TestClient, auth_headers: dict[str, str], character: Character, connected_location: Location, location_connection: LocationConnection, session: Session, mock_auth
    ):
        """利用可能なアクションの取得"""
        # 探索進捗を作成（霧が晴れた状態）
        from app.models.exploration_progress import CharacterExplorationProgress

        progress = CharacterExplorationProgress(
            id=str(uuid.uuid4()),
            character_id=character.id,
            location_id=connected_location.id,
            fog_revealed_at=datetime.now(UTC)
        )
        session.add(progress)
        session.commit()

        response = client.get(
            f"/api/v1/narrative/{character.id}/actions",
            headers=auth_headers
        )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0

        # 基本アクションが含まれているか確認
        action_texts = [action["text"] for action in data]
        assert "周囲を詳しく調べる" in action_texts
        assert "休憩する" in action_texts

        # 移動アクションが含まれているか確認
        move_actions = [action for action in data if action["action_type"] == "move"]
        assert len(move_actions) > 0

    @pytest.mark.asyncio
    async def test_get_available_actions_forbidden(
        self, client: TestClient, auth_headers: dict[str, str], character: Character, session: Session, mock_auth
    ):
        """他のキャラクターのアクション取得は禁止"""
        # 別のユーザーを作成
        other_user = UserModel(
            id=str(uuid.uuid4()),
            username="other_user_get_actions",
            email="other_get_actions@example.com",
            hashed_password="dummy"
        )
        session.add(other_user)
        session.commit()
        
        # 別のキャラクターを作成
        other_character = Character(
            id=str(uuid.uuid4()),
            user_id=other_user.id,
            name="Other Character For Get Actions",
            location_id=character.location_id,
            hp=100,
            energy=100,
            attack=10,
            defense=5
        )
        session.add(other_character)
        session.commit()
        
        other_character_id = other_character.id

        response = client.get(
            f"/api/v1/narrative/{other_character_id}/actions",
            headers=auth_headers
        )

        # セキュリティ上の理由から、他のユーザーのキャラクターの存在を明かさない
        # 404 Not Foundを返す
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.asyncio
    async def test_update_location_history(self, session: Session, character: Character, connected_location: Location):
        """場所移動履歴の更新テスト"""
        from app.api.api_v1.endpoints.narrative import update_location_history

        # 現在地の履歴を作成
        current_history = CharacterLocationHistory(
            character_id=character.id,
            location_id=character.location_id,
            sp_consumed=0
        )
        session.add(current_history)
        session.commit()

        # 新しい場所への移動を記録
        update_location_history(session, character, connected_location, sp_cost=10)
        session.commit()

        # 現在地の履歴が終了されたか確認
        session.refresh(current_history)
        assert current_history.departed_at is not None

        # 新しい履歴が作成されたか確認
        new_history = session.query(CharacterLocationHistory).filter(
            CharacterLocationHistory.character_id == character.id,
            CharacterLocationHistory.location_id == connected_location.id,
            CharacterLocationHistory.departed_at.is_(None)
        ).first()
        assert new_history is not None
        assert new_history.sp_consumed == 10

    @pytest.mark.asyncio
    async def test_generate_action_choices_with_context(self, session: Session, character: Character):
        """文脈に応じたアクション選択肢の生成"""
        from app.api.api_v1.endpoints.narrative import generate_action_choices

        # 扉がある文脈
        choices = generate_action_choices(
            session, character, "目の前に重厚な扉がある。", str(character.location_id)
        )

        action_texts = [choice.text for choice in choices]
        assert "扉を開ける" in action_texts

        # 人影がある文脈
        choices = generate_action_choices(
            session, character, "遠くに人影が見える。", str(character.location_id)
        )

        action_texts = [choice.text for choice in choices]
        assert "人影に近づく" in action_texts
