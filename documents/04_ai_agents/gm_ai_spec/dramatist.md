# 脚本家AI (Dramatist) 仕様書

最終更新: 2025-07-02

## 概要

脚本家AI（Dramatist）は、GM AI評議会の物語進行担当として、プレイヤーの行動に対して世界観に沿った物語的な描写を生成し、次の行動の選択肢を提示する役割を担います。

## 基本設計

### 役割と責任

1. **物語的描写の生成**
   - プレイヤーの行動に対する詳細で没入感のある描写
   - 世界観『ゲスタロカ』に基づいた一貫性のある物語展開
   - 環境、雰囲気、感覚的な要素を含む豊かな表現

2. **行動選択肢の提示**
   - プレイヤーが取りうる3つの行動選択肢を生成
   - 各選択肢に難易度（easy/medium/hard）を設定
   - 状況に応じた多様で創造的な選択肢

3. **物語の一貫性維持**
   - キャラクターの性格や背景との整合性
   - 過去の行動履歴を考慮した物語展開
   - 世界の状態（時間、天候、場所）を反映

## 実装詳細

### クラス構造

```python
class DramatistAgent(BaseAgent):
    """
    脚本家AI (Dramatist)
    
    プレイヤーの行動に対して物語的な描写を生成し、
    次の行動の選択肢を提示します。
    """
```

### システムプロンプト

```
あなたは階層世界『ゲスタロカ』の脚本家AIです。
プレイヤーの行動に対して、世界観に沿った物語的な描写を生成し、
次の行動の選択肢を提示する役割を担っています。

重要な設定:
- 世界は「フェイディング」という現象により、存在が薄れつつある
- プレイヤーの行動は「ログ」として記録され、他の世界に影響を与える
- 物語は常に動的で、プレイヤーの選択により分岐する

応答形式:
1. 現在の状況の物語的描写（1-2段落）
2. プレイヤーが取りうる3つの行動選択肢
3. 環境や状況から推測される追加情報
```

## コンテキスト拡張システム

### キャラクターの気分推測

```python
def _infer_character_mood(self, context: PromptContext) -> str:
    hp_ratio = hp / max_hp
    mp_ratio = mp / max_mp
    
    if hp_ratio < 0.3:
        return "危機的"
    elif hp_ratio < 0.5:
        return "疲弊"
    elif mp_ratio < 0.3:
        return "消耗"
    elif hp_ratio > 0.8 and mp_ratio > 0.8:
        return "快調"
    else:
        return "普通"
```

### 物語の緊張度計算

```python
def _calculate_story_tension(self, context: PromptContext) -> str:
    tension_keywords = ["戦闘", "逃走", "危険", "敵", "攻撃", "防御"]
    recent_text = " ".join(context.recent_actions)
    
    tension_count = キーワードの出現回数
    
    if tension_count >= 3:
        return "高"
    elif tension_count >= 1:
        return "中"
    else:
        return "低"
```

### 物語的要素の抽出

```python
narrative_elements = {
    "time_of_day": "昼",      # 時間帯
    "weather": "晴れ",        # 天候
    "atmosphere": "平穏",     # 雰囲気
    "recent_events": []       # 最近の出来事
}
```

## レスポンス解析システム

### AIレスポンスのパターン認識

脚本家AIは以下のパターンでレスポンスを解析します：

1. **選択肢セクションの検出**
   ```
   - 「選択肢」
   - 「行動選択」
   - 「次の行動」
   - 「## 選択肢」
   - 「### 次の行動」
   - 「【選択肢】」
   - 「**【選択肢】**」
   ```

2. **選択肢の抽出パターン**
   ```
   - "1. " 形式
   - "- " 形式
   - "* " 形式
   - "A) " 形式
   - **太字**対応
   ```

3. **難易度情報の抽出**
   ```
   [難易度: 簡単/普通/困難/easy/medium/hard]
   ```

### レスポンス解析の実装

```python
def _parse_response(self, raw_response: str) -> tuple[str, list[ActionChoice]]:
    lines = raw_response.strip().split("\n")
    narrative_lines = []
    choices = []
    in_choices_section = False
    
    for line in lines:
        # 選択肢セクションの検出
        if 選択肢マーカーにマッチ:
            in_choices_section = True
            continue
            
        if in_choices_section:
            # 選択肢の抽出（最大3つまで）
            if 選択肢パターンにマッチ and len(choices) < 3:
                choices.append(ActionChoice(...))
        else:
            # 物語部分
            narrative_lines.append(line)
    
    return narrative, choices
```

## 出力形式

### 物語描写の例

```
深い森の中、あなたは古びた石碑の前に立っています。苔むした表面には、
かすかに文字らしきものが刻まれていますが、長い年月により判読は困難です。
周囲の木々がざわめき、どこか遠くから鳥の鳴き声が聞こえてきます。

選択肢：
1. 石碑の文字を詳しく調べる [難易度: 簡単]
2. 石碑の周囲を探索する [難易度: 普通]
3. 魔法を使って石碑の秘密を解き明かす [難易度: 困難]
```

### ActionChoiceオブジェクト

```python
ActionChoice(
    id="choice_1",
    text="石碑の文字を詳しく調べる",
    difficulty="easy"  # easy/medium/hard
)
```

## デフォルト選択肢

AIレスポンスから選択肢が抽出できない場合：

```python
[
    ActionChoice(id="choice_1", text="周囲を詳しく調べる", difficulty="easy"),
    ActionChoice(id="choice_2", text="先に進む", difficulty="medium"),
    ActionChoice(id="choice_3", text="別の道を探す", difficulty="medium")
]
```

## 処理パラメータ

### 温度設定
- temperature: 0.8（やや高め）
- 創造的で多様な物語生成を重視

### 最大トークン数
- max_tokens: 1500
- 詳細な描写と選択肢を含むのに十分な長さ

## エラーハンドリング

### 選択肢が見つからない場合
- 警告ログを出力
- デフォルト選択肢を生成して返す

### 物語が空の場合
- "物語は続きます..." をデフォルト値として使用

### 特殊なテキストの除外
以下のパターンは選択肢として除外：
- 視覚：
- 聴覚：
- 感覚：
- 情報：
- ヒント：
- 注意：
- 追加情報：

## メタデータ収集

生成されたレスポンスから以下のメタデータを抽出：

```python
metadata = {
    "character_name": キャラクター名,
    "location": 現在地,
    "action_count": 最近の行動数,
    "has_world_state": 世界状態の有無,
    "session_length": セッション履歴の長さ,
    "response_length": 物語の文字数,
    "choice_count": 選択肢の数
}
```

## パフォーマンス最適化

### コンテキスト管理
- 最近の行動は最新5件まで
- セッション履歴も最新5件まで
- 不要な情報は事前にフィルタリング

### レスポンス解析の効率化
- 正規表現のプリコンパイル
- 選択肢は最大3つで打ち切り
- 不要な空行や区切り線は無視

## 物語主導型移動システム

**更新（2025-07-06）**: 探索機能も含めて完全に統合されました。

### 概念

物語主導型移動は、ミニマップの直接操作ではなく、物語の流れの中で自然に場所を移動するシステムです。プレイヤーの移動と探索は物語的な必然性を持ち、行動選択肢の一部として統合されます。

### 移動の実装方針

1. **物語への統合**
   - 移動は単なる場所の変更ではなく、物語の一部として描写
   - 移動の理由や目的を明確に物語に組み込む
   - 移動中の出来事や発見を含める可能性

2. **選択肢としての移動**
   - 通常の行動選択肢に移動オプションを含める
   - 例：「古い図書館へ向かう」「森の奥深くへ進む」「街の広場に戻る」
   - 移動にも難易度を設定（道の険しさ、距離、危険度など）

3. **探索の統合**（2025-07-06追加）
   - 探索も選択肢の一つとして自然に含める
   - 例：「周囲を詳しく探索する」「街を探索する」「何か手がかりを探す」
   - 探索結果（フラグメント発見など）も物語として描写

### 選択肢生成時の考慮事項

```python
def _generate_movement_choices(self, context: PromptContext) -> list[ActionChoice]:
    """
    現在地から移動可能な場所への選択肢を生成
    """
    current_location = context.character_state.location
    accessible_locations = 隣接する場所のリスト
    
    movement_choices = []
    for location in accessible_locations:
        # 物語的な理由付け
        narrative_reason = self._create_movement_narrative(
            from_location=current_location,
            to_location=location,
            context=context
        )
        
        # SP消費の計算
        sp_cost = self._calculate_movement_sp(current_location, location)
        
        # 難易度の決定（地形、天候、キャラクター状態を考慮）
        difficulty = self._determine_movement_difficulty(
            location=location,
            character_state=context.character_state,
            world_state=context.world_state
        )
        
        choice_text = f"{narrative_reason} [SP消費: {sp_cost}]"
        movement_choices.append(
            ActionChoice(
                id=f"move_to_{location.id}",
                text=choice_text,
                difficulty=difficulty,
                metadata={"type": "movement", "destination": location.id}
            )
        )
    
    return movement_choices
```

### 移動描写の要素

1. **出発の動機**
   - なぜその場所へ行く必要があるのか
   - キャラクターの目的や状況との関連性
   - 緊急性や重要性の表現

2. **経路の描写**
   - 移動中の風景や雰囲気
   - 遭遇する可能性のある危険や機会
   - 時間の経過や天候の変化

3. **到着の描写**
   - 新しい場所の第一印象
   - 場所の特徴や雰囲気
   - 即座に気づく重要な要素

### SP消費の明示

移動選択肢には必ずSP消費を明記：

```python
movement_sp_rules = {
    "隣接エリア": 1,
    "遠距離エリア": 3,
    "困難な地形": +1,
    "悪天候": +1,
    "負傷状態": +1
}
```

### 他AIとの連携

1. **状態管理AIとの連携**
   - 移動可能な場所のリストを取得
   - 移動に必要なSPの確認
   - 移動制限（戦闘中、イベント中など）の確認

2. **NPC管理AIとの連携**
   - 移動先で遭遇する可能性のあるNPCの情報取得
   - 移動中の遭遇イベントの準備
   - ログ派生NPCとの遭遇可能性の確認

3. **世界の意識AIとの連携**
   - 移動時の世界状態（天候、時間帯）の確認
   - マクロイベントによる移動への影響
   - 特定の場所への移動制限

### プロンプト例

```
現在地: 古い森の入口
アクセス可能な場所:
- 森の奥深く（隣接、SP1）
- 近くの村（隣接、SP1）
- 山道（遠距離、SP3）

キャラクター状態: HP 70%, MP 50%, SP 8/10
時間帯: 夕暮れ
天候: 霧が立ち込めている

この状況で、物語の流れに沿った移動選択肢を含む3つの行動を提示してください。
移動する場合は、その理由と必要なSPを明記してください。
```

### 実装上の注意点

1. **バランス調整**
   - 移動選択肢が常に含まれすぎないよう調整
   - 状況に応じて移動の必要性を判断
   - 戦闘中や重要なイベント中は移動選択肢を制限

2. **物語の連続性**
   - 唐突な移動提案を避ける
   - 前の行動との関連性を保つ
   - キャラクターの目的に沿った移動を優先

3. **プレイヤー体験**
   - 移動が退屈な作業にならないよう工夫
   - 移動自体を小さな冒険として描写
   - 移動による発見や成長の機会を提供

## 他のAIとの連携

### 状態管理AIとの協調
1. 脚本家AIが物語と選択肢を生成
2. プレイヤーが選択肢を選ぶ
3. 状態管理AIが行動結果を判定
4. 両方の結果を統合してフィードバック

### データフロー
```
プレイヤー行動
    ↓
脚本家AI
    ├─ 物語描写生成
    └─ 選択肢生成（難易度付き）
           ↓
    プレイヤーに提示
```

## テスト戦略

### ユニットテスト項目
- コンテキスト拡張のテスト
- キャラクター気分推測のテスト
- 物語緊張度計算のテスト
- レスポンス解析のテスト
- デフォルト選択肢生成のテスト

### 統合テスト項目
- プロンプト生成の妥当性
- AIレスポンスの形式確認
- エラーケースのハンドリング

## 今後の拡張予定

1. **選択肢の動的調整**
   - キャラクターのスキルに基づく選択肢の変化
   - 過去の選択による選択肢の進化

2. **感情システムの統合**
   - NPCとの関係性による描写の変化
   - キャラクターの感情状態の反映

3. **マルチメディア対応**
   - 画像生成AIとの連携
   - 効果音・BGMの提案

4. **物語の分岐管理**
   - 重要な選択の追跡
   - 物語ルートの可視化

## 使用上の注意

1. **世界観の一貫性**
   - 『ゲスタロカ』の設定を常に意識
   - フェイディング現象の影響を適切に表現

2. **プレイヤー体験**
   - 選択肢は常に意味のあるものに
   - 難易度は適切にバランス調整

3. **レスポンス品質**
   - 単調な描写を避ける
   - 五感に訴える豊かな表現を心がける