# ログ編纂機能実装ガイド

## 概要
ログ編纂機能は、プレイヤーが収集したログフラグメント（記憶の断片）を組み合わせて完成ログを作成し、NPCとして他プレイヤーの世界に送り出すための中核機能です。

## アーキテクチャ

### フロントエンド構成

```
src/features/logs/
├── LogsPage.tsx              # メインページ（キャラクター選択、編纂ボタン）
├── components/
│   ├── LogFragmentCard.tsx   # 個別フラグメント表示
│   ├── LogFragmentList.tsx   # フラグメント一覧（フィルタリング・ソート機能）
│   └── LogCompilationEditor.tsx # 編纂エディター（コアフラグメント選択、汚染度計算）
├── hooks/
│   ├── useLogFragments.ts    # フラグメント取得・作成フック
│   └── useCompletedLogs.ts   # 完成ログ管理フック
└── types/
    └── log.ts               # ログシステムの型定義
```

### バックエンド構成

```
app/
├── api/api_v1/endpoints/
│   └── logs.py              # ログシステムAPIエンドポイント
├── models/
│   └── log.py               # SQLModelデータモデル
├── schemas/
│   └── log.py               # Pydanticスキーマ
└── services/
    └── npc_generator.py     # ログNPC生成サービス
```

## 主要コンポーネント

### 1. LogsPage
メインページコンポーネント。キャラクター選択と編纂モードの管理を行う。

```typescript
const [showCompilationEditor, setShowCompilationEditor] = useState(false)

// 編纂モードへの切り替え
<Button onClick={() => setShowCompilationEditor(true)}>
  ログを編纂する ({selectedFragmentIds.length})
</Button>
```

### 2. LogCompilationEditor
編纂の中核となるエディターコンポーネント。

主な機能：
- コアフラグメントの選択
- サブフラグメントの選択・解除
- 汚染度の自動計算（ネガティブ感情価の割合）
- ログ名・称号・説明の自動提案
- 編纂実行とAPIコール

### 3. API統合

#### 型定義の統一
フロントエンドとバックエンドの型定義を一致させることが重要：

```typescript
// フロントエンド（types/log.ts）
export interface CompletedLogCreate {
  creatorId: string
  coreFragmentId: string
  subFragmentIds: string[]
  name: string
  title?: string
  description: string
  skills?: string[]
  personalityTraits?: string[]
  behaviorPatterns?: Record<string, unknown>
}
```

```python
# バックエンド（schemas/log.py）
class CompletedLogCreate(CompletedLogBase):
    creator_id: str
    core_fragment_id: str
    sub_fragment_ids: list[str]
```

#### ケース変換
APIクライアントでスネークケース/キャメルケースの自動変換を実装：

```typescript
// api/client.ts
const snakeToCamelObject = (obj: any): any => {
  // 実装
}

const camelToSnakeObject = (obj: any): any => {
  // 実装
}
```

## 実装上の注意点

### 1. 型の整合性
- バックエンドはスネークケース（Python慣習）
- フロントエンドはキャメルケース（JavaScript慣習）
- APIクライアントで自動変換を行う

### 2. 必須フィールド
完成ログ作成時に必要なフィールド：
- `creatorId`: 作成者のキャラクターID
- `coreFragmentId`: コアフラグメントのID
- `subFragmentIds`: サブフラグメントのIDリスト（コアを除く）
- `name`, `description`: 基本情報

### 3. エラーハンドリング
- APIエラー時は適切なトースト通知を表示
- UI状態を適切にリセット
- コンソールに詳細なエラー情報を記録

## テスト方法

### 手動テストの手順

1. **ユーザー登録・ログイン**
   ```
   Email: test@example.com
   Password: testpassword123
   ```

2. **キャラクター作成**
   - 名前、説明、外見、性格を入力

3. **テストデータ投入**
   ```sql
   -- ゲームセッション作成
   INSERT INTO game_sessions (id, character_id, is_active, current_scene, created_at, updated_at)
   VALUES ('test-session-001', (SELECT id FROM characters WHERE name = 'テスト戦士エリス' LIMIT 1), true, '冒険の始まり', NOW(), NOW());

   -- ログフラグメント作成
   INSERT INTO log_fragments (id, character_id, session_id, action_description, keywords, emotional_valence, rarity, importance_score, context_data, created_at)
   VALUES (...);
   ```

4. **編纂機能のテスト**
   - `/logs`にアクセス
   - キャラクター選択
   - フラグメント選択
   - 編纂ボタンクリック
   - エディターで編纂実行

## 今後の拡張

### 1. 完成ログプレビュー
編纂結果のプレビュー画面を実装し、NPCとしての能力を確認できるようにする。

### 2. ゲームセッション統合
ゲームプレイ中に自動的にログフラグメントが生成される仕組みを実装。

### 3. ログ契約システム
完成ログを他プレイヤーの世界に送り出すための契約システムの実装。

### 4. マーケットプレイス
ログ契約を公開・取引できるマーケットプレイスの実装。
詳細は[ログマーケットプレイス仕様](../03_worldbuilding/game_mechanics/logMarketplace.md)を参照。

## トラブルシューティング

### よくある問題

1. **編纂ボタンが押せない**
   - フラグメントが選択されているか確認
   - キャラクターが選択されているか確認

2. **APIエラーが発生する**
   - ブラウザのコンソールでエラー内容を確認
   - バックエンドログでリクエスト内容を確認

3. **型エラーが発生する**
   - フロントエンドとバックエンドの型定義が一致しているか確認
   - ケース変換が正しく動作しているか確認

## 関連ドキュメント

- [ログシステム設計](../03_worldbuilding/game_mechanics/log_system.md)
- [API仕様](../02_architecture/api/api_specification.md)
- [プロジェクト進捗](../01_project/progressReports/2025-06-20_log_compilation_implementation.md)