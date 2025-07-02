# 記憶継承システム実装ガイド

最終更新: 2025-07-02

## 概要

記憶継承システムは、プレイヤーが獲得した記憶フラグメントを組み合わせて新しい価値（スキル、称号、アイテム、ログ強化）を創造するシステムです。

## アーキテクチャ

### サービス層
- **MemoryInheritanceService**: 記憶継承の中核ロジック
  - 組み合わせプレビュー生成
  - SP消費計算（レアリティとコンボボーナス）
  - AI統合による動的報酬生成
  - 継承履歴の管理

### データモデル

#### 新規追加モデル
```python
# 称号モデル
class CharacterTitle(SQLModel, table=True):
    id: str
    character_id: str
    title: str
    description: str
    acquired_at: str  # 獲得方法
    effects: dict[str, Any]  # JSON型
    is_equipped: bool

# アイテムマスタ
class Item(SQLModel, table=True):
    id: str
    name: str
    description: str
    item_type: ItemType
    rarity: ItemRarity
    effects: dict[str, Any]
    tradeable: bool
    stackable: bool

# キャラクター所持アイテム
class CharacterItem(SQLModel, table=True):
    id: str
    character_id: str
    item_id: str
    quantity: int
    obtained_at: str
    is_equipped: bool
```

#### 既存モデルの変更
- **Skill**: マスタデータに変更（character_idを削除）
- **CharacterSkill**: 新規追加（キャラクターのスキル所持状況）
- **Character**: character_metadataフィールド追加（JSON型）

### APIエンドポイント

```python
# プレビュー取得
GET /api/v1/memory-inheritance/characters/{character_id}/memory-inheritance/preview
Query: fragment_ids (List[str])

# 継承実行
POST /api/v1/memory-inheritance/characters/{character_id}/memory-inheritance/execute
Body: {
    "fragment_ids": ["id1", "id2"],
    "inheritance_type": "skill"  # skill/title/item/log_enhancement
}

# 履歴取得
GET /api/v1/memory-inheritance/characters/{character_id}/memory-inheritance/history

# ログ強化情報取得
GET /api/v1/memory-inheritance/characters/{character_id}/memory-inheritance/enhancements
```

## 継承タイプ別の実装

### 1. スキル継承
- 記憶の組み合わせから新しいスキルを生成
- AI（GM AI Service）が記憶の内容を分析してスキルを提案
- 例: [剣術の極意] + [守護の誓い] → スキル「聖剣術」

### 2. 称号獲得
- 物語的な達成や特性を表す称号を獲得
- ステータスボーナスや特殊効果を付与
- 例: [勇気] + [犠牲] + [仲間との絆] → 称号「真の英雄」

### 3. アイテム生成
- 記憶が物質化した特別なアイテムを創造
- 記憶から生成されたアイテムは取引不可
- 例: [古代の知識] + [錬金術の秘伝] → アイテム「賢者の石」

### 4. ログ強化
- ログ派遣時に特別な効果を付与
- 初期好感度ボーナスや特殊イベント発生率の向上
- character_metadataに保存され、ログ編纂時に適用

## SP消費計算

### 基本コスト
- スキル継承: 30 SP
- 称号獲得: 50 SP
- アイテム生成: 100 SP
- ログ強化: 20 SP

### レアリティ倍率
```python
rarity_multipliers = {
    COMMON: 1.0,
    UNCOMMON: 1.2,
    RARE: 1.5,
    EPIC: 2.0,
    LEGENDARY: 3.0,
    UNIQUE: 2.5,
    ARCHITECT: 5.0
}
```

### コンボボーナス
- 3つ以上: 10%割引
- 5つ以上: 20%割引 + 特別効果

## AI統合

記憶継承システムはGM AIサービスと統合されており、以下のプロセスで動的に報酬を生成します：

1. **記憶フラグメントの分析**
   - キーワード、感情タグ、レアリティを抽出
   - 物語的な文脈を理解

2. **適切な報酬の生成**
   - 記憶の内容に基づいた名前と説明
   - ゲームバランスを考慮した効果値
   - 物語的な一貫性の確保

3. **パース処理**
   - 現在は簡易実装（将来的により堅牢なパーサーが必要）

## 実装時の注意点

### データベース
- マイグレーションが必要（既に適用済み）
- character_metadataフィールドはJSON型
- Skillテーブルの構造変更に注意

### セキュリティ
- キャラクター所有権の確認
- SP残高の事前チェック
- トランザクション処理の適切な実装

### パフォーマンス
- 複数フラグメントの同時取得
- AI応答のキャッシュ検討（将来）
- 大量の継承履歴への対応

## 今後の拡張予定

### フロントエンドUI
- 記憶の書庫（コレクション画面）
- 継承工房インターフェース
- ドラッグ&ドロップによる組み合わせ
- 効果プレビューとアニメーション

### 機能拡張
- より複雑なコンボシステム
- セットボーナス（関連する記憶の組み合わせ）
- 期間限定の特別な継承パターン
- 他プレイヤーとの記憶交換

## テスト方法

### 手動テスト
```bash
# 1. プレビュー取得
curl -X GET "http://localhost:8000/api/v1/memory-inheritance/characters/{character_id}/memory-inheritance/preview?fragment_ids=id1&fragment_ids=id2" \
  -H "Authorization: Bearer {token}"

# 2. 継承実行
curl -X POST "http://localhost:8000/api/v1/memory-inheritance/characters/{character_id}/memory-inheritance/execute" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "fragment_ids": ["id1", "id2"],
    "inheritance_type": "skill"
  }'
```

### 自動テスト
- 単体テストの作成が必要
- モックを使用したAI応答のテスト
- SP消費計算のエッジケーステスト

## 関連ドキュメント
- [記憶継承システム仕様](../../03_worldbuilding/game_mechanics/memoryInheritance.md)
- [動的クエストシステム](./questSystem.md)
- [SPシステム仕様](../../03_worldbuilding/game_mechanics/sp.md)