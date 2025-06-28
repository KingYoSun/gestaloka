"""
SPシステムのビジネスロジックを管理するサービスクラス
"""

from datetime import datetime, timedelta
from typing import ClassVar, Optional

from sqlmodel import Session, col, select

from app.core.exceptions import InsufficientSPError, SPSystemError
from app.core.logging import get_logger
from app.models.sp import (
    PlayerSP,
    SPPurchasePackage,
    SPSubscriptionType,
    SPTransaction,
    SPTransactionType,
)
from app.websocket.events import SPEventEmitter

logger = get_logger(__name__)


class SPService:
    """SPシステムのサービスクラス"""

    def __init__(self, db: Session):
        self.db = db

    # 基本設定
    DAILY_RECOVERY_AMOUNT = 10  # 毎日の自然回復量
    DAILY_RECOVERY_HOUR = 4  # 回復時刻（UTC）

    # 連続ログインボーナス
    LOGIN_BONUS_7_DAYS = 5
    LOGIN_BONUS_14_DAYS = 10
    LOGIN_BONUS_30_DAYS = 20

    # 購入パッケージ設定
    PURCHASE_PACKAGES: ClassVar[dict[SPPurchasePackage, dict[str, int]]] = {
        SPPurchasePackage.SMALL: {"sp": 100, "price": 500},
        SPPurchasePackage.MEDIUM: {"sp": 300, "price": 1200},
        SPPurchasePackage.LARGE: {"sp": 500, "price": 2000},
        SPPurchasePackage.EXTRA_LARGE: {"sp": 1000, "price": 3500},
        SPPurchasePackage.MEGA: {"sp": 3000, "price": 8000},
    }

    # サブスクリプション設定
    SUBSCRIPTION_BENEFITS: ClassVar[dict[SPSubscriptionType, dict[str, float | int]]] = {
        SPSubscriptionType.BASIC: {
            "daily_bonus": 20,
            "discount_rate": 0.1,  # 10%割引
            "price": 1000,
        },
        SPSubscriptionType.PREMIUM: {
            "daily_bonus": 50,
            "discount_rate": 0.2,  # 20%割引
            "price": 2500,
        },
    }

    async def get_or_create_player_sp(self, user_id: str) -> PlayerSP:
        """プレイヤーのSP残高を取得または作成"""
        try:
            # 既存のレコードを検索
            # 既存のレコードを検索
            stmt = select(PlayerSP).where(col(PlayerSP.user_id) == user_id)
            player_sp = self.db.exec(stmt).first()

            if not player_sp:
                # 新規作成
                player_sp = PlayerSP(
                    user_id=user_id,
                    current_sp=50,  # 初期ボーナス
                    total_earned_sp=50,
                )
                self.db.add(player_sp)
                self.db.commit()
                self.db.refresh(player_sp)

                # 初期ボーナスの取引記録
                await self._create_transaction(
                    player_sp=player_sp,
                    transaction_type=SPTransactionType.ACHIEVEMENT,
                    amount=50,
                    description="初回登録ボーナス",
                    metadata={"achievement": "first_registration"},
                )

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

            # サブスクリプション割引の適用
            discount_rate = 0.0
            if player_sp.active_subscription and player_sp.subscription_expires_at:
                if player_sp.subscription_expires_at > datetime.utcnow():
                    discount_rate = self.SUBSCRIPTION_BENEFITS[
                        player_sp.active_subscription
                    ]["discount_rate"]

            final_amount = int(amount * (1 - discount_rate))

            # 残高チェック
            if player_sp.current_sp < final_amount:
                # SP不足イベントを送信
                await SPEventEmitter.emit_sp_insufficient(
                    user_id=user_id,
                    required_amount=final_amount,
                    current_sp=player_sp.current_sp,
                    action=description,
                )
                raise InsufficientSPError(
                    f"SP残高が不足しています。必要: {final_amount}, 現在: {player_sp.current_sp}"
                )

            # SPを消費
            balance_before = player_sp.current_sp
            player_sp.current_sp -= final_amount
            player_sp.total_consumed_sp += final_amount
            player_sp.updated_at = datetime.utcnow()

            # 取引記録を作成
            transaction_metadata = metadata or {}
            if discount_rate > 0:
                transaction_metadata["discount_rate"] = float(discount_rate)
                transaction_metadata["original_amount"] = amount

            transaction = await self._create_transaction(
                player_sp=player_sp,
                transaction_type=transaction_type,
                amount=-final_amount,
                description=description,
                balance_before=balance_before,
                related_entity_type=related_entity_type,
                related_entity_id=related_entity_id,
                metadata=transaction_metadata,
            )

            self.db.commit()
            logger.info(
                "SP consumed",
                user_id=user_id,
                amount=final_amount,
                type=transaction_type.value,
            )

            # WebSocketイベントを送信
            await SPEventEmitter.emit_sp_update(
                user_id=user_id,
                current_sp=player_sp.current_sp,
                amount_changed=-final_amount,
                transaction_type=transaction_type.value,
                description=description,
                balance_before=balance_before,
                metadata=transaction_metadata,
            )

            return transaction

        except InsufficientSPError:
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

            # SPを追加
            balance_before = player_sp.current_sp
            player_sp.current_sp += amount
            player_sp.total_earned_sp += amount
            player_sp.updated_at = datetime.utcnow()

            # 取引記録を作成
            transaction = await self._create_transaction(
                player_sp=player_sp,
                transaction_type=transaction_type,
                amount=amount,
                description=description,
                balance_before=balance_before,
                related_entity_type=related_entity_type,
                related_entity_id=related_entity_id,
                metadata=metadata,
            )

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
            now = datetime.utcnow()
            today = now.date()

            # 最後の回復日を確認
            if player_sp.last_daily_recovery_at:
                last_recovery_date = player_sp.last_daily_recovery_at.date()
                if last_recovery_date >= today:
                    return {
                        "success": False,
                        "message": "本日の回復は既に完了しています",
                    }

            # 基本回復量
            recovery_amount = self.DAILY_RECOVERY_AMOUNT

            # サブスクリプションボーナス
            subscription_bonus: int = 0
            if player_sp.active_subscription and player_sp.subscription_expires_at:
                if player_sp.subscription_expires_at > now:
                    subscription_bonus = int(self.SUBSCRIPTION_BENEFITS[
                        player_sp.active_subscription
                    ]["daily_bonus"])

            # 連続ログイン処理
            login_bonus = 0
            if player_sp.last_login_date:
                last_login_date = player_sp.last_login_date.date()
                if last_login_date == today - timedelta(days=1):
                    # 連続ログイン継続
                    player_sp.consecutive_login_days += 1
                elif last_login_date < today - timedelta(days=1):
                    # 連続ログインリセット
                    player_sp.consecutive_login_days = 1
            else:
                player_sp.consecutive_login_days = 1

            # 連続ログインボーナス
            if player_sp.consecutive_login_days == 7:
                login_bonus = self.LOGIN_BONUS_7_DAYS
            elif player_sp.consecutive_login_days == 14:
                login_bonus = self.LOGIN_BONUS_14_DAYS
            elif player_sp.consecutive_login_days == 30:
                login_bonus = self.LOGIN_BONUS_30_DAYS

            # 合計回復量
            total_recovery = recovery_amount + subscription_bonus + login_bonus

            # SP追加
            balance_before = player_sp.current_sp
            player_sp.current_sp += total_recovery
            player_sp.total_earned_sp += total_recovery
            player_sp.last_daily_recovery_at = now
            player_sp.last_login_date = now
            player_sp.updated_at = now

            # 取引記録
            await self._create_transaction(
                player_sp=player_sp,
                transaction_type=SPTransactionType.DAILY_RECOVERY,
                amount=total_recovery,
                description=f"日次回復 (+{recovery_amount})"
                + (f" + サブスク (+{subscription_bonus})" if subscription_bonus else "")
                + (f" + 連続ログイン{player_sp.consecutive_login_days}日目 (+{login_bonus})" if login_bonus else ""),
                balance_before=balance_before,
                metadata={
                    "base_recovery": recovery_amount,
                    "subscription_bonus": subscription_bonus,
                    "login_bonus": login_bonus,
                    "consecutive_days": player_sp.consecutive_login_days,
                },
            )

            self.db.commit()

            recovery_result = {
                "success": True,
                "recovered_amount": recovery_amount,
                "subscription_bonus": subscription_bonus,
                "login_bonus": login_bonus,
                "consecutive_days": player_sp.consecutive_login_days,
                "total_amount": total_recovery,
                "balance_after": player_sp.current_sp,
                "message": f"SP +{total_recovery} を獲得しました！",
            }

            # 日次回復イベントを送信
            await SPEventEmitter.emit_daily_recovery_completed(
                user_id=user_id,
                recovery_details=recovery_result,
            )

            return recovery_result

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
        transaction_type: Optional[SPTransactionType] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        related_entity_type: Optional[str] = None,
        related_entity_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[SPTransaction]:
        """取引履歴を取得"""
        try:
            stmt = select(SPTransaction).where(col(SPTransaction.user_id) == user_id)

            # フィルター条件
            if transaction_type:
                stmt = stmt.where(col(SPTransaction.transaction_type) == transaction_type)
            if start_date:
                stmt = stmt.where(col(SPTransaction.created_at) >= start_date)
            if end_date:
                stmt = stmt.where(col(SPTransaction.created_at) <= end_date)
            if related_entity_type:
                stmt = stmt.where(
                    col(SPTransaction.related_entity_type) == related_entity_type
                )
            if related_entity_id:
                stmt = stmt.where(
                    col(SPTransaction.related_entity_id) == related_entity_id
                )

            # ソートとページネーション
            stmt = stmt.order_by(col(SPTransaction.created_at).desc())
            stmt = stmt.offset(offset).limit(limit)

            return list(self.db.exec(stmt).all())

        except Exception as e:
            logger.error(
                "Failed to get transaction history",
                user_id=user_id,
                error=str(e),
            )
            raise SPSystemError("取引履歴の取得に失敗しました")

    def process_daily_recovery_sync(self, user_id: str) -> dict:
        """日次回復処理（同期版）- Celeryタスク用"""
        try:
            player_sp = self.get_or_create_player_sp_sync(user_id)
            now = datetime.utcnow()
            today = now.date()

            # 最後の回復日を確認
            if player_sp.last_daily_recovery_at:
                last_recovery_date = player_sp.last_daily_recovery_at.date()
                if last_recovery_date >= today:
                    return {
                        "success": False,
                        "message": "本日の回復は既に完了しています",
                    }

            # 基本回復量
            recovery_amount = self.DAILY_RECOVERY_AMOUNT

            # サブスクリプションボーナス
            subscription_bonus: int = 0
            if player_sp.active_subscription and player_sp.subscription_expires_at:
                if player_sp.subscription_expires_at > now:
                    subscription_bonus = int(self.SUBSCRIPTION_BENEFITS[
                        player_sp.active_subscription
                    ]["daily_bonus"])

            # 連続ログイン処理
            login_bonus = 0
            if player_sp.last_login_date:
                last_login_date = player_sp.last_login_date.date()
                if last_login_date == today - timedelta(days=1):
                    # 連続ログイン継続
                    player_sp.consecutive_login_days += 1
                elif last_login_date < today - timedelta(days=1):
                    # 連続ログインリセット
                    player_sp.consecutive_login_days = 1
            else:
                player_sp.consecutive_login_days = 1

            # 連続ログインボーナス
            if player_sp.consecutive_login_days == 7:
                login_bonus = self.LOGIN_BONUS_7_DAYS
            elif player_sp.consecutive_login_days == 14:
                login_bonus = self.LOGIN_BONUS_14_DAYS
            elif player_sp.consecutive_login_days == 30:
                login_bonus = self.LOGIN_BONUS_30_DAYS

            # 合計回復量
            total_recovery = recovery_amount + subscription_bonus + login_bonus

            # SP追加
            balance_before = player_sp.current_sp
            player_sp.current_sp += total_recovery
            player_sp.total_earned_sp += total_recovery
            player_sp.last_daily_recovery_at = now
            player_sp.last_login_date = now
            player_sp.updated_at = now

            # 取引記録
            self._create_transaction_sync(
                player_sp=player_sp,
                transaction_type=SPTransactionType.DAILY_RECOVERY,
                amount=total_recovery,
                description=f"日次回復 (+{recovery_amount})"
                + (f" + サブスク (+{subscription_bonus})" if subscription_bonus else "")
                + (f" + 連続ログイン{player_sp.consecutive_login_days}日目 (+{login_bonus})" if login_bonus else ""),
                balance_before=balance_before,
                metadata={
                    "base_recovery": recovery_amount,
                    "subscription_bonus": subscription_bonus,
                    "login_bonus": login_bonus,
                    "consecutive_days": player_sp.consecutive_login_days,
                },
            )

            self.db.commit()

            return {
                "success": True,
                "recovered_amount": recovery_amount,
                "subscription_bonus": subscription_bonus,
                "login_bonus": login_bonus,
                "consecutive_days": player_sp.consecutive_login_days,
                "total_amount": total_recovery,
                "balance_after": player_sp.current_sp,
                "message": f"SP +{total_recovery} を獲得しました！",
            }

        except Exception as e:
            logger.error(
                "Failed to process daily recovery (sync)",
                user_id=user_id,
                error=str(e),
            )
            self.db.rollback()
            raise SPSystemError("日次回復処理に失敗しました")

    def get_or_create_player_sp_sync(self, user_id: str) -> PlayerSP:
        """プレイヤーのSP残高を取得または作成（同期版）"""
        try:
            # 既存のレコードを検索
            stmt = select(PlayerSP).where(col(PlayerSP.user_id) == user_id)
            player_sp = self.db.exec(stmt).first()

            if not player_sp:
                # 新規作成
                player_sp = PlayerSP(
                    user_id=user_id,
                    current_sp=50,  # 初期ボーナス
                    total_earned_sp=50,
                )
                self.db.add(player_sp)
                self.db.commit()
                self.db.refresh(player_sp)

                # 初期ボーナスの取引記録
                self._create_transaction_sync(
                    player_sp=player_sp,
                    transaction_type=SPTransactionType.ACHIEVEMENT,
                    amount=50,
                    description="初回登録ボーナス",
                    metadata={"achievement": "first_registration"},
                )

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

    async def _create_transaction(
        self,
        player_sp: PlayerSP,
        transaction_type: SPTransactionType,
        amount: int,
        description: str,
        balance_before: Optional[int] = None,
        related_entity_type: Optional[str] = None,
        related_entity_id: Optional[str] = None,
        metadata: Optional[dict] = None,
        purchase_package: Optional[SPPurchasePackage] = None,
        purchase_amount: Optional[int] = None,
        payment_method: Optional[str] = None,
        payment_transaction_id: Optional[str] = None,
    ) -> SPTransaction:
        """取引記録を作成（内部使用）"""
        if balance_before is None:
            balance_before = player_sp.current_sp - amount

        transaction = SPTransaction(
            player_sp_id=player_sp.id,
            user_id=player_sp.user_id,
            transaction_type=transaction_type,
            amount=amount,
            balance_before=balance_before,
            balance_after=player_sp.current_sp,
            description=description,
            transaction_metadata=metadata or {},
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
            purchase_package=purchase_package,
            purchase_amount=purchase_amount,
            payment_method=payment_method,
            payment_transaction_id=payment_transaction_id,
        )
        self.db.add(transaction)
        return transaction

    def _create_transaction_sync(
        self,
        player_sp: PlayerSP,
        transaction_type: SPTransactionType,
        amount: int,
        description: str,
        balance_before: Optional[int] = None,
        related_entity_type: Optional[str] = None,
        related_entity_id: Optional[str] = None,
        metadata: Optional[dict] = None,
        purchase_package: Optional[SPPurchasePackage] = None,
        purchase_amount: Optional[int] = None,
        payment_method: Optional[str] = None,
        payment_transaction_id: Optional[str] = None,
    ) -> SPTransaction:
        """取引記録を作成（内部使用・同期版）"""
        if balance_before is None:
            balance_before = player_sp.current_sp - amount

        transaction = SPTransaction(
            player_sp_id=player_sp.id,
            user_id=player_sp.user_id,
            transaction_type=transaction_type,
            amount=amount,
            balance_before=balance_before,
            balance_after=player_sp.current_sp,
            description=description,
            transaction_metadata=metadata or {},
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
            purchase_package=purchase_package,
            purchase_amount=purchase_amount,
            payment_method=payment_method,
            payment_transaction_id=payment_transaction_id,
        )
        self.db.add(transaction)
        return transaction
