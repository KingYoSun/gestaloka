"""
SPシステム関連のモデル定義

Story Points（SP）は、プレイヤーが世界に干渉する力を表すリソースです。
プレイヤーの行動、ログ派遣、特殊機能の使用などで消費されます。
"""

from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional
from uuid import uuid4

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.user import User


class SPTransactionType(str, Enum):
    """SP取引の種類"""

    # 取得系
    DAILY_RECOVERY = "daily_recovery"  # 毎日の自然回復
    PURCHASE = "purchase"  # 購入
    ACHIEVEMENT = "achievement"  # 実績報酬
    EVENT_REWARD = "event_reward"  # イベント報酬
    LOG_RESULT = "log_result"  # ログ成果報酬
    LOGIN_BONUS = "login_bonus"  # ログインボーナス
    REFUND = "refund"  # 返金・補填

    # 消費系
    FREE_ACTION = "free_action"  # 自由行動宣言
    LOG_DISPATCH = "log_dispatch"  # ログ派遣
    LOG_ENHANCEMENT = "log_enhancement"  # ログ強化
    SYSTEM_FUNCTION = "system_function"  # システム機能（即時回復など）
    MOVEMENT = "movement"  # 場所移動
    EXPLORATION = "exploration"  # 探索行動

    # システム系
    ADJUSTMENT = "adjustment"  # システム調整
    MIGRATION = "migration"  # データ移行


class SPPurchasePackage(str, Enum):
    """SP購入パッケージ"""

    SMALL = "small"  # 100 SP (¥500)
    MEDIUM = "medium"  # 300 SP (¥1,200)
    LARGE = "large"  # 500 SP (¥2,000)
    EXTRA_LARGE = "extra_large"  # 1,000 SP (¥3,500)
    MEGA = "mega"  # 3,000 SP (¥8,000)


class SPSubscriptionType(str, Enum):
    """SP月額パスの種類"""

    BASIC = "basic"  # ベーシックパス (¥1,000/月)
    PREMIUM = "premium"  # プレミアムパス (¥2,500/月)


class PlayerSP(SQLModel, table=True):
    """
    プレイヤーのSP保有状況を管理するモデル

    各プレイヤーは1つのSP残高を持ち、日々の回復や購入によって増減します。
    """

    __tablename__ = "player_sp"
    __table_args__ = (UniqueConstraint("user_id", name="uq_player_sp_user_id"),)

    # Primary Key
    id: str = Field(
        default_factory=lambda: str(uuid4()), primary_key=True, index=True, description="SP残高レコードのID"
    )

    # Foreign Keys
    user_id: str = Field(foreign_key="users.id", index=True, description="ユーザーID")

    # SP情報
    current_sp: int = Field(default=0, ge=0, description="現在のSP残高")

    total_earned_sp: int = Field(default=0, ge=0, description="これまでに獲得した総SP")

    total_consumed_sp: int = Field(default=0, ge=0, description="これまでに消費した総SP")

    # 購入情報
    total_purchased_sp: int = Field(default=0, ge=0, description="購入によって獲得した総SP")

    total_purchase_amount: int = Field(default=0, ge=0, description="総購入金額（円）")

    # サブスクリプション情報
    active_subscription: Optional[SPSubscriptionType] = Field(default=None, description="有効な月額パスの種類")

    subscription_expires_at: Optional[datetime] = Field(default=None, description="月額パスの有効期限")

    # 日次情報
    last_daily_recovery_at: Optional[datetime] = Field(default=None, description="最後の日次回復日時")

    consecutive_login_days: int = Field(default=0, ge=0, description="連続ログイン日数")

    last_login_date: Optional[datetime] = Field(default=None, description="最後のログイン日")

    # タイムスタンプ
    created_at: datetime = Field(default_factory=datetime.utcnow, description="作成日時")

    updated_at: datetime = Field(default_factory=datetime.utcnow, description="更新日時")

    # Relationships
    user: Optional["User"] = Relationship(back_populates="player_sp")
    transactions: list["SPTransaction"] = Relationship(
        back_populates="player_sp", sa_relationship_kwargs={"order_by": "SPTransaction.created_at.desc()"}
    )

    def __repr__(self) -> str:
        return f"<PlayerSP(id={self.id}, user_id={self.user_id}, current_sp={self.current_sp})>"


class SPTransaction(SQLModel, table=True):
    """
    SP取引履歴を記録するモデル

    全てのSPの増減を記録し、監査やデバッグ、不正検出に使用します。
    """

    __tablename__ = "sp_transactions"

    # Primary Key
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, index=True, description="取引ID")

    # Foreign Keys
    player_sp_id: str = Field(foreign_key="player_sp.id", index=True, description="プレイヤーSP残高ID")

    user_id: str = Field(foreign_key="users.id", index=True, description="ユーザーID（検索高速化のため冗長に保持）")

    # 取引情報
    transaction_type: SPTransactionType = Field(index=True, description="取引の種類")

    amount: int = Field(description="SP増減量（正の値は獲得、負の値は消費）")

    balance_before: int = Field(ge=0, description="取引前のSP残高")

    balance_after: int = Field(ge=0, description="取引後のSP残高")

    # 詳細情報
    description: str = Field(description="取引の説明")

    transaction_metadata: dict = Field(
        default_factory=dict,
        sa_column=Column(JSON),
        description="取引に関する追加情報（購入パッケージ、ログ派遣詳細など）",
    )

    # 関連情報
    related_entity_type: Optional[str] = Field(
        default=None, description="関連エンティティの種類（log、character、sessionなど）"
    )

    related_entity_id: Optional[str] = Field(default=None, index=True, description="関連エンティティのID")

    # 購入情報（購入の場合のみ）
    purchase_package: Optional[SPPurchasePackage] = Field(default=None, description="購入パッケージ（購入取引の場合）")

    purchase_amount: Optional[int] = Field(default=None, ge=0, description="購入金額（円）")

    payment_method: Optional[str] = Field(default=None, description="決済方法")

    payment_transaction_id: Optional[str] = Field(
        default=None, index=True, description="決済トランザクションID（決済プロバイダーのID）"
    )

    # タイムスタンプ
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True, description="取引日時")

    # Relationships
    player_sp: Optional["PlayerSP"] = Relationship(back_populates="transactions")
    user: Optional["User"] = Relationship(back_populates="sp_transactions")

    def __repr__(self) -> str:
        return (
            f"<SPTransaction(id={self.id}, type={self.transaction_type.value}, "
            f"amount={self.amount}, user_id={self.user_id})>"
        )
