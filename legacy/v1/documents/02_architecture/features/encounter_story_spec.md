# 遭遇ストーリーシステム仕様書

作成日: 2025-07-04

## 概要

遭遇ストーリーシステムは、記憶継承システムの拡張機能として、ログNPCやプレイヤーとの遭遇を一時的なイベントではなく、継続的で意味のある物語として発展させるシステムです。

## システムの目的

1. **永続的な関係性の構築**: プレイヤーとNPCの間に継続的な関係を築く
2. **動的な物語生成**: 関係性に基づいた多様なストーリー展開
3. **世界への影響**: 個人的な物語が世界全体に波及効果を持つ
4. **プレイヤー体験の深化**: 一期一会ではない、意味のある出会いと別れ

## 主要コンポーネント

### 1. ストーリーアークタイプ

8種類のストーリーアークが定義されており、それぞれ異なる進行パターンと関係性の発展を持ちます：

| タイプ | 説明 | 進行間隔 | 特徴 |
|--------|------|----------|------|
| QUEST_CHAIN | 連続クエスト | 2時間 | タスク中心、明確な目標 |
| RIVALRY | ライバル関係 | 4時間 | 競争と成長 |
| ALLIANCE | 同盟関係 | 6時間 | 協力と信頼構築 |
| MENTORSHIP | 師弟関係 | 24時間 | 知識・技術の伝承 |
| ROMANCE | ロマンス | 12時間 | 感情的な繋がり |
| MYSTERY | 謎解き | 3時間 | 知的な探求 |
| CONFLICT | 対立 | 1時間 | 緊張と解決 |
| COLLABORATION | 協力関係 | 6時間 | 実利的な協力 |

### 2. 関係性システム

#### 関係性パラメータ
- **relationship_depth** (0.0-1.0): 関係の深さ
- **trust_level** (0.0-1.0): 信頼度
- **conflict_level** (0.0-1.0): 対立度

#### 関係性ステータス
1. INITIAL - 初対面
2. DEVELOPING - 発展中
3. ESTABLISHED - 確立された関係
4. DEEPENING - 深まる関係
5. TRANSFORMED - 変容した関係
6. CONCLUDED - 完結した関係

### 3. データモデル

#### EncounterStory
```python
class EncounterStory:
    id: str
    character_id: str  # プレイヤーキャラクター
    encounter_entity_id: str  # 遭遇相手
    encounter_type: EncounterType
    story_arc_type: StoryArcType
    title: str
    current_chapter: int
    total_chapters: Optional[int]
    relationship_status: RelationshipStatus
    relationship_depth: float
    trust_level: float
    conflict_level: float
    story_beats: list[dict]  # 重要な転換点
    shared_memories: list[dict]  # 共有された記憶
    pending_plot_threads: list[str]  # 未解決のプロット
    active_quest_ids: list[str]
    completed_quest_ids: list[str]
    world_impact: dict[str, Any]
    character_growth: dict[str, Any]
```

#### EncounterChoice
```python
class EncounterChoice:
    id: str
    story_id: str
    session_id: str
    situation_context: str
    available_choices: list[dict]
    player_choice: str
    choice_reasoning: str
    immediate_consequence: str
    long_term_impact: dict[str, Any]
    relationship_change: dict[str, float]
```

#### SharedQuest
```python
class SharedQuest:
    id: str
    quest_id: str
    story_id: str
    participants: list[dict]
    leader_id: str
    cooperation_level: float
    sync_level: float
    contribution_balance: dict[str, float]
    shared_objectives: list[str]
```

## 処理フロー

### 初回遭遇時
1. EncounterManagerが遭遇を検知
2. GM AIがストーリーアークを決定
3. 初回イベントの生成と選択肢の提示
4. EncounterStoryレコードの作成
5. 必要に応じてクエストの生成

### 継続的な遭遇時
1. 既存のストーリーを検索
2. 関係性の進展度を計算
3. 次のストーリービートを生成
4. プレイヤーの選択を処理
5. 関係性パラメータの更新
6. 共同クエストの提案（条件を満たす場合）

### 自動進行
1. StoryProgressionManagerが定期的にチェック
2. 時間経過に基づく進行判定
3. 緊急度の計算とソート
4. 物語の自動進行
5. 世界への影響の適用

## AI統合

### GM AIサービスとの連携
- **dramatist**: ストーリー展開、選択結果の生成
- **state_manager**: クエスト生成、共同クエスト提案
- **the_world**: 世界への影響適用

### プロンプト設計
各AIエージェントに対して、ストーリーの文脈、関係性の状態、過去の選択などを含む詳細なコンテキストを提供し、一貫性のある物語生成を実現。

## 世界への影響

ストーリーの展開は以下の世界パラメータに影響を与えます：
- 平和度
- 汚染度
- 資源の豊富さ
- 魔法活動度
- 勢力間の緊張度

## パフォーマンス最適化

1. **バッチ処理**: 複数のストーリー進行を一度に処理
2. **キャッシング**: アクティブなストーリーをRedisにキャッシュ
3. **非同期処理**: Celeryタスクで時間のかかる処理を非同期化
4. **インデックス最適化**: 頻繁にアクセスされるデータへの効率的なアクセス

## 今後の拡張計画

1. **ストーリー間の相互作用**: 複数のストーリーが影響し合うシステム
2. **コミュニティイベント**: 複数プレイヤーが関わる大規模ストーリー
3. **ビジュアル化**: 関係性マップやストーリー進行のタイムライン表示
4. **専用APIエンドポイント**: フロントエンドから直接アクセス可能なAPI

## 関連ドキュメント

- [記憶継承システム仕様](../../03_worldbuilding/game_mechanics/memoryInheritance.md)
- [遭遇ストーリーシステム実装ガイド](../../05_implementation/backend/encounterStorySystem.md)
- [ログ遭遇システム仕様](log_encounter_spec.md)