# 技術的決定記録 - ログバース (Logverse)

このファイルには、重要な技術的決定、実装時の問題と解決策、技術的負債が記録されています。

## 技術的負債と改善項目

### ハードコーディング箇所の管理

#### 識別済みハードコード（2025/06/17調査）

1. **開発用として許容するもの**
   - 認証情報・シークレット（開発環境用デフォルト値）
   - テスト用フィクスチャデータ
   - プロジェクト識別子（"logverse", "logverse-client"等）

2. **将来的に設定管理すべきもの**
   - **URL・エンドポイント**: localhost URLのハードコード
   - **マジックナンバー**: 
     - JWT有効期限（60 * 24 * 8）
     - 最大アップロードサイズ（10MB）
     - LLM設定（温度0.7、最大トークン2048）
     - ゲームロジック値（HP上限9999、環境修正値等）
   - **固定文字列**: APIレスポンスメッセージ、デフォルト値

3. **テストの構造的問題**
   - `backend/tests/test_state_manager.py`: 計算結果が特定値前提のテスト
   - 環境修正値・天候修正値の変更でテスト失敗する構造

#### 改善方針
- 環境変数化または設定ファイル化を段階的に実施
- ゲームパラメータは将来的に管理画面で調整可能に
- テストは設定値に依存しない構造に改修

## 今後の技術的検討事項

### 短期（次3ヶ月）
1. **パフォーマンス最適化**
   - データベースクエリ最適化
   - Redis キャッシュ戦略
   - フロントエンドのコード分割

2. **AI処理最適化**
   - プロンプトキャッシング
   - バッチ処理導入
   - レスポンス時間改善

3. **設定管理の改善**
   - ハードコード値の環境変数化
   - ゲームパラメータ設定システム
   - 動的設定管理機能

### 中期（6ヶ月）
1. **スケーラビリティ**
   - 水平スケーリング対応
   - ロードバランサー導入
   - CDN統合

2. **運用自動化**
   - CI/CDパイプライン
   - 自動デプロイメント
   - 監視アラート

### 長期（1年）
1. **マイクロサービス化**
   - AI層の独立サービス化
   - データベース分離
   - API Gateway導入

2. **高度な機能**
   - GraphQL導入
   - リアルタイムサブスクリプション
   - 分散トレーシング（OpenTelemetry）

3. **インフラ進化**
   - Kubernetes移行
   - サービスメッシュ（Istio）
   - 自動スケーリング

## ゲームセッション機能実装時の技術的決定・問題・解決策

### 実装時に発見した問題と解決策

#### 1. 重複ルートファイル競合 ✅ **解決済み**
**問題**: `game.$sessionId.tsx`と`game/$sessionId.tsx`の競合によりTanStack Router生成失敗
**原因**: ファイル命名規則の混在（ドットベース vs ディレクトリベース）
**解決策**: 古いドットベースファイル削除、ディレクトリベース構造に統一
**学習**: ルートファイル生成前の既存ファイル確認が重要

#### 2. 型安全性エラー（APIレスポンス構造の変更） ✅ **完全解決**
**問題**: `charactersData?.characters`プロパティ不存在エラー、any型の多用
**原因**: APIレスポンス構造変更による型定義の不整合、適切な型指定不足
**解決策**: 
- APIクライアント全体でany型を適切な型指定に変更
- Character interface更新（`isActive`追加、オプショナルフィールド調整）
- UI層でのany型使用除去
- バックエンドAPIとの型定義完全統一
**技術詳細**: snake_case ↔ camelCase変換維持、型安全性完全確保

#### 3. Radix UI依存関係不足 ✅ **完全解決**
**問題**: `@radix-ui/react-scroll-area`不足によるビルドエラー
**原因**: shadcn/uiコンポーネントの依存関係未インストール
**解決策**: 
- `@radix-ui/react-scroll-area@1.2.9`正式インストール
- 独自ScrollAreaコンポーネントを正式なRadix UI実装に置き換え
- アクセシビリティ対応とプロフェッショナルなスクロールバー実装
**効果**: より堅牢で機能豊富なScrollAreaコンポーネント実現

#### 4. 未使用コンポーネントによる型エラー ✅ **解決済み**
**問題**: 古い`ui/layout/Navbar.tsx`のuseAuthフック参照エラー
**原因**: リファクタリング後の未使用ファイル残存
**解決策**: ファイル削除とLayoutコンポーネント使用への統一
**学習**: リファクタリング時の不要ファイル整理の重要性

### 実装パターンの確立

#### サービス層分離パターン
```python
class GameSessionService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_session(self, user_id: str, session_data: GameSessionCreate) -> GameSessionResponse:
        # 既存アクティブセッション非アクティブ化
        # 新セッション作成
        # 初期シーン設定
        # レスポンス生成
```

#### React Query + Zustand統合パターン
```typescript
export const useCreateGameSession = () => {
  const { setActiveSession } = useGameSessionStore()
  
  return useMutation<GameSession, Error, GameSessionCreate>({
    mutationFn: (sessionData) => apiClient.createGameSession(sessionData),
    onSuccess: (newSession) => {
      queryClient.invalidateQueries({ queryKey: ['gameSessions'] })
      setActiveSession(newSession) // ストア更新
    },
  })
}
```

#### 型安全なAPIクライアント統合
```typescript
// snake_case ↔ camelCase変換統合
async createGameSession(sessionData: GameSessionCreate): Promise<GameSession> {
  const snakeData = camelToSnakeObject(sessionData)
  const data = await this.request<any>('/game/sessions', {
    method: 'POST',
    body: JSON.stringify(snakeData),
  })
  return snakeToCamelObject<GameSession>(data)
}
```

### 技術的決定事項

1. **API設計**: RESTful + 専用アクションエンドポイント（AI統合準備）
2. **状態管理**: React Query（サーバー状態） + Zustand（クライアント状態）分離
3. **エラーハンドリング**: 統一的なHTTPException処理とtoast通知
4. **UI実装**: 段階的実装（基本機能優先、高度なUI後回し）
5. **型安全性戦略**: 完全な型安全性確保、any型の排除、バックエンドAPIとの型統一
6. **依存関係管理**: 正式なRadix UI採用、独自実装からの段階的移行

---

## 最新の技術的成果（2025/06/14追加）

### 型安全性の完全確保 ✅ **達成**

**実装詳細:**
```typescript
// APIクライアントの型安全化（src/api/client.ts）
async getCharacters(): Promise<Character[]> {
  const data = await this.request<Character[]>('/characters')  // any型から適切な型指定に変更
  return snakeToCamelObject<Character[]>(data)
}

// Character interface完全更新（src/types/index.ts）
export interface Character {
  id: string
  userId: string
  name: string
  description?: string      // オプショナル化
  appearance?: string       // オプショナル化
  personality?: string      // オプショナル化
  skills: Skill[]
  stats?: CharacterStats    // オプショナル化
  location: string
  isActive: boolean         // バックエンド対応追加
  createdAt: string
  updatedAt: string
}
```

**効果:**
- TypeScriptコンパイル時エラー検出
- IntelliSenseによる開発体験向上
- ランタイムエラー予防
- APIレスポンス構造変更の早期発見

### Radix UI完全統合 ✅ **達成**

**実装詳細:**
```typescript
// ScrollAreaコンポーネント（src/components/ui/scroll-area.tsx）
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
```

**効果:**
- プロフェッショナルなスクロールバー実装
- アクセシビリティ完全対応
- キーボードナビゲーション支援
- 統一されたUI/UXパターン

---

**更新履歴:**
- 2025/06/14: 初版作成・基盤構築完了を反映
- 2025/06/14: Docker環境・WebSocket・開発ツール詳細追加
- 2025/06/14: TanStack Router移行完了を反映
- 2025/06/14: ゲームセッション機能実装完了・技術的決定事項・問題解決策を追加
- 2025/06/14: 型安全性完全確保・Radix UI完全統合・全技術的問題解決完了を反映
- 2025/06/15: インフラストラクチャとLTSバージョン更新完了
  - 主要サービスLTS化（PostgreSQL 17、Neo4j 5.26 LTS、Redis 8、Keycloak 26.2）
  - バックエンド依存ライブラリ最新版更新完了
  - Celeryタスクシステム完全統合（Worker、Beat、Flower）
- 2025/06/15: フロントエンド依存ライブラリ最新化完了
  - React 19.1.0、TypeScript 5.8.3、Vite 6.3.5への更新
  - TanStack Query v5、ESLint v9、Tailwind CSS v4への移行
  - Breaking changes対応（cacheTime→gcTime、新ESLint設定形式、Tailwind CSS v4設定）
- 2025/06/17: ハードコーディング箇所の調査・管理方針追加
  - 開発用として許容する項目の明確化
  - 将来的に設定管理すべき項目の識別
  - テストの構造的問題の文書化