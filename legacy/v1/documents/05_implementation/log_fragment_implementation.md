# ログフラグメント（記憶フラグメント）実装ガイド

## 最終更新
2025-07-02

## 概要
ログフラグメント（記憶フラグメント）は、プレイヤーの重要な達成や物語の節目を記念する**永続的なコレクションアイテム**です。これらは「ゲーム体験の記念碑」として位置づけられ、一度獲得したら使用しても消費されません。動的クエストシステムと連携し、物語の完結時にGM AIがサマライズして生成します。

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
    rarity: LogFragmentRarity  # コモン〜レジェンダリー、ユニーク、アーキテクト
    backstory: str  # 200-500文字の物語的コンテキスト
    importance_score: float
    context_data: dict[str, Any]
    acquisition_date: datetime
    acquisition_context: str  # 獲得時の詳細な状況
    memory_type: str  # 勇気/友情/知恵/犠牲/勝利/真実など
    combination_tags: list[str]  # 組み合わせ用のタグ
    world_truth: Optional[str]  # アーキテクトレアリティ限定
    is_consumed: bool = False  # 常にFalse（永続性を保証）
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

#### 動的クエスト完了時
```python
# QuestService内で実装
def complete_quest(quest_id: str, character_id: str):
    # 1. GM AIがクエスト完了を判定
    completion_result = gm_ai.evaluate_quest_completion(quest)
    
    # 2. 物語のサマライズ
    story_summary = gm_ai.summarize_quest_story(quest.key_events)
    
    # 3. テーマ分析と記憶生成
    theme_analysis = gm_ai.analyze_story_themes(story_summary)
    fragment = LogFragmentService.generate_quest_memory(
        character_id=character_id,
        theme=theme_analysis.main_theme,
        summary=story_summary,
        rarity=determine_rarity(quest.difficulty, theme_analysis.uniqueness)
    )
```

#### アチーブメント達成時
```python
# AchievementService内で実装
achievement_fragments = {
    "first_dungeon_clear": ("初めての挑戦", LogFragmentRarity.UNCOMMON),
    "100_battles_won": ("百戦錬磨", LogFragmentRarity.RARE),
    "all_areas_explored": ("世界を知る者", LogFragmentRarity.EPIC),
}
```

#### アーキテクト記憶の発見
```python
# 世界の真実発見時の特別な処理
def discover_world_truth(truth_type: str, character_id: str):
    fragment = LogFragmentService.generate_architect_memory(
        character_id=character_id,
        truth_type=truth_type,
        world_truth=get_world_truth_content(truth_type)
    )
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

## 記憶継承システムの実装

### 1. フラグメントの永続性
```python
class LogFragmentService:
    @staticmethod
    def use_fragment(fragment_id: str, purpose: str) -> bool:
        """フラグメントを使用（消費しない）"""
        fragment = db.query(LogFragment).get(fragment_id)
        if not fragment:
            return False
        
        # 使用履歴を記録するが、フラグメント自体は削除しない
        usage_log = FragmentUsageLog(
            fragment_id=fragment_id,
            purpose=purpose,
            used_at=datetime.utcnow()
        )
        db.add(usage_log)
        
        # is_consumedは常にFalseのまま
        return True
```

### 2. 記憶の組み合わせ
```python
class MemoryInheritanceService:
    @staticmethod
    def combine_memories(fragment_ids: list[str], purpose: str, sp_cost: int):
        """複数の記憶を組み合わせて新たな価値を創造"""
        # SP消費チェック
        if not consume_sp(character_id, sp_cost):
            raise InsufficientSPError()
        
        # 組み合わせ効果の判定
        combination_result = evaluate_combination(fragment_ids)
        
        if purpose == "skill_inheritance":
            return create_new_skill(combination_result)
        elif purpose == "title_acquisition":
            return grant_title(combination_result)
        elif purpose == "log_enhancement":
            return enhance_log(combination_result)
```

### 3. アーキテクト記憶の特別処理
```python
def handle_architect_memory(fragment: LogFragment):
    """アーキテクト記憶の世界真実開示機能"""
    if fragment.rarity != LogFragmentRarity.ARCHITECT:
        return
    
    # world_truthフィールドから世界設定の一部を開示
    revealed_truth = fragment.world_truth
    
    # プレイヤーの知識フラグを更新
    update_player_knowledge(fragment.character_id, revealed_truth)
    
    # 特別なUIで表示するためのフラグ
    fragment.special_display = "architect_revelation"
```

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