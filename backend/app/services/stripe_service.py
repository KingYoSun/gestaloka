"""
Stripe統合サービス
"""

from typing import Any, Optional, cast

import stripe
from stripe import Customer, Subscription
from stripe.error import SignatureVerificationError, StripeError

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class StripeService:
    """Stripe API統合サービス"""

    def __init__(self):
        stripe.api_key = settings.STRIPE_SECRET_KEY or settings.STRIPE_API_KEY

    async def create_checkout_session(
        self,
        price_id: str,
        success_url: str,
        cancel_url: str,
        metadata: dict[str, Any],
        mode: str = "payment",
    ) -> dict[str, Any]:
        """Stripeチェックアウトセッションを作成"""
        try:
            session = stripe.checkout.Session.create(
                payment_method_types=["card"],
                line_items=[
                    {
                        "price": price_id,
                        "quantity": 1,
                    }
                ],
                mode=mode,
                success_url=success_url,
                cancel_url=cancel_url,
                metadata=metadata,
            )

            return {
                "success": True,
                "session_id": session.id,
                "checkout_url": session.url,
            }

        except StripeError as e:
            logger.error("Failed to create checkout session", error=str(e))
            return {
                "success": False,
                "message": "決済セッションの作成に失敗しました",
            }

    async def create_customer(self, email: str, metadata: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        """Stripe顧客を作成"""
        try:
            customer = stripe.Customer.create(
                email=email,
                metadata=metadata or {},
            )

            return {
                "success": True,
                "customer_id": customer.id,
            }

        except StripeError as e:
            logger.error("Failed to create customer", error=str(e))
            return {
                "success": False,
                "message": "顧客の作成に失敗しました",
            }

    async def create_subscription(
        self,
        customer_id: str,
        price_id: str,
        payment_method_id: Optional[str] = None,
        trial_days: Optional[int] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Stripeサブスクリプションを作成"""
        try:
            # 決済方法を顧客に紐付け
            if payment_method_id:
                stripe.PaymentMethod.attach(
                    payment_method_id,
                    customer=customer_id,
                )

                # デフォルトの決済方法として設定
                stripe.Customer.modify(
                    customer_id,
                    invoice_settings={
                        "default_payment_method": payment_method_id,
                    },
                )

            # サブスクリプションを作成
            subscription_params = {
                "customer": customer_id,
                "items": [{"price": price_id}],
                "metadata": metadata or {},
            }

            # 試用期間を設定
            if trial_days:
                subscription_params["trial_period_days"] = trial_days

            subscription = stripe.Subscription.create(**subscription_params)

            return {
                "success": True,
                "subscription_id": subscription.id,
                "status": subscription.status,
            }

        except StripeError as e:
            logger.error("Failed to create subscription", error=str(e))
            return {
                "success": False,
                "message": "サブスクリプションの作成に失敗しました",
            }

    async def cancel_subscription(self, subscription_id: str, immediate: bool = False) -> dict[str, Any]:
        """Stripeサブスクリプションをキャンセル"""
        try:
            if immediate:
                # 即座にキャンセル
                stripe.Subscription.cancel(subscription_id)
            else:
                # 期限まで有効（自動更新を無効化）
                stripe.Subscription.modify(
                    subscription_id,
                    cancel_at_period_end=True,
                )

            return {
                "success": True,
                "message": (
                    "サブスクリプションをキャンセルしました" if immediate else "サブスクリプションは期限まで有効です"
                ),
            }

        except StripeError as e:
            logger.error("Failed to cancel subscription", error=str(e))
            return {
                "success": False,
                "message": "サブスクリプションのキャンセルに失敗しました",
            }

    async def update_subscription_payment_method(self, subscription_id: str, payment_method_id: str) -> dict[str, Any]:
        """サブスクリプションの決済方法を更新"""
        try:
            # サブスクリプションを取得
            subscription = cast(Subscription, stripe.Subscription.retrieve(subscription_id))
            customer_id = (
                str(subscription.customer) if isinstance(subscription.customer, Customer) else subscription.customer
            )

            # 決済方法を顧客に紐付け
            stripe.PaymentMethod.attach(
                payment_method_id,
                customer=customer_id,
            )

            # デフォルトの決済方法として設定
            stripe.Customer.modify(
                customer_id,
                invoice_settings={
                    "default_payment_method": payment_method_id,
                },
            )

            return {
                "success": True,
                "message": "決済方法を更新しました",
            }

        except StripeError as e:
            logger.error("Failed to update payment method", error=str(e))
            return {
                "success": False,
                "message": "決済方法の更新に失敗しました",
            }

    def verify_webhook_signature(self, payload: bytes, signature: str) -> Optional[dict[str, Any]]:
        """Webhookの署名を検証してイベントを返す"""
        try:
            event = stripe.Webhook.construct_event(payload, signature, settings.STRIPE_WEBHOOK_SECRET)
            return event
        except ValueError:
            logger.error("Invalid webhook payload")
            return None
        except SignatureVerificationError:
            logger.error("Invalid webhook signature")
            return None
