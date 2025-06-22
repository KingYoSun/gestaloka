"""
SPシステムAPIのテスト
"""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models.sp import SPTransactionType
from app.models.user import User
from app.services.sp_service import SPService


@pytest.mark.asyncio
async def test_get_sp_balance(
    client: TestClient,
    test_user: User,
    get_user_auth_headers: dict[str, str],
    db: Session,
) -> None:
    """SP残高取得のテスト"""
    # SPサービスを使って初期残高を作成
    service = SPService(db)
    await service.get_or_create_player_sp(test_user.id)

    # API呼び出し
    response = client.get(
        "/api/v1/sp/balance",
        headers=get_user_auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["user_id"] == test_user.id
    assert data["current_sp"] >= 50  # 初期ボーナス
    assert "total_earned_sp" in data
    assert "total_consumed_sp" in data


@pytest.mark.asyncio
async def test_get_sp_balance_summary(
    client: TestClient,
    test_user: User,
    get_user_auth_headers: dict[str, str],
    db: Session,
) -> None:
    """SP残高概要取得のテスト"""
    # SPサービスを使って初期残高を作成
    service = SPService(db)
    await service.get_or_create_player_sp(test_user.id)

    # API呼び出し
    response = client.get(
        "/api/v1/sp/balance/summary",
        headers=get_user_auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert "current_sp" in data
    assert data["current_sp"] >= 50  # 初期ボーナス
    assert "active_subscription" in data
    assert "subscription_expires_at" in data


@pytest.mark.asyncio
async def test_consume_sp_success(
    client: TestClient,
    test_user: User,
    get_user_auth_headers: dict[str, str],
    db: Session,
) -> None:
    """SP消費成功のテスト"""
    # SPサービスを使って初期残高を作成
    service = SPService(db)
    await service.get_or_create_player_sp(test_user.id)

    # SP消費リクエスト
    consume_request = {
        "amount": 10,
        "transaction_type": SPTransactionType.FREE_ACTION.value,
        "description": "テスト自由行動",
        "metadata": {"action": "test"},
    }

    response = client.post(
        "/api/v1/sp/consume",
        headers=get_user_auth_headers,
        json=consume_request,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["balance_before"] == 50  # 初期ボーナス
    assert data["balance_after"] == 40  # 50 - 10
    assert "transaction_id" in data
    assert data["message"] == "SP 10 を消費しました"


@pytest.mark.asyncio
async def test_consume_sp_insufficient_balance(
    client: TestClient,
    test_user: User,
    get_user_auth_headers: dict[str, str],
    db: Session,
) -> None:
    """SP残高不足時のテスト"""
    # SPサービスを使って初期残高を作成
    service = SPService(db)
    await service.get_or_create_player_sp(test_user.id)

    # 残高以上の消費を試みる
    consume_request = {
        "amount": 100,  # 初期残高50より多い
        "transaction_type": SPTransactionType.LOG_DISPATCH.value,
        "description": "高額ログ派遣",
    }

    response = client.post(
        "/api/v1/sp/consume",
        headers=get_user_auth_headers,
        json=consume_request,
    )
    assert response.status_code == 400
    data = response.json()
    assert "SP残高が不足しています" in data["detail"]


@pytest.mark.asyncio
async def test_daily_recovery(
    client: TestClient,
    test_user: User,
    get_user_auth_headers: dict[str, str],
    db: Session,
) -> None:
    """日次回復のテスト"""
    # SPサービスを使って初期残高を作成
    service = SPService(db)
    player_sp = await service.get_or_create_player_sp(test_user.id)

    # 一部消費
    await service.consume_sp(
        test_user.id,
        amount=30,
        transaction_type=SPTransactionType.FREE_ACTION,
        description="消費テスト",
    )

    # 日次回復
    response = client.post(
        "/api/v1/sp/daily-recovery",
        headers=get_user_auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["recovered_amount"] == 10  # 基本回復量
    assert data["balance_after"] == 30  # 20 + 10

    # 同日に再度回復を試みる
    response = client.post(
        "/api/v1/sp/daily-recovery",
        headers=get_user_auth_headers,
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_get_transaction_history(
    client: TestClient,
    test_user: User,
    get_user_auth_headers: dict[str, str],
    db: Session,
) -> None:
    """取引履歴取得のテスト"""
    # SPサービスを使って初期残高を作成
    service = SPService(db)
    await service.get_or_create_player_sp(test_user.id)

    # いくつかの取引を作成
    await service.consume_sp(
        test_user.id,
        amount=5,
        transaction_type=SPTransactionType.FREE_ACTION,
        description="テスト行動1",
    )
    await service.consume_sp(
        test_user.id,
        amount=10,
        transaction_type=SPTransactionType.FREE_ACTION,
        description="テスト行動2",
    )

    # 取引履歴取得
    response = client.get(
        "/api/v1/sp/transactions",
        headers=get_user_auth_headers,
        params={"limit": 10},
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 3  # 初期ボーナス + 2つの消費
    
    # 最新の取引を確認
    latest = data[0]
    assert latest["amount"] == -10  # 最後の消費
    assert latest["transaction_type"] == SPTransactionType.FREE_ACTION.value


@pytest.mark.asyncio
async def test_get_transaction_detail(
    client: TestClient,
    test_user: User,
    get_user_auth_headers: dict[str, str],
    db: Session,
) -> None:
    """取引詳細取得のテスト"""
    # SPサービスを使って初期残高を作成
    service = SPService(db)
    await service.get_or_create_player_sp(test_user.id)

    # 取引を作成
    transaction = await service.consume_sp(
        test_user.id,
        amount=5,
        transaction_type=SPTransactionType.FREE_ACTION,
        description="詳細確認用テスト",
        metadata={"test": "value"},
    )

    # 取引詳細取得
    response = client.get(
        f"/api/v1/sp/transactions/{transaction.id}",
        headers=get_user_auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == transaction.id
    assert data["amount"] == -5
    assert data["description"] == "詳細確認用テスト"
    assert data["transaction_metadata"]["test"] == "value"

    # 他のユーザーの取引は取得できない
    response = client.get(
        "/api/v1/sp/transactions/invalid-id",
        headers=get_user_auth_headers,
    )
    assert response.status_code == 404