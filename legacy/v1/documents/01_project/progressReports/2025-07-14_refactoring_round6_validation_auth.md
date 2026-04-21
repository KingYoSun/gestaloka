# 全体リファクタリング第6回（バリデーションルール統一・認証システム統一）

## 実施日時
2025年7月14日 03:45 JST

## 概要
プロジェクト全体のリファクタリング第6回として、バリデーションルールの重複実装解消と認証システムの統一を実施。DRY原則に従い、重複したコードを削除し、単一の真実の源（Single Source of Truth）を確立。

## 実施内容

### 1. バリデーションルールの重複実装解消

#### 問題点
- フロントエンドでバリデーションルールがハードコーディングされていた
- バックエンドに`/api/v1/config/game/validation-rules`エンドポイントが存在するにも関わらず未使用

#### 実施した修正

1. **バリデーションルールフックの作成**
   - `/frontend/src/hooks/useValidationRules.ts`を新規作成
   - APIからバリデーションルールを取得するReact Queryフックを実装

2. **バリデーションルールコンテキストの作成**
   - `/frontend/src/contexts/ValidationRulesContext.tsx`を新規作成
   - アプリケーション全体でバリデーションルールを共有

3. **バリデーションスキーマのファクトリー関数化**
   - `/frontend/src/lib/validations/schemas/auth.ts`
     - `userRegisterSchema` → `createUserRegisterSchema()`
     - `changePasswordSchema` → `createChangePasswordSchema()`
   - `/frontend/src/lib/validations/validators/password.ts`
     - `passwordSchema` → `createPasswordSchema()`
     - `passwordConfirmBaseSchema` → `createPasswordConfirmBaseSchema()`
   - `/frontend/src/schemas/character.ts`
     - `characterCreationSchema` → `createCharacterCreationSchema()`

4. **コンポーネントの修正**
   - `/frontend/src/features/character/CharacterCreatePage.tsx`
   - `/frontend/src/features/auth/RegisterPage.tsx`
   - バリデーションルールをAPIから取得して使用するよう修正

### 2. 認証システムの統一

#### 問題点
- AuthProvider/useAuth（Context API）とuseAuthStore（Zustand）の2つの認証システムが混在
- 同じ目的で異なる実装が存在（DRY原則違反）

#### 実施した修正

1. **AuthProvider/useAuthの採用を決定**
   - より包括的でAPIとの連携が適切に実装されている
   - Cookie認証との統合が正しく動作している

2. **useAuthStoreの削除**
   - `/frontend/src/store/authStore.ts`を削除
   - 空になった`/frontend/src/store`ディレクトリを削除

3. **コンポーネントの修正**
   - `/frontend/src/components/Header.tsx`
     - `useAuthStore` → `useAuth`に変更
   - `/frontend/src/features/admin/components/AdminLayout.tsx`
     - `useAuthStore` → `useAuth`に変更
     - ログアウト処理を非同期化

### 3. 型エラーの修正

#### バックエンド
1. **StoryArcTypeの重複定義を解消**
   - `/backend/app/models/story_arc.py`に不足していたENUM値を追加
   - `/backend/app/models/encounter_story.py`の重複定義を削除
   - インポートで`story_arc.py`のStoryArcTypeを使用

#### フロントエンド
1. **型定義の修正**
   - `useValidationRules.ts`のapiClientインポートパスを修正
   - `password.ts`のZodスキーマ型定義を修正（ZodTypeAnyを使用）
   - apiClient.getの戻り値型を正しく扱うよう修正

## 成果

### コード品質
- **リント**: 全て成功（警告44件のみ、エラー0件）
- **型チェック**: 全て成功（バックエンド・フロントエンド共にエラー0件）

### DRY原則の適用
- バリデーションルールの単一の真実の源を確立
- 認証システムの重複を解消
- 保守性と一貫性の向上

### 削除されたファイル
- `/frontend/src/store/authStore.ts`
- `/frontend/src/store/`（ディレクトリ）

### 作成されたファイル
- `/frontend/src/hooks/useValidationRules.ts`
- `/frontend/src/contexts/ValidationRulesContext.tsx`

## 技術的詳細

### バリデーションルールAPI
```typescript
interface ValidationRules {
  user: {
    username: {
      min_length: number
      max_length: number
      pattern: string
      pattern_description: string
    }
    password: {
      min_length: number
      max_length: number
      requirements: string[]
    }
  }
  character: {
    name: { min_length: number; max_length: number }
    description: { max_length: number }
    appearance: { max_length: number }
    personality: { max_length: number }
  }
  game_action: {
    action_text: { max_length: number }
  }
}
```

### 認証システムの統一
- AuthContext（Context API）を採用
- useAuthフックで認証状態を管理
- Cookie認証との適切な統合

## 今後の課題

1. **警告の解消**
   - フロントエンドのany型警告（44件）の解消
   - fast-refresh警告の対応

2. **テストの追加**
   - バリデーションルールコンテキストのテスト
   - 認証フックのテスト

3. **ドキュメントの更新**
   - 新しいバリデーションシステムの使用方法
   - 認証システムの統一に関する説明

## 関連ファイル
- [現在のタスク状況](../activeContext/current_tasks.md)
- [既知の問題リスト](../activeContext/issuesAndNotes.md)