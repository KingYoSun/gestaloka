"""Stripe Webhookエンドポイント"""

from fastapi import APIRouter, Request, HTTPException, Depends
from sqlmodel import Session
import stripe

from app.api.deps import get_db
from app.core.logging import get_logger

logger = get_logger(__name__)
from app.core.stripe_config import stripe_service
from app.services.sp_purchase_service import SPPurchaseService
from app.websocket.events import emit_sp_purchase_event

router = APIRouter()


@router.post("/stripe/webhook")
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Stripe Webhookエンドポイント
    
    Stripeからの支払い完了通知を受け取り、SP購入を処理します
    """
    # Stripeが設定されているかチェック
    if not stripe_service.config.is_configured:
        logger.error("Stripe webhook called but Stripe is not configured")
        raise HTTPException(status_code=500, detail="Stripe is not configured")

    # リクエストボディとヘッダーを取得
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    if not sig_header:
        logger.error("Missing stripe-signature header")
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")

    try:
        # Webhookイベントを構築・検証
        event = stripe_service.construct_webhook_event(payload, sig_header)
        logger.info(f"Received Stripe webhook event: {event['type']}")

    except ValueError as e:
        logger.error(f"Invalid webhook payload: {str(e)}")
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError as e:
        logger.error(f"Invalid webhook signature: {str(e)}")
        raise HTTPException(status_code=400, detail="Invalid signature")

    # イベントタイプごとの処理
    if event["type"] == "checkout.session.completed":
        await handle_checkout_completed(event["data"]["object"], db)
    elif event["type"] == "payment_intent.succeeded":
        await handle_payment_succeeded(event["data"]["object"], db)
    elif event["type"] == "payment_intent.payment_failed":
        await handle_payment_failed(event["data"]["object"], db)
    else:
        logger.info(f"Unhandled webhook event type: {event['type']}")

    return {"received": True}


async def handle_checkout_completed(session: dict, db: Session):
    """チェックアウト完了時の処理"""
    logger.info(f"Processing checkout.session.completed: {session['id']}")
    
    # メタデータから購入情報を取得
    metadata = session.get("metadata", {})
    purchase_id = metadata.get("purchase_id")
    
    if not purchase_id:
        logger.error("No purchase_id in checkout session metadata")
        return

    try:
        # 購入を承認
        purchase = SPPurchaseService.approve_purchase_by_stripe(
            db=db,
            purchase_id=purchase_id,
            stripe_session_id=session["id"],
            payment_intent_id=session.get("payment_intent")
        )
        
        if purchase:
            # WebSocketイベント送信
            await emit_sp_purchase_event(
                user_id=purchase.user_id,
                event_type="purchase_completed",
                purchase_id=str(purchase.id),
                status=purchase.status.value,
                sp_amount=purchase.sp_amount,
            )
            logger.info(f"Purchase {purchase_id} approved via Stripe webhook")
        else:
            logger.error(f"Failed to approve purchase {purchase_id}")
            
    except Exception as e:
        logger.error(f"Error processing checkout completed: {str(e)}")


async def handle_payment_succeeded(payment_intent: dict, db: Session):
    """支払い成功時の処理"""
    logger.info(f"Processing payment_intent.succeeded: {payment_intent['id']}")
    # 通常はcheckout.session.completedで処理するため、ここでは追加処理は不要


async def handle_payment_failed(payment_intent: dict, db: Session):
    """支払い失敗時の処理"""
    logger.info(f"Processing payment_intent.payment_failed: {payment_intent['id']}")
    
    # メタデータから購入情報を取得
    metadata = payment_intent.get("metadata", {})
    purchase_id = metadata.get("purchase_id")
    
    if purchase_id:
        try:
            # 購入を失敗状態に更新
            purchase = SPPurchaseService.fail_purchase(
                db=db,
                purchase_id=purchase_id,
                reason="Payment failed"
            )
            
            if purchase:
                # WebSocketイベント送信
                await emit_sp_purchase_event(
                    user_id=purchase.user_id,
                    event_type="purchase_failed",
                    purchase_id=str(purchase.id),
                    status=purchase.status.value,
                    sp_amount=purchase.sp_amount,
                )
                logger.info(f"Purchase {purchase_id} marked as failed")
                
        except Exception as e:
            logger.error(f"Error processing payment failed: {str(e)}")