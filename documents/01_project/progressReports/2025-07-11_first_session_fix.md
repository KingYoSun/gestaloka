# 進捗レポート: 初回セッション導入ストーリー表示問題の修正

作成日: 2025-07-11

## 実施内容

### 1. 問題の特定

初回セッションで導入ストーリーが表示されない問題について調査し、以下の原因を特定：

- WebSocket接続が確立される前に`join_game`イベントが送信されていた
- バックエンドで生成された導入ストーリーが`narrative_update`イベントのみで送信され、フロントエンドのストアに保存されていなかった

### 2. バックエンドの修正

#### `/backend/app/websocket/server.py`
- 初回セッション処理に詳細なデバッグログを追加
- 導入ストーリーを`message_added`イベントで送信するように変更
- メッセージIDを含む完全なメッセージオブジェクトを送信

```python
# message_addedイベントを送信（IDを含む）
await GameEventEmitter.emit_custom_event(
    game_session_id,
    "message_added",
    {
        "message": {
            "id": saved_message.id,
            "content": saved_message.content,
            "message_type": saved_message.message_type,
            "sender_type": saved_message.sender_type,
            "turn_number": saved_message.turn_number,
            "metadata": saved_message.message_metadata,
            "created_at": saved_message.created_at.isoformat(),
        },
        "choices": initial_choices,
    }
)
```

### 3. フロントエンドの修正

#### `/frontend/src/hooks/useWebSocket.ts`
- WebSocket接続の状態を確認してから`join_game`を送信するように修正
- 接続待機ロジックの追加
- `message_added`イベントハンドラーにデバッグログを追加

```typescript
// WebSocket接続が確立されてからjoin_gameを送信
const joinGameWhenReady = () => {
  if (isMounted && wsStatus.connected) {
    console.log('[useGameWebSocket] WebSocket connected, joining game session', { gameSessionId, userId: user.id })
    websocketManager.joinGame(gameSessionId, user.id)
  }
}

// 既に接続済みの場合はすぐに参加
if (wsStatus.connected) {
  joinGameWhenReady()
} else {
  // 接続を待つ
  console.log('[useGameWebSocket] Waiting for WebSocket connection...')
  checkInterval = setInterval(() => {
    if (websocketManager.isConnected()) {
      clearInterval(checkInterval)
      joinGameWhenReady()
    }
  }, 100)
}
```

### 4. テストの修正

#### `/backend/tests/test_game_message.py`
- `GameEventEmitter.emit_custom_event`のモックを追加
- テストが新しいイベント構造に対応

## 成果

1. **初回セッション導入ストーリーの表示問題（部分的に解決）**
   - WebSocket接続の確立を待ってから`join_game`を送信する処理を追加
   - `message_added`イベントでメッセージをストアに保存する処理を実装
   - **注意**: フロントエンドで「Waiting for WebSocket connection」と表示される問題が残存
   - バックエンドログではセッション作成は成功しているが、WebSocket接続が確立されていない

2. **デバッグ機能の強化**
   - バックエンドとフロントエンドの両方に詳細なログを追加
   - 問題の追跡と診断が容易に

3. **テストの成功**
   - バックエンドテスト: 242/242成功（100%）
   - フロントエンドテスト: 28/28成功（100%）

## 技術的詳細

### イベントフロー

1. **セッション作成**: REST APIで初回セッションを作成
2. **WebSocket接続**: フロントエンドがWebSocket接続を確立
3. **ゲーム参加**: 接続確立後に`join_game`イベントを送信
4. **初期化処理**: バックエンドで`FirstSessionInitializer`が導入ストーリーを生成
5. **メッセージ送信**: `message_added`イベントでストーリーと選択肢を送信
6. **ストア更新**: フロントエンドでメッセージをストアに保存し、UIに表示

### 修正ファイル

- `/backend/app/websocket/server.py`: 初回セッション処理の改善
- `/frontend/src/hooks/useWebSocket.ts`: WebSocket接続待機ロジックの追加
- `/backend/tests/test_game_message.py`: テストの更新

## 残存する問題

1. **WebSocket接続が確立されない**
   - フロントエンドコンソール: "Waiting for WebSocket connection"が表示され続ける
   - `websocketManager.isConnected()`が常にfalseを返している可能性
   - `join_game`イベントが送信されないため、初回セッションの導入ストーリーが表示されない

2. **根本原因の可能性**
   - WebSocketManagerの初期化タイミングの問題
   - Socket.IOクライアントの接続設定の問題
   - 認証トークンの処理に関する問題

## 今後の推奨事項

1. **WebSocket接続問題の調査**
   - `websocketManager`の実装を確認
   - Socket.IOクライアントの接続状態を詳細に調査
   - 接続イベントのハンドリングを見直し

2. **エラーハンドリングの強化**
   - WebSocket接続タイムアウトの実装
   - 接続エラー時のリトライ機構

3. **監視の強化**
   - WebSocketイベントの詳細なメトリクス収集
   - エラー率の監視