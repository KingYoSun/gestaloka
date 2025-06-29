"""SP購入システムのテストスクリプト"""
import asyncio
import json
import sys
from datetime import datetime

import httpx


async def test_sp_purchase_flow():
    """SP購入フローのテスト"""
    base_url = "http://localhost:8000/api/v1"
    
    # テストユーザーのログイン情報
    test_user = {
        "username": "testuser",
        "password": "testpassword123"
    }
    
    async with httpx.AsyncClient() as client:
        # 1. ログイン
        print("1. ログイン...")
        try:
            response = await client.post(f"{base_url}/auth/login", data=test_user)
            if response.status_code != 200:
                print(f"ログイン失敗: {response.status_code}")
                print(response.text)
                return
            
            auth_data = response.json()
            access_token = auth_data["access_token"]
            headers = {"Authorization": f"Bearer {access_token}"}
            print(f"✓ ログイン成功: {test_user['username']}")
            
        except Exception as e:
            print(f"エラー: {e}")
            return
        
        # 2. 現在のSP残高を確認
        print("\n2. 現在のSP残高確認...")
        response = await client.get(f"{base_url}/sp/balance", headers=headers)
        if response.status_code == 200:
            balance_data = response.json()
            print(f"✓ 現在のSP残高: {balance_data['current_sp']} / {balance_data['max_sp']}")
        else:
            print(f"残高取得失敗: {response.status_code}")
        
        # 3. 価格プラン一覧を取得
        print("\n3. 価格プラン一覧取得...")
        response = await client.get(f"{base_url}/sp/plans")
        if response.status_code == 200:
            plans_data = response.json()
            print(f"✓ 支払いモード: {plans_data['payment_mode']}")
            print("利用可能なプラン:")
            for plan in plans_data['plans']:
                print(f"  - {plan['id']}: {plan['name']} - {plan['sp_amount']}SP (¥{plan['price_jpy']})")
                if plan.get('bonus_percentage', 0) > 0:
                    print(f"    ボーナス: {plan['bonus_percentage']}%")
                if plan.get('description'):
                    print(f"    説明: {plan['description']}")
        else:
            print(f"プラン取得失敗: {response.status_code}")
            return
        
        # 4. SP購入申請（テストモード）
        print("\n4. SP購入申請（smallプラン）...")
        purchase_request = {
            "plan_id": "small",
            "test_reason": "SP購入機能のテストのため、smallプランを購入申請します。"
        }
        
        response = await client.post(
            f"{base_url}/sp/purchase",
            json=purchase_request,
            headers=headers
        )
        
        if response.status_code == 200:
            purchase_data = response.json()
            purchase_id = purchase_data['purchase_id']
            print(f"✓ 購入申請成功:")
            print(f"  購入ID: {purchase_id}")
            print(f"  ステータス: {purchase_data['status']}")
            print(f"  SP量: {purchase_data['sp_amount']}")
            print(f"  価格: ¥{purchase_data['price_jpy']}")
            print(f"  メッセージ: {purchase_data['message']}")
        else:
            print(f"購入申請失敗: {response.status_code}")
            print(response.text)
            return
        
        # 5. 購入詳細を確認
        print(f"\n5. 購入詳細確認（ID: {purchase_id}）...")
        await asyncio.sleep(1)  # 少し待機
        
        response = await client.get(
            f"{base_url}/sp/purchases/{purchase_id}",
            headers=headers
        )
        
        if response.status_code == 200:
            detail_data = response.json()
            print(f"✓ 購入詳細:")
            print(f"  ステータス: {detail_data['status']}")
            print(f"  作成日時: {detail_data['created_at']}")
            if detail_data.get('approved_at'):
                print(f"  承認日時: {detail_data['approved_at']}")
        else:
            print(f"詳細取得失敗: {response.status_code}")
        
        # 6. 購入履歴を確認
        print("\n6. 購入履歴確認...")
        response = await client.get(
            f"{base_url}/sp/purchases",
            headers=headers
        )
        
        if response.status_code == 200:
            history_data = response.json()
            print(f"✓ 購入履歴: {history_data['total']}件")
            for purchase in history_data['purchases'][:3]:  # 最新3件を表示
                print(f"  - {purchase['created_at']}: {purchase['plan_id']} - {purchase['sp_amount']}SP ({purchase['status']})")
        else:
            print(f"履歴取得失敗: {response.status_code}")
        
        # 7. 購入統計を確認
        print("\n7. 購入統計確認...")
        response = await client.get(
            f"{base_url}/sp/purchase-stats",
            headers=headers
        )
        
        if response.status_code == 200:
            stats_data = response.json()
            print(f"✓ 購入統計:")
            print(f"  総購入回数: {stats_data['total_purchases']}回")
            print(f"  総購入SP: {stats_data['total_sp_purchased']}SP")
            print(f"  総支払額: ¥{stats_data['total_spent_jpy']}")
        else:
            print(f"統計取得失敗: {response.status_code}")
        
        # 8. 更新後のSP残高を確認
        print("\n8. 更新後のSP残高確認...")
        await asyncio.sleep(2)  # 処理完了を待つ
        
        response = await client.get(f"{base_url}/sp/balance", headers=headers)
        if response.status_code == 200:
            balance_data = response.json()
            print(f"✓ 更新後のSP残高: {balance_data['current_sp']} / {balance_data['max_sp']}")
        else:
            print(f"残高取得失敗: {response.status_code}")
        
        # 9. キャンセルのテスト（新しい購入を作成）
        print("\n9. キャンセル機能テスト...")
        print("  新しい購入申請を作成...")
        
        cancel_request = {
            "plan_id": "medium",
            "test_reason": "キャンセル機能のテストのため、購入後すぐにキャンセルします。"
        }
        
        response = await client.post(
            f"{base_url}/sp/purchase",
            json=cancel_request,
            headers=headers
        )
        
        if response.status_code == 200:
            cancel_data = response.json()
            cancel_id = cancel_data['purchase_id']
            
            # 即座にキャンセル（PENDINGの場合のみ可能）
            if cancel_data['status'] == 'PENDING':
                print(f"  購入ID: {cancel_id} (PENDING)")
                print("  キャンセル実行...")
                
                response = await client.post(
                    f"{base_url}/sp/purchases/{cancel_id}/cancel",
                    headers=headers
                )
                
                if response.status_code == 200:
                    result = response.json()
                    print(f"✓ キャンセル成功: ステータス = {result['status']}")
                else:
                    print(f"キャンセル失敗: {response.status_code}")
                    print(response.text)
            else:
                print(f"  購入は既に処理済み: {cancel_data['status']}")


if __name__ == "__main__":
    print("SP購入システムテスト開始")
    print("=" * 50)
    
    # イベントループを実行
    asyncio.run(test_sp_purchase_flow())
    
    print("\n" + "=" * 50)
    print("テスト完了")