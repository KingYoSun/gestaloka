# 記憶継承システム仕様

最終更新: 2025-07-04

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
  - フェイディング（世界の消滅）の真相
  - アストラルネットやスクリプトの本質的理解
  - 来訪者の真の意味と役割の発見

## 5. 記憶継承システム

### 5.1. 基本メカニクス
- **永続性**: フラグメントは使用しても消費されない
- **組み合わせ**: 複数のフラグメントを組み合わせて新たな価値を創造
- **SP消費**: 組み合わせ実行にはSPが必要

### 5.2. 継承パターン

#### A. スキル継承
- 特定のフラグメント組み合わせで新スキル獲得
- 例: [剣術の極意] + [守護の誓い] → スキル「聖剣術」
- **SP消費**: 20-50 SP（レアリティによる）

#### B. 称号獲得
- 物語的な組み合わせで称号を獲得
- 例: [勇敢な討伐] + [自己犠牲] + [仲間との絆] → 称号「真の英雄」
- **SP消費**: 30-100 SP

#### C. アイテム生成
- フラグメントの記憶から特別なアイテムを創造
- 例: [古代の知識] + [錬金術の秘伝] → アイテム「賢者の石」
- **SP消費**: 50-200 SP

#### D. ログ強化
- ログ編纂時に追加効果を付与
- 例: [英雄の記憶]を持つログは初期好感度+50%
- **SP消費**: ログ派遣費用に追加

### 5.3. コンボシステム
- **2つ組み合わせ**: 基本効果
- **3つ組み合わせ**: 強化効果 + ボーナス
- **5つ組み合わせ**: レア効果 + 特殊称号
- **セットボーナス**: 関連するフラグメントの組み合わせで追加効果

## 6. UI/UX設計

### 6.1. コレクション画面
- **記憶の書庫**: 獲得したフラグメントを美しく展示
- **ストーリー再生**: 各フラグメントの獲得時の物語を再読
- **組み合わせシミュレーター**: 効果をプレビュー
- **達成率表示**: 全体の収集進捗

### 6.2. 継承工房
- **組み合わせ選択**: ドラッグ&ドロップで直感的に
- **効果プレビュー**: SP消費と獲得効果の確認
- **履歴記録**: 過去の継承結果を参照

## 7. ゲームバランス

### 7.1. 希少性の確保
- **達成難易度による希少性**: 困難なクエストほど高レアリティ
- **物語の独自性**: ユニークな解決方法や選択をした場合にレアリティ上昇
- **複合的な達成**: 複数の条件を同時に満たすことで特別な記憶を獲得
- **深い探索**: 隠された要素や秘密を発見することで希少な記憶を入手

### 7.2. SP経済
- 基本的な継承: 20-50 SP
- 高度な継承: 100-300 SP
- 特殊な継承: 500+ SP

### 7.3. 進行への影響
- 必須ではないが、あると有利
- 戦略的な選択が重要
- コレクター要素と実用性のバランス

## 8. 具体的なプレイ体験例

### 8.1. ある冒険者の物語
1. **探索の始まり**
   - プレイヤーが古代遺跡について話すNPCと出会う
   - 会話の中で「遺跡の謎を解き明かしたい」という意図を示す
   - GM AIが「古代遺跡の探索」というクエストを提案

2. **クエストの進行**
   - 遺跡への道中で山賊に襲われるが、説得で回避
   - 遺跡で古代の仕掛けを解く
   - 最深部で古代文明の真実を発見
   - 守護者との対話で平和的解決

3. **記憶の結晶化**
   - GM AIがクエスト完了を判定
   - 物語をサマライズ：「知恵と対話による古代の謎の解明」
   - 記憶フラグメント[古の叡智]を獲得（レア）
   - バックストーリー：「暴力ではなく知恵と対話によって古代の秘密を解き明かした記憶」

### 8.2. 記憶の活用
1. **スキル生成**（30 SP消費）
   - [古の叡智] + [商人の知恵] = スキル「古代言語解読」

2. **ログ強化**（通常の派遣費用+20 SP）
   - [古の叡智]を持つログは古代遺跡で特別なイベントを発生させる

3. **称号獲得**（50 SP消費）
   - [古の叡智] + [平和の使者] + [探求心] = 称号「賢者」

### 8.3. アーキテクト記憶の発見例
1. **アストラルネットへの深層アクセス**
   - 遺物を解析中、偶然システムの深層にアクセス
   - スキルの本質が「スクリプト実行」であることを理解
   - 記憶フラグメント[世界のコード]を獲得（アーキテクト）
   - バックストーリー：「魔法と呼ばれるものが、実は世界のシステムへの干渉であることを理解した瞬間の記憶」

2. **忘却領域での真実の遭遇**
   - 忘却領域で設計者の残したメッセージを発見
   - 世界が巨大な情報記録庫であることを知る
   - 記憶フラグメント[設計者の遺言]を獲得（アーキテクト）
   - バックストーリー：「滅びゆく世界の創造主が残した、最後のメッセージとの邂逅」

### 8.4. アーキテクト記憶の特別な効果
- **世界の真実の開示**: フラグメントを通じて、通常は隠されている世界設定の一部を確認可能
- **深層スクリプトの理解**: より強力なスキル生成の可能性
- **設計者の遺産へのアクセス**: 特殊な遺物との共鳴
- **他のアーキテクト記憶との強力なシナジー**: 複数組み合わせることで世界の全貌に迫る

## 9. 遭遇ストーリーシステム（2025-07-04実装）

### 9.1. 概要
ログとの遭遇が一時的なイベントではなく、継続的で意味のある物語として発展するシステムを実装しました。

### 9.2. ストーリーアークタイプ
- **QUEST_CHAIN**: 連続クエスト - NPCから与えられる一連のタスク
- **RIVALRY**: ライバル関係 - 競争や対立から生まれる緊張関係
- **ALLIANCE**: 同盟関係 - 共通の目的に向かう協力関係
- **MENTORSHIP**: 師弟関係 - 知識や技術の伝承
- **ROMANCE**: ロマンス - 感情的な繋がりの発展
- **MYSTERY**: 謎解き - 謎めいた存在との知的な交流
- **CONFLICT**: 対立 - 価値観の衝突から生まれるドラマ
- **COLLABORATION**: 協力関係 - 実利的な協力関係

### 9.3. 関係性システム
- **relationship_depth**: 0.0-1.0の範囲で関係の深さを表現
- **trust_level**: 信頼度（裏切りや協力で変動）
- **conflict_level**: 対立度（敵対的な行動で上昇）

### 9.4. ストーリー進行メカニクス
- **自動進行**: 時間経過により物語が自然に進行
- **プレイヤー選択**: 重要な場面での選択が関係性と物語の方向を決定
- **世界への影響**: 重要なストーリーの展開が世界の状態に影響

### 9.5. 共同クエスト
関係性が深まったNPCと共に挑戦する特別なクエスト：
- 参加者の貢献度バランスを追跡
- 協力度によって報酬が変化
- 成功/失敗が関係性に大きく影響

## 10. 実装状況

### 10.1. 完了済み（2025-07-04）
- **Phase 1**: 基本システム
  - ✅ 動的クエストシステムの実装
  - ✅ クエスト完了判定ロジック
  - ✅ 基本的な記憶フラグメント生成
  - ✅ AI駆動のクエスト提案機能
  - ✅ 行動パターンからの暗黙的クエスト推測
  - ✅ クエスト進捗のAI評価システム
  - ✅ 記憶継承メカニクスの実装（スキル/称号/アイテム/ログ強化）

- **Phase 2**: 遭遇ストーリーシステム
  - ✅ EncounterStory、EncounterChoice、SharedQuestモデル
  - ✅ EncounterManagerの実装
  - ✅ StoryProgressionManagerの実装
  - ✅ NPC管理AI、世界の意識AIとの統合
  - ✅ 関係性の永続化と発展システム

### 10.2. 実装予定
- **Phase 3**: 高度な機能
  - ストーリー間の相互作用
  - 複数キャラクター間の三角関係
  - コミュニティイベントへの発展

- **Phase 4**: UI/UX
  - 記憶の書庫（コレクション画面）
  - 継承工房インターフェース
  - ストーリー進行の可視化
  - 関係性マップの表示

## 11. 技術仕様

### 11.1. APIエンドポイント（実装済み）
- GET `/quests/{character_id}/quests` - クエスト一覧取得
- GET `/quests/{character_id}/proposals` - AI駆動のクエスト提案
- POST `/quests/{character_id}/create` - 新規クエスト作成
- POST `/quests/{character_id}/quests/infer` - 行動パターンから暗黙的クエスト推測
- POST `/quests/{character_id}/quests/{quest_id}/accept` - クエスト受諾
- POST `/quests/{character_id}/quests/{quest_id}/update` - クエスト進捗更新
- GET `/log-fragments/{character_id}/fragments` - 記憶フラグメント一覧
- GET `/log-fragments/{character_id}/fragments/{fragment_id}` - 記憶フラグメント詳細
- GET `/memory-inheritance/{character_id}/preview` - 継承プレビュー
- POST `/memory-inheritance/{character_id}/inherit` - 記憶継承実行
- GET `/memory-inheritance/{character_id}/history` - 継承履歴取得

### 11.2. データベース構造
```sql
-- questsテーブル（実装済み）
CREATE TABLE quests (
    id VARCHAR PRIMARY KEY,
    character_id VARCHAR NOT NULL,
    session_id VARCHAR,
    status VARCHAR NOT NULL,
    origin VARCHAR NOT NULL,
    title VARCHAR NOT NULL,
    description TEXT NOT NULL,
    objectives JSON,
    progress_percentage FLOAT DEFAULT 0.0,
    narrative_completeness FLOAT DEFAULT 0.0,
    emotional_satisfaction FLOAT DEFAULT 0.0,
    key_events JSON,
    involved_entities JSON,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    completed_at TIMESTAMP
);

-- log_fragmentsテーブル（拡張済み）
ALTER TABLE log_fragments ADD COLUMN memory_type VARCHAR(50);
ALTER TABLE log_fragments ADD COLUMN combination_tags TEXT[];
ALTER TABLE log_fragments ADD COLUMN world_truth TEXT;
ALTER TABLE log_fragments ADD COLUMN is_consumed BOOLEAN DEFAULT FALSE;

-- encounter_storiesテーブル（2025-07-04追加）
CREATE TABLE encounter_stories (
    id VARCHAR PRIMARY KEY,
    character_id VARCHAR NOT NULL REFERENCES characters(id),
    encounter_entity_id VARCHAR NOT NULL,
    encounter_type VARCHAR NOT NULL,
    story_arc_type VARCHAR NOT NULL,
    title VARCHAR NOT NULL,
    current_chapter INTEGER DEFAULT 1,
    total_chapters INTEGER,
    relationship_status VARCHAR NOT NULL,
    relationship_depth FLOAT DEFAULT 0.0,
    trust_level FLOAT DEFAULT 0.5,
    conflict_level FLOAT DEFAULT 0.0,
    story_beats JSON,
    shared_memories JSON,
    pending_plot_threads JSON,
    active_quest_ids JSON,
    completed_quest_ids JSON,
    world_impact JSON,
    character_growth JSON,
    narrative_tension FLOAT DEFAULT 0.5,
    emotional_resonance FLOAT DEFAULT 0.5,
    story_momentum FLOAT DEFAULT 0.5,
    created_at TIMESTAMP,
    last_interaction_at TIMESTAMP,
    next_expected_beat TIMESTAMP
);

-- encounter_choicesテーブル（2025-07-04追加）
CREATE TABLE encounter_choices (
    id VARCHAR PRIMARY KEY,
    story_id VARCHAR NOT NULL REFERENCES encounter_stories(id),
    session_id VARCHAR NOT NULL REFERENCES game_sessions(id),
    situation_context TEXT,
    available_choices JSON,
    player_choice VARCHAR,
    choice_reasoning TEXT,
    immediate_consequence TEXT,
    long_term_impact JSON,
    relationship_change JSON,
    presented_at TIMESTAMP,
    decided_at TIMESTAMP
);

-- shared_questsテーブル（2025-07-04追加）
CREATE TABLE shared_quests (
    id VARCHAR PRIMARY KEY,
    quest_id VARCHAR NOT NULL REFERENCES quests(id),
    story_id VARCHAR NOT NULL REFERENCES encounter_stories(id),
    participants JSON,
    leader_id VARCHAR,
    cooperation_level FLOAT DEFAULT 0.5,
    sync_level FLOAT DEFAULT 0.5,
    contribution_balance JSON,
    shared_objectives JSON,
    synchronized_actions JSON,
    conflict_points JSON,
    reward_distribution JSON,
    created_at TIMESTAMP,
    last_sync_at TIMESTAMP,
    completed_at TIMESTAMP
);
```

## 関連ドキュメント
- [ログシステム](log.md) - 基本的なログ記録機能
- [ログ派遣システム](logDispatchSystem.md) - NPCとしてのログ活用
- [動的クエストシステム実装ガイド](../../05_implementation/backend/questSystem.md) - 技術的な実装詳細
- [memory_fragment_redesign.md](memory_fragment_redesign.md) - 初期設計仕様（本ドキュメントに統合済み）