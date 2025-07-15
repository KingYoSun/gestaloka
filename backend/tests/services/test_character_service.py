"""
CharacterServiceのテスト
"""

import pytest
from sqlmodel import Session, create_engine
from sqlmodel.pool import StaticPool

from app.models.character import Character as CharacterModel, CharacterStats
from app.models.user import User
from app.schemas.character import CharacterCreate, CharacterUpdate
from app.services.character_service import CharacterService
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
def character_service(test_db: Session):
    """CharacterServiceインスタンス"""
    return CharacterService(test_db)


@pytest.mark.asyncio
async def test_create_character(character_service: CharacterService, test_user: User):
    """キャラクター作成のテスト"""
    character_data = CharacterCreate(
        name="テストキャラクター",
        description="テスト用のキャラクターです",
        appearance="黒髪で背が高い",
        personality="優しく穏やか",
    )
    
    character = await character_service.create(test_user.id, character_data)
    
    assert character.name == "テストキャラクター"
    assert character.description == "テスト用のキャラクターです"
    assert character.user_id == test_user.id
    assert character.is_active is True


@pytest.mark.asyncio
async def test_get_by_id(character_service: CharacterService, test_user: User, test_db: Session):
    """IDによるキャラクター取得のテスト"""
    # キャラクターを作成
    character = CharacterModel(
        id=generate_uuid(),
        user_id=test_user.id,
        name="テストキャラクター",
        description="テスト",
        appearance="外見",
        personality="性格",
    )
    stats = CharacterStats(
        id=generate_uuid(),
        character_id=character.id,
        level=1,
        experience=0,
        health=100,
        max_health=100,
        mp=100,
        max_mp=100,
        attack=10,
        defense=5,
        agility=10,
    )
    test_db.add(character)
    test_db.add(stats)
    test_db.commit()
    
    # 取得テスト
    result = await character_service.get_by_id(character.id)
    
    assert result is not None
    assert result.id == character.id
    assert result.name == "テストキャラクター"


@pytest.mark.asyncio
async def test_get_by_id_not_found(character_service: CharacterService):
    """存在しないIDでの取得テスト"""
    result = await character_service.get_by_id("non-existent-id")
    assert result is None


@pytest.mark.asyncio
async def test_get_by_user(character_service: CharacterService, test_user: User, test_db: Session):
    """ユーザーのキャラクター一覧取得のテスト"""
    # 複数のキャラクターを作成
    for i in range(3):
        character = CharacterModel(
            id=generate_uuid(),
            user_id=test_user.id,
            name=f"キャラクター{i+1}",
            description=f"テスト{i+1}",
            appearance="公開",
            personality="非公開",
            is_active=True,
        )
        stats = CharacterStats(
            id=generate_uuid(),
            character_id=character.id,
            contamination_level=0,
            mental_corruption=0,
            insight_level=0,
            physical_condition=100,
            cognitive_integrity=100,
        )
        test_db.add(character)
        test_db.add(stats)
    
    # 削除済みキャラクターも作成
    deleted_character = CharacterModel(
        id=generate_uuid(),
        user_id=test_user.id,
        name="削除済みキャラクター",
        description="削除済み",
        appearance="外見",
        personality="性格",
        is_active=False,
    )
    deleted_stats = CharacterStats(
        id=generate_uuid(),
        character_id=deleted_character.id,
        contamination_level=0,
        mental_corruption=0,
        insight_level=0,
        physical_condition=100,
        cognitive_integrity=100,
    )
    test_db.add(deleted_character)
    test_db.add(deleted_stats)
    test_db.commit()
    
    # 取得テスト
    characters = await character_service.get_by_user(test_user.id)
    
    assert len(characters) == 3  # アクティブなキャラクターのみ
    assert all(c.is_active for c in characters)
    assert all(c.user_id == test_user.id for c in characters)


@pytest.mark.asyncio
async def test_get_by_user_empty(character_service: CharacterService, test_user: User):
    """キャラクターがいないユーザーのテスト"""
    characters = await character_service.get_by_user(test_user.id)
    assert characters == []


@pytest.mark.asyncio
async def test_update_character(character_service: CharacterService, test_user: User, test_db: Session):
    """キャラクター更新のテスト"""
    # キャラクターを作成
    character = CharacterModel(
        id=generate_uuid(),
        user_id=test_user.id,
        name="元の名前",
        description="元の紹介",
        appearance="元の外見",
        personality="元の性格",
    )
    stats = CharacterStats(
        id=generate_uuid(),
        character_id=character.id,
        level=1,
        experience=0,
        health=100,
        max_health=100,
        mp=100,
        max_mp=100,
        attack=10,
        defense=5,
        agility=10,
    )
    test_db.add(character)
    test_db.add(stats)
    test_db.commit()
    
    # 更新
    update_data = CharacterUpdate(
        name="新しい名前",
        description="新しい紹介",
    )
    
    updated = await character_service.update(character.id, update_data)
    
    assert updated is not None
    assert updated.name == "新しい名前"
    assert updated.description == "新しい紹介"
    assert updated.appearance == "元の外見"  # 更新されていない
    assert updated.personality == "元の性格"  # 更新されていない


@pytest.mark.asyncio
async def test_delete_character(character_service: CharacterService, test_user: User, test_db: Session):
    """キャラクター削除のテスト"""
    # キャラクターを作成
    character = CharacterModel(
        id=generate_uuid(),
        user_id=test_user.id,
        name="削除対象",
        description="削除される",
        appearance="外見",
        personality="性格",
        is_active=True,
    )
    stats = CharacterStats(
        id=generate_uuid(),
        character_id=character.id,
        level=1,
        experience=0,
        health=100,
        max_health=100,
        mp=100,
        max_mp=100,
        attack=10,
        defense=5,
        agility=10,
    )
    test_db.add(character)
    test_db.add(stats)
    test_db.commit()
    
    # 削除
    result = await character_service.delete(character.id)
    
    assert result is True
    
    # 削除確認
    test_db.refresh(character)
    assert character.is_active is False


@pytest.mark.asyncio
async def test_clear_active_character(character_service: CharacterService, test_user: User):
    """アクティブキャラクタークリアのテスト"""
    # 現在の実装では何もしないメソッドなので、エラーが発生しないことだけを確認
    await character_service.clear_active_character(test_user.id)
    # エラーが発生しなければ成功