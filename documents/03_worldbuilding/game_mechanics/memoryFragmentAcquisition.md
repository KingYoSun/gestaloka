# 記憶フラグメント獲得システム

最終更新: 2025-07-05

## 1. 新しい位置づけ：「ゲーム体験の記念碑」

記憶フラグメントは、プレイヤーの重要な達成や物語の節目を記念する**永続的なコレクションアイテム**として再定義されます。

### 1.1. 基本理念
- **希少性**: 簡単には入手できない、特別な瞬間の証
- **永続性**: 一度獲得したら永久に保持（使用しても消えない）
- **物語性**: 各フラグメントが独自のバックストーリーを持つ
- **実用性**: 組み合わせることで新たな価値を創造

## 2. 動的クエストシステムと記憶フラグメント

### 2.1. クエストの概念
- **動的生成**: GM AIが物語の流れから「これまでの物語から予想される目標」を提案
- **プレイヤー主導**: プレイヤーの自由記述や行動によってクエストが生成・変化
- **同時並行**: 複数のクエストが同時に進行可能
- **有機的な完了**: 明確な完了フラグではなく、GM AIが文脈から達成を判断

### 2.2. クエスト完了時の記憶生成
1. **物語のサマライズ**: GM AIがクエストに関連する一連の出来事を要約
2. **テーマ抽出**: サマライズから中心的なテーマや感情を特定
3. **記憶の結晶化**: 抽出されたテーマを基に記憶フラグメントを生成
4. **コンテキスト保存**: 生成時の詳細な状況を永続的に記録

### 2.3. 記憶フラグメント獲得の例
- **例1：商人との長い交流**
  - クエスト：「行商人の失われた荷物を探す」（プレイヤーの会話から自然発生）
  - 完了時：[信頼の絆]というフラグメントを獲得
  - バックストーリー：行商人との出会いから荷物発見までの物語
  
- **例2：未知の遺跡探索**
  - クエスト：「古代遺跡の謎を解明する」（探索行動から生成）
  - 完了時：[古の知識]というフラグメントを獲得
  - バックストーリー：遺跡での発見と謎解きの過程

### 2.4. アチーブメント型の獲得
- **探索の記念碑**: 特定の場所への初到達
- **技能の証**: スキルの習熟度が一定レベルに到達
- **関係性の深化**: NPCとの関係値が特別な段階に到達
- **累積的な達成**: 特定の行動の積み重ね（100回の戦闘勝利など）

### 2.5. 特別な記憶
- **偶発的な瞬間**: 予期せぬ出来事から生まれる特別な記憶
- **プレイヤー間の交流**: 他プレイヤーのログとの深い関わりから生成
- **世界イベント**: GM AI評議会が生成する大規模イベントへの参加

## 3. 動的クエストの詳細メカニクス（2025-07-03実装済み）

### 3.1. クエストの生成
- **文脈分析**: GM AIが直近の10-20ターンの行動を分析
- **目標提案**: 物語の流れから自然な目標を1-3個提案
- **プレイヤー選択**: 提案を受け入れる、修正する、独自に設定する
- **暗黙的クエスト**: プレイヤーが明示的に宣言しなくても、行動パターンから推測

### 3.2. クエスト進行の追跡
```python
# 実装済みのQuestモデル
class Quest(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    status: QuestStatus  # PROPOSED, ACTIVE, PROGRESSING, NEAR_COMPLETION, COMPLETED, ABANDONED, FAILED
    origin: QuestOrigin  # GM_PROPOSED, PLAYER_DECLARED, BEHAVIOR_INFERRED, NPC_GIVEN, WORLD_EVENT
    description: str
    objectives: list[str]
    progress_percentage: float
    narrative_completeness: float  # 物語的完結度
    emotional_satisfaction: float  # 感情的満足度
    key_events: dict[str, Any]
    involved_entities: dict[str, Any]
```

### 3.3. 完了判定のロジック
1. **目標達成度**: 当初の目標がどの程度達成されたか（0-100%）
2. **物語的完結**: 起承転結が成立しているか
3. **感情的満足度**: プレイヤーの行動が示す満足感
4. **時間的区切り**: 一定期間の経過や場面転換

### 3.4. サマライズと記憶生成プロセス
1. **イベント抽出**: クエスト関連の全イベントを時系列で整理
2. **重要度評価**: 各イベントの物語的重要度を評価
3. **テーマ分析**: 
   - 主要テーマ（勇気、友情、裏切り、発見など）
   - サブテーマ（成長、犠牲、希望など）
4. **感情曲線**: 物語全体の感情的な起伏を分析
5. **記憶の具現化**:
   - キーワード選定（テーマから最も象徴的なもの）
   - レアリティ判定（達成の困難さ、物語の独自性）
   - バックストーリー生成（200-500文字のサマリー）

## 4. フラグメントの新仕様（2025-07-03実装済み）

### 4.1. 属性
```python
# 実装済みのLogFragmentモデル拡張
class LogFragment(SQLModel, table=True):
    # 既存フィールド
    id: str
    character_id: str
    content: str
    keywords: list[str]
    emotional_tags: list[str]
    significance_score: float
    rarity: LogFragmentRarity  # COMMON ~ ARCHITECT
    
    # 記憶継承用の新フィールド
    memory_type: Optional[str]  # 勇気/友情/知恵/犠牲/勝利/真実など
    combination_tags: list[str]  # 組み合わせ用のタグ
    world_truth: Optional[str]  # 世界の真実（ARCHITECTレアリティ限定）
    is_consumed: bool = False  # 常にFalse（永続性保証）
```

### 4.2. レアリティと決定基準
- **コモン**: 
  - 通常のクエスト完了
  - 基本的なアチーブメント達成
  - 単純な目標の達成
  
- **アンコモン**: 
  - 創意工夫による問題解決
  - 予想外の方法でのクエスト完了
  - 複数の小目標を含むクエストの達成
  
- **レア**: 
  - 困難な状況での勝利
  - 平和的解決など特殊な選択
  - 隠された真実の発見
  - 複雑な人間関係の構築
  
- **エピック**: 
  - 大規模な物語の完結
  - 複数のクエストが絡み合った結果
  - 世界に影響を与える選択
  - 極めて困難な挑戦の克服
  
- **レジェンダリー**: 
  - 前例のない独創的な解決
  - 複数のプレイヤーが関わる偉業
  - GM AI評議会が認定する特別な功績
  - 世界の歴史に刻まれる出来事
  
- **ユニーク**: 
  - 個人的に意味深い物語の完結
  - そのプレイヤーにしか達成できない条件
  - キャラクター固有の背景に関連する達成

- **アーキテクト**: 
  - 世界の根源的な真実の発見
  - ゲスタロカの本質（階層情報圏）の理解
  - 設計者（アーキテクト）に関する重要な手がかり
  - 世界の劣化と汚染の真相
  - アストラルネットやスクリプトの本質的理解
  - 来訪者の真の意味と役割の発見

## 関連ドキュメント
- [記憶継承システム仕様](memoryInheritance.md) - フラグメントの活用方法
- [ログシステム仕様](log.md) - ログフラグメントの基本概念