# 記憶継承システム フロントエンドUI実装

## 概要
記憶継承システムは、プレイヤーが収集した記憶フラグメントを組み合わせて、新たな力（スキル、称号、アイテム、ログ強化）を獲得できる機能です。

## 実装日
2025-07-03

## 技術構成

### APIクライアント
- **ファイル**: `frontend/src/api/memoryInheritance.ts`
- **エンドポイント**:
  - `GET /characters/{character_id}/memory-inheritance/preview`
  - `POST /characters/{character_id}/memory-inheritance/execute`
  - `GET /characters/{character_id}/memory-inheritance/history`
  - `GET /characters/{character_id}/memory-inheritance/enhancements`

### 型定義
```typescript
enum MemoryInheritanceType {
  SKILL = "skill",
  TITLE = "title",
  ITEM = "item",
  LOG_ENHANCEMENT = "log_enhancement"
}

interface MemoryCombinationPreview {
  possible_types: MemoryInheritanceType[];
  skill_preview?: SkillPreview;
  title_preview?: TitlePreview;
  item_preview?: ItemPreview;
  log_enhancement_preview?: LogEnhancementPreview;
  base_sp_cost: number;
  combo_bonus: number;
  total_sp_cost: number;
  memory_themes: string[];
  rarity_distribution: Record<string, number>;
}
```

## UIコンポーネント

### 1. MemoryInheritanceScreen
**パス**: `components/memory/MemoryInheritanceScreen.tsx`

メイン画面コンポーネント。タブ形式で「記憶継承」と「継承履歴」を切り替え。

**特徴**:
- レスポンシブレイアウト（lg:grid-cols-2）
- タブ切り替え（Tabs/TabsContent使用）
- 実行状態管理とローディング表示

### 2. MemoryFragmentSelector
**パス**: `components/memory/MemoryFragmentSelector.tsx`

記憶フラグメントの選択UIコンポーネント。

**特徴**:
- チェックボックスによる複数選択
- レアリティ別の色分け表示
- ARCHITECTレアリティの特別表示
- キーワードバッジ表示
- ScrollAreaによる効率的なスクロール

### 3. MemoryInheritancePreview
**パス**: `components/memory/MemoryInheritancePreview.tsx`

選択したフラグメントの組み合わせプレビューと継承タイプ選択。

**特徴**:
- SP消費計算とコンボボーナス表示
- RadioGroupによる継承タイプ選択
- 各タイプのプレビュー情報表示
- レアリティ分布のプログレスバー表示

### 4. MemoryInheritanceHistory
**パス**: `components/memory/MemoryInheritanceHistory.tsx`

継承履歴の時系列表示コンポーネント。

**特徴**:
- 継承タイプ別のアイコンと色分け
- 日時フォーマット（date-fns使用）
- SP消費量の表示
- ScrollAreaによる履歴のスクロール

## カスタムフック

### useMemoryInheritance
**パス**: `hooks/useMemoryInheritance.ts`

記憶継承システムの基本的な状態管理とAPI連携。

**機能**:
- フラグメント選択状態管理
- プレビュー取得（選択数2以上で自動実行）
- 継承実行とエラーハンドリング
- 関連クエリの自動無効化
- トースト通知

### useMemoryInheritanceScreen
画面専用の拡張フック。

**機能**:
- 継承可能フラグメントのフィルタリング
- 実行可能状態の計算
- useMemoryInheritanceの全機能を継承

## ルーティングとナビゲーション

### ルート設定
- **パス**: `/memory`
- **ファイル**: `routes/memory.lazy.tsx`
- **アクセス制御**: キャラクター選択必須

### ナビゲーション統合
1. **サイドバー**: 「記憶継承」リンク追加（Sparklesアイコン）
2. **ゲーム画面**: クイックアクセスボタン追加

## 依存関係

### 外部パッケージ
- `@radix-ui/react-radio-group`: ラジオグループUI
- `@radix-ui/react-checkbox`: チェックボックスUI
- `date-fns`: 日時フォーマット
- `sonner`: トースト通知

### 内部依存
- `@/api/generated`: 型定義
- `@/lib/api-client`: APIクライアント
- `@/components/ui/*`: 共通UIコンポーネント

## 状態管理とデータフロー

```
ユーザー操作
    ↓
useMemoryInheritance（状態管理）
    ↓
APIクライアント（memoryInheritanceApi）
    ↓
バックエンドAPI
    ↓
React Query（キャッシュ管理）
    ↓
UIコンポーネント（表示更新）
```

## エラーハンドリング

1. **API エラー**: トースト通知で表示
2. **バリデーション**: 
   - フラグメント最低2つ必要
   - 継承タイプ選択必須
   - SP不足チェック
3. **ネットワークエラー**: React Queryのリトライ機能

## パフォーマンス最適化

1. **条件付きクエリ**: 選択数2以上でのみプレビュー取得
2. **楽観的更新**: 実行後の即座のUI更新
3. **ScrollArea**: 大量データの効率的表示
4. **メモ化**: 不要な再レンダリング防止

## 今後の拡張可能性

1. **アニメーション**: 継承実行時の演出
2. **フィルタリング**: レアリティやキーワードでの絞り込み
3. **バッチ継承**: 複数の継承を一度に実行
4. **統計表示**: 継承成功率や人気の組み合わせ
5. **WebSocket連携**: リアルタイム更新

## 関連ドキュメント
- [記憶継承システム設計](../../03_worldbuilding/mechanics/memory_inheritance_mechanics.md)
- [バックエンドAPI仕様](../api_endpoints.md#記憶継承api)