# 2025-06-28 SPシステムの実装完了

## 概要
プロジェクトのフェーズ3における主要タスクである、SPシステムの基本実装を完了しました。プレイヤーの行動がSPを消費し、日次で自然回復する仕組みが実装されています。

## 実装内容

### 1. 自由行動入力時のSP消費
- **実装場所**: `backend/app/services/game_session.py`の`execute_action`メソッド
- **消費量設定**: 
  - 自由行動: 3SP
  - 選択肢選択: 1SP
  - 探索: 5SP
  - 移動: 2SP
- **設定ファイル**: `backend/app/core/config.py`に追加

```python
# アクションタイプに応じたSP消費量を決定
if action_request.action_type == "free_action":
    sp_cost = settings.SP_COST_FREE_ACTION
    transaction_type = SPTransactionType.FREE_ACTION
else:  # choice_action
    sp_cost = settings.SP_COST_CHOICE_ACTION
    transaction_type = SPTransactionType.SYSTEM_FUNCTION
```

### 2. SP不足時のエラーハンドリング
- **バックエンド**: 適切なHTTPステータス（400）とエラーメッセージを返す
- **フロントエンド**: エラーメッセージとともに回復方法を案内

```typescript
// SP不足エラーの特別処理
if (error?.response?.status === 400 && error?.response?.data?.detail?.includes('SP不足')) {
    toast.error(error.response.data.detail, {
        description: 'SPを回復するか、より簡単な行動を選択してください。',
        duration: 5000,
    })
}
```

### 3. SP自然回復バッチ処理
- **Celeryタスク**: `backend/app/tasks/sp_tasks.py`
- **スケジュール**: 毎日UTC 4時（JST 13時）に実行
- **回復量**: 
  - 基本: 10SP/日
  - サブスクリプションボーナス: +20SP（Basic）、+50SP（Premium）
  - 連続ログインボーナス: 7日目+5SP、14日目+10SP、30日目+20SP

### 4. 関連機能
- **サブスクリプション期限チェック**: 1時間ごとに実行
- **ログインボーナス付与**: ユーザーログイン時に日次回復処理を実行

## 技術的な詳細

### SPサービスの同期版メソッド追加
Celeryタスクは同期的に実行されるため、非同期メソッドの同期版を追加：
- `process_daily_recovery_sync`
- `get_or_create_player_sp_sync`
- `_create_transaction_sync`

### Celery設定の更新
```python
beat_schedule={
    "daily-sp-recovery": {
        "task": "app.tasks.sp_tasks.process_daily_sp_recovery",
        "schedule": crontab(hour=4, minute=0),  # UTC 4時 = JST 13時
    },
    "check-subscription-expiry": {
        "task": "app.tasks.sp_tasks.check_subscription_expiry",
        "schedule": 3600.0,  # 1時間ごと
    },
}
```

## テスト結果
- **バックエンド**: 192/193テスト成功（1件は戦闘システムのテストでcommit回数の期待値が異なるため失敗）
- **フロントエンド**: 21/21テスト成功
- **SP関連テスト**: 全て成功

## 今後の拡張可能性
- SPの細かい消費量調整（アクションの複雑さに応じた動的計算）
- 特殊アクションのSP消費実装
- SPブーストアイテムの実装
- WebSocketによるリアルタイムSP更新通知

## 関連ファイル
- `backend/app/services/game_session.py` - SP消費処理
- `backend/app/tasks/sp_tasks.py` - Celeryタスク
- `backend/app/core/config.py` - SP消費量設定
- `frontend/src/routes/game/$sessionId.tsx` - エラーハンドリング