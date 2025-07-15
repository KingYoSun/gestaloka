"""
UserServiceのテスト
"""

import pytest
from sqlmodel import Session, create_engine
from sqlmodel.pool import StaticPool

from app.models.user import User as UserModel
from app.models.user_role import RoleType, UserRole
from app.schemas.user import UserCreate, UserUpdate
from app.services.user_service import UserService
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
def user_service(test_db: Session):
    """UserServiceインスタンス"""
    return UserService(test_db)


@pytest.mark.asyncio
async def test_create_user(user_service: UserService):
    """ユーザー作成のテスト"""
    user_data = UserCreate(
        username="newuser",
        email="newuser@example.com",
        password="Password123!",
    )
    
    user = await user_service.create(user_data)
    
    assert user.username == "newuser"
    assert user.email == "newuser@example.com"
    assert user.is_active is True
    assert "player" in user.roles  # デフォルトロール


@pytest.mark.asyncio
async def test_create_user_duplicate_username(user_service: UserService):
    """重複ユーザー名でのユーザー作成テスト"""
    # 既存ユーザーを作成
    first_user = UserCreate(
        username="existinguser",
        email="existing@example.com",
        password="Password123!",
    )
    await user_service.create(first_user)
    
    # 同じユーザー名で作成を試みる
    user_data = UserCreate(
        username="existinguser",
        email="another@example.com",
        password="Password123!",
    )
    
    # 重複チェックでValueErrorが発生する
    with pytest.raises(ValueError, match="Username 'existinguser' already exists"):
        await user_service.create(user_data)


@pytest.mark.asyncio
async def test_create_user_duplicate_email(user_service: UserService):
    """重複メールアドレスでのユーザー作成テスト"""
    # 既存ユーザーを作成
    first_user = UserCreate(
        username="user1",
        email="existing@example.com",
        password="Password123!",
    )
    await user_service.create(first_user)
    
    # 同じメールアドレスで作成を試みる
    user_data = UserCreate(
        username="user2",
        email="existing@example.com",
        password="Password123!",
    )
    
    # 重複チェックでValueErrorが発生する
    with pytest.raises(ValueError, match="Email 'existing@example.com' already exists"):
        await user_service.create(user_data)


@pytest.mark.asyncio
async def test_get_by_id(user_service: UserService, test_db: Session):
    """IDによるユーザー取得のテスト"""
    # ユーザーを作成
    user = UserModel(
        id=generate_uuid(),
        username="testuser",
        email="test@example.com",
        hashed_password="hashed",
    )
    test_db.add(user)
    
    # ロールを付与
    role = UserRole(
        id=generate_uuid(),
        user_id=user.id,
        role=RoleType.PLAYER,
    )
    test_db.add(role)
    test_db.commit()
    
    # 取得テスト
    result = await user_service.get_by_id(user.id)
    
    assert result is not None
    assert result.id == user.id
    assert result.username == "testuser"
    assert "player" in result.roles


@pytest.mark.asyncio
async def test_get_by_id_not_found(user_service: UserService):
    """存在しないIDでの取得テスト"""
    result = await user_service.get_by_id("non-existent-id")
    assert result is None


@pytest.mark.asyncio
async def test_get_by_username(user_service: UserService, test_db: Session):
    """ユーザー名による取得のテスト"""
    # ユーザーを作成
    user = UserModel(
        id=generate_uuid(),
        username="uniqueuser",
        email="unique@example.com",
        hashed_password="hashed",
    )
    test_db.add(user)
    test_db.commit()
    
    # 取得テスト
    result = await user_service.get_by_username("uniqueuser")
    
    assert result is not None
    assert result.username == "uniqueuser"


@pytest.mark.asyncio
async def test_get_by_email(user_service: UserService, test_db: Session):
    """メールアドレスによる取得のテスト"""
    # ユーザーを作成
    user = UserModel(
        id=generate_uuid(),
        username="emailuser",
        email="emailtest@example.com",
        hashed_password="hashed",
    )
    test_db.add(user)
    test_db.commit()
    
    # 取得テスト
    result = await user_service.get_by_email("emailtest@example.com")
    
    assert result is not None
    assert result.email == "emailtest@example.com"


@pytest.mark.asyncio
async def test_update_user(user_service: UserService, test_db: Session):
    """ユーザー更新のテスト"""
    # ユーザーを作成
    user = UserModel(
        id=generate_uuid(),
        username="oldusername",
        email="old@example.com",
        hashed_password=user_service.get_password_hash("OldPassword123!"),
    )
    test_db.add(user)
    test_db.commit()
    
    # 更新（UserUpdateにはパスワードフィールドがないため、ユーザー名とメールのみ）
    update_data = UserUpdate(
        username="newusername",
        email="new@example.com",
    )
    
    updated = await user_service.update(user.id, update_data)
    
    assert updated is not None
    assert updated.username == "newusername"
    assert updated.email == "new@example.com"


@pytest.mark.asyncio
async def test_update_user_partial(user_service: UserService, test_db: Session):
    """部分的なユーザー更新のテスト"""
    # ユーザーを作成
    user = UserModel(
        id=generate_uuid(),
        username="username",
        email="email@example.com",
        hashed_password="hashed",
    )
    test_db.add(user)
    test_db.commit()
    
    # ユーザー名のみ更新
    update_data = UserUpdate(username="newusername")
    
    updated = await user_service.update(user.id, update_data)
    
    assert updated is not None
    assert updated.username == "newusername"
    assert updated.email == "email@example.com"  # 変更されていない


@pytest.mark.asyncio
async def test_update_user_duplicate_username(user_service: UserService, test_db: Session):
    """重複ユーザー名での更新テスト"""
    # 2人のユーザーを作成
    user1 = UserModel(
        id=generate_uuid(),
        username="user1",
        email="user1@example.com",
        hashed_password="hashed",
    )
    user2 = UserModel(
        id=generate_uuid(),
        username="user2",
        email="user2@example.com",
        hashed_password="hashed",
    )
    test_db.add(user1)
    test_db.add(user2)
    test_db.commit()
    
    # user2のユーザー名をuser1と同じにしようとする
    update_data = UserUpdate(username="user1")
    
    with pytest.raises(ValueError, match="Username 'user1' already exists"):
        await user_service.update(user2.id, update_data)


@pytest.mark.asyncio
async def test_update_user_duplicate_email(user_service: UserService, test_db: Session):
    """重複メールアドレスでの更新テスト"""
    # 2人のユーザーを作成
    user1 = UserModel(
        id=generate_uuid(),
        username="user1",
        email="user1@example.com",
        hashed_password="hashed",
    )
    user2 = UserModel(
        id=generate_uuid(),
        username="user2",
        email="user2@example.com",
        hashed_password="hashed",
    )
    test_db.add(user1)
    test_db.add(user2)
    test_db.commit()
    
    # user2のメールアドレスをuser1と同じにしようとする
    update_data = UserUpdate(email="user1@example.com")
    
    with pytest.raises(ValueError, match="Email 'user1@example.com' already exists"):
        await user_service.update(user2.id, update_data)


@pytest.mark.asyncio
async def test_delete_user(user_service: UserService, test_db: Session):
    """ユーザー削除のテスト"""
    # ユーザーを作成
    user = UserModel(
        id=generate_uuid(),
        username="deleteuser",
        email="delete@example.com",
        hashed_password="hashed",
        is_active=True,
    )
    test_db.add(user)
    test_db.commit()
    
    # 削除
    result = await user_service.delete(user.id)
    
    assert result is True
    
    # 削除確認
    test_db.refresh(user)
    assert user.is_active is False


@pytest.mark.asyncio
async def test_delete_user_not_found(user_service: UserService):
    """存在しないユーザーの削除テスト"""
    result = await user_service.delete("non-existent-id")
    assert result is False


def test_verify_password(user_service: UserService):
    """パスワード検証のテスト"""
    password = "TestPassword123!"
    hashed = user_service.get_password_hash(password)
    
    # 正しいパスワード
    assert user_service.verify_password(password, hashed) is True
    
    # 間違ったパスワード
    assert user_service.verify_password("WrongPassword123!", hashed) is False


def test_get_password_hash(user_service: UserService):
    """パスワードハッシュ化のテスト"""
    password = "TestPassword123!"
    hash1 = user_service.get_password_hash(password)
    hash2 = user_service.get_password_hash(password)
    
    # 同じパスワードでも異なるハッシュが生成される
    assert hash1 != hash2
    
    # どちらのハッシュも元のパスワードで検証できる
    assert user_service.verify_password(password, hash1) is True
    assert user_service.verify_password(password, hash2) is True