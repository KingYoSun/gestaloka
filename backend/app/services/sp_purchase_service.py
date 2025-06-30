"""SP購入サービス"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import and_, desc, func, select
from sqlmodel import Session, col

from app.core.config import settings
from app.core.sp_plans import SP_PLANS, SPPlan
from app.models.sp import SPTransactionType
from app.models.sp_purchase import PaymentMode, PurchaseStatus, SPPurchase
from app.models.user import User
from app.services.sp_service import SPService


class SPPurchaseService:
    """SP購入サービス"""

    @staticmethod
    def get_plans() -> list[SPPlan]:
        """価格プラン一覧を取得"""
        plans = list(SP_PLANS.values())

        # 価格調整係数を適用
        if settings.SP_PRICE_MULTIPLIER != 1.0:
            for plan in plans:
                plan.price_jpy = int(plan.price_jpy * settings.SP_PRICE_MULTIPLIER)

        return plans

    @staticmethod
    def create_purchase(
        db: Session, user_id: str, plan_id: str, test_reason: Optional[str] = None
    ) -> SPPurchase:
        """SP購入申請を作成"""
        # プランの存在確認
        if plan_id not in SP_PLANS:
            raise ValueError(f"Invalid plan_id: {plan_id}")

        plan = SP_PLANS[plan_id]

        # ユーザーの存在確認
        user = db.get(User, user_id)
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
        db.commit()
        db.refresh(purchase)

        # テストモードで自動承認が有効な場合
        if settings.PAYMENT_MODE == "test" and settings.TEST_MODE_AUTO_APPROVE:
            # 承認遅延がある場合はTODO: Celeryタスクで処理
            if settings.TEST_MODE_APPROVAL_DELAY > 0:
                # TODO: Celeryタスクとして実装
                pass
            else:
                # 即座に承認
                purchase, event_type, error = SPPurchaseService.approve_test_purchase(db, purchase.id, system_approved=True)
                # Note: WebSocket events for auto-approval should be handled by the caller if needed
                # Return the updated purchase object
                return purchase

        # WebSocketイベント送信はAPIエンドポイントで処理

        return purchase

    # 削除: _delayed_auto_approveメソッドは不要（Celeryタスクで実装すべき）

    @staticmethod
    def approve_test_purchase(
        db: Session,
        purchase_id: uuid.UUID,
        approved_by_user_id: Optional[str] = None,
        system_approved: bool = False,
    ) -> tuple[SPPurchase, str, Optional[str]]:
        """テスト購入を承認"""
        # 購入申請取得
        purchase = db.get(SPPurchase, purchase_id)

        if not purchase:
            raise ValueError(f"Purchase not found: {purchase_id}")

        if purchase.status != PurchaseStatus.PENDING:
            raise ValueError(f"Purchase is not pending: {purchase.status}")

        if purchase.payment_mode != PaymentMode.TEST:
            raise ValueError("This method is only for test mode purchases")

        # ステータス更新
        purchase.status = PurchaseStatus.PROCESSING
        purchase.approved_by = uuid.UUID(approved_by_user_id) if approved_by_user_id and not system_approved else None
        purchase.approved_at = datetime.utcnow()
        purchase.updated_at = datetime.utcnow()

        try:
            # SP付与
            sp_service = SPService(db)
            sp_service.add_sp_sync(
                user_id=purchase.user_id,
                amount=purchase.sp_amount,
                transaction_type=SPTransactionType.PURCHASE,
                description=f"SP購入: {SP_PLANS[purchase.plan_id].name}",
                related_entity_type="sp_purchase",
                related_entity_id=str(purchase.id),
            )

            # ステータスを完了に更新
            purchase.status = PurchaseStatus.COMPLETED
            purchase.updated_at = datetime.utcnow()

            db.commit()
            db.refresh(purchase)

            # WebSocketイベント送信はAPIエンドポイントで処理
            return purchase, "completed", None

        except Exception as e:
            # エラー時はステータスを失敗に更新
            purchase.status = PurchaseStatus.FAILED
            purchase.updated_at = datetime.utcnow()
            db.commit()

            # WebSocketイベント送信はAPIエンドポイントで処理
            return purchase, "failed", str(e)

    @staticmethod
    def get_user_purchases(
        db: Session, user_id: str, status: Optional[PurchaseStatus] = None, limit: int = 20, offset: int = 0
    ) -> list[SPPurchase]:
        """ユーザーの購入履歴を取得"""
        query = select(SPPurchase).where(col(SPPurchase.user_id) == user_id)

        if status:
            query = query.where(col(SPPurchase.status) == status)

        query = query.order_by(col(SPPurchase.created_at).desc()).limit(limit).offset(offset)

        results = db.exec(query).all()  # type: ignore[call-overload]
        # db.exec() with SQLModel should return model instances directly
        return list(results)

    @staticmethod
    def get_purchase(db: Session, purchase_id: uuid.UUID, user_id: str) -> Optional[SPPurchase]:
        """購入詳細を取得"""
        purchase = db.get(SPPurchase, purchase_id)
        if purchase and purchase.user_id == user_id:
            return purchase
        return None

    @staticmethod
    def cancel_purchase(db: Session, purchase_id: uuid.UUID, user_id: str) -> SPPurchase:
        """購入をキャンセル"""
        purchase = SPPurchaseService.get_purchase(db, purchase_id, user_id)

        if not purchase:
            raise ValueError(f"Purchase not found: {purchase_id}")

        if purchase.status not in [PurchaseStatus.PENDING, PurchaseStatus.PROCESSING]:
            raise ValueError(f"Cannot cancel purchase with status: {purchase.status}")

        # ステータス更新
        purchase.status = PurchaseStatus.CANCELLED
        purchase.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(purchase)

        # WebSocketイベント送信はAPIエンドポイントで処理

        return purchase

    @staticmethod
    def get_purchase_stats(db: Session, user_id: str) -> dict:
        """ユーザーの購入統計を取得"""
        stmt = select(
            func.count(col(SPPurchase.id)).label("total_purchases"),
            func.sum(col(SPPurchase.sp_amount)).label("total_sp_purchased"),
            func.sum(col(SPPurchase.price_jpy)).label("total_spent_jpy"),
        ).where(and_(col(SPPurchase.user_id) == user_id, col(SPPurchase.status) == PurchaseStatus.COMPLETED))

        result = db.exec(stmt).one()  # type: ignore[call-overload]

        return {
            "total_purchases": result.total_purchases or 0,
            "total_sp_purchased": result.total_sp_purchased or 0,
            "total_spent_jpy": result.total_spent_jpy or 0,
        }
