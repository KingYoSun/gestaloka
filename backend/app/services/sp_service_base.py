"""
SPサービスの共通ロジック

同期/非同期の重複を解消するための基底クラス
"""

from datetime import datetime, timedelta
from typing import Dict, Optional

from sqlalchemy.orm import Session as SyncSession
from sqlmodel import Session, select, col

from app.core.exceptions import InsufficientSPError, SPSystemError
from app.models.sp import PlayerSP, SPTransaction, SPTransactionType
from app.models.user import User
from app.core.logging import get_logger

logger = get_logger(__name__)


class SPServiceBase:
    """SPサービスの基底クラス（共通ロジック）"""

    # 定数
    DAILY_RECOVERY_AMOUNT = 10
    LOGIN_BONUS_7_DAYS = 20
    LOGIN_BONUS_14_DAYS = 50
    LOGIN_BONUS_30_DAYS = 100

    SUBSCRIPTION_BENEFITS = {
        "basic": {"daily_bonus": 20},
        "premium": {"daily_bonus": 50},
    }

    def _create_player_sp(self, user: User) -> PlayerSP:
        """プレイヤーSPレコードを作成（共通ロジック）"""
        now = datetime.utcnow()
        return PlayerSP(
            user_id=user.id,
            current_sp=0,  # 初期値は0
            total_earned_sp=0,
            total_consumed_sp=0,
            created_at=now,
            updated_at=now,
        )

    def _process_daily_recovery_logic(self, player_sp: PlayerSP) -> dict:
        """日次回復処理の共通ロジック"""
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
                subscription_bonus = int(self.SUBSCRIPTION_BENEFITS[player_sp.active_subscription]["daily_bonus"])

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
        metadata: Optional[Dict] = None,
        related_entity_type: Optional[str] = None,
        related_entity_id: Optional[str] = None,
    ) -> SPTransaction:
        """トランザクションデータを作成（共通ロジック）"""
        now = datetime.utcnow()
        return SPTransaction(
            user_id=player_sp.user_id,
            transaction_type=transaction_type,
            amount=amount,
            balance_before=balance_before,
            balance_after=balance_before + amount,
            description=description,
            metadata=metadata or {},
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
            created_at=now,
        )