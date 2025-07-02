"""
SPサブスクリプションサービス
"""

from datetime import datetime, timedelta
from typing import Any, ClassVar, Optional

from sqlalchemy import and_
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.logging import get_logger
from app.models.sp import SPSubscriptionType
from app.models.sp_subscription import SPSubscription, SubscriptionStatus, SubscriptionTransaction
from app.models.user import User
from app.schemas.sp_subscription import (
    SPSubscriptionCancel,
    SPSubscriptionCreate,
    SPSubscriptionResponse,
    SPSubscriptionUpdate,
    SubscriptionBenefits,
)
from app.services.sp_service import SPService
from app.services.stripe_service import StripeService

logger = get_logger(__name__)


class SPSubscriptionService:
    """SPサブスクリプション管理サービス"""

    # サブスクリプションプラン定義
    SUBSCRIPTION_PLANS: ClassVar[dict[SPSubscriptionType, dict[str, Any]]] = {
        SPSubscriptionType.BASIC: {
            "name": "ベーシックパス",
            "price": 1000,
            "daily_bonus": 20,
            "discount_rate": 0.1,
            "features": [
                "毎日20SPボーナス",
                "SP消費10%割引",
                "限定ログフラグメント出現率UP",
            ],
            "stripe_price_id": settings.STRIPE_SUBSCRIPTION_BASIC_PRICE_ID,
        },
        SPSubscriptionType.PREMIUM: {
            "name": "プレミアムパス",
            "price": 2500,
            "daily_bonus": 50,
            "discount_rate": 0.2,
            "features": [
                "毎日50SPボーナス",
                "SP消費20%割引",
                "限定ログフラグメント出現率大幅UP",
                "専用ログフラグメント",
                "月1回の特別ログ編纂チケット",
            ],
            "stripe_price_id": settings.STRIPE_SUBSCRIPTION_PREMIUM_PRICE_ID,
        },
    }

    def __init__(self, db: Session):
        self.db = db
        self.stripe_service = StripeService()
        self.sp_service = SPService(db)

    def get_subscription_plans(self) -> list[SubscriptionBenefits]:
        """利用可能なサブスクリプションプランを取得"""
        plans = []
        for sub_type, plan_info in self.SUBSCRIPTION_PLANS.items():
            plans.append(
                SubscriptionBenefits(
                    subscription_type=sub_type,
                    name=str(plan_info["name"]),
                    price=int(plan_info["price"]),
                    daily_bonus=int(plan_info["daily_bonus"]),
                    discount_rate=float(plan_info["discount_rate"]),
                    features=list(plan_info["features"]),
                )
            )
        return plans

    def get_active_subscription(self, user_id: str) -> Optional[SPSubscription]:
        """ユーザーの有効なサブスクリプションを取得"""
        stmt = select(SPSubscription).where(
            and_(
                col(SPSubscription.user_id) == user_id,
                col(SPSubscription.status) == SubscriptionStatus.ACTIVE,
                col(SPSubscription.expires_at) > datetime.utcnow(),
            )
        )
        return self.db.exec(stmt).first()

    def get_user_subscriptions(self, user_id: str) -> list[SPSubscription]:
        """ユーザーの全サブスクリプション履歴を取得"""
        stmt = (
            select(SPSubscription)
            .where(col(SPSubscription.user_id) == user_id)
            .order_by(col(SPSubscription.created_at).desc())
        )
        return list(self.db.exec(stmt).all())

    async def create_subscription(
        self, user_id: str, data: SPSubscriptionCreate
    ) -> dict:
        """サブスクリプションを作成"""
        try:
            # ユーザー取得
            user = self.db.get(User, user_id)
            if not user:
                return {
                    "success": False,
                    "message": "ユーザーが見つかりません",
                }

            # 既存の有効なサブスクリプションをチェック
            active_sub = self.get_active_subscription(user_id)
            if active_sub:
                return {
                    "success": False,
                    "message": "既に有効なサブスクリプションがあります",
                }

            plan_info = self.SUBSCRIPTION_PLANS.get(data.subscription_type)
            if not plan_info:
                return {
                    "success": False,
                    "message": "無効なサブスクリプションタイプです",
                }

            # テストモードの場合
            if settings.SP_PURCHASE_TEST_MODE:
                # 即座にサブスクリプションを有効化
                subscription = SPSubscription(
                    user_id=user_id,
                    subscription_type=data.subscription_type,
                    status=SubscriptionStatus.ACTIVE,
                    started_at=datetime.utcnow(),
                    expires_at=datetime.utcnow() + timedelta(days=30),
                    price=plan_info["price"],
                    currency="jpy",
                    auto_renew=data.auto_renew,
                    next_billing_date=datetime.utcnow() + timedelta(days=30),
                )
                self.db.add(subscription)

                # PlayerSPも更新
                player_sp = await self.sp_service.get_or_create_player_sp(user_id)
                player_sp.active_subscription = data.subscription_type
                player_sp.subscription_expires_at = subscription.expires_at

                # 取引記録を作成
                transaction = SubscriptionTransaction(
                    subscription_id=subscription.id,
                    transaction_type="purchase",
                    amount=plan_info["price"],
                    status="completed",
                )
                self.db.add(transaction)

                self.db.commit()

                logger.info(
                    "Test mode subscription created",
                    user_id=user_id,
                    subscription_id=subscription.id,
                    type=data.subscription_type,
                )

                return {
                    "success": True,
                    "subscription_id": subscription.id,
                    "message": "サブスクリプションが有効になりました（テストモード）",
                    "test_mode": True,
                }

            # 本番モードの場合
            else:
                # Stripe顧客を作成または取得
                stripe_customer_id = await self._get_or_create_stripe_customer(user)

                # Stripeサブスクリプションを作成
                stripe_data = await self.stripe_service.create_subscription(
                    customer_id=stripe_customer_id,
                    price_id=str(plan_info["stripe_price_id"]),
                    payment_method_id=data.payment_method_id,
                    trial_days=data.trial_days,
                    metadata={
                        "user_id": user_id,
                        "subscription_type": data.subscription_type,
                    },
                )

                if not stripe_data["success"]:
                    return stripe_data

                # サブスクリプションレコードを作成（Pending状態）
                subscription = SPSubscription(
                    user_id=user_id,
                    subscription_type=data.subscription_type,
                    status=SubscriptionStatus.PENDING,
                    stripe_subscription_id=stripe_data["subscription_id"],
                    stripe_customer_id=stripe_customer_id,
                    stripe_payment_method_id=data.payment_method_id,
                    price=plan_info["price"],
                    currency="jpy",
                    auto_renew=data.auto_renew,
                    trial_end=(
                        datetime.utcnow() + timedelta(days=data.trial_days)
                        if data.trial_days
                        else None
                    ),
                )
                self.db.add(subscription)

                # 取引記録を作成
                transaction = SubscriptionTransaction(
                    subscription_id=subscription.id,
                    transaction_type="purchase",
                    amount=plan_info["price"],
                    status="pending",
                )
                self.db.add(transaction)

                self.db.commit()

                return {
                    "success": True,
                    "subscription_id": subscription.id,
                    "checkout_url": stripe_data.get("checkout_url"),
                    "message": "サブスクリプションの購入手続きを開始しました",
                    "test_mode": False,
                }

        except Exception as e:
            logger.error(
                "Failed to create subscription",
                user_id=user_id,
                error=str(e),
            )
            self.db.rollback()
            return {
                "success": False,
                "message": "サブスクリプションの作成に失敗しました",
            }

    async def cancel_subscription(
        self, user_id: str, data: SPSubscriptionCancel
    ) -> dict:
        """サブスクリプションをキャンセル"""
        try:
            # アクティブなサブスクリプションを取得
            subscription = self.get_active_subscription(user_id)
            if not subscription:
                return {
                    "success": False,
                    "message": "有効なサブスクリプションがありません",
                }

            # テストモードの場合
            if settings.SP_PURCHASE_TEST_MODE or not subscription.stripe_subscription_id:
                # 即座にキャンセル処理
                if data.immediate:
                    subscription.status = SubscriptionStatus.CANCELLED
                    subscription.expires_at = datetime.utcnow()
                else:
                    # 期限まで有効
                    subscription.auto_renew = False

                subscription.cancelled_at = datetime.utcnow()

                # PlayerSPも更新
                player_sp = await self.sp_service.get_or_create_player_sp(user_id)
                if data.immediate:
                    player_sp.active_subscription = None
                    player_sp.subscription_expires_at = None

                self.db.commit()

                return {
                    "success": True,
                    "message": (
                        "サブスクリプションをキャンセルしました"
                        if data.immediate
                        else f"サブスクリプションは{subscription.expires_at}まで有効です"
                    ),
                }

            # 本番モードの場合
            else:
                # Stripeでキャンセル
                stripe_result = await self.stripe_service.cancel_subscription(
                    subscription.stripe_subscription_id,
                    immediate=data.immediate,
                )

                if not stripe_result["success"]:
                    return stripe_result

                # サブスクリプションレコードを更新
                subscription.cancelled_at = datetime.utcnow()
                if data.immediate:
                    subscription.status = SubscriptionStatus.CANCELLED
                    subscription.expires_at = datetime.utcnow()
                else:
                    subscription.auto_renew = False

                # 取引記録を作成
                transaction = SubscriptionTransaction(
                    subscription_id=subscription.id,
                    transaction_type="cancel",
                    amount=0,
                    status="completed",
                    metadata={"reason": data.reason} if data.reason else {},
                )
                self.db.add(transaction)

                self.db.commit()

                return {
                    "success": True,
                    "message": stripe_result["message"],
                }

        except Exception as e:
            logger.error(
                "Failed to cancel subscription",
                user_id=user_id,
                error=str(e),
            )
            self.db.rollback()
            return {
                "success": False,
                "message": "サブスクリプションのキャンセルに失敗しました",
            }

    async def update_subscription(
        self, user_id: str, data: SPSubscriptionUpdate
    ) -> dict:
        """サブスクリプションを更新"""
        try:
            # アクティブなサブスクリプションを取得
            subscription = self.get_active_subscription(user_id)
            if not subscription:
                return {
                    "success": False,
                    "message": "有効なサブスクリプションがありません",
                }

            # 自動更新フラグを更新
            if data.auto_renew is not None:
                subscription.auto_renew = data.auto_renew

            # 決済方法を更新（本番モードのみ）
            if data.payment_method_id and subscription.stripe_subscription_id:
                stripe_result = await self.stripe_service.update_subscription_payment_method(
                    subscription.stripe_subscription_id,
                    data.payment_method_id,
                )
                if not stripe_result["success"]:
                    return stripe_result

                subscription.stripe_payment_method_id = data.payment_method_id

            self.db.commit()

            return {
                "success": True,
                "message": "サブスクリプションを更新しました",
            }

        except Exception as e:
            logger.error(
                "Failed to update subscription",
                user_id=user_id,
                error=str(e),
            )
            self.db.rollback()
            return {
                "success": False,
                "message": "サブスクリプションの更新に失敗しました",
            }

    async def activate_subscription(self, subscription_id: str) -> bool:
        """サブスクリプションを有効化（Webhookから呼ばれる）"""
        try:
            subscription = self.db.get(SPSubscription, subscription_id)
            if not subscription:
                logger.error("Subscription not found", subscription_id=subscription_id)
                return False

            # サブスクリプションを有効化
            subscription.status = SubscriptionStatus.ACTIVE
            subscription.started_at = datetime.utcnow()
            subscription.expires_at = datetime.utcnow() + timedelta(days=30)
            subscription.next_billing_date = subscription.expires_at

            # PlayerSPも更新
            player_sp = await self.sp_service.get_or_create_player_sp(subscription.user_id)
            player_sp.active_subscription = subscription.subscription_type
            player_sp.subscription_expires_at = subscription.expires_at

            # 取引記録を更新
            stmt = select(SubscriptionTransaction).where(
                and_(
                    col(SubscriptionTransaction.subscription_id) == subscription_id,
                    col(SubscriptionTransaction.transaction_type) == "purchase",
                    col(SubscriptionTransaction.status) == "pending",
                )
            )
            transaction = self.db.exec(stmt).first()
            if transaction:
                transaction.status = "completed"

            self.db.commit()

            logger.info(
                "Subscription activated",
                subscription_id=subscription_id,
                user_id=subscription.user_id,
            )

            return True

        except Exception as e:
            logger.error(
                "Failed to activate subscription",
                subscription_id=subscription_id,
                error=str(e),
            )
            self.db.rollback()
            return False

    def to_response(self, subscription: SPSubscription) -> SPSubscriptionResponse:
        """サブスクリプションをレスポンス形式に変換"""
        now = datetime.utcnow()
        is_active = (
            subscription.status == SubscriptionStatus.ACTIVE
            and subscription.expires_at
            and subscription.expires_at > now
        )

        days_remaining = None
        if is_active and subscription.expires_at:
            days_remaining = (subscription.expires_at - now).days

        is_trial = (
            subscription.trial_end is not None
            and subscription.trial_end > now
        )

        return SPSubscriptionResponse(
            **subscription.model_dump(),
            is_active=bool(is_active),
            days_remaining=days_remaining,
            is_trial=is_trial,
        )

    async def _get_or_create_stripe_customer(self, user: User) -> str:
        """Stripe顧客を取得または作成"""
        # 既存のサブスクリプションから顧客IDを探す
        stmt = select(SPSubscription).where(
            and_(
                col(SPSubscription.user_id) == user.id,
                col(SPSubscription.stripe_customer_id).is_not(None),
            )
        ).limit(1)
        existing_sub = self.db.exec(stmt).first()

        if existing_sub and existing_sub.stripe_customer_id:
            return existing_sub.stripe_customer_id

        # 新規作成
        result = await self.stripe_service.create_customer(
            email=user.email,
            metadata={"user_id": user.id, "username": user.username},
        )

        if result["success"]:
            return str(result["customer_id"])
        else:
            raise Exception(f"Failed to create Stripe customer: {result['message']}")
