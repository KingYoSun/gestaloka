"""SP購入システムのテスト"""

import uuid
from datetime import datetime
from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.sp_purchase import PaymentMode, PurchaseStatus, SPPurchase
from app.models.user import User
from app.services.sp_purchase_service import SPPurchaseService


@pytest.mark.asyncio
class TestSPPurchaseService:
    """SP購入サービスのテスト"""

    async def test_get_plans(self):
        """価格プラン一覧取得のテスト"""
        plans = await SPPurchaseService.get_plans()
        
        assert len(plans) == 4
        assert plans[0].id == "small"
        assert plans[1].id == "medium"
        assert plans[2].id == "large"
        assert plans[3].id == "xlarge"
        
        # ボーナスの検証
        assert plans[0].bonus_percentage == 0
        assert plans[1].bonus_percentage == 25
        assert plans[2].bonus_percentage == 50
        assert plans[3].bonus_percentage == 100

    async def test_create_purchase_test_mode(self, db: AsyncSession, test_user: User):
        """テストモードでの購入申請作成のテスト"""
        # 設定をテストモードに
        original_mode = settings.PAYMENT_MODE
        settings.PAYMENT_MODE = "test"
        
        try:
            purchase = await SPPurchaseService.create_purchase(
                db=db,
                user_id=test_user.id,
                plan_id="small",
                test_reason="テスト購入のため"
            )
            
            assert purchase.user_id == test_user.id
            assert purchase.plan_id == "small"
            assert purchase.sp_amount == 100
            assert purchase.price_jpy == 500
            assert purchase.payment_mode == PaymentMode.TEST
            assert purchase.test_reason == "テスト購入のため"
            assert purchase.status == PurchaseStatus.PENDING
            
        finally:
            settings.PAYMENT_MODE = original_mode

    async def test_create_purchase_invalid_plan(self, db: AsyncSession, test_user: User):
        """無効なプランIDでの購入申請のテスト"""
        with pytest.raises(ValueError) as exc:
            await SPPurchaseService.create_purchase(
                db=db,
                user_id=test_user.id,
                plan_id="invalid_plan",
                test_reason="テスト"
            )
        
        assert "Invalid plan_id" in str(exc.value)

    async def test_create_purchase_invalid_user(self, db: AsyncSession):
        """無効なユーザーIDでの購入申請のテスト"""
        with pytest.raises(ValueError) as exc:
            await SPPurchaseService.create_purchase(
                db=db,
                user_id="invalid_user_id",
                plan_id="small",
                test_reason="テスト"
            )
        
        assert "User not found" in str(exc.value)

    async def test_approve_test_purchase(self, db: AsyncSession, test_user: User):
        """テスト購入の承認のテスト"""
        # 購入申請作成
        original_mode = settings.PAYMENT_MODE
        settings.PAYMENT_MODE = "test"
        
        try:
            purchase = await SPPurchaseService.create_purchase(
                db=db,
                user_id=test_user.id,
                plan_id="medium",
                test_reason="承認テスト"
            )
            
            # 承認
            with patch("app.services.sp_service.SPService.add_sp") as mock_add_sp:
                mock_add_sp.return_value = None
                
                approved = await SPPurchaseService.approve_test_purchase(
                    db=db,
                    purchase_id=purchase.id,
                    system_approved=True
                )
                
                assert approved.status == PurchaseStatus.COMPLETED
                assert approved.approved_at is not None
                mock_add_sp.assert_called_once()
                
        finally:
            settings.PAYMENT_MODE = original_mode

    async def test_get_user_purchases(self, db: AsyncSession, test_user: User):
        """ユーザー購入履歴取得のテスト"""
        # テストデータ作成
        for i in range(3):
            purchase = SPPurchase(
                user_id=test_user.id,
                plan_id="small",
                sp_amount=100,
                price_jpy=500,
                status=PurchaseStatus.COMPLETED if i == 0 else PurchaseStatus.PENDING,
                payment_mode=PaymentMode.TEST
            )
            db.add(purchase)
        
        await db.commit()
        
        # 全履歴取得
        purchases = await SPPurchaseService.get_user_purchases(
            db=db,
            user_id=test_user.id
        )
        
        assert len(purchases) >= 3
        
        # ステータスフィルタ
        completed = await SPPurchaseService.get_user_purchases(
            db=db,
            user_id=test_user.id,
            status=PurchaseStatus.COMPLETED
        )
        
        assert len(completed) >= 1
        assert all(p.status == PurchaseStatus.COMPLETED for p in completed)

    async def test_cancel_purchase(self, db: AsyncSession, test_user: User):
        """購入キャンセルのテスト"""
        # 購入申請作成
        purchase = SPPurchase(
            user_id=test_user.id,
            plan_id="large",
            sp_amount=600,
            price_jpy=2000,
            status=PurchaseStatus.PENDING,
            payment_mode=PaymentMode.TEST
        )
        db.add(purchase)
        await db.commit()
        
        # キャンセル
        cancelled = await SPPurchaseService.cancel_purchase(
            db=db,
            purchase_id=purchase.id,
            user_id=test_user.id
        )
        
        assert cancelled.status == PurchaseStatus.CANCELLED
        assert cancelled.updated_at > purchase.created_at

    async def test_cancel_completed_purchase_fails(self, db: AsyncSession, test_user: User):
        """完了済み購入のキャンセル失敗テスト"""
        # 完了済み購入作成
        purchase = SPPurchase(
            user_id=test_user.id,
            plan_id="small",
            sp_amount=100,
            price_jpy=500,
            status=PurchaseStatus.COMPLETED,
            payment_mode=PaymentMode.TEST
        )
        db.add(purchase)
        await db.commit()
        
        # キャンセル試行
        with pytest.raises(ValueError) as exc:
            await SPPurchaseService.cancel_purchase(
                db=db,
                purchase_id=purchase.id,
                user_id=test_user.id
            )
        
        assert "Cannot cancel purchase with status" in str(exc.value)

    async def test_get_purchase_stats(self, db: AsyncSession, test_user: User):
        """購入統計取得のテスト"""
        # テストデータ作成
        purchases = [
            SPPurchase(
                user_id=test_user.id,
                plan_id="small",
                sp_amount=100,
                price_jpy=500,
                status=PurchaseStatus.COMPLETED,
                payment_mode=PaymentMode.TEST
            ),
            SPPurchase(
                user_id=test_user.id,
                plan_id="medium",
                sp_amount=250,
                price_jpy=1000,
                status=PurchaseStatus.COMPLETED,
                payment_mode=PaymentMode.TEST
            ),
            SPPurchase(
                user_id=test_user.id,
                plan_id="large",
                sp_amount=600,
                price_jpy=2000,
                status=PurchaseStatus.PENDING,  # これは集計対象外
                payment_mode=PaymentMode.TEST
            )
        ]
        
        for purchase in purchases:
            db.add(purchase)
        
        await db.commit()
        
        # 統計取得
        stats = await SPPurchaseService.get_purchase_stats(
            db=db,
            user_id=test_user.id
        )
        
        assert stats["total_purchases"] >= 2
        assert stats["total_sp_purchased"] >= 350  # 100 + 250
        assert stats["total_spent_jpy"] >= 1500  # 500 + 1000