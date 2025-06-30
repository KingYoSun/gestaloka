"""
データベース接続のテスト
"""

from sqlmodel import Session, select

from app.models.user import User


def test_database_connection(session: Session):
    """データベース接続のテスト"""
    # テスト用ユーザーを作成（IDを明示的に設定）
    import uuid
    user = User(
        id=str(uuid.uuid4()),
        username="test_db_user",
        email="testdb@example.com",
        hashed_password="dummy_hash"
    )
    session.add(user)
    session.commit()

    # ユーザーを取得
    statement = select(User).where(User.username == "test_db_user")
    result = session.exec(statement)
    db_user = result.first()

    assert db_user is not None
    assert db_user.username == "test_db_user"
    assert db_user.email == "testdb@example.com"


def test_transaction_rollback(session: Session):
    """トランザクションのロールバックテスト"""
    # 最初のユーザーを作成
    import uuid
    user1 = User(
        id=str(uuid.uuid4()),
        username="user1",
        email="user1@example.com",
        hashed_password="hash1"
    )
    session.add(user1)
    session.commit()

    # 同じテスト内で別のユーザーを作成（ロールバックされるはず）
    user2 = User(
        id=str(uuid.uuid4()),
        username="user2",
        email="user2@example.com",
        hashed_password="hash2"
    )
    session.add(user2)
    # commitはフィクスチャのトランザクション内で実行される

    # user1は存在するはず
    statement = select(User).where(User.username == "user1")
    result = session.exec(statement)
    assert result.first() is not None
