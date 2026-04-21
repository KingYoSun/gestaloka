"""
SPシステムAPIのテスト
"""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models.sp import SPTransactionType
from app.models.user import User as UserModel
from app.services.sp_service import SPService


class TestSPEndpoints:
    """SPエンドポイントのテストクラス"""

    @pytest.fixture
    def mock_auth(self, client: TestClient, session: Session):
        """認証のモック設定"""
        from app.api.deps import get_current_user

        def get_test_user():
            # テスト用ユーザーを返す
            statement = select(UserModel).where(UserModel.username == "sp_testuser")
            result = session.exec(statement)
            user = result.first()
            if not user:
                user = UserModel(
                    id="test-user-sp",
                    username="sp_testuser",
                    email="sp_test@example.com",
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
        statement = select(UserModel).where(UserModel.username == "sp_testuser")
        result = session.exec(statement)
        user_model = result.first()

        if not user_model:
            # ユーザーが存在しない場合は作成
            user_model = UserModel(
                id="test-user-sp",
                username="sp_testuser",
                email="sp_test@example.com",
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

    @pytest.mark.asyncio
    async def test_get_sp_balance(
        self,
        client: TestClient,
        test_user: UserModel,
        auth_headers: dict[str, str],
        session: Session,
        mock_auth,
    ) -> None:
        """SP残高取得のテスト"""
        # SPサービスを使って初期残高を作成
        service = SPService(session)
        await service.get_or_create_player_sp(test_user.id)

        # API呼び出し
        response = client.get(
            "/api/v1/sp/balance",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["user_id"] == test_user.id
        assert data["current_sp"] >= 50  # 初期ボーナス
        assert "total_earned_sp" in data
        assert "total_consumed_sp" in data

    @pytest.mark.asyncio
    async def test_get_sp_balance_summary(
        self,
        client: TestClient,
        test_user: UserModel,
        auth_headers: dict[str, str],
        session: Session,
        mock_auth,
    ) -> None:
        """SP残高概要取得のテスト"""
        # SPサービスを使って初期残高を作成
        service = SPService(session)
        await service.get_or_create_player_sp(test_user.id)

        # API呼び出し
        response = client.get(
            "/api/v1/sp/balance/summary",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert "current_sp" in data
        assert data["current_sp"] >= 50  # 初期ボーナス
        assert "active_subscription" in data
        assert "subscription_expires_at" in data

    @pytest.mark.asyncio
    async def test_consume_sp_success(
        self,
        client: TestClient,
        test_user: UserModel,
        auth_headers: dict[str, str],
        session: Session,
        mock_auth,
    ) -> None:
        """SP消費成功のテスト"""
        # SPサービスを使って初期残高を作成
        service = SPService(session)
        await service.get_or_create_player_sp(test_user.id)

        # SP消費リクエスト
        consume_request = {
            "amount": 10,
            "transaction_type": SPTransactionType.FREE_ACTION.value,
            "description": "テスト自由行動",
            "metadata": {"test": "value"},
        }

        # API呼び出し
        response = client.post(
            "/api/v1/sp/consume",
            json=consume_request,
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["balance_before"] >= 50
        assert data["balance_after"] == data["balance_before"] - 10
        assert "transaction_id" in data

    @pytest.mark.asyncio
    async def test_consume_sp_insufficient_balance(
        self,
        client: TestClient,
        test_user: UserModel,
        auth_headers: dict[str, str],
        session: Session,
        mock_auth,
    ) -> None:
        """SP残高不足のテスト"""
        # SPサービスを使って初期残高を作成
        service = SPService(session)
        await service.get_or_create_player_sp(test_user.id)

        # 大量のSPを消費しようとする
        consume_request = {
            "amount": 10000,
            "transaction_type": SPTransactionType.FREE_ACTION.value,
            "description": "テスト大量消費",
        }

        # API呼び出し
        response = client.post(
            "/api/v1/sp/consume",
            json=consume_request,
            headers=auth_headers,
        )
        assert response.status_code == 400
        data = response.json()
        assert "message" in data
        assert "不足" in data["message"]

    @pytest.mark.asyncio
    async def test_daily_recovery(
        self,
        client: TestClient,
        test_user: UserModel,
        auth_headers: dict[str, str],
        session: Session,
        mock_auth,
    ) -> None:
        """日次回復のテスト"""
        # SPサービスを使って初期残高を作成
        service = SPService(session)
        await service.get_or_create_player_sp(test_user.id)

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
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["recovered_amount"] > 0
        assert data["balance_after"] > 0

        # 再度回復しようとすると失敗
        response = client.post(
            "/api/v1/sp/daily-recovery",
            headers=auth_headers,
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_get_transaction_history(
        self,
        client: TestClient,
        test_user: UserModel,
        auth_headers: dict[str, str],
        session: Session,
        mock_auth,
    ) -> None:
        """取引履歴取得のテスト"""
        # SPサービスを使って初期残高を作成
        service = SPService(session)
        await service.get_or_create_player_sp(test_user.id)

        # いくつか取引を作成
        await service.consume_sp(
            test_user.id,
            amount=10,
            transaction_type=SPTransactionType.FREE_ACTION,
            description="テスト1",
        )
        await service.consume_sp(
            test_user.id,
            amount=20,
            transaction_type=SPTransactionType.LOG_DISPATCH,
            description="テスト2",
        )

        # API呼び出し
        response = client.get(
            "/api/v1/sp/transactions",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 3  # 初期ボーナス + 2取引

        # 最新の取引から順に返される
        assert data[0]["amount"] == -20
        assert data[1]["amount"] == -10

    @pytest.mark.asyncio
    async def test_get_transaction_detail(
        self,
        client: TestClient,
        test_user: UserModel,
        auth_headers: dict[str, str],
        session: Session,
        mock_auth,
    ) -> None:
        """取引詳細取得のテスト"""
        # SPサービスを使って初期残高を作成
        service = SPService(session)
        await service.get_or_create_player_sp(test_user.id)

        # 取引を作成
        result = await service.consume_sp(
            test_user.id,
            amount=15,
            transaction_type=SPTransactionType.FREE_ACTION,
            description="詳細テスト",
            metadata={"test": "value"},
        )

        # API呼び出し
        response = client.get(
            f"/api/v1/sp/transactions/{result.id}",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == result.id
        assert data["amount"] == -15
        assert data["description"] == "詳細テスト"
        assert data["transaction_metadata"]["test"] == "value"

        # 他のユーザーの取引は取得できない
        response = client.get(
            "/api/v1/sp/transactions/invalid-id",
            headers=auth_headers,
        )
        assert response.status_code == 404
