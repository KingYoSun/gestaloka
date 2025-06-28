#!/usr/bin/env python3
"""
WebSocket SP更新イベントのテストスクリプト

使用方法:
1. Docker環境を起動: docker-compose up -d
2. フロントエンドを起動: cd frontend && npm run dev
3. ブラウザでログイン
4. このスクリプトを実行: python backend/test_websocket_sp.py <user_id>
"""

import asyncio
import sys
from datetime import datetime

from sqlmodel import Session, select

from app.core.db import get_engine
from app.models.sp import PlayerSP, SPTransactionType
from app.services.sp_service import SPService
from app.websocket.events import SPEventEmitter


async def test_sp_events(user_id: str):
    """SP WebSocketイベントをテスト"""
    
    print(f"Testing SP WebSocket events for user: {user_id}")
    
    # データベースセッションを作成
    engine = get_engine()
    
    with Session(engine) as db:
        sp_service = SPService(db)
        
        # 1. 現在の残高を取得
        print("\n1. Getting current balance...")
        player_sp = await sp_service.get_or_create_player_sp(user_id)
        print(f"Current SP: {player_sp.current_sp}")
        
        # 2. SPを追加（WebSocketイベントが送信される）
        print("\n2. Adding SP...")
        await sp_service.add_sp(
            user_id=user_id,
            amount=50,
            transaction_type=SPTransactionType.ACHIEVEMENT,
            description="テスト実績達成ボーナス",
            metadata={"test": True, "achievement": "websocket_test"}
        )
        print("SP added successfully - check browser for notification!")
        
        await asyncio.sleep(2)
        
        # 3. SPを消費（WebSocketイベントが送信される）
        print("\n3. Consuming SP...")
        try:
            await sp_service.consume_sp(
                user_id=user_id,
                amount=30,
                transaction_type=SPTransactionType.LOG_DISPATCH,
                description="テストログ派遣",
                metadata={"test": True, "log_id": "test_log_001"}
            )
            print("SP consumed successfully - check browser for notification!")
        except Exception as e:
            print(f"Error consuming SP: {e}")
        
        await asyncio.sleep(2)
        
        # 4. SP不足をテスト
        print("\n4. Testing insufficient SP...")
        current_balance = await sp_service.get_balance(user_id)
        try:
            await sp_service.consume_sp(
                user_id=user_id,
                amount=current_balance.current_sp + 100,  # 残高より多く消費しようとする
                transaction_type=SPTransactionType.PREMIUM_ACTION,
                description="高額アクションテスト",
            )
        except Exception as e:
            print(f"Expected error: {e}")
            print("Insufficient SP event should be sent - check browser!")
        
        await asyncio.sleep(2)
        
        # 5. 日次回復をテスト
        print("\n5. Testing daily recovery...")
        try:
            result = await sp_service.process_daily_recovery(user_id)
            if result["success"]:
                print(f"Daily recovery completed: +{result['total_amount']} SP")
                print("Daily recovery event sent - check browser!")
            else:
                print(f"Daily recovery skipped: {result['message']}")
        except Exception as e:
            print(f"Error in daily recovery: {e}")
        
        # 6. 最終残高を表示
        print("\n6. Final balance check...")
        final_balance = await sp_service.get_balance(user_id)
        print(f"Final SP: {final_balance.current_sp}")
        print(f"Total earned: {final_balance.total_earned_sp}")
        print(f"Total consumed: {final_balance.total_consumed_sp}")


async def main():
    if len(sys.argv) < 2:
        print("Usage: python test_websocket_sp.py <user_id>")
        print("Example: python test_websocket_sp.py 12345678-1234-5678-1234-567812345678")
        sys.exit(1)
    
    user_id = sys.argv[1]
    
    try:
        await test_sp_events(user_id)
        print("\n✅ Test completed successfully!")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())