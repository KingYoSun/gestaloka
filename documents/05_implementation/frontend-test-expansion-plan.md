# フロントエンドテスト拡充計画

## 概要
作成日: 2025/07/17
作成者: Claude

フロントエンドのテストカバレッジが実質0%の状況を改善するための段階的なテスト拡充計画です。

## 現状分析

### 問題点
- テストファイルが1つのみ（`src/lib/__tests__/api.test.ts`）
- テストカバレッジ: 0%（129ファイルに対して）
- MSWは導入済みだがモックサーバーが未実装
- 主要機能のテストが全く存在しない

### 既存のテスト環境
- Vitest設定済み
- Testing Library導入済み
- MSWパッケージ導入済み
- テスト実行環境は動作可能

## 実装計画

### フェーズ1: テスト基盤の構築（優先度: 最高）

#### 1.1 MSWモックサーバーの実装
```
src/mocks/
├── server.ts          # MSWサーバー設定
├── handlers/          # APIモックハンドラー
│   ├── auth.ts       # 認証APIモック
│   ├── characters.ts  # キャラクターAPIモック
│   ├── game.ts       # ゲームAPIモック
│   └── index.ts      # ハンドラー統合
└── fixtures/          # テストデータ
    ├── user.ts
    ├── character.ts
    └── game.ts
```

#### 1.2 テストユーティリティの作成
```
src/test/
├── test-utils.tsx     # カスタムレンダー関数
├── providers.tsx      # テスト用プロバイダー
└── factories/         # テストデータファクトリー
```

### フェーズ2: 認証機能のテスト（優先度: 最高）

#### 2.1 認証関連コンポーネント
- [ ] `useAuth.test.ts` - 認証フックのテスト
- [ ] `AuthProvider.test.tsx` - 認証プロバイダーのテスト
- [ ] `LoginPage.test.tsx` - ログインページのテスト
- [ ] `RegisterPage.test.tsx` - 登録ページのテスト

#### 2.2 認証フローの統合テスト
- [ ] ログインフロー全体のテスト
- [ ] セッション管理のテスト
- [ ] 認証エラーハンドリングのテスト

### フェーズ3: APIクライアントのテスト（優先度: 高）

#### 3.1 自動生成APIクライアント
- [ ] 各APIクライアントの基本動作テスト
- [ ] エラーハンドリングのテスト
- [ ] リトライロジックのテスト

#### 3.2 カスタムAPIクライアント
- [ ] `sp-purchase.ts`
- [ ] `memoryInheritance.ts`
- [ ] `narrativeApi.ts`

### フェーズ4: 主要機能コンポーネントのテスト（優先度: 高）

#### 4.1 ゲームプレイ機能
- [ ] `GamePage.test.tsx`
- [ ] `NarrativeInterface.test.tsx`
- [ ] `NPCEncounterManager.test.tsx`

#### 4.2 キャラクター管理
- [ ] `CharacterListPage.test.tsx`
- [ ] `CharacterCreatePage.test.tsx`
- [ ] `CharacterEditForm.test.tsx`

#### 4.3 ログ管理
- [ ] `LogsPage.test.tsx`
- [ ] `LogFragmentList.test.tsx`
- [ ] `LogCompilationEditor.test.tsx`

### フェーズ5: 共通コンポーネントのテスト（優先度: 中）

#### 5.1 UIコンポーネント
- [ ] 各UIコンポーネントの表示テスト
- [ ] インタラクションテスト
- [ ] アクセシビリティテスト

#### 5.2 カスタムフック
- [ ] `useCharacters.test.ts`
- [ ] `useGameSessions.test.ts`
- [ ] `useValidationRules.test.ts`

### フェーズ6: E2Eテストの追加（優先度: 低）

#### 6.1 主要ユーザーフロー
- [ ] 新規登録→ログイン→キャラクター作成
- [ ] ゲームプレイセッション
- [ ] SP購入フロー

## 実装順序と期待される効果

### 第1週: 基盤構築
1. MSWモックサーバー実装
2. テストユーティリティ作成
3. 認証フックのテスト

**期待効果**: テスト実行可能な環境の確立

### 第2週: 認証とAPIテスト
1. 認証コンポーネントのテスト
2. APIクライアントの基本テスト

**期待効果**: カバレッジ20-30%達成

### 第3週: 主要機能テスト
1. ゲームプレイ機能のテスト
2. キャラクター管理のテスト

**期待効果**: カバレッジ40-50%達成

### 第4週: 完成度向上
1. 残りのコンポーネントテスト
2. 統合テストの追加

**期待効果**: カバレッジ60%以上達成

## 成功指標

### 短期目標（1ヶ月）
- テストカバレッジ: 60%以上
- 全ての主要機能にテスト存在
- CI/CDでのテスト自動実行

### 中期目標（3ヶ月）
- テストカバレッジ: 80%以上
- E2Eテストの導入
- パフォーマンステストの追加

## 技術的な考慮事項

### MSWのセットアップ
- バージョン2系を使用（既にインストール済み）
- Service WorkerモードとNodeモードの両方をサポート
- レスポンスの遅延シミュレーション機能を活用

### テストデータ管理
- Factoryパターンを使用してテストデータを生成
- Fixtureファイルで共通データを管理
- 実際のAPIレスポンスを参考にモックデータを作成

### パフォーマンス考慮
- 並列実行可能なテストの設計
- テストの独立性を保証
- 不要なレンダリングを避ける

## リスクと対策

### リスク1: 既存コードの品質
**対策**: テスト作成時にリファクタリングも同時実施

### リスク2: テスト実行時間の増大
**対策**: 
- 適切なテスト分割
- 並列実行の活用
- 重いテストの最適化

### リスク3: メンテナンスコスト
**対策**:
- 共通化できる部分の抽出
- Page Objectパターンの採用
- テストユーティリティの充実

## 次のステップ

1. この計画のレビューと承認
2. MSWモックサーバーの実装開始
3. 最初の認証テストの作成
4. 週次でのカバレッジレポート確認

## 参考資料

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [MSW Documentation](https://mswjs.io/)
- [React Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)