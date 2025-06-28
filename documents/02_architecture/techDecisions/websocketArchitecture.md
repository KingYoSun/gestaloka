# WebSocketアーキテクチャ

## 概要
ゲスタロカではリアルタイム通信のためにSocket.IOを使用しています。このドキュメントでは、WebSocketアーキテクチャの設計と実装パターンについて説明します。

## 技術スタック

- **バックエンド**: Python Socket.IO (AsyncServer)
- **フロントエンド**: Socket.IO Client
- **トランスポート**: WebSocket優先、Pollingフォールバック

## アーキテクチャ設計

### 1. イベント駆動アーキテクチャ

```
クライアント → WebSocket → サーバー → イベントエミッター → ブロードキャスト
     ↑                                                          ↓
     └──────────────────────── リアルタイム更新 ←────────────────┘
```

### 2. ルーム管理

- **user_{user_id}**: ユーザー固有のルーム（個人通知用）
- **game_{session_id}**: ゲームセッション用ルーム（マルチプレイヤー）

### 3. イベントカテゴリー

#### ゲームイベント
- `game_started`: ゲーム開始
- `narrative_update`: 物語更新
- `action_result`: アクション結果
- `state_update`: 状態更新
- `player_status_update`: プレイヤーステータス更新

#### SPイベント
- `sp_update`: SP残高更新
- `sp_insufficient`: SP不足通知
- `sp_daily_recovery`: 日次回復完了

#### システムイベント
- `connected`: 接続成功
- `notification`: 汎用通知
- `error`: エラー通知

## 実装パターン

### 1. イベントエミッター

```python
class SPEventEmitter:
    @staticmethod
    async def emit_sp_update(user_id: str, current_sp: int, ...):
        await broadcast_to_user(
            user_id,
            "sp_update",
            {
                "type": "sp_update",
                "current_sp": current_sp,
                # ... その他のデータ
            }
        )
```

### 2. サービス統合

```python
class SPService:
    async def consume_sp(self, ...):
        # ビジネスロジック実行
        # ...
        
        # WebSocketイベント送信
        await SPEventEmitter.emit_sp_update(
            user_id=user_id,
            current_sp=player_sp.current_sp,
            # ...
        )
```

### 3. フロントエンド統合

```typescript
// WebSocketマネージャー
class WebSocketManager {
    private setupEventHandlers(): void {
        this.socket.on('sp_update', data => {
            this.emit('sp:update', data)
        })
    }
}

// Reactフック
function useSPBalanceSummary() {
    useEffect(() => {
        const handleSPUpdate = (data) => {
            // キャッシュ更新
            queryClient.setQueryData(['sp', 'balance'], ...)
            // 通知表示
            toast({ title: 'SPを獲得しました', ... })
        }
        
        websocketManager.on('sp:update', handleSPUpdate)
        
        return () => {
            websocketManager.off('sp:update', handleSPUpdate)
        }
    }, [])
}
```

## ベストプラクティス

### 1. エラーハンドリング
- WebSocket送信失敗時もビジネスロジックは継続
- エラーはログに記録し、監視システムで追跡

### 2. パフォーマンス
- 重要度の低いイベントはバッチ処理を検討
- 頻繁な更新は間引きまたは集約

### 3. セキュリティ
- ユーザー認証を必須化
- ルームベースの権限管理
- イベントペイロードの検証

### 4. 型安全性
- TypeScriptで全イベントの型定義
- バックエンドとフロントエンドで型を共有

## 監視とデバッグ

### 1. ログ出力
```python
logger.info("SP update event emitted", 
    user_id=user_id, 
    current_sp=current_sp,
    transaction_type=transaction_type
)
```

### 2. デバッグモード
開発環境では詳細なSocket.IOログを有効化：
```python
engineio_logger=True if settings.LOG_LEVEL == "DEBUG" else False
```

### 3. テストツール
- `test_websocket_sp.py`: SP関連イベントのテスト
- ブラウザ開発者ツールでのWebSocketフレーム監視

## 今後の拡張計画

1. **イベント優先度システム**
   - 重要なイベントを優先的に配信
   - 低優先度イベントのバッチ処理

2. **接続状態管理**
   - 自動再接続の改善
   - オフライン時のイベントキューイング

3. **スケーラビリティ**
   - Redis Pub/Subによる複数サーバー対応
   - 負荷分散の実装

4. **分析とメトリクス**
   - イベント配信の成功率測定
   - レイテンシーの監視