"""
QuestServiceのテスト
"""

import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import Session, create_engine
from sqlmodel.pool import StaticPool

from app.models.character import Character
from app.models.log import ActionLog
from app.models.quest import Quest, QuestOrigin, QuestStatus
from app.models.user import User
from app.services.quest_service import QuestService
from app.utils.security import generate_uuid


@pytest.fixture
def test_db():
    """テスト用データベース"""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    from app.models.base import SQLModel
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        yield session


@pytest.fixture
def test_user(test_db: Session):
    """テストユーザー"""
    user = User(
        id=generate_uuid(),
        username="testuser",
        email="test@example.com",
        hashed_password="hashed_password",
    )
    test_db.add(user)
    test_db.commit()
    test_db.refresh(user)
    return user


@pytest.fixture
def test_character(test_db: Session, test_user: User):
    """テストキャラクター"""
    character = Character(
        id=generate_uuid(),
        user_id=test_user.id,
        name="テストキャラクター",
        description="テスト用",
        appearance="公開情報",
        personality="非公開情報",
    )
    test_db.add(character)
    test_db.commit()
    test_db.refresh(character)
    return character


@pytest.fixture
def quest_service(test_db: Session):
    """QuestServiceインスタンス"""
    with patch('app.services.quest_service.GMAIService'), \
         patch('app.services.quest_service.LogFragmentService'):
        return QuestService(test_db)


def test_create_quest(quest_service: QuestService, test_character: Character):
    """クエスト作成のテスト"""
    quest = quest_service.create_quest(
        character_id=test_character.id,
        title="テストクエスト",
        description="テストクエストの説明",
        origin=QuestOrigin.GM_PROPOSED,
        session_id="test-session",
        context_summary="コンテキスト",
    )

    assert quest.title == "テストクエスト"
    assert quest.description == "テストクエストの説明"
    assert quest.character_id == test_character.id
    assert quest.status == QuestStatus.PROPOSED  # デフォルトはPROPOSED
    assert quest.origin == QuestOrigin.GM_PROPOSED


def test_accept_quest(quest_service: QuestService, test_character: Character, test_db: Session):
    """クエスト受諾のテスト"""
    # 提案されたクエストを作成
    quest = Quest(
        id=generate_uuid(),
        character_id=test_character.id,
        title="受諾テストクエスト",
        description="受諾テスト",
        status=QuestStatus.PROPOSED,
        origin=QuestOrigin.GM_PROPOSED,
    )
    test_db.add(quest)
    test_db.commit()

    # 受諾
    accepted_quest = quest_service.accept_quest(quest.id)

    assert accepted_quest is not None
    assert accepted_quest.status == QuestStatus.ACTIVE
    assert accepted_quest.started_at is not None


def test_accept_quest_not_found(quest_service: QuestService):
    """存在しないクエストの受諾テスト"""
    result = quest_service.accept_quest("non-existent-id")
    assert result is None


def test_accept_quest_already_active(quest_service: QuestService, test_character: Character, test_db: Session):
    """既にアクティブなクエストの受諾テスト"""
    # 既にアクティブなクエストを作成
    quest = Quest(
        id=generate_uuid(),
        character_id=test_character.id,
        title="アクティブクエスト",
        description="既にアクティブ",
        status=QuestStatus.ACTIVE,
        origin=QuestOrigin.GM_PROPOSED,
        started_at=datetime.now(UTC),
    )
    test_db.add(quest)
    test_db.commit()

    # 受諾を試みる
    result = quest_service.accept_quest(quest.id)

    # 既にアクティブなのでNoneが返される（accept_questはPROPOSEDのみ受け付ける）
    assert result is None


@pytest.mark.asyncio
async def test_update_quest_progress(quest_service: QuestService, test_character: Character, test_db: Session):
    """クエスト進行更新のテスト"""
    # アクティブなクエストを作成
    quest = Quest(
        id=generate_uuid(),
        character_id=test_character.id,
        title="進行テストクエスト",
        description="進行テスト",
        status=QuestStatus.ACTIVE,
        origin=QuestOrigin.GM_PROPOSED,
        started_at=datetime.now(UTC),
    )
    test_db.add(quest)

    # アクションログを作成
    action = ActionLog(
        id=generate_uuid(),
        character_id=test_character.id,
        session_id="test-session",
        action_type="explore",
        action_content="古い宝箱を発見した",
        response_content="錆びた宝箱を見つけました",
    )
    test_db.add(action)
    test_db.commit()

    # GMサービスのモック設定
    mock_progress = {
        "progress_percentage": 50.0,
        "narrative_completeness": 0.5,
        "emotional_satisfaction": 0.6,
        "status": "progressing",
        "summary": "宝箱を見つけました"
    }
    quest_service.gm_ai_service.generate_ai_response = AsyncMock(return_value=json.dumps(mock_progress))

    # 進行更新
    updated_quest = await quest_service.update_quest_progress(quest.id, test_character.id, action)

    assert updated_quest is not None
    assert updated_quest.status == QuestStatus.PROGRESSING
    assert updated_quest.progress_percentage == 50.0


@pytest.mark.asyncio
async def test_complete_quest(quest_service: QuestService, test_character: Character, test_db: Session):
    """クエスト完了のテスト"""
    # 全目標達成済みのクエストを作成
    quest = Quest(
        id=generate_uuid(),
        character_id=test_character.id,
        title="完了テストクエスト",
        description="完了テスト",
        status=QuestStatus.PROGRESSING,
        origin=QuestOrigin.GM_PROPOSED,
        started_at=datetime.now(UTC),
        progress_percentage=100.0,
    )
    test_db.add(quest)
    test_db.commit()

    # モック設定
    quest_service.log_fragment_service.generate_quest_memory = AsyncMock()
    quest_service.gm_ai_service.generate_ai_response = AsyncMock(
        return_value=json.dumps({
            "main_theme": "宝探し",
            "story_summary": "テストクエストを完了しました",
            "emotional_keywords": ["達成感"],
            "uniqueness_score": 0.7,
            "difficulty_score": 0.5
        })
    )

    # statusを手動で設定（_complete_questはstatusを変更しない）
    quest.status = QuestStatus.COMPLETED

    # _complete_questメソッドを呼び出し
    await quest_service._complete_quest(quest)

    # 確認
    test_db.refresh(quest)
    assert quest.status == QuestStatus.COMPLETED
    assert quest.completed_at is not None
    quest_service.log_fragment_service.generate_quest_memory.assert_called_once()


def test_get_character_quests(quest_service: QuestService, test_character: Character, test_db: Session):
    """キャラクターのクエスト一覧取得のテスト"""
    # 複数のクエストを作成
    quests = []
    for i, status in enumerate([QuestStatus.ACTIVE, QuestStatus.PROGRESSING, QuestStatus.COMPLETED]):
        quest = Quest(
            id=generate_uuid(),
            character_id=test_character.id,
            title=f"クエスト{i+1}",
            description=f"説明{i+1}",
            status=status,
            origin=QuestOrigin.GM_PROPOSED,
        )
        quests.append(quest)
        test_db.add(quest)
    test_db.commit()

    # 全クエスト取得
    all_quests = quest_service.get_character_quests(test_character.id)
    assert len(all_quests) == 3

    # アクティブなクエストのみ取得
    active_quests = quest_service.get_character_quests(
        test_character.id,
        status=QuestStatus.ACTIVE
    )
    assert len(active_quests) == 1

    # 進行中クエスト取得
    progressing_quests = quest_service.get_character_quests(
        test_character.id,
        status=QuestStatus.PROGRESSING
    )
    assert len(progressing_quests) == 1

    # 完了済みクエスト取得
    completed_quests = quest_service.get_character_quests(
        test_character.id,
        status=QuestStatus.COMPLETED
    )
    assert len(completed_quests) == 1


@pytest.mark.asyncio
async def test_analyze_and_propose_quests(quest_service: QuestService, test_character: Character, test_db: Session):
    """クエスト分析・提案のテスト"""
    # アクションログを作成
    for i in range(3):
        action = ActionLog(
            id=generate_uuid(),
            character_id=test_character.id,
            session_id="test-session",
            action_type="explore",
            action_content=f"行動{i+1}",
            response_content=f"結果{i+1}",
        )
        test_db.add(action)
    test_db.commit()

    # モック設定
    mock_proposals = [
        {
            "title": "提案クエスト1",
            "description": "説明1",
            "difficulty_estimate": 0.3,
            "relevance_score": 0.8,
            "reasoning": "理由",
            "suggested_rewards": ["報酬"],
        }
    ]
    quest_service.gm_ai_service.generate_ai_response = AsyncMock(
        return_value=json.dumps(mock_proposals)
    )

    # 分析と提案
    proposals = await quest_service.analyze_and_propose_quests(
        test_character.id, "test-session"
    )

    assert len(proposals) == 1
    assert proposals[0].title == "提案クエスト1"


@pytest.mark.asyncio
async def test_infer_implicit_quest(quest_service: QuestService, test_character: Character, test_db: Session):
    """暗黙的クエスト推論のテスト"""
    # 最近のアクションログを作成
    actions = []
    for i in range(5):
        action = ActionLog(
            id=generate_uuid(),
            character_id=test_character.id,
            session_id="test-session",
            action_type="collect",
            action_content=f"アイテム{i+1}を収集",
            response_content=f"アイテム{i+1}を入手しました",
        )
        actions.append(action)
        test_db.add(action)
    test_db.commit()

    # モック設定
    mock_quest_data = {
        "title": "収集家の道",
        "description": "様々なアイテムを集める",
        "confidence": 0.8
    }
    quest_service.gm_ai_service.generate_ai_response = AsyncMock(
        return_value=json.dumps(mock_quest_data)
    )

    # 推論
    quest = await quest_service.infer_implicit_quest(
        test_character.id, "test-session"
    )

    assert quest is not None
    assert quest.title == "収集家の道"
    assert quest.origin == QuestOrigin.BEHAVIOR_INFERRED
    assert quest.status == QuestStatus.ACTIVE
