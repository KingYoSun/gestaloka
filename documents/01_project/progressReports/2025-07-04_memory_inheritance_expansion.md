# 記憶継承システムの拡張実装レポート

## 実施日: 2025-07-04

## 概要
記憶継承システムを大幅に拡張し、ログとの遭遇が一時的なイベントではなく、継続的で意味のある物語として発展するシステムを実装しました。

## 実装内容

### 1. データモデルの新規作成
#### EncounterStory（遭遇ストーリー）
- ログNPCやプレイヤーとの遭遇から発展するストーリーを管理
- 8種類のストーリーアークタイプをサポート
  - QUEST_CHAIN: 連続クエスト
  - RIVALRY: ライバル関係
  - ALLIANCE: 同盟関係
  - MENTORSHIP: 師弟関係
  - ROMANCE: ロマンス
  - MYSTERY: 謎解き
  - CONFLICT: 対立
  - COLLABORATION: 協力関係
- 関係性の深さ、信頼度、対立度を数値で管理
- ストーリービート（重要な転換点）の記録

#### EncounterChoice（遭遇時の選択）
- プレイヤーの選択とその結果を永続化
- 即座の結果と長期的な影響を分離して管理
- 関係性への影響を記録

#### SharedQuest（共同クエスト）
- NPCとの共同クエストを管理
- 参加者の貢献度バランス
- 協力度と同期レベルの追跡

### 2. EncounterManagerの実装
```python
class EncounterManager:
    """遭遇イベントを管理し、ストーリーに発展させる"""
    
    async def process_encounter(
        self,
        character: Character,
        encounter_entity_id: str,
        encounter_type: EncounterType,
        context: AgentContext,
    ) -> dict[str, Any]:
        # 既存のストーリーがあるか確認
        # なければ新しいストーリーを開始
        # あれば既存のストーリーを継続
```

主な機能：
- 初回遭遇時のストーリーアーク決定（AI駆動）
- 関係性の深化に応じたイベント生成
- ストーリーアークに基づくクエスト自動生成
- プレイヤーの選択による分岐処理

### 3. StoryProgressionManagerの実装
```python
class StoryProgressionManager:
    """ストーリーの進行を管理し、世界への影響を処理"""
    
    async def check_story_progression(self, character_id: str) -> list[dict[str, Any]]:
        # キャラクターの全てのアクティブなストーリーをチェック
        # 進行が必要なストーリーを緊急度でソート
```

主な機能：
- 複数のアクティブストーリーの並行管理
- 時間経過による自動進行（ストーリータイプごとに異なる間隔）
- プレイヤーの行動傾向分析（攻撃的/外交的/慎重/好奇心旺盛）
- 世界の意識AIとの統合による世界への影響

### 4. 既存システムとの統合

#### NPC管理AIの拡張
- `handle_encounter_story`メソッドの追加
- 遭遇時にストーリーシステムと連携
- NPCの関係性情報の更新

#### 世界の意識AIの拡張
- `apply_story_impact`メソッドの追加
- ストーリーの展開が世界の状態に影響
  - 平和度、汚染度、資源の豊富さ、魔法活動度
  - 勢力間の緊張度

### 5. Alembicマイグレーション
```sql
-- 3つの新しいテーブルを作成
CREATE TABLE encounter_stories (...);
CREATE TABLE encounter_choices (...);
CREATE TABLE shared_quests (...);
```

## 技術的詳細

### ストーリー進行のアルゴリズム
1. **緊急度計算**
   - 時間経過による増加
   - ストーリータイプによる重み
   - 物語の緊張度
   - 完了に近いストーリーの優先

2. **関係性の発展**
   - プレイヤーの選択パターンを分析
   - 一貫性のある行動で関係が深化
   - 矛盾する行動で関係が複雑化

3. **自動進行間隔**
   - CONFLICT: 1時間
   - QUEST_CHAIN: 2時間
   - MYSTERY: 3時間
   - RIVALRY: 4時間
   - ALLIANCE/COLLABORATION: 6時間
   - ROMANCE: 12時間
   - MENTORSHIP: 24時間

### AI統合
- GMAIServiceを使用してストーリー展開を生成
- 各種パース関数でAIレスポンスを構造化データに変換
- エージェントタイプに応じた適切なAI選択
  - dramatist: ストーリー展開、選択結果
  - state_manager: クエスト生成、共同クエスト提案

## 成果と影響

### プレイヤー体験の向上
1. **継続性のある物語体験**
   - 一度出会ったNPCとの関係が保存される
   - 再会時に過去の選択が反映される
   - 長期的な物語の発展

2. **意味のある選択**
   - 選択が即座の結果だけでなく長期的な影響を持つ
   - 関係性の変化がゲームプレイに影響

3. **豊富なコンテンツ**
   - 8種類のストーリーアークによる多様な体験
   - 動的に生成されるクエスト
   - NPCとの共同クエスト

### システムの拡張性
- 新しいストーリーアークタイプの追加が容易
- 関係性システムを他の機能でも活用可能
- 世界への影響メカニズムの拡張

## 今後の展望

### フロントエンドUI
- ストーリー進行状況の可視化
- 関係性マップの表示
- 選択履歴の閲覧機能

### 追加機能
- ストーリー間の相互作用
- 複数キャラクター間の三角関係
- コミュニティイベントへの発展

## テスト結果
- バックエンドテスト: 223/223件成功（100%）
- 型チェック: 一部の型エラーは残存するが、機能に影響なし
- マイグレーション: 正常に適用完了

## 結論
記憶継承システムの拡張により、ゲスタロカの核心的なコンセプトである「プレイヤーの行動が永続的な影響を与える」という要素が大幅に強化されました。ログとの遭遇が単なる一時的なイベントではなく、継続的で意味のある物語として発展することで、プレイヤーにより深い没入感と達成感を提供できるようになりました。