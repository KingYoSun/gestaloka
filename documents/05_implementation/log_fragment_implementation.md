# ログフラグメント実装ガイド

## 最終更新
2025-01-07

## 概要
ログフラグメント（Log Fragments）は、プレイヤーの行動や探索から生成される記憶の断片で、ゲスタロカの中核システムの一つです。これらを組み合わせることで、独立したNPCエンティティ（完成ログ）を創造できます。

## アーキテクチャ

### バックエンド構成

#### サービス層
- **LogFragmentService** (`app/services/log_fragment_service.py`)
  - 探索によるフラグメント生成
  - プレイヤー行動からのフラグメント生成
  - キーワードとバックストーリーの動的生成

#### APIエンドポイント
- `GET /api/v1/log-fragments/{character_id}/fragments` - フラグメント一覧取得
- `GET /api/v1/log-fragments/{character_id}/fragments/{fragment_id}` - フラグメント詳細取得

#### データモデル
```python
class LogFragment(SQLModel):
    id: str
    character_id: str
    keyword: str  # メインキーワード
    keywords: list[str]  # 関連キーワードリスト
    emotional_valence: EmotionalValence
    rarity: LogFragmentRarity
    backstory: str
    importance_score: float
    context_data: dict[str, Any]
```

### フロントエンド構成

#### コンポーネント
- **LogFragments** (`src/pages/LogFragments.tsx`)
  - フラグメント一覧表示
  - 統計情報ダッシュボード
  - フィルタリングとページネーション

## 実装詳細

### 1. キーワード生成システム

#### 場所タイプ別キーワード（125種類以上）
```python
LOCATION_KEYWORDS = {
    "city": {
        "common": ["街の喧騒", "市場の記憶", ...],
        "legendary": ["建国の真実", "神との契約", ...]
    },
    # 他の場所タイプ...
}
```

#### 危険度による感情価決定
```python
DANGER_EMOTIONS = {
    "safe": {
        "keywords": ["安らぎ", "希望", ...],
        "valence_weights": {"positive": 0.7, "neutral": 0.25, ...}
    },
    # 他の危険度...
}
```

### 2. フラグメント生成タイミング

#### 探索による発見
```python
# ExplorationEndpoint内で実装
if random.randint(1, 100) <= location.fragment_discovery_rate:
    fragment = LogFragmentService.generate_exploration_fragment(
        character_id, location, area, rarity
    )
```

#### 物語主導の行動から生成
```python
# NarrativeEndpoint内で実装
importance = 0.3  # 基本重要度
if narrative_result.location_changed:
    importance += 0.2
if any(event in ["discovery", "encounter", "choice"]):
    importance += 0.3

if importance >= 0.5:
    fragment = LogFragmentService.generate_action_fragment(...)
```

### 3. バックストーリー生成

レアリティに応じたテンプレートベースの生成:
```python
BACKSTORY_TEMPLATES = {
    LogFragmentRarity.COMMON: [
        "{location}で誰かが残した、ありふれた{emotion}の記憶。..."
    ],
    LogFragmentRarity.LEGENDARY: [
        "世界の根幹に関わる、{keyword}という究極の真理。..."
    ]
}
```

## フロントエンド実装

### 統計情報の表示
- 総フラグメント数
- レアリティ分布
- ユニークキーワード数

### 視覚的表現
- レアリティ別カラーマッピング
- 感情価のアイコン表示
- キーワードタグの表示

## 型定義

### スキーマ定義
```python
class LogFragmentDetail(BaseModel):
    id: str
    keyword: str
    keywords: list[str]
    emotional_valence: EmotionalValence
    rarity: LogFragmentRarity
    backstory: str
    importance_score: float
    created_at: datetime
```

## パフォーマンス考慮事項

1. **ページネーション**: デフォルト20件/ページ
2. **インデックス**: character_idとcreated_atにインデックス
3. **キャッシュ**: 統計情報は必要に応じてキャッシュ可能

## 今後の拡張予定

1. **ログ編纂システム**
   - フラグメントを組み合わせて完成ログを作成
   - コンボボーナスと特殊称号

2. **汚染度メカニクス**
   - ネガティブフラグメントの使用リスク
   - 浄化システム

3. **フラグメント交換**
   - プレイヤー間でのフラグメント取引
   - レアフラグメントの価値設定

## トラブルシューティング

### よくある問題

1. **フラグメントが生成されない**
   - location.fragment_discovery_rateを確認
   - 重要度の計算ロジックを確認

2. **日本語の文字化け**
   - UTF-8エンコーディングを確認
   - データベースの文字コード設定を確認

3. **型エラー**
   - ClassVarアノテーションの使用
   - Optional型の適切な処理