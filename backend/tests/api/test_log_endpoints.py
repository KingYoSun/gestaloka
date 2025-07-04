"""
ログシステムAPIエンドポイントのテスト
"""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models.character import Character, GameSession
from app.models.log import (
    EmotionalValence,
    LogFragment,
    LogFragmentRarity,
)
from app.models.user import User as UserModel
from app.schemas.user import UserCreate
from app.services.user_service import UserService


class TestLogEndpoints:
    """ログエンドポイントのテストクラス"""

    @pytest.fixture
    async def test_user(self, session: Session) -> UserModel:
        """テスト用ユーザー作成"""
        import uuid

        user_service = UserService(session)
        unique_id = str(uuid.uuid4())[:8]
        user_create = UserCreate(
            username=f"testuser_{unique_id}", email=f"test_{unique_id}@example.com", password="testpassword123"
        )
        user_schema = await user_service.create(user_create)
        # モデルを返す
        statement = select(UserModel).where(UserModel.id == user_schema.id)
        result = session.exec(statement)
        user_model = result.first()
        assert user_model is not None
        return user_model

    @pytest.fixture
    def auth_headers(self, test_user: UserModel) -> dict[str, str]:
        """認証ヘッダー作成"""
        # 実際の実装では、JWTトークンを生成する
        # ここでは簡略化
        return {"Authorization": f"Bearer test-token-{test_user.id}"}

    def test_create_log_fragment_unauthorized(self, client: TestClient):
        """認証なしでのログフラグメント作成（失敗）"""
        fragment_data = {
            "character_id": "test-char",
            "session_id": "test-session",
            "action_description": "Test action",
            "keywords": ["test"],
        }

        response = client.post("/api/v1/logs/fragments", json=fragment_data)
        assert response.status_code == 401  # Unauthorized

    def test_create_log_fragment_success(
        self,
        client: TestClient,
        session: Session,
    ):
        """ログフラグメント作成成功のテスト"""
        # テスト用ユーザー作成
        import uuid

        unique_id = str(uuid.uuid4())[:8]
        user = UserModel(
            id=f"test-user-{unique_id}",
            username=f"testuser_{unique_id}",
            email=f"test_{unique_id}@example.com",
            hashed_password="dummy",
            is_active=True,
            is_verified=False,
            is_superuser=False,
        )
        session.add(user)

        # テスト用キャラクター作成
        character = Character(
            id="test-char-1",
            user_id=user.id,
            name="Test Character",
            location="starting_village",
            is_active=True,
        )
        session.add(character)

        # テスト用ゲームセッション作成
        game_session = GameSession(
            id="test-session-1",
            character_id=character.id,
            is_active=True,
        )
        session.add(game_session)
        session.commit()

        # 認証をモック（実際の実装では適切な認証処理が必要）
        from app.api.api_v1.endpoints.auth import get_current_user

        def mock_get_current_user():
            return user

        from fastapi import FastAPI

        app = client.app
        if isinstance(app, FastAPI):
            app.dependency_overrides[get_current_user] = mock_get_current_user

        # ログフラグメント作成リクエスト
        fragment_data = {
            "character_id": character.id,
            "session_id": game_session.id,
            "action_description": "勇敢にもゴブリンの群れに立ち向かった",
            "keywords": ["勇敢", "戦闘", "ゴブリン"],
            "emotional_valence": "positive",
            "rarity": "uncommon",
            "importance_score": 0.7,
            "context_data": {
                "location": "森の入り口",
                "enemies": ["ゴブリン x3"],
                "outcome": "勝利",
            },
        }

        response = client.post(
            "/api/v1/logs/fragments",
            json=fragment_data,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["action_description"] == fragment_data["action_description"]
        assert data["keywords"] == fragment_data["keywords"]
        assert data["emotional_valence"] == fragment_data["emotional_valence"]

        # クリーンアップ
        from app.main import app

        app.dependency_overrides.clear()  # type: ignore[attr-defined]

    def test_get_character_fragments(
        self,
        client: TestClient,
        session: Session,
    ):
        """キャラクターのログフラグメント一覧取得のテスト"""
        # テスト用データ作成
        user = UserModel(
            id="test-user-2",
            username="testuser2",
            email="test2@example.com",
            hashed_password="dummy",
            is_active=True,
            is_verified=False,
            is_superuser=False,
        )
        session.add(user)

        character = Character(
            id="test-char-2",
            user_id=user.id,
            name="Test Character 2",
            location="starting_village",
            is_active=True,
        )
        session.add(character)

        game_session = GameSession(
            id="test-session-2",
            character_id=character.id,
        )
        session.add(game_session)

        # テスト用フラグメント作成
        for i in range(3):
            fragment = LogFragment(
                id=f"fragment-{i}",
                character_id=character.id,
                session_id=game_session.id,
                action_description=f"Test action {i}",
                keywords=[f"keyword{i}"],
                emotional_valence=EmotionalValence.NEUTRAL,
                rarity=LogFragmentRarity.COMMON,
            )
            session.add(fragment)
        session.commit()

        # 認証をモック
        from app.api.api_v1.endpoints.auth import get_current_user

        def mock_get_current_user():
            return user

        from fastapi import FastAPI

        app = client.app
        if isinstance(app, FastAPI):
            app.dependency_overrides[get_current_user] = mock_get_current_user

        # フラグメント一覧取得
        response = client.get(f"/api/v1/logs/fragments/{character.id}")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 3
        assert all(f["character_id"] == character.id for f in data)

        # クリーンアップ
        from app.main import app

        app.dependency_overrides.clear()  # type: ignore[attr-defined]

    def test_create_completed_log(
        self,
        client: TestClient,
        session: Session,
    ):
        """完成ログ作成のテスト"""
        # テスト用データ作成
        user = UserModel(
            id="test-user-3",
            username="testuser3",
            email="test3@example.com",
            hashed_password="dummy",
            is_active=True,
            is_verified=False,
            is_superuser=False,
        )
        session.add(user)

        character = Character(
            id="test-char-3",
            user_id=user.id,
            name="Test Character 3",
            location="starting_village",
            is_active=True,
        )
        session.add(character)

        game_session = GameSession(
            id="test-session-3",
            character_id=character.id,
        )
        session.add(game_session)

        # テスト用フラグメント作成
        core_fragment = LogFragment(
            id="core-fragment-1",
            character_id=character.id,
            session_id=game_session.id,
            action_description="英雄的な行動",
            keywords=["勇敢", "英雄"],
            emotional_valence=EmotionalValence.POSITIVE,
            rarity=LogFragmentRarity.RARE,
        )
        session.add(core_fragment)

        sub_fragments = []
        for i in range(2):
            fragment = LogFragment(
                id=f"sub-fragment-{i}",
                character_id=character.id,
                session_id=game_session.id,
                action_description=f"Supporting action {i}",
                keywords=[f"support{i}"],
                emotional_valence=EmotionalValence.POSITIVE if i == 0 else EmotionalValence.NEGATIVE,
                rarity=LogFragmentRarity.COMMON,
            )
            session.add(fragment)
            sub_fragments.append(fragment)
        session.commit()

        # 認証をモック
        from app.api.api_v1.endpoints.auth import get_current_user

        def mock_get_current_user():
            return user

        from fastapi import FastAPI

        app = client.app
        if isinstance(app, FastAPI):
            app.dependency_overrides[get_current_user] = mock_get_current_user

        # 完成ログ作成リクエスト
        log_data = {
            "creator_id": character.id,
            "core_fragment_id": core_fragment.id,
            "sub_fragment_ids": [f.id for f in sub_fragments],
            "name": "勇敢なる戦士",
            "title": "英雄",
            "description": "ゴブリンの群れから村を守った勇敢な戦士",
            "skills": ["剣術", "勇気"],
            "personality_traits": ["勇敢", "正義感が強い"],
            "behavior_patterns": {
                "combat": "積極的に前線で戦う",
                "social": "困っている人を助ける",
            },
        }

        response = client.post(
            "/api/v1/logs/completed",
            json=log_data,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == log_data["name"]
        assert data["title"] == log_data["title"]
        assert data["contamination_level"] == pytest.approx(1 / 3)  # 1 negative out of 3 total
        assert data["status"] == "draft"

        # クリーンアップ
        from app.main import app

        app.dependency_overrides.clear()  # type: ignore[attr-defined]
