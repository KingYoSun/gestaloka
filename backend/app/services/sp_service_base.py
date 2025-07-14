"""
SPサービスの共通ロジック

同期/非同期の重複を解消するための基底クラス
"""

from abc import ABC, abstractmethod
from datetime import UTC, datetime, timedelta
from typing import Any, Optional

from sqlmodel import Session

from app.core.exceptions import InsufficientSPError
from app.core.logging import get_logger
from app.models.sp import (
    PlayerSP,
    SPSubscriptionType,
    SPTransaction,
    SPTransactionType,
)

logger = get_logger(__name__)


class SPServiceBase(ABC):
    """SPサービスの基底クラス（共通ロジック）"""

    # 基本設定
    DAILY_RECOVERY_AMOUNT = 10  # 毎日の自然回復量
    DAILY_RECOVERY_HOUR = 4  # 回復時刻（UTC）

    # 連続ログインボーナス
    LOGIN_BONUS_7_DAYS = 5
    LOGIN_BONUS_14_DAYS = 10
    LOGIN_BONUS_30_DAYS = 20

    def __init__(self, db: Session):
        self.db = db

    def _create_player_sp(self, user_id: str, initial_sp: int = 50) -> PlayerSP:
        """プレイヤーSPレコードを作成（共通ロジック）"""
        now = datetime.now(UTC)
        return PlayerSP(
            user_id=user_id,
            current_sp=initial_sp,
            total_earned_sp=initial_sp,
            total_consumed_sp=0,
            created_at=now,
            updated_at=now,
        )

    def _process_daily_recovery_logic(self, player_sp: PlayerSP) -> dict:
        """日次回復処理の共通ロジック"""
        now = datetime.now(UTC)
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
                benefits = self._get_subscription_benefits(player_sp.active_subscription)
                subscription_bonus = int(benefits.get("daily_bonus", 0))

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

        return {
            "success": True,
            "recovered_amount": recovery_amount,
            "subscription_bonus": subscription_bonus,
            "login_bonus": login_bonus,
            "consecutive_days": player_sp.consecutive_login_days,
            "total_amount": total_recovery,
            "balance_before": balance_before,
            "balance_after": player_sp.current_sp,
            "message": f"SP +{total_recovery} を獲得しました！",
        }

    def _create_transaction_data(
        self,
        player_sp: PlayerSP,
        transaction_type: SPTransactionType,
        amount: int,
        description: str,
        balance_before: int,
        metadata: Optional[dict] = None,
        related_entity_type: Optional[str] = None,
        related_entity_id: Optional[str] = None,
    ) -> SPTransaction:
        """トランザクションデータを作成（共通ロジック）"""
        now = datetime.now(UTC)
        return SPTransaction(
            player_sp_id=player_sp.id,
            user_id=player_sp.user_id,
            transaction_type=transaction_type,
            amount=amount,
            balance_before=balance_before,
            balance_after=balance_before + amount,
            description=description,
            transaction_metadata=metadata or {},
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
            created_at=now,
        )

    def _calculate_discounted_amount(self, player_sp: PlayerSP, amount: int) -> tuple[int, float]:
        """サブスクリプション割引を適用した金額を計算"""
        discount_rate = 0.0
        if player_sp.active_subscription and player_sp.subscription_expires_at:
            if player_sp.subscription_expires_at > datetime.now(UTC):
                benefits = self._get_subscription_benefits(player_sp.active_subscription)
                discount_rate = float(benefits.get("discount_rate", 0.0))

        final_amount = int(amount * (1 - discount_rate))
        return final_amount, discount_rate

    @abstractmethod
    def _save_transaction(self, transaction: SPTransaction) -> None:
        """トランザクションを保存（同期/非同期で実装が異なる）"""
        pass

    def _get_or_create_player_sp_logic(self, user_id: str) -> tuple[PlayerSP, bool]:
        """プレイヤーのSP残高を取得または作成する共通ロジック

        Returns:
            tuple[PlayerSP, bool]: (プレイヤーSP, 新規作成フラグ)
        """
        from sqlmodel import col, select

        # 既存のレコードを検索
        stmt = select(PlayerSP).where(col(PlayerSP.user_id) == user_id)
        player_sp = self.db.execute(stmt).scalars().first()

        if player_sp:
            return player_sp, False

        # 新規作成
        player_sp = self._create_player_sp(user_id, initial_sp=50)
        self.db.add(player_sp)
        self.db.commit()
        self.db.refresh(player_sp)

        # 初期ボーナスの取引記録を作成（保存は呼び出し側で行う）
        transaction = self._create_transaction_data(
            player_sp=player_sp,
            transaction_type=SPTransactionType.ACHIEVEMENT,
            amount=50,
            description="初回登録ボーナス",
            balance_before=0,
            metadata={"achievement": "first_registration"},
        )

        # 一時的に保存（呼び出し側でコミット）
        self.db.add(transaction)

        logger.info(
            "Created new PlayerSP",
            user_id=user_id,
            initial_sp=50,
        )

        return player_sp, True

    def _get_subscription_benefits(self, subscription_type: SPSubscriptionType) -> dict[str, Any]:
        """サブスクリプションの特典情報を取得"""
        # デフォルト値を返す。実際の値はsp_subscription_service.pyで管理
        default_benefits = {
            SPSubscriptionType.BASIC: {
                "daily_bonus": 20,
                "discount_rate": 0.1,
            },
            SPSubscriptionType.PREMIUM: {
                "daily_bonus": 50,
                "discount_rate": 0.2,
            },
        }
        return default_benefits.get(subscription_type, {})

    def _consume_sp_logic(
        self,
        player_sp: PlayerSP,
        amount: int,
        transaction_type: SPTransactionType,
        description: str,
        related_entity_type: Optional[str] = None,
        related_entity_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> tuple[SPTransaction, dict]:
        """SP消費の共通ロジック"""
        # サブスクリプション割引の適用
        final_amount, discount_rate = self._calculate_discounted_amount(player_sp, amount)

        # 残高チェック
        if player_sp.current_sp < final_amount:
            raise InsufficientSPError(
                f"SP残高が不足しています。必要: {final_amount}, 現在: {player_sp.current_sp}"
            )

        # SPを消費
        balance_before = player_sp.current_sp
        player_sp.current_sp -= final_amount
        player_sp.total_consumed_sp += final_amount
        player_sp.updated_at = datetime.now(UTC)

        # 取引記録用のメタデータ
        transaction_metadata = metadata or {}
        if discount_rate > 0:
            transaction_metadata["discount_rate"] = float(discount_rate)
            transaction_metadata["original_amount"] = amount

        # トランザクション作成
        transaction = self._create_transaction_data(
            player_sp=player_sp,
            transaction_type=transaction_type,
            amount=-final_amount,
            description=description,
            balance_before=balance_before,
            metadata=transaction_metadata,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
        )

        return transaction, {
            "final_amount": final_amount,
            "discount_rate": discount_rate,
            "balance_before": balance_before,
            "metadata": transaction_metadata,
        }

    def _add_sp_logic(
        self,
        player_sp: PlayerSP,
        amount: int,
        transaction_type: SPTransactionType,
        description: str,
        related_entity_type: Optional[str] = None,
        related_entity_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> tuple[SPTransaction, int]:
        """SP追加の共通ロジック"""
        # SPを追加
        balance_before = player_sp.current_sp
        player_sp.current_sp += amount
        player_sp.total_earned_sp += amount
        player_sp.updated_at = datetime.now(UTC)

        # トランザクション作成
        transaction = self._create_transaction_data(
            player_sp=player_sp,
            transaction_type=transaction_type,
            amount=amount,
            description=description,
            balance_before=balance_before,
            metadata=metadata,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
        )

        return transaction, balance_before
