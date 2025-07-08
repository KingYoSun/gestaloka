# WebSocketセッション管理の修正

## 日付: 2025-07-08

## 概要
ゲームセッション開始時の初期コンテンツ表示問題を修正し、WebSocketイベントとFirstSessionInitializerの統合を実装しました。また、重複メッセージ表示の問題も解決しました。

## 解決した問題

### 1. 初期セッションコンテンツが表示されない問題
**問題の詳細**:
- 新規キャラクターで冒険を開始した際、初回セッションの導入テキストとクエストが表示されない
- `create_session`エンドポイントでFirstSessionInitializerが実行されるが、WebSocket接続前のため内容が失われる

**原因**:
- `create_session`時点ではWebSocket接続が確立されていない
- FirstSessionInitializerのメッセージとクエストがWebSocketクライアントに届かない

**解決策**:
- FirstSessionInitializerの呼び出しを`create_session`から`join_game` WebSocketイベントに移動
- WebSocket接続確立後に初期化処理を実行することで、メッセージが確実に配信される

### 2. メッセージ重複表示の問題
**問題の詳細**:
- React StrictModeにより、WebSocketイベントハンドラーが2回登録される
- 同じメッセージが2回表示される

**原因**:
- React StrictModeは開発環境でコンポーネントを2回マウントする
- WebSocketイベントリスナーのクリーンアップが不適切

**解決策**:
- useEffectのクリーンアップ関数で確実にイベントリスナーを削除
- WebSocketマネージャーの`off`メソッドを適切に実装

### 3. leave_gameイベントの過剰発火
**問題の詳細**:
- ページ遷移時にも`leave_game`イベントが発火する
- セッションが意図せず終了してしまう

**解決策**:
- `leave_game`イベントを明示的なセッション終了時のみ発火するよう変更
- ページ遷移時のクリーンアップではイベントを送信しない

## 技術的実装

### バックエンド変更

1. **WebSocketハンドラーの修正** (`backend/app/websocket/handlers.py`)
```python
async def handle_join_game(self, data: Dict[str, Any]) -> None:
    """ゲームセッションに参加"""
    session_id = data.get("session_id")
    if not session_id:
        return
    
    # セッション取得
    session = await self._get_session(session_id)
    if not session:
        return
    
    # 初回セッションの場合、FirstSessionInitializerを実行
    if session.turn_count == 0 and not session.context_summary:
        first_session_initializer = FirstSessionInitializer()
        initial_content = await first_session_initializer.generate_initial_content(
            character_name=session.character.name,
            character_description=session.character.description
        )
        
        # 初期メッセージとクエストを送信
        await self.send_personal_event("game:message", {
            "session_id": session_id,
            "message": {
                "role": "system",
                "content": initial_content["narrative"],
                "timestamp": datetime.now(UTC).isoformat()
            }
        })
        
        # クエストの送信
        for quest in initial_content["quests"]:
            await self.send_personal_event("quest:created", {
                "quest": quest
            })
```

2. **GameSessionServiceの修正** (`backend/app/services/game_session.py`)
- `create_session`メソッドからFirstSessionInitializer関連のコードを削除
- セッション作成を簡素化

### フロントエンド変更

1. **WebSocketイベントハンドラーの修正** (`frontend/src/hooks/useGameWebSocket.ts`)
```typescript
useEffect(() => {
  const handleGameMessage = (data: any) => {
    // メッセージ処理
  };

  socket.on("game:message", handleGameMessage);
  
  // クリーンアップ関数で確実にリスナーを削除
  return () => {
    socket.off("game:message", handleGameMessage);
  };
}, [socket]);
```

2. **leave_gameイベントの制御** (`frontend/src/features/game/GameSessionPage.tsx`)
```typescript
// 明示的なセッション終了時のみleave_gameを送信
const handleEndSession = () => {
  if (sessionId) {
    socket.emit("leave_game", { session_id: sessionId });
  }
  navigate("/dashboard");
};

// ページ遷移時のクリーンアップではleave_gameを送信しない
useEffect(() => {
  return () => {
    // クリーンアップのみ、leave_gameは送信しない
  };
}, []);
```

## 成果

1. **初期セッションコンテンツの正常表示**
   - 新規キャラクターの冒険開始時に導入テキストが表示される
   - 初期クエスト6つが正しく付与される
   - ゲスタロカ世界への没入感が向上

2. **メッセージ表示の正常化**
   - React StrictModeでも重複表示が発生しない
   - クリーンなメッセージ履歴

3. **セッション管理の改善**
   - ページ遷移でセッションが終了しない
   - 明示的な終了操作でのみセッションが終了

## 今後の課題

1. **セッション復帰機能**
   - アクティブセッションがある場合の「冒険を再開」ボタン実装
   - 現在は「冒険を始める」ボタンのみ

2. **UI/UXの改善**
   - チャット形式から物語形式への変更
   - 自動進行する小説のような表示
   - SP消費モーダルの削除（ヘッダーにSP表示）

## 関連ファイル

- `backend/app/websocket/handlers.py`
- `backend/app/services/game_session.py`
- `backend/app/ai_agents/first_session_initializer.py`
- `frontend/src/hooks/useGameWebSocket.ts`
- `frontend/src/features/game/GameSessionPage.tsx`
- `frontend/src/providers/WebSocketProvider.tsx`