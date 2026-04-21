# WebSocket接続状態表示の問題修正 - 2025/07/05

## 概要
ダッシュボードでWebSocketが実際には接続されているのに「切断」と表示される問題を修正しました。原因は認証システムの二重管理（AuthProviderとuseAuthStore）と、Socket.IOの初期接続タイミングの問題でした。

## 問題の詳細

### 症状
- ダッシュボードを開いた際、WebSocketのpingは通っているのに接続状態が「切断」と表示
- コンソールログで`isAuthenticated: false`と表示される
- WebSocket接続の403エラーが発生

### 原因
1. **認証システムの二重管理**
   - `AuthProvider`（Context API）と`useAuthStore`（Zustand）の2つの認証管理システムが混在
   - WebSocket関連のコードは`useAuthStore`を使用
   - 実際の認証は`AuthProvider`で管理
   - 両者の状態が同期されていない

2. **Socket.IOの接続タイミング**
   - Socket.IOは非同期で接続される
   - `connect()`直後は`socket.connected`が`false`
   - 初期状態の確認が早すぎる

3. **WebSocketManagerの認証情報取得**
   - `useAuthStore`から認証情報を取得していた
   - しかし`useAuthStore`は使用されていない状態

## 修正内容

### 1. 認証システムの統一

#### 対象ファイル
- `frontend/src/providers/WebSocketProvider.tsx`
- `frontend/src/hooks/useWebSocket.ts`
- `frontend/src/lib/websocket/socket.ts`

#### 変更内容
```typescript
// Before: useAuthStoreを使用
import { useAuthStore } from '@/store/authStore'
const isAuthenticated = useAuthStore(state => state.isAuthenticated)

// After: useAuthフックを使用
import { useAuth } from '@/features/auth/useAuth'
const { isAuthenticated } = useAuth()
```

### 2. apiClientの拡張

#### ファイル: `frontend/src/api/client.ts`

```typescript
class ApiClient {
  private token: string | null = null
  private currentUser: User | null = null  // 追加

  // 新規メソッド追加
  getToken(): string | null {
    return this.token
  }

  setCurrentUser(user: User | null) {
    this.currentUser = user
  }

  getCurrentUserSync(): User | null {
    return this.currentUser
  }
}
```

### 3. AuthProviderの更新

#### ファイル: `frontend/src/features/auth/AuthProvider.tsx`

```typescript
// ユーザー情報をapiClientにも設定
const checkAuthStatus = async () => {
  // ...
  const user = await apiClient.getCurrentUser()
  setUser(user)
  apiClient.setCurrentUser(user)  // 追加
}

const login = async (username: string, password: string) => {
  // ...
  setUser(response.user)
  apiClient.setCurrentUser(response.user)  // 追加
}

const logout = async () => {
  // ...
  setUser(null)
  apiClient.setCurrentUser(null)  // 追加
}
```

### 4. WebSocketManagerの更新

#### ファイル: `frontend/src/lib/websocket/socket.ts`

```typescript
// Before: useAuthStoreから取得
import { useAuthStore } from '@/store/authStore'
const auth = useAuthStore.getState()

// After: apiClientから取得
import { apiClient } from '@/api/client'
const token = apiClient.getToken()
const user = apiClient.getCurrentUserSync()
```

### 5. Socket.IO接続の改善

#### 重複接続の防止
```typescript
connect(): void {
  if (this.socket) {
    if (this.socket.connected) {
      this.emit('ws:connected', { socketId: this.socket.id })
      return
    } else if (this.socket.active) {  // 接続処理中もスキップ
      return
    }
  }
  // ...
}
```

#### 初期接続チェックの遅延
```typescript
// Socket.IOは非同期で接続されるため、少し待ってから初回チェック
setTimeout(() => {
  const initialConnected = websocketManager.isConnected()
  if (initialConnected) {
    const socketId = websocketManager.getSocketId()
    setStatus({ connected: true, socketId })
  }
}, 100)
```

#### 定期的な接続状態確認
```typescript
// 接続状態の定期的な確認（1秒ごと）
const checkConnectionInterval = setInterval(() => {
  const isConnected = websocketManager.isConnected()
  setStatus(prev => {
    if (prev.connected !== isConnected) {
      return { ...prev, connected: isConnected }
    }
    return prev
  })
}, 1000)
```

### 6. デバッグとクリーンアップ

#### デバッグプロセス
1. 詳細なログを追加して問題を特定
2. CORS設定を一時的に全許可（`cors_allowed_origins="*"`）
3. 問題解決後、本来のCORS設定に復元
4. 不要なデバッグログを削除

#### 最終的なCORS設定
```python
# backend/app/websocket/server.py
cors_origins = [str(origin).rstrip("/") for origin in settings.BACKEND_CORS_ORIGINS]
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=cors_origins,
    cors_credentials=True,
    logger=True,
    engineio_logger=True if settings.LOG_LEVEL == "DEBUG" else False,
)
```

## 技術的な学び

### 1. 認証システムの一元化の重要性
- 複数の状態管理システムは避ける
- 単一の真実の源（Single Source of Truth）を維持

### 2. Socket.IOの非同期性
- 接続は非同期で行われる
- 初期状態の確認にはタイミングの考慮が必要

### 3. デバッグの進め方
- 詳細なログで問題を特定
- 一時的な設定変更で問題を切り分け
- 解決後は本来の設定に戻す

## 成果

1. **WebSocket接続状態の正確な表示**
   - ダッシュボードで接続状態が正しく「接続中」と表示

2. **認証システムの統一**
   - AuthProvider/useAuthフックに一本化
   - 保守性と信頼性の向上

3. **パフォーマンスの最適化**
   - 不要なデバッグログの削除
   - 効率的な接続状態の管理

## 関連ファイル

### フロントエンド
- `/frontend/src/providers/WebSocketProvider.tsx`
- `/frontend/src/hooks/useWebSocket.ts`
- `/frontend/src/lib/websocket/socket.ts`
- `/frontend/src/api/client.ts`
- `/frontend/src/features/auth/AuthProvider.tsx`
- `/frontend/src/components/WebSocketStatus.tsx`

### バックエンド
- `/backend/app/websocket/server.py`
- `/backend/app/main.py`

## 今後の推奨事項

1. **useAuthStoreの削除**
   - 使用されていない`useAuthStore`を完全に削除
   - 関連するインポートやファイルのクリーンアップ

2. **WebSocket接続の監視**
   - 本番環境での接続状態の監視
   - エラーログの収集と分析

3. **テストの追加**
   - WebSocket接続のユニットテスト
   - 認証フローの統合テスト