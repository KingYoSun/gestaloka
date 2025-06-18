# NPC管理AI (NPC Manager) 仕様書

## 概要

NPC管理AI（NPC Manager）は、ゲスタロカ世界に存在する非プレイヤーキャラクター（NPC）の生成・管理・制御を担当するGM AI評議会のメンバーです。永続的NPCの創造から、ログNPCの生成、一時的NPCの管理まで、世界に必要なすべての登場人物を統括します。

## 基本設計

### 役割と責任

1. **NPC生成**
   - 永続的NPC（店主、重要人物等）の創造
   - ログNPCの生成（他プレイヤーのログから）
   - 一時的NPC（通行人等）の作成
   - クエスト付与NPCの配置
   - 商人NPCの管理
   - 守護者NPCの設置

2. **NPC管理**
   - NPCキャラクターシートの維持
   - 関係性の追跡と更新
   - NPCの永続性レベル管理
   - 一時的NPCの自動削除

3. **AIエージェント協調**
   - 脚本家AI（Dramatist）からの生成要求への対応
   - 歴史家AI（Historian）とのログNPC生成連携
   - 状態管理AI（State Manager）へのNPCデータ提供

## 実装詳細

### NPCタイプ定義

```python
class NPCType(Enum):
    PERSISTENT = "persistent"      # 永続的NPC（店主、重要人物等）
    LOG_NPC = "log_npc"           # ログから生成されたNPC
    TEMPORARY = "temporary"        # 一時的NPC（通行人等）
    QUEST_GIVER = "quest_giver"   # クエスト付与NPC
    MERCHANT = "merchant"         # 商人NPC
    GUARDIAN = "guardian"         # 守護者NPC
```

### NPCキャラクターシート構造

```python
class NPCCharacterSheet:
    id: str                           # 一意のID
    name: str                         # NPC名
    title: Optional[str]              # 称号・肩書き
    npc_type: NPCType                 # NPCタイプ
    appearance: str                   # 外見の説明
    personality: NPCPersonality       # 性格設定
    background: str                   # 背景・経歴
    occupation: str                   # 職業・役割
    location: str                     # 通常いる場所
    stats: dict[str, int]            # ステータス
    skills: list[str]                # スキルリスト
    inventory: list[str]             # 所持品
    relationships: list[NPCRelationship]  # 関係性リスト
    dialogue_topics: list[str]       # 会話可能なトピック
    quest_potential: bool            # クエスト付与可能か
    created_at: datetime             # 作成日時
    created_by: str                  # 生成者（AI名）
    persistence_level: int           # 永続性レベル（1-10）
```

### NPCパーソナリティ構造

```python
class NPCPersonality:
    traits: list[str]         # 性格特性リスト
    motivations: list[str]    # 動機・目的リスト
    fears: list[str]          # 恐れ・弱点リスト
    speech_pattern: str       # 話し方の特徴
    alignment: str           # 性格傾向（善/中立/悪）
```

### NPC生成テンプレート

各NPCタイプに対して以下のテンプレートが定義されています：

```python
{
    "persistent": {
        "min_stats": {"hp": 100, "mp": 50, "level": 5},
        "required_fields": ["occupation", "location", "dialogue_topics"],
        "persistence_level_range": (7, 10),
    },
    "log_npc": {
        "min_stats": {"hp": 80, "mp": 40, "level": 1},
        "required_fields": ["original_player", "log_source"],
        "persistence_level_range": (3, 7),
    },
    "merchant": {
        "min_stats": {"hp": 120, "mp": 30, "level": 8},
        "required_fields": ["inventory", "trade_goods", "price_modifier"],
        "persistence_level_range": (8, 10),
    },
    "quest_giver": {
        "min_stats": {"hp": 150, "mp": 80, "level": 10},
        "required_fields": ["quest_chain", "reward_pool"],
        "persistence_level_range": (8, 10),
    },
}
```

## NPC生成プロセス

### 1. 生成要求の処理

```python
NPCGenerationRequest:
    requesting_agent: str    # リクエスト元のAI
    purpose: str            # 生成目的
    npc_type: NPCType       # 必要なNPCタイプ
    context: dict          # 文脈情報
    requirements: dict     # 特定要件
```

### 2. 生成必要性の判断

- 既存NPCの確認
- 場所ごとのNPC密度
- NPCタイプ別の配置ルール
- 物語進行上の必要性

### 3. NPC生成

1. コンテキスト拡張
   - 場所の雰囲気
   - 既存NPCとの関係
   - 世界の状況

2. AI生成（Gemini API使用）
   - 創造的な生成（temperature: 0.8）
   - 1500トークンまでの詳細な記述

3. レスポンス解析
   - JSON形式優先
   - テキストフォールバック

4. キャラクターシート構築
   - デフォルト値の適用
   - ステータス計算
   - 永続性レベル設定

## AIレスポンス形式

### 成功時のレスポンス例

```json
{
    "name": "鍛冶屋ハロルド",
    "title": "伝説の鍛冶師",
    "occupation": "鍛冶屋",
    "appearance": "筋骨隆々とした中年男性。髭面で、常にハンマーを手にしている",
    "traits": ["頑固", "職人気質", "誠実"],
    "motivations": ["最高の武器を作る", "技術の継承"],
    "fears": ["技術の衰退", "後継者不足"],
    "speech_pattern": "職人らしい無骨な話し方",
    "background": "王都で修行を積んだ後、この街で工房を開いて20年",
    "skills": ["鍛冶", "鑑定", "武器知識"],
    "inventory": ["鍛冶ハンマー", "上質な鉱石", "修理道具"],
    "dialogue_topics": ["武器の修理", "鍛冶の技術", "素材の入手方法"],
    "level": 12
}
```

## 他のAIとの連携

### 脚本家AI（Dramatist）との連携

- 物語進行に必要なNPCの生成要求を受信
- 生成したNPCの登場演出用のnarrative提供

### 歴史家AI（Historian）との連携

- ログの欠片からのNPC生成要求処理
- ログNPCの背景情報の取得

### 状態管理AI（State Manager）との連携

- NPCのステータス管理
- 戦闘・イベント時の状態変更

## 特殊機能

### ログNPC生成

他プレイヤーの行動履歴から生成されるNPCの特別な処理：

1. 元プレイヤーの性格・行動パターンの保持
2. 現在の世界への適応
3. 「元の世界への郷愁」という特有の動機

### 一時的NPC管理

- 24時間後の自動削除
- 永続性レベル1-3のNPC
- メモリ効率のための定期クリーンアップ

### 関係性管理

```python
class NPCRelationship:
    target_id: str           # 関係対象のID
    relationship_type: str   # 関係タイプ
    intensity: float        # 関係の強度（-1.0〜1.0）
    history: list[str]      # 関係の履歴
```

## パフォーマンス考慮事項

1. **NPCレジストリ**
   - メモリ内キャッシュによる高速アクセス
   - 場所ベースのインデックス

2. **生成最適化**
   - 必要に応じた遅延生成
   - タイプ別の生成テンプレート

3. **メモリ管理**
   - 一時的NPCの定期削除
   - 永続性レベルに基づく保持戦略

## エラーハンドリング

1. **生成失敗時**
   - デフォルトNPCの生成
   - フォールバックテンプレートの使用

2. **レスポンス解析エラー**
   - テキストベースの情報抽出
   - 最小限の必須フィールドでの生成

3. **コンテキスト不足**
   - 推測に基づく生成要求の構築
   - 場所と行動からのNPCタイプ推定

## 将来の拡張性

1. **動的NPC行動**
   - 時間帯による行動パターン
   - イベントへの反応

2. **NPC間相互作用**
   - NPC同士の関係性
   - 集団行動の実装

3. **高度な対話システム**
   - 記憶に基づく会話
   - 感情状態の変化

## まとめ

NPC管理AIは、ゲスタロカ世界に生命を吹き込む重要な役割を担っています。永続的なNPCから一時的な通行人まで、すべてのNPCを統括的に管理し、プレイヤーに豊かな世界体験を提供します。他のGM AI評議会メンバーとの密接な連携により、動的で生きた世界の創造に貢献しています。