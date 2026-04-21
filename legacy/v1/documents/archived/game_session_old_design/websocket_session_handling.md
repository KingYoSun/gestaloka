# WebSocketセッション管理ガイド

## 概要
ゲスタロカではWebSocketを使用してリアルタイムなゲームセッション管理を実現しています。このドキュメントでは、WebSocketイベントの設計とセッション管理の実装について説明します。

## WebSocketイベント一覧

### ゲームセッション関連

#### `join_game`
- **送信タイミング**: セッションページ開始時
- **データ**: `{ session_id: string }`
- **サーバー処理**:
  - セッションへの参加を記録
  - 初回セッションの場合、FirstSessionInitializerを実行
  - 初期メッセージとクエストを送信

#### `leave_game`
- **送信タイミング**: 明示的なセッション終了時のみ
- **データ**: `{ session_id: string }`
- **注意**: ページ遷移時には送信しない

#### `game:action`
- **送信タイミング**: プレイヤーがアクションを実行時
- **データ**: `{ session_id: string, action: string }`

#### `game:message`
- **受信タイミング**: GMからの応答時
- **データ**: 
```typescript
{
  session_id: string;
  message: {
    role: "gm" | "player" | "system";
    content: string;
    timestamp: string;
  }
}
```

#### `game:choices`
- **受信タイミング**: 選択肢が提示される時
- **データ**: 
```typescript
{
  session_id: string;
  choices: Array<{
    id: string;
    text: string;
    type: string;
  }>
}
```

### その他のイベント

#### `sp:update`
- **受信タイミング**: SP残高が変更された時
- **データ**: `{ balance: number, character_id: string }`

#### `quest:created`
- **受信タイミング**: 新しいクエストが作成された時
- **データ**: クエストオブジェクト

#### `quest:updated`
- **受信タイミング**: クエストが更新された時
- **データ**: 更新されたクエストオブジェクト

## 実装の注意点

### 1. React StrictModeでの二重実行対策

開発環境でReact StrictModeが有効な場合、useEffectが2回実行されます。これによりWebSocketイベントリスナーが重複登録される可能性があります。

**解決策**:
```typescript
useEffect(() => {
  const handleEvent = (data: any) => {
    // イベント処理
  };

  socket.on("event:name", handleEvent);
  
  // クリーンアップ関数で確実にリスナーを削除
  return () => {
    socket.off("event:name", handleEvent);
  };
}, [socket]);
```

### 2. 初期セッションコンテンツの配信

新規キャラクターの初回セッションでは、FirstSessionInitializerによる導入テキストとクエストが必要です。

**重要なポイント**:
- `create_session`時点ではWebSocket接続が確立されていない
- FirstSessionInitializerは`join_game`イベントハンドラー内で実行する
- これによりWebSocket接続後に確実にコンテンツが配信される

### 3. セッション終了の制御

`leave_game`イベントは慎重に扱う必要があります：

- **送信すべきケース**:
  - プレイヤーが「セッションを終了」ボタンをクリック
  - GMがセッション終了を提案し、プレイヤーが承認

- **送信すべきでないケース**:
  - ページのリロード
  - 他のページへの遷移
  - ブラウザタブを閉じる

### 4. WebSocket接続状態の管理

```typescript
// WebSocketProviderでの接続管理例
useEffect(() => {
  if (!user || !token) return;

  const manager = WebSocketManager.getInstance();
  manager.connect(token);

  return () => {
    // ページ遷移時は接続を維持
    // アプリケーション終了時のみdisconnect
  };
}, [user, token]);
```

## セッション復帰機能の実装

アクティブセッションがある場合の復帰機能：

1. **アクティブセッション確認**:
```typescript
const { data: activeSession } = useQuery({
  queryKey: ["active-session", characterId],
  queryFn: () => apiClient.get<GameSession>(`/api/v1/game/sessions/active`)
});
```

2. **UIの条件分岐**:
```typescript
{activeSession ? (
  <Button onClick={() => navigate(`/game/${activeSession.id}`)}>
    冒険を再開
  </Button>
) : (
  <Button onClick={handleStartAdventure}>
    冒険を始める
  </Button>
)}
```

## 今後の改善提案

### 1. SP消費のリアルタイム表示
- ヘッダーに常時SP残高を表示
- アクション実行時の確認モーダルを削除
- SP不足時のみ警告表示

### 2. 物語形式のUI
- チャット形式から小説形式への変更
- テキストのタイプライター効果
- 背景画像や BGM の追加
- 選択肢を物語に自然に組み込む

### 3. セッション状態の永続化
- ブラウザを閉じても進行状況を保持
- 複数デバイスからの継続プレイ対応
- オフライン時の状態保存