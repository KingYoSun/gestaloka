"""
テスト設定
"""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.core.database import get_session
from app.main import app
from app.models.sp import PlayerSP, SPTransaction  # noqa: F401
from app.models.sp_purchase import SPPurchase  # noqa: F401

# Import all models to ensure they're registered with SQLModel
from app.models.user import User  # noqa: F401


@pytest.fixture(name="session")
def session_fixture():
    """テスト用データベースセッション"""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture(name="client")
def client_fixture(session: Session):
    """テスト用FastAPIクライアント"""

    def get_session_override():
        return session

    app.dependency_overrides[get_session] = get_session_override
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


@pytest.fixture
def test_user_data():
    """テスト用ユーザーデータ"""
    return {"username": "testuser", "email": "test@example.com", "password": "TestPassword123!"}


@pytest.fixture
def test_character_data():
    """テスト用キャラクターデータ"""
    return {
        "name": "テストキャラクター",
        "description": "テスト用のキャラクターです",
        "appearance": "勇敢そうな外見",
        "personality": "好奇心旺盛で勇敢",
        "location": "starting_village",
    }
