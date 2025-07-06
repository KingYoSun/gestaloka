# TanStack Router実装パターン

## 概要
このドキュメントでは、ゲスタロカプロジェクトで使用しているTanStack Routerの実装パターンと、実際の開発で得られた知見をまとめます。

## ディレクトリベースルーティング

### 基本構造
TanStack Routerはファイルシステムベースのルーティングをサポートしています。

```
src/routes/
  __root.tsx              # ルートレイアウト
  index.tsx               # ホームページ（/）
  login.tsx               # ログインページ（/login）
  register.tsx            # 登録ページ（/register）
  _authenticated.tsx      # 認証済みレイアウト
  _authenticated/         # 認証が必要なページ
    dashboard.tsx         # ダッシュボード（/dashboard）
    characters.tsx        # キャラクター一覧（/characters）
```

### レイアウトルート
アンダースコア（`_`）で始まるファイルはレイアウトルートとして機能します：

```typescript
// _authenticated.tsx
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { Layout } from '@/components/layout/Layout'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context }) => {
    if (!context.auth?.isAuthenticated) {
      throw redirect({
        to: '/login',
        search: { redirect: location.pathname },
      })
    }
  },
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
})
```

## ネストされたルートの実装

### ❌ 誤った実装（フラットファイル）
```
/routes/_authenticated/
  character.$id.tsx        # 詳細ページ
  character.$id.edit.tsx   # 編集ページ（動作しない）
```

この構造では、URLは変わってもコンポーネントが切り替わりません。

### ✅ 正しい実装（ディレクトリ構造）
```
/routes/_authenticated/character/
  $id.tsx                  # 親ルート（レイアウト）
  $id/
    index.tsx              # 詳細ページ（/character/$id）
    edit.tsx               # 編集ページ（/character/$id/edit）
```

#### 親ルートの実装
```typescript
// character/$id.tsx
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/character/$id')({
  component: () => <Outlet />,
})
```

#### 子ルートの実装
```typescript
// character/$id/index.tsx
import { createFileRoute } from '@tanstack/react-router'
import { CharacterDetailPage } from '@/features/character/CharacterDetailPage'

export const Route = createFileRoute('/_authenticated/character/$id/')({
  component: CharacterDetailPage,
})
```

```typescript
// character/$id/edit.tsx
import { createFileRoute } from '@tanstack/react-router'
import { CharacterEditPage } from '@/features/characters/pages/CharacterEditPage'

export const Route = createFileRoute('/_authenticated/character/$id/edit')({
  component: CharacterEditPage,
})
```

## パラメータの取得

### useParamsフックの使用
```typescript
import { useParams } from '@tanstack/react-router'

export const CharacterEditPage = () => {
  // 正しいルートパスを指定することが重要
  const { id } = useParams({ from: '/_authenticated/character/$id/edit' })
  
  // idを使用してデータを取得
  const { data: character } = useCharacter(id)
}
```

## ナビゲーション

### useNavigateフックの使用
```typescript
import { useNavigate } from '@tanstack/react-router'

const navigate = useNavigate()

// 型安全なナビゲーション
navigate({ to: '/character/$id', params: { id: characterId } })
navigate({ to: '/character/$id/edit', params: { id: characterId } })
```

### Linkコンポーネントの使用
```typescript
import { Link } from '@tanstack/react-router'

<Link to="/character/$id" params={{ id: character.id }}>
  {character.name}
</Link>
```

## ルート保護

### beforeLoadフックでの認証チェック
```typescript
export const Route = createFileRoute('/_authenticated/admin')({
  beforeLoad: async ({ context }) => {
    if (!context.auth?.isAdmin) {
      throw redirect({ to: '/dashboard' })
    }
  },
})
```

## ベストプラクティス

### 1. ディレクトリ構造の原則
- ネストされたルートは必ずディレクトリ構造で実装する
- 親ルートには`<Outlet />`を配置する
- indexルートは明示的に`index.tsx`として作成する

### 2. 型安全性の確保
- `useParams`には正確な`from`パスを指定する
- ルートパラメータの型定義を活用する
- `navigate`関数では型安全なオブジェクト形式を使用する

### 3. レイアウトの管理
- 共通レイアウトはレイアウトルート（`_`プレフィックス）で管理
- 認証状態によるレイアウトの切り替えを活用
- レイアウトの重複を避ける

### 4. エラーハンドリング
- ルートごとにエラーバウンダリを設定可能
- 404ページの適切な処理
- リダイレクトの活用

## トラブルシューティング

### 問題：URLは変わるがコンポーネントが変わらない
**原因**：フラットファイル構造でネストされたルートを実装している
**解決策**：ディレクトリ構造に変更し、親ルートに`<Outlet />`を配置

### 問題：パラメータが取得できない
**原因**：`useParams`の`from`パスが間違っている
**解決策**：正確なルートパスを指定する

### 問題：ルートツリーが更新されない
**原因**：開発サーバーの再起動が必要
**解決策**：`docker-compose restart frontend`を実行

## 参考リンク
- [TanStack Router公式ドキュメント](https://tanstack.com/router/latest)
- [ファイルベースルーティング](https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing)
- [ディレクトリルート](https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing#directory-routes)