"""Stripe設定とサービス"""

import stripe
from typing import Dict, Any, Optional
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class StripeConfig:
    """Stripe設定管理"""

    def __init__(self):
        # Stripe APIキーの設定
        self.stripe_api_key = settings.STRIPE_API_KEY
        self.stripe_webhook_secret = settings.STRIPE_WEBHOOK_SECRET
        self.stripe_price_ids = {
            "small": settings.STRIPE_PRICE_ID_SMALL,
            "medium": settings.STRIPE_PRICE_ID_MEDIUM,
            "large": settings.STRIPE_PRICE_ID_LARGE,
            "xlarge": settings.STRIPE_PRICE_ID_XLARGE,
        }
        
        # Stripe SDKの初期化
        if self.stripe_api_key:
            stripe.api_key = self.stripe_api_key
            logger.info("Stripe SDK initialized")
        else:
            logger.warning("Stripe API key not configured")

    @property
    def is_configured(self) -> bool:
        """Stripeが設定されているかチェック"""
        return bool(self.stripe_api_key)

    def get_price_id(self, plan_id: str) -> Optional[str]:
        """プランIDからStripe価格IDを取得"""
        return self.stripe_price_ids.get(plan_id)


stripe_config = StripeConfig()


class StripeService:
    """Stripe決済サービス"""

    def __init__(self):
        self.config = stripe_config

    async def create_checkout_session(
        self,
        plan_id: str,
        user_id: str,
        success_url: str,
        cancel_url: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """チェックアウトセッションを作成"""
        if not self.config.is_configured:
            raise ValueError("Stripe is not configured")

        price_id = self.config.get_price_id(plan_id)
        if not price_id:
            raise ValueError(f"Invalid plan_id: {plan_id}")

        try:
            # メタデータの準備
            session_metadata = {
                "user_id": user_id,
                "plan_id": plan_id,
            }
            if metadata:
                session_metadata.update(metadata)

            # チェックアウトセッションの作成
            session = stripe.checkout.Session.create(
                payment_method_types=["card"],
                line_items=[
                    {
                        "price": price_id,
                        "quantity": 1,
                    }
                ],
                mode="payment",
                success_url=success_url,
                cancel_url=cancel_url,
                metadata=session_metadata,
                client_reference_id=user_id,
            )

            logger.info(f"Created checkout session: {session.id} for user: {user_id}")
            return {
                "session_id": session.id,
                "url": session.url,
            }

        except stripe.error.StripeError as e:
            logger.error(f"Stripe error creating checkout session: {str(e)}")
            raise

    async def retrieve_session(self, session_id: str) -> stripe.checkout.Session:
        """チェックアウトセッションを取得"""
        if not self.config.is_configured:
            raise ValueError("Stripe is not configured")

        try:
            session = stripe.checkout.Session.retrieve(session_id)
            return session
        except stripe.error.StripeError as e:
            logger.error(f"Stripe error retrieving session: {str(e)}")
            raise

    async def create_payment_intent(
        self,
        amount: int,
        currency: str = "jpy",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> stripe.PaymentIntent:
        """支払いインテントを作成"""
        if not self.config.is_configured:
            raise ValueError("Stripe is not configured")

        try:
            intent = stripe.PaymentIntent.create(
                amount=amount,
                currency=currency,
                metadata=metadata or {},
            )
            logger.info(f"Created payment intent: {intent.id}")
            return intent
        except stripe.error.StripeError as e:
            logger.error(f"Stripe error creating payment intent: {str(e)}")
            raise

    def construct_webhook_event(self, payload: bytes, sig_header: str) -> stripe.Event:
        """Webhookイベントを構築・検証"""
        if not self.config.is_configured:
            raise ValueError("Stripe is not configured")

        if not self.config.stripe_webhook_secret:
            raise ValueError("Stripe webhook secret is not configured")

        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, self.config.stripe_webhook_secret
            )
            return event
        except ValueError as e:
            logger.error(f"Invalid webhook payload: {str(e)}")
            raise
        except stripe.error.SignatureVerificationError as e:
            logger.error(f"Invalid webhook signature: {str(e)}")
            raise


stripe_service = StripeService()