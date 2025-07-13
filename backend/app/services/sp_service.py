"""
SPシステムのビジネスロジックを管理するサービスクラス
"""

from collections.abc import AsyncGenerator
from datetime import datetime
from typing import Optional

from sqlmodel import col, select

from app.core.exceptions import InsufficientSPError, SPSystemError
from app.core.logging import get_logger
from app.models.sp import (
    PlayerSP,
    SPTransaction,
    SPTransactionType,
)
from app.services.sp_service_base import SPServiceBase
from app.websocket.events import SPEventEmitter

logger = get_logger(__name__)


class SPService(SPServiceBase):
    """SPシステムのサービスクラス（非同期版）"""

    async def _save_transaction(self, transaction: SPTransaction) -> None:
        """トランザクションを保存（非同期版）"""
        self.db.add(transaction)
        # Note: コミットは呼び出し側で行う

    async def get_or_create_player_sp(self, user_id: str) -> PlayerSP:
        """プレイヤーのSP残高を取得または作成"""
        try:
            # 既存のレコードを検索
            stmt = select(PlayerSP).where(col(PlayerSP.user_id) == user_id)
            player_sp = self.db.exec(stmt).first()

            if not player_sp:
                # 新規作成
                player_sp = self._create_player_sp(user_id, initial_sp=50)
                self.db.add(player_sp)
                self.db.commit()
                self.db.refresh(player_sp)

                # 初期ボーナスの取引記録
                transaction = self._create_transaction_data(
                    player_sp=player_sp,
                    transaction_type=SPTransactionType.ACHIEVEMENT,
                    amount=50,
                    description="初回登録ボーナス",
                    balance_before=0,
                    metadata={"achievement": "first_registration"},
                )
                await self._save_transaction(transaction)
                self.db.commit()

                logger.info(
                    "Created new PlayerSP",
                    user_id=user_id,
                    initial_sp=50,
                )

            return player_sp

        except Exception as e:
            logger.error(
                "Failed to get or create PlayerSP",
                user_id=user_id,
                error=str(e),
            )
            raise SPSystemError("SP残高の取得に失敗しました")

    async def get_balance(self, user_id: str) -> PlayerSP:
        """現在のSP残高を取得"""
        return await self.get_or_create_player_sp(user_id)

    async def consume_sp(
        self,
        user_id: str,
        amount: int,
        transaction_type: SPTransactionType,
        description: str,
        related_entity_type: Optional[str] = None,
        related_entity_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> SPTransaction:
        """SPを消費"""
        try:
            player_sp = await self.get_or_create_player_sp(user_id)

            # 共通ロジックを使用
            transaction, result = self._consume_sp_logic(
                player_sp=player_sp,
                amount=amount,
                transaction_type=transaction_type,
                description=description,
                related_entity_type=related_entity_type,
                related_entity_id=related_entity_id,
                metadata=metadata,
            )

            await self._save_transaction(transaction)
            self.db.commit()
            logger.info(
                "SP consumed",
                user_id=user_id,
                amount=result["final_amount"],
                type=transaction_type.value,
            )

            # WebSocketイベントを送信
            await SPEventEmitter.emit_sp_update(
                user_id=user_id,
                current_sp=player_sp.current_sp,
                amount_changed=-result["final_amount"],
                transaction_type=transaction_type.value,
                description=description,
                balance_before=result["balance_before"],
                metadata=result["metadata"],
            )

            return transaction

        except InsufficientSPError:
            # SP不足イベントを送信
            await SPEventEmitter.emit_sp_insufficient(
                user_id=user_id,
                required_amount=amount,
                current_sp=player_sp.current_sp if 'player_sp' in locals() else 0,
                action=description,
            )
            raise
        except Exception as e:
            logger.error(
                "Failed to consume SP",
                user_id=user_id,
                amount=amount,
                error=str(e),
            )
            self.db.rollback()
            raise SPSystemError("SP消費処理に失敗しました")

    async def add_sp(
        self,
        user_id: str,
        amount: int,
        transaction_type: SPTransactionType,
        description: str,
        related_entity_type: Optional[str] = None,
        related_entity_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> SPTransaction:
        """SPを追加"""
        try:
            player_sp = await self.get_or_create_player_sp(user_id)

            # 共通ロジックを使用
            transaction, balance_before = self._add_sp_logic(
                player_sp=player_sp,
                amount=amount,
                transaction_type=transaction_type,
                description=description,
                related_entity_type=related_entity_type,
                related_entity_id=related_entity_id,
                metadata=metadata,
            )

            await self._save_transaction(transaction)
            self.db.commit()
            logger.info(
                "SP added",
                user_id=user_id,
                amount=amount,
                type=transaction_type.value,
            )

            # WebSocketイベントを送信
            await SPEventEmitter.emit_sp_update(
                user_id=user_id,
                current_sp=player_sp.current_sp,
                amount_changed=amount,
                transaction_type=transaction_type.value,
                description=description,
                balance_before=balance_before,
                metadata=metadata,
            )

            return transaction

        except Exception as e:
            logger.error(
                "Failed to add SP",
                user_id=user_id,
                amount=amount,
                error=str(e),
            )
            self.db.rollback()
            raise SPSystemError("SP追加処理に失敗しました")

    async def process_daily_recovery(self, user_id: str) -> dict:
        """日次回復処理"""
        try:
            player_sp = await self.get_or_create_player_sp(user_id)

            # 共通ロジックを使用
            result = self._process_daily_recovery_logic(player_sp)

            if not result["success"]:
                return result

            # 取引記録
            transaction = self._create_transaction_data(
                player_sp=player_sp,
                transaction_type=SPTransactionType.DAILY_RECOVERY,
                amount=result["total_amount"],
                description=f"日次回復 (+{result['recovered_amount']})"
                + (f" + サブスク (+{result['subscription_bonus']})" if result['subscription_bonus'] else "")
                + (f" + 連続ログイン{result['consecutive_days']}日目 (+{result['login_bonus']})" if result['login_bonus'] else ""),
                balance_before=result["balance_before"],
                metadata={
                    "base_recovery": result["recovered_amount"],
                    "subscription_bonus": result["subscription_bonus"],
                    "login_bonus": result["login_bonus"],
                    "consecutive_days": result["consecutive_days"],
                },
            )

            await self._save_transaction(transaction)
            self.db.commit()

            # 日次回復イベントを送信
            await SPEventEmitter.emit_daily_recovery_completed(
                user_id=user_id,
                recovery_details={
                    "recovered_amount": result["recovered_amount"],
                    "subscription_bonus": result["subscription_bonus"],
                    "login_bonus": result["login_bonus"],
                    "consecutive_days": result["consecutive_days"],
                    "total_amount": result["total_amount"],
                    "balance_after": result["balance_after"],
                },
            )

            logger.info(
                "Daily recovery processed",
                user_id=user_id,
                total_amount=result["total_amount"],
                consecutive_days=result["consecutive_days"],
            )

            return result

        except Exception as e:
            logger.error(
                "Failed to process daily recovery",
                user_id=user_id,
                error=str(e),
            )
            self.db.rollback()
            raise SPSystemError("日次回復処理に失敗しました")

    async def get_transaction_history(
        self,
        user_id: str,
        limit: int = 20,
        offset: int = 0,
        transaction_type: Optional[SPTransactionType] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        related_entity_type: Optional[str] = None,
        related_entity_id: Optional[str] = None,
    ) -> AsyncGenerator[SPTransaction, None]:
        """取引履歴を取得"""
        try:
            query = select(SPTransaction).where(col(SPTransaction.user_id) == user_id)

            if transaction_type:
                query = query.where(col(SPTransaction.transaction_type) == transaction_type)

            if start_date:
                query = query.where(col(SPTransaction.created_at) >= start_date)

            if end_date:
                query = query.where(col(SPTransaction.created_at) <= end_date)

            if related_entity_type:
                query = query.where(col(SPTransaction.related_entity_type) == related_entity_type)

            if related_entity_id:
                query = query.where(col(SPTransaction.related_entity_id) == related_entity_id)

            query = query.order_by(col(SPTransaction.created_at).desc()).limit(limit).offset(offset)

            results = self.db.exec(query).all()

            for transaction in results:
                yield transaction

        except Exception as e:
            logger.error(
                "Failed to get transaction history",
                user_id=user_id,
                error=str(e),
            )
            raise SPSystemError("取引履歴の取得に失敗しました")


class SPServiceSync(SPServiceBase):
    """SPシステムのサービスクラス（同期版）- Celeryタスク用"""

    def _save_transaction(self, transaction: SPTransaction) -> None:
        """トランザクションを保存（同期版）"""
        self.db.add(transaction)
        # Note: コミットは呼び出し側で行う

    def get_or_create_player_sp_sync(self, user_id: str) -> PlayerSP:
        """プレイヤーのSP残高を取得または作成（同期版）"""
        try:
            # 既存のレコードを検索
            stmt = select(PlayerSP).where(col(PlayerSP.user_id) == user_id)
            player_sp = self.db.exec(stmt).first()

            if not player_sp:
                # 新規作成
                player_sp = self._create_player_sp(user_id, initial_sp=50)
                self.db.add(player_sp)
                self.db.commit()
                self.db.refresh(player_sp)

                # 初期ボーナスの取引記録
                transaction = self._create_transaction_data(
                    player_sp=player_sp,
                    transaction_type=SPTransactionType.ACHIEVEMENT,
                    amount=50,
                    description="初回登録ボーナス",
                    balance_before=0,
                    metadata={"achievement": "first_registration"},
                )
                self._save_transaction(transaction)
                self.db.commit()

                logger.info(
                    "Created new PlayerSP (sync)",
                    user_id=user_id,
                    initial_sp=50,
                )

            return player_sp

        except Exception as e:
            logger.error(
                "Failed to get or create PlayerSP (sync)",
                user_id=user_id,
                error=str(e),
            )
            raise SPSystemError("SP残高の取得に失敗しました")

    def add_sp_sync(
        self,
        user_id: str,
        amount: int,
        transaction_type: SPTransactionType,
        description: str,
        related_entity_type: Optional[str] = None,
        related_entity_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> SPTransaction:
        """SPを追加（同期版）"""
        try:
            player_sp = self.get_or_create_player_sp_sync(user_id)

            # 共通ロジックを使用
            transaction, balance_before = self._add_sp_logic(
                player_sp=player_sp,
                amount=amount,
                transaction_type=transaction_type,
                description=description,
                related_entity_type=related_entity_type,
                related_entity_id=related_entity_id,
                metadata=metadata,
            )

            self._save_transaction(transaction)
            self.db.commit()
            logger.info(
                "SP added (sync)",
                user_id=user_id,
                amount=amount,
                type=transaction_type.value,
            )

            return transaction

        except Exception as e:
            logger.error(
                "Failed to add SP (sync)",
                user_id=user_id,
                amount=amount,
                error=str(e),
            )
            self.db.rollback()
            raise SPSystemError("SP追加処理に失敗しました")

    def process_daily_recovery_sync(self, user_id: str) -> dict:
        """日次回復処理（同期版）- Celeryタスク用"""
        try:
            player_sp = self.get_or_create_player_sp_sync(user_id)

            # 共通ロジックを使用
            result = self._process_daily_recovery_logic(player_sp)

            if not result["success"]:
                return result

            # 取引記録
            transaction = self._create_transaction_data(
                player_sp=player_sp,
                transaction_type=SPTransactionType.DAILY_RECOVERY,
                amount=result["total_amount"],
                description=f"日次回復 (+{result['recovered_amount']})"
                + (f" + サブスク (+{result['subscription_bonus']})" if result['subscription_bonus'] else "")
                + (f" + 連続ログイン{result['consecutive_days']}日目 (+{result['login_bonus']})" if result['login_bonus'] else ""),
                balance_before=result["balance_before"],
                metadata={
                    "base_recovery": result["recovered_amount"],
                    "subscription_bonus": result["subscription_bonus"],
                    "login_bonus": result["login_bonus"],
                    "consecutive_days": result["consecutive_days"],
                },
            )

            self._save_transaction(transaction)
            self.db.commit()

            logger.info(
                "Daily recovery processed (sync)",
                user_id=user_id,
                total_amount=result["total_amount"],
                consecutive_days=result["consecutive_days"],
            )

            return result

        except Exception as e:
            logger.error(
                "Failed to process daily recovery (sync)",
                user_id=user_id,
                error=str(e),
            )
            self.db.rollback()
            raise SPSystemError("日次回復処理に失敗しました")
