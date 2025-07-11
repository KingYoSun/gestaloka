# ゲームセッションv1アーカイブ

このディレクトリには、2025-07-11にアーカイブされた初期のゲームセッション実装が含まれています。

## アーカイブ理由

- WebSocket接続が確立されない問題が解決できなかった
- 実装が複雑になりすぎ、デバッグが困難になった
- ゼロから再実装することを決定

## 含まれるファイル

### バックエンド
- `game_session.py` - ゲームセッションサービス
- `game.py` - APIエンドポイント
- `server.py` - WebSocketサーバー
- `coordinator.py` - AIコーディネーター
- `first_session_initializer.py` - 初回セッション初期化
- 各種テストファイル

### フロントエンド
- `useGameSessions.ts` - ゲームセッションカスタムフック
- `useWebSocket.ts` - WebSocketカスタムフック
- `gameSessionStore.ts` - Zustandストア
- `game/` - ゲーム関連ルート
- `game/` - ゲーム関連コンポーネント
- `websocket/` - WebSocketマネージャー
- 各種関連ファイル

## 注意事項

このコードは動作しない状態でアーカイブされています。
参考目的でのみ使用してください。