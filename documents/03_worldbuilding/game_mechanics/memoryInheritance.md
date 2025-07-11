# 記憶継承システム仕様

最終更新: 2025-07-05

## 概要

記憶継承システムは、[記憶フラグメント獲得システム](memoryFragmentAcquisition.md)で獲得したフラグメントを活用して、新たな価値を創造するシステムです。フラグメントは永続的に保持され、様々な組み合わせで活用できます。

## 1. 基本メカニクス
- **永続性**: フラグメントは使用しても消費されない
- **組み合わせ**: 複数のフラグメントを組み合わせて新たな価値を創造
- **SP消費**: 組み合わせ実行にはSPが必要

## 2. 継承パターン

#### A. スキル継承
- 特定のフラグメント組み合わせで新スキル獲得
- 例: [剣術の極意] + [守護の誓い] → スキル「聖剣術」
- **SP消費**: 20-50 SP

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

## 3. コンボシステム

記憶フラグメントの組み合わせ効果については、[高度な編纂メカニクス仕様](advancedCompilation.md)を参照してください。基本的には：
- 2-5個の組み合わせで様々な効果
- セットボーナスによる追加効果
- 特殊称号の獲得可能性

## 4. 記憶継承における汚染と浄化

記憶継承システムにおける汚染と浄化の詳細は、[汚染浄化システム仕様](purificationSystem.md)を参照してください。記憶継承特有の要素：
- ポジティブな記憶フラグメントの組み合わせによる自然浄化
- 光属性の記憶による強力な浄化効果  
- アーキテクト記憶による完全浄化の可能性

## 5. UI/UX設計

### 5.1. コレクション画面
- **記憶の書庫**: 獲得したフラグメントを美しく展示
- **ストーリー再生**: 各フラグメントの獲得時の物語を再読
- **組み合わせシミュレーター**: 効果をプレビュー
- **達成率表示**: 全体の収集進捗

### 5.2. 継承工房
- **組み合わせ選択**: ドラッグ&ドロップで直感的に
- **効果プレビュー**: SP消費と獲得効果の確認
- **履歴記録**: 過去の継承結果を参照

## 6. ゲームバランス

### 6.1. 希少性の確保
- **達成難易度による希少性**: 困難なクエストほど高レアリティ
- **物語の独自性**: ユニークな解決方法や選択をした場合にレアリティ上昇
- **複合的な達成**: 複数の条件を同時に満たすことで特別な記憶を獲得
- **深い探索**: 隠された要素や秘密を発見することで希少な記憶を入手

### 6.2. SP経済

#### 基本的な継承コスト
- 基本的な継承: 20-50 SP
- 高度な継承: 100-300 SP
- 特殊な継承: 500+ SP

ログ編纂時のSP消費の詳細については、[高度な編纂メカニクス仕様](advancedCompilation.md)を参照してください。記憶継承特有の追加コスト：
- アーキテクト記憶使用時: +200 SP

### 6.3. 進行への影響
- 必須ではないが、あると有利
- 戦略的な選択が重要
- コレクター要素と実用性のバランス

## 7. 具体的なプレイ体験例

### 7.1. ある冒険者の物語
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

### 7.2. 記憶の活用
1. **スキル生成**（30 SP消費）
   - [古の叡智] + [商人の知恵] = スキル「古代言語解読」

2. **ログ強化**（通常の派遣費用+20 SP）
   - [古の叡智]を持つログは古代遺跡で特別なイベントを発生させる

3. **称号獲得**（50 SP消費）
   - [古の叡智] + [平和の使者] + [探求心] = 称号「賢者」

### 7.3. アーキテクト記憶の発見例
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

### 7.4. アーキテクト記憶の特別な効果
- **世界の真実の開示**: フラグメントを通じて、通常は隠されている世界設定の一部を確認可能
- **深層スクリプトの理解**: より強力なスキル生成の可能性
- **設計者の遺産へのアクセス**: 特殊な遺物との共鳴
- **他のアーキテクト記憶との強力なシナジー**: 複数組み合わせることで世界の全貌に迫る

## 8. 遭遇ストーリーシステム（2025-07-04実装）

### 8.1. 概要
ログとの遭遇が一時的なイベントではなく、継続的で意味のある物語として発展するシステムを実装しました。

### 8.2. ストーリーアークタイプ
- **QUEST_CHAIN**: 連続クエスト - NPCから与えられる一連のタスク
- **RIVALRY**: ライバル関係 - 競争や対立から生まれる緊張関係
- **ALLIANCE**: 同盟関係 - 共通の目的に向かう協力関係
- **MENTORSHIP**: 師弟関係 - 知識や技術の伝承
- **ROMANCE**: ロマンス - 感情的な繋がりの発展
- **MYSTERY**: 謎解き - 謎めいた存在との知的な交流
- **CONFLICT**: 対立 - 価値観の衝突から生まれるドラマ
- **COLLABORATION**: 協力関係 - 実利的な協力関係

### 8.3. 関係性システム
- **relationship_depth**: 0.0-1.0の範囲で関係の深さを表現
- **trust_level**: 信頼度（裏切りや協力で変動）
- **conflict_level**: 対立度（敵対的な行動で上昇）

### 8.4. ストーリー進行メカニクス
- **自動進行**: 時間経過により物語が自然に進行
- **プレイヤー選択**: 重要な場面での選択が関係性と物語の方向を決定
- **世界への影響**: 重要なストーリーの展開が世界の状態に影響

### 8.5. 共同クエスト
関係性が深まったNPCと共に挑戦する特別なクエスト：
- 参加者の貢献度バランスを追跡
- 協力度によって報酬が変化
- 成功/失敗が関係性に大きく影響

## 9. 実装状況

### 9.1. 完了済み（2025-07-04）
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

### 9.2. 実装予定
- **Phase 3**: 高度な機能
  - ストーリー間の相互作用
  - 複数キャラクター間の三角関係
  - コミュニティイベントへの発展

- **Phase 4**: UI/UX
  - 記憶の書庫（コレクション画面）
  - 継承工房インターフェース
  - ストーリー進行の可視化
  - 関係性マップの表示

## 10. 技術仕様

### 10.1. APIエンドポイント（実装済み）
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

### 10.2. データベース構造
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
- [高度な編纂メカニクス](advancedCompilation.md) - コンボボーナス、SP消費の詳細
- [汚染浄化システム](purificationSystem.md) - 汚染と浄化の詳細仕様
- [特殊称号システム](titleSystem.md) - 称号の詳細仕様
- [動的クエストシステム実装ガイド](../../05_implementation/backend/questSystem.md) - 技術的な実装詳細
- [memory_fragment_redesign.md](memory_fragment_redesign.md) - 初期設計仕様（本ドキュメントに統合済み）