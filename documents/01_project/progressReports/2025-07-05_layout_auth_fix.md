# 進捗レポート: レイアウト二重表示とログイン認証フローの修正

**日付**: 2025年7月5日  
**作業者**: Claude  
**カテゴリ**: バグ修正 / アーキテクチャ改善

## 概要

ログイン後にサイドバーとヘッダーが二重に表示される問題と、ダッシュボードへの直接アクセス時に認証が正しく機能しない問題を修正しました。

## 解決した問題

### 1. レイアウトの二重表示
- **問題**: ログイン後、管理画面や認証済みページでサイドバーとヘッダーが二重に表示されていた
- **原因**: `__root.tsx`と各ルートの両方でLayoutコンポーネントが適用されていた

### 2. 認証フローの不具合
- **問題**: ログイン成功後にリダイレクトが機能せず、保護されたルートに直接アクセスできなかった
- **原因**: TanStack Routerのコンテキストに認証情報が正しく提供されていなかった

## 実装した解決策

### 1. TanStack Routerのレイアウトルート機能を活用

#### レイアウトルートの作成
```typescript
// _authenticated.tsx - 認証が必要なルート用
export const Route = createFileRoute('/_authenticated')({
  component: AuthenticatedComponent,
})

// _admin.tsx - 管理者ルート用
export const Route = createFileRoute('/_admin')({
  component: AdminComponent,
})
```

#### ルート構造の再編成
```
__root.tsx (レイアウトなし)
├── _authenticated/ (通常のLayout適用)
│   ├── dashboard
│   ├── characters
│   ├── exploration
│   └── ...
├── _admin/ (AdminLayout適用)
│   ├── admin
│   ├── admin.performance
│   └── admin.sp
└── 公開ルート (レイアウトなし)
    ├── index
    ├── login
    └── register
```

### 2. 認証コンテキストの提供方法を改善

#### カスタムコンテキストの実装
```typescript
// __root.tsx
const AuthContext = React.createContext<any>(null)

export function useRouterAuth() {
  const context = React.useContext(AuthContext)
  if (!context) {
    throw new Error('useRouterAuth must be used within AuthContext')
  }
  return context
}

function InnerRoot() {
  const auth = useAuth()
  
  return (
    <AuthContext.Provider value={auth}>
      <WebSocketProvider>
        <div className="min-h-screen bg-background text-foreground">
          <Outlet />
        </div>
      </WebSocketProvider>
    </AuthContext.Provider>
  )
}
```

#### 認証チェックの実装
```typescript
// _authenticated.tsx
function AuthenticatedComponent() {
  const auth = useRouterAuth()
  const navigate = Route.useNavigate()
  
  React.useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      navigate({ 
        to: '/login',
        search: {
          redirect: Route.path,
        },
      })
    }
  }, [auth.isLoading, auth.isAuthenticated, navigate])
  
  if (auth.isLoading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>
  }
  
  if (!auth.isAuthenticated) {
    return <div className="flex items-center justify-center min-h-screen">Redirecting...</div>
  }
  
  return (
    <Layout>
      <Outlet />
    </Layout>
  )
}
```

### 3. ログインページのリダイレクト処理を修正

#### 検索パラメータの型定義
```typescript
// login.tsx
const loginSearchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/login')({
  validateSearch: loginSearchSchema,
  component: LoginPage,
})
```

#### リダイレクト処理の実装
```typescript
// LoginPage.tsx
const search = Route.useSearch()
const redirect = search.redirect || '/dashboard'

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault()
  await handleAsync(async () => {
    await login(username, password)
    navigate({ to: redirect })
  }, 'ログインに失敗しました。')
}
```

## 技術的な変更点

### 1. ファイル構造の変更
- 認証が必要なルートを`_authenticated/`配下に移動
- 管理者ルートを`_admin/`配下に移動
- 各ルートファイルからLayout関連のインポートと使用を削除

### 2. 型定義の追加
- `types/router.ts`でルーターコンテキストの型を定義
- TanStack Routerのモジュール拡張で型サポートを提供

### 3. コンポーネントの整理
- 各ルートファイルから重複したLayout/ProtectedRouteコンポーネントを削除
- レイアウトルートで一元管理

## 結果

- ✅ レイアウトの二重表示が解消
- ✅ ログイン後の適切なリダイレクトが実現
- ✅ 保護されたルートへの直接アクセス制御が機能
- ✅ 認証状態の一元管理による一貫性の向上
- ✅ 型安全性の向上

## 今後の検討事項

1. 管理者権限のチェック機能の実装
2. より細かい権限管理（ロールベースアクセス制御）
3. 認証エラー時のより詳細なエラーハンドリング
4. ローディング状態のUIの改善

## 関連ファイル

- `/src/routes/__root.tsx`
- `/src/routes/_authenticated.tsx`
- `/src/routes/_admin.tsx`
- `/src/routes/login.tsx`
- `/src/features/auth/LoginPage.tsx`
- `/src/types/router.ts`
- `/src/App.tsx`