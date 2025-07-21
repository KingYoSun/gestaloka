"""SPServiceのテストクラス"""

import uuid
from datetime import UTC, datetime
from unittest.mock import Mock, patch

import pytest
from sqlmodel import Session

from app.core.exceptions import InsufficientSPError, SPSystemError
from app.models.sp import PlayerSP, SPTransaction, SPTransactionType
from app.services.sp_service import SPService


class TestSPService:
    """SPServiceのテストクラス"""

    @pytest.fixture
    def mock_session(self):
        """モックデータベースセッション"""
        return Mock(spec=Session)

    @pytest.fixture
    def service(self, mock_session):
        """SPServiceインスタンス"""
        return SPService(mock_session)

    @pytest.fixture
    def mock_player_sp(self):
        """モックPlayerSP"""
        player_sp = Mock(spec=PlayerSP)
        player_sp.id = str(uuid.uuid4())
        player_sp.user_id = "test-user-id"
        player_sp.current_sp = 100
        player_sp.total_earned = 500
        player_sp.total_consumed = 400
        player_sp.subscription_type = None
        player_sp.last_recovery_at = datetime.now(UTC)
        player_sp.last_login_at = datetime.now(UTC)
        player_sp.consecutive_login_days = 5
        return player_sp

    @pytest.mark.asyncio
    async def test_get_or_create_player_sp_existing(self, service, mock_player_sp):
        """既存のPlayerSP取得のテスト"""
        user_id = "test-user-id"

        # モック設定
        with patch.object(service, "_get_or_create_player_sp_logic", return_value=(mock_player_sp, False)):
            # 実行
            result = await service.get_or_create_player_sp(user_id)

            # 検証
            assert result == mock_player_sp
            service.db.commit.assert_not_called()  # 既存の場合はコミットしない

    @pytest.mark.asyncio
    async def test_get_or_create_player_sp_new(self, service, mock_player_sp):
        """新規PlayerSP作成のテスト"""
        user_id = "test-user-id"

        # モック設定
        with patch.object(service, "_get_or_create_player_sp_logic", return_value=(mock_player_sp, True)):
            # 実行
            result = await service.get_or_create_player_sp(user_id)

            # 検証
            assert result == mock_player_sp
            service.db.commit.assert_called_once()  # 新規作成の場合はコミット

    @pytest.mark.asyncio
    async def test_get_or_create_player_sp_error(self, service):
        """PlayerSP取得時のエラーハンドリング"""
        user_id = "test-user-id"

        # モック設定
        with patch.object(service, "_get_or_create_player_sp_logic", side_effect=Exception("DB Error")):
            # 実行と検証
            with pytest.raises(SPSystemError, match="SP残高の取得に失敗しました"):
                await service.get_or_create_player_sp(user_id)

    @pytest.mark.asyncio
    async def test_get_balance(self, service, mock_player_sp):
        """SP残高取得のテスト"""
        user_id = "test-user-id"

        # モック設定
        with patch.object(service, "get_or_create_player_sp", return_value=mock_player_sp):
            # 実行
            result = await service.get_balance(user_id)

            # 検証
            assert result == mock_player_sp
            service.get_or_create_player_sp.assert_called_once_with(user_id)

    @pytest.mark.asyncio
    async def test_consume_sp_success(self, service, mock_player_sp):
        """SP消費成功のテスト"""
        user_id = "test-user-id"
        amount = 50
        transaction_type = SPTransactionType.FREE_ACTION
        description = "アクション実行"

        # モックトランザクション
        mock_transaction = Mock(spec=SPTransaction)
        mock_result = {
            "final_amount": 50,
            "balance_before": 100,
            "metadata": {"discount_rate": 0}
        }

        # モック設定
        with patch.object(service, "get_or_create_player_sp", return_value=mock_player_sp):
            with patch.object(service, "_consume_sp_logic", return_value=(mock_transaction, mock_result)):
                with patch.object(service, "_save_transaction") as mock_save:
                    with patch("app.services.sp_service.SPEventEmitter.emit_sp_update") as mock_emit:
                        # 実行
                        result = await service.consume_sp(
                            user_id=user_id,
                            amount=amount,
                            transaction_type=transaction_type,
                            description=description
                        )

                        # 検証
                        assert result == mock_transaction
                        mock_save.assert_called_once_with(mock_transaction)
                        service.db.commit.assert_called_once()
                        mock_emit.assert_called_once()

    @pytest.mark.asyncio
    async def test_consume_sp_insufficient_balance(self, service, mock_player_sp):
        """SP不足時のテスト"""
        user_id = "test-user-id"
        amount = 150  # 残高を超える量
        transaction_type = SPTransactionType.FREE_ACTION
        description = "アクション実行"

        # モック設定
        with patch.object(service, "get_or_create_player_sp", return_value=mock_player_sp):
            with patch.object(service, "_consume_sp_logic", side_effect=InsufficientSPError("SP不足")):
                # 実行と検証
                with pytest.raises(InsufficientSPError):
                    await service.consume_sp(
                        user_id=user_id,
                        amount=amount,
                        transaction_type=transaction_type,
                        description=description
                    )

    @pytest.mark.asyncio
    async def test_add_sp_success(self, service, mock_player_sp):
        """SP追加成功のテスト"""
        user_id = "test-user-id"
        amount = 100
        transaction_type = SPTransactionType.PURCHASE
        description = "SP購入"

        # モックトランザクション
        mock_transaction = Mock(spec=SPTransaction)
        balance_before = 100

        # モック設定
        with patch.object(service, "get_or_create_player_sp", return_value=mock_player_sp):
            with patch.object(service, "_add_sp_logic", return_value=(mock_transaction, balance_before)):
                with patch.object(service, "_save_transaction") as mock_save:
                    with patch("app.services.sp_service.SPEventEmitter.emit_sp_update") as mock_emit:
                        # 実行
                        result = await service.add_sp(
                            user_id=user_id,
                            amount=amount,
                            transaction_type=transaction_type,
                            description=description
                        )

                        # 検証
                        assert result == mock_transaction
                        mock_save.assert_called_once_with(mock_transaction)
                        service.db.commit.assert_called_once()
                        mock_emit.assert_called_once()

    @pytest.mark.asyncio
    async def test_add_sp_error(self, service):
        """SP追加時のエラーハンドリング"""
        user_id = "test-user-id"
        amount = 100
        transaction_type = SPTransactionType.PURCHASE
        description = "SP購入"

        # モック設定
        with patch.object(service, "get_or_create_player_sp", side_effect=Exception("DB Error")):
            # 実行と検証
            with pytest.raises(SPSystemError, match="SP追加処理に失敗しました"):
                await service.add_sp(
                    user_id=user_id,
                    amount=amount,
                    transaction_type=transaction_type,
                    description=description
                )

    @pytest.mark.asyncio
    async def test_process_daily_recovery_success(self, service, mock_player_sp):
        """デイリー回復成功のテスト"""
        user_id = "test-user-id"

        # モック結果
        mock_result = {
            "success": True,
            "total_amount": 25,
            "recovered_amount": 10,
            "subscription_bonus": 0,
            "login_bonus": 15,
            "consecutive_days": 6,
            "balance_before": 100,
            "balance_after": 125,
            "already_recovered": False
        }

        # モック設定
        with patch.object(service, "get_or_create_player_sp", return_value=mock_player_sp):
            with patch.object(service, "_process_daily_recovery_logic", return_value=mock_result):
                with patch.object(service, "_create_transaction_data") as mock_create:
                    mock_transaction = Mock(spec=SPTransaction)
                    mock_create.return_value = mock_transaction

                    with patch.object(service, "_save_transaction"):
                        with patch("app.services.sp_service.SPEventEmitter.emit_daily_recovery_completed"):
                            # 実行
                            result = await service.process_daily_recovery(user_id)

                            # 検証
                            assert result["success"] is True
                            assert result["total_amount"] == 25
                            assert result["login_bonus"] == 15
                            assert result["consecutive_days"] == 6
                            service.db.commit.assert_called()

    @pytest.mark.asyncio
    async def test_process_daily_recovery_already_recovered(self, service, mock_player_sp):
        """既に回復済みの場合のテスト"""
        user_id = "test-user-id"

        # モック結果
        mock_result = {
            "success": False,
            "already_recovered": True,
            "total_amount": 0
        }

        # モック設定
        with patch.object(service, "get_or_create_player_sp", return_value=mock_player_sp):
            with patch.object(service, "_process_daily_recovery_logic", return_value=mock_result):
                # 実行
                result = await service.process_daily_recovery(user_id)

                # 検証
                assert result["success"] is False
                assert result["already_recovered"] is True
                service.db.commit.assert_not_called()

    @pytest.mark.asyncio
    async def test_get_transaction_history(self, service):
        """トランザクション履歴取得のテスト"""
        user_id = "test-user-id"
        limit = 10
        offset = 0

        # モックトランザクション
        mock_transactions = [Mock(spec=SPTransaction) for _ in range(5)]
        mock_execute_result = Mock()
        mock_execute_result.scalars = Mock(return_value=Mock(all=Mock(return_value=mock_transactions)))

        # モック設定
        service.db.execute = Mock(return_value=mock_execute_result)

        # 実行 - AsyncGeneratorから値を収集
        result = []
        async for transaction in service.get_transaction_history(user_id, limit=limit, offset=offset):
            result.append(transaction)

        # 検証
        assert result == mock_transactions
        service.db.execute.assert_called_once()



    @pytest.mark.asyncio
    async def test_save_transaction(self, service):
        """トランザクション保存のテスト"""
        # モックトランザクション
        mock_transaction = Mock(spec=SPTransaction)

        # 実行
        await service._save_transaction(mock_transaction)

        # 検証
        service.db.add.assert_called_once_with(mock_transaction)
        # コミットは呼び出し側で行うため、ここではコミットされない
        service.db.commit.assert_not_called()
