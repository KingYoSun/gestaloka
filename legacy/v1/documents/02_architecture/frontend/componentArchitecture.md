# フロントエンドコンポーネントアーキテクチャ

## 概要

Gestaloka のフロントエンドは、React 19.1 と TypeScript 5.8 を基盤とし、DRY原則に従った再利用可能なコンポーネント設計を採用しています。

## アーキテクチャ原則

### 1. DRY原則の徹底
- 共通UIコンポーネントの抽出と再利用
- カスタムフックによるロジックの共通化
- ユーティリティ関数での処理の統一
- スタイル定数による一貫性の確保

### 2. 型安全性
- TypeScriptによる完全な型定義
- APIレスポンスの自動生成型を活用
- Zodスキーマによる実行時バリデーション

### 3. レイヤー分離
- **UIレイヤー**: 表示に特化したコンポーネント
- **ロジックレイヤー**: カスタムフックとストア
- **データレイヤー**: APIクライアントとキャッシュ

## 共通コンポーネント

### UI基本コンポーネント (`/components/ui/`)

#### LoadingState
```tsx
interface LoadingStateProps {
  message?: string
  className?: string
}
```
- **用途**: 統一されたローディング表示
- **使用例**: ページ読み込み、データフェッチ中

#### FormError
```tsx
interface FormErrorProps {
  error?: string | null
  className?: string
}
```
- **用途**: フォームエラーの統一表示
- **使用例**: ログイン、登録、各種フォーム

#### LoadingButton
```tsx
interface LoadingButtonProps extends ButtonProps {
  isLoading?: boolean
  loadingText?: string
  icon?: LucideIcon
}
```
- **用途**: ローディング状態を持つボタン
- **使用例**: 送信ボタン、アクションボタン

## カスタムフック

### useFormError
```tsx
const { error, isLoading, handleAsync, setError, clearError } = useFormError()
```
- **機能**: フォームのエラーとローディング状態管理
- **メリット**: エラーハンドリングロジックの統一

### 使用パターン
```tsx
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault()
  
  await handleAsync(
    async () => {
      // 非同期処理
      await apiCall()
    },
    'カスタムエラーメッセージ' // オプション
  )
}
```

## ユーティリティ

### Toast通知 (`/utils/toast.ts`)
```tsx
showSuccessToast(title: string, description?: string)
showErrorToast(error: unknown, defaultMessage?: string)
showInfoToast(title: string, description?: string)
```
- **用途**: 統一されたトースト通知
- **メリット**: 一貫したユーザーフィードバック

### スタイル定数 (`/lib/styles.ts`)
```tsx
export const cardStyles = {
  default: 'shadow-lg border-0 bg-white/80 backdrop-blur-sm',
  gradient: 'bg-gradient-to-br from-purple-50 to-blue-50 border-purple-200',
  transparent: 'bg-white/60 backdrop-blur-md border-white/20',
}

export const containerStyles = {
  page: 'min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-pink-50',
  pageAlt: 'min-h-screen bg-gradient-to-br from-slate-50 to-slate-100',
  centered: 'flex items-center justify-center min-h-screen bg-muted/50',
  maxWidth: 'max-w-4xl mx-auto px-4 py-8',
}

export const buttonStyles = {
  primary: 'bg-purple-600 hover:bg-purple-700 text-white',
  secondary: 'bg-slate-600 hover:bg-slate-700 text-white',
  ghost: 'hover:bg-slate-100',
  outline: 'border-slate-300 hover:bg-slate-50',
}
```

## APIクライアントアーキテクチャ

### 変換処理の統一
```tsx
private async requestWithTransform<T>(
  endpoint: string,
  options: RequestInit = {},
  data?: unknown
): Promise<T>
```
- **機能**: snake_case ↔ camelCase の自動変換
- **メリット**: 各APIメソッドでの重複削除

## ディレクトリ構造

```
src/
├── components/
│   └── ui/                    # 共通UIコンポーネント
│       ├── LoadingState.tsx
│       ├── FormError.tsx
│       ├── LoadingButton.tsx
│       └── ... (shadcn/ui)
├── features/                  # 機能別コンポーネント
│   ├── auth/
│   ├── character/
│   └── game/
├── hooks/                     # カスタムフック
│   ├── useFormError.ts
│   ├── useCharacters.ts
│   └── use-toast.ts
├── utils/                     # ユーティリティ
│   ├── toast.ts
│   └── caseConverter.ts
├── lib/                       # 設定・定数
│   ├── styles.ts
│   └── validations/
└── api/                       # APIクライアント
    └── client.ts
```

## コンポーネント設計ガイドライン

### 1. 新規コンポーネント作成時
- 既存の共通コンポーネントを確認
- 再利用可能な部分を抽出
- スタイル定数を活用

### 2. ローディング状態
- `LoadingState`コンポーネントを使用
- `LoadingButton`でボタンの状態管理
- `useFormError`でフォーム全体の状態管理

### 3. エラーハンドリング
- `FormError`コンポーネントで表示
- `showErrorToast`で通知
- `useFormError`のhandleAsyncで処理

### 4. スタイリング
- `lib/styles.ts`の定数を優先使用
- 一貫性のあるデザインシステム
- Tailwind CSSのユーティリティクラス

## ベストプラクティス

1. **コンポーネントの責務分離**
   - 表示ロジックとビジネスロジックを分離
   - カスタムフックでロジックを抽出

2. **型定義の活用**
   - propsの完全な型定義
   - APIレスポンスの自動生成型を使用

3. **エラー境界の実装**
   - 各機能レベルでエラーバウンダリー
   - ユーザーフレンドリーなエラー表示

4. **パフォーマンス最適化**
   - React.memoによる不要な再レンダリング防止
   - useMemoとuseCallbackの適切な使用

## 今後の拡張ポイント

1. **アニメーション統一**
   - 共通のトランジションコンポーネント
   - Framer Motionの活用

2. **テーマシステム**
   - ダークモード対応
   - カスタマイズ可能なカラースキーム

3. **アクセシビリティ**
   - ARIA属性の統一管理
   - キーボードナビゲーション