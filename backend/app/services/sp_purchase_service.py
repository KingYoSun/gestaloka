"""SP購入サービス"""

import asyncio
import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.sp_plans import SP_PLANS, SPPlan
from app.models.sp import PlayerSP, SPTransaction, SPTransactionType
from app.models.sp_purchase import PaymentMode, PurchaseStatus, SPPurchase
from app.models.user import User
from app.services.sp_service import SPService
from app.websocket.events import emit_sp_purchase_event


class SPPurchaseService:
    """SP購入サービス"""

    @staticmethod
    async def get_plans() -> List[SPPlan]:
        """価格プラン一覧を取得"""
        plans = list(SP_PLANS.values())

        # 価格調整係数を適用
        if settings.SP_PRICE_MULTIPLIER != 1.0:
            for plan in plans:
                plan.price_jpy = int(plan.price_jpy * settings.SP_PRICE_MULTIPLIER)

        return plans

    @staticmethod
    async def create_purchase(
        db: AsyncSession, user_id: str, plan_id: str, test_reason: Optional[str] = None
    ) -> SPPurchase:
        """SP購入申請を作成"""
        # プランの存在確認
        if plan_id not in SP_PLANS:
            raise ValueError(f"Invalid plan_id: {plan_id}")

        plan = SP_PLANS[plan_id]

        # ユーザーの存在確認
        user = await db.get(User, user_id)
        if not user:
            raise ValueError(f"User not found: {user_id}")

        # 購入申請作成
        purchase = SPPurchase(
            user_id=user_id,
            plan_id=plan_id,
            sp_amount=plan.sp_amount,
            price_jpy=int(plan.price_jpy * settings.SP_PRICE_MULTIPLIER),
            payment_mode=PaymentMode(settings.PAYMENT_MODE),
            test_reason=test_reason if settings.PAYMENT_MODE == "test" else None,
        )

        db.add(purchase)
        await db.commit()
        await db.refresh(purchase)

        # テストモードで自動承認が有効な場合
        if settings.PAYMENT_MODE == "test" and settings.TEST_MODE_AUTO_APPROVE:
            # 承認遅延がある場合は非同期で処理
            if settings.TEST_MODE_APPROVAL_DELAY > 0:
                asyncio.create_task(
                    SPPurchaseService._delayed_auto_approve(purchase.id, settings.TEST_MODE_APPROVAL_DELAY)
                )
            else:
                # 即座に承認
                await SPPurchaseService.approve_test_purchase(db, purchase.id, system_approved=True)

        # WebSocketイベント送信
        await emit_sp_purchase_event(
            user_id=user_id,
            event_type="purchase_created",
            purchase_id=str(purchase.id),
            status=purchase.status.value,
            sp_amount=purchase.sp_amount,
        )

        return purchase

    @staticmethod
    async def _delayed_auto_approve(purchase_id: uuid.UUID, delay: int):
        """遅延自動承認（非同期タスク）"""
        await asyncio.sleep(delay)

        # 新しいDBセッションを作成
        from app.db.database import get_async_db

        async for db in get_async_db():
            try:
                await SPPurchaseService.approve_test_purchase(db, purchase_id, system_approved=True)
            finally:
                await db.close()

    @staticmethod
    async def approve_test_purchase(
        db: AsyncSession,
        purchase_id: uuid.UUID,
        approved_by_user_id: Optional[str] = None,
        system_approved: bool = False,
    ) -> SPPurchase:
        """テスト購入を承認"""
        # 購入申請取得
        result = await db.execute(
            select(SPPurchase).options(selectinload(SPPurchase.user)).where(SPPurchase.id == purchase_id)
        )
        purchase = result.scalar_one_or_none()

        if not purchase:
            raise ValueError(f"Purchase not found: {purchase_id}")

        if purchase.status != PurchaseStatus.PENDING:
            raise ValueError(f"Purchase is not pending: {purchase.status}")

        if purchase.payment_mode != PaymentMode.TEST:
            raise ValueError("This method is only for test mode purchases")

        # ステータス更新
        purchase.status = PurchaseStatus.PROCESSING
        purchase.approved_by = approved_by_user_id if not system_approved else None
        purchase.approved_at = datetime.utcnow()
        purchase.updated_at = datetime.utcnow()

        try:
            # SP付与
            sp_service = SPService()
            await sp_service.add_sp(
                db=db,
                user_id=purchase.user_id,
                amount=purchase.sp_amount,
                transaction_type=SPTransactionType.PURCHASE,
                reference_id=str(purchase.id),
                description=f"SP購入: {SP_PLANS[purchase.plan_id].name}",
            )

            # ステータスを完了に更新
            purchase.status = PurchaseStatus.COMPLETED
            purchase.updated_at = datetime.utcnow()

            await db.commit()
            await db.refresh(purchase)

            # WebSocketイベント送信
            await emit_sp_purchase_event(
                user_id=purchase.user_id,
                event_type="purchase_completed",
                purchase_id=str(purchase.id),
                status=purchase.status.value,
                sp_amount=purchase.sp_amount,
            )

        except Exception as e:
            # エラー時はステータスを失敗に更新
            purchase.status = PurchaseStatus.FAILED
            purchase.updated_at = datetime.utcnow()
            await db.commit()

            # WebSocketイベント送信
            await emit_sp_purchase_event(
                user_id=purchase.user_id,
                event_type="purchase_failed",
                purchase_id=str(purchase.id),
                status=purchase.status.value,
                sp_amount=purchase.sp_amount,
                error=str(e),
            )

            raise

        return purchase

    @staticmethod
    async def get_user_purchases(
        db: AsyncSession, user_id: str, status: Optional[PurchaseStatus] = None, limit: int = 20, offset: int = 0
    ) -> List[SPPurchase]:
        """ユーザーの購入履歴を取得"""
        query = select(SPPurchase).where(SPPurchase.user_id == user_id)

        if status:
            query = query.where(SPPurchase.status == status)

        query = query.order_by(SPPurchase.created_at.desc()).limit(limit).offset(offset)

        result = await db.execute(query)
        return list(result.scalars().all())

    @staticmethod
    async def get_purchase(db: AsyncSession, purchase_id: uuid.UUID, user_id: str) -> Optional[SPPurchase]:
        """購入詳細を取得"""
        result = await db.execute(
            select(SPPurchase).where(and_(SPPurchase.id == purchase_id, SPPurchase.user_id == user_id))
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def cancel_purchase(db: AsyncSession, purchase_id: uuid.UUID, user_id: str) -> SPPurchase:
        """購入をキャンセル"""
        purchase = await SPPurchaseService.get_purchase(db, purchase_id, user_id)

        if not purchase:
            raise ValueError(f"Purchase not found: {purchase_id}")

        if purchase.status not in [PurchaseStatus.PENDING, PurchaseStatus.PROCESSING]:
            raise ValueError(f"Cannot cancel purchase with status: {purchase.status}")

        # ステータス更新
        purchase.status = PurchaseStatus.CANCELLED
        purchase.updated_at = datetime.utcnow()

        await db.commit()
        await db.refresh(purchase)

        # WebSocketイベント送信
        await emit_sp_purchase_event(
            user_id=user_id,
            event_type="purchase_cancelled",
            purchase_id=str(purchase.id),
            status=purchase.status.value,
            sp_amount=purchase.sp_amount,
        )

        return purchase

    @staticmethod
    async def get_purchase_stats(db: AsyncSession, user_id: str) -> dict:
        """ユーザーの購入統計を取得"""
        result = await db.execute(
            select(
                func.count(SPPurchase.id).label("total_purchases"),
                func.sum(SPPurchase.sp_amount).label("total_sp_purchased"),
                func.sum(SPPurchase.price_jpy).label("total_spent_jpy"),
            ).where(and_(SPPurchase.user_id == user_id, SPPurchase.status == PurchaseStatus.COMPLETED))
        )

        stats = result.one()

        return {
            "total_purchases": stats.total_purchases or 0,
            "total_sp_purchased": stats.total_sp_purchased or 0,
            "total_spent_jpy": stats.total_spent_jpy or 0,
        }
