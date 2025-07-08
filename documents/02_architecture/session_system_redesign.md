# セッションシステム再設計仕様書

作成日: 2025-07-08  
作成者: Claude

## 1. 概要

現在のセッションシステムは長時間のプレイにより、メッセージ履歴が肥大化し、コンテキストの管理が困難になる問題を抱えています。本仕様書では、GM AIによる自動的なセッション区切り判定と、セッション間の継続性を保つリザルト処理システムを提案します。

## 2. 主要な変更点

### 2.1 セッションライフサイクル
- **開始**: キャラクター選択 → 前回リザルトを引き継いで新規セッション作成
- **進行**: GM AIがストーリーの区切りを判定
- **終了提案**: GM AIが区切りの良いところで終了を提案
- **リザルト処理**: サマリー生成、知識グラフ更新、経験値計算
- **次回への継承**: リザルトをコンテキストとして次セッション開始

### 2.2 データ永続化
- セッションごとのメッセージ履歴をDBに保存
- リザルトサマリーの保存
- Neo4jへの知識グラフ反映

## 3. データモデル設計

### 3.1 GameSession（拡張）
```python
class GameSession(SQLModel, table=True):
    # 既存フィールド
    id: str
    character_id: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    
    # 新規フィールド
    session_status: SessionStatus  # ACTIVE, ENDING_PROPOSED, COMPLETED
    session_number: int  # キャラクターの何回目のセッションか
    previous_session_id: Optional[str]  # 前回セッションのID
    story_arc_id: Optional[str]  # ストーリーアークID（複数セッション跨ぎ）
    
    # リザルト関連
    result_summary: Optional[str]  # セッションのサマリー
    result_processed_at: Optional[datetime]
    
    # メトリクス
    turn_count: int = 0
    word_count: int = 0
    play_duration_minutes: int = 0
    
    # 終了提案追跡
    ending_proposal_count: int = 0  # 終了提案された回数（0-3）
    last_proposal_at: Optional[datetime]  # 最後に提案した時刻
```

### 3.2 GameMessage（新規）
```python
class GameMessage(SQLModel, table=True):
    id: str
    session_id: str
    message_type: MessageType  # PLAYER_ACTION, GM_NARRATIVE, SYSTEM_EVENT
    sender_type: SenderType  # PLAYER, GM, SYSTEM
    content: str
    metadata: Optional[dict]  # choices, character_status等
    created_at: datetime
    
    # インデックス
    turn_number: int  # セッション内のターン番号
    
    # 関係
    session: GameSession = Relationship(back_populates="messages")
```

### 3.3 SessionResult（新規）
```python
class SessionResult(SQLModel, table=True):
    id: str
    session_id: str
    
    # ストーリーサマリー
    story_summary: str  # GM AIが生成する物語の要約
    key_events: list[str]  # 重要イベントのリスト
    
    # キャラクター成長
    experience_gained: int
    skills_improved: dict[str, int]  # スキル名: 上昇値
    items_acquired: list[str]
    
    # ナレッジグラフ更新
    neo4j_updates: dict  # Neo4jに反映した内容
    
    # 次回への引き継ぎ
    continuation_context: str  # 次セッションへ渡すコンテキスト
    unresolved_plots: list[str]  # 未解決のプロット
    
    created_at: datetime
```

## 4. GM AIの終了判定ロジック

### 4.1 終了提案のトリガー条件
1. **ストーリー的区切り**
   - クエスト完了
   - 章の終わり
   - 大きな戦闘の終了
   - 重要な選択の完了

2. **システム的区切り**
   - プレイ時間が2時間を超過
   - ターン数が50を超過
   - メッセージ数が100を超過

3. **プレイヤー状態**
   - HP/MPが危険域
   - 重要アイテムの獲得
   - レベルアップ
   - SPの不足

### 4.2 終了提案の実装
```python
class SessionEndingProposal:
    reason: str  # 終了を提案する理由
    summary_preview: str  # これまでの冒険の簡単なまとめ
    continuation_hint: str  # 次回への引き
    rewards_preview: dict  # 獲得予定の報酬
    proposal_count: int  # 何回目の提案か（1-3）
    is_mandatory: bool  # 強制終了かどうか（3回目はTrue）
```

### 4.3 終了提案の拒否制限
- **1回目・2回目の提案**: プレイヤーは拒否可能
  - 拒否した場合、セッションは継続
  - 次の区切りで再度提案（proposal_countをインクリメント）
- **3回目の提案**: 強制的にセッション終了
  - 拒否ボタンは非表示または無効化
  - 自動的にリザルト処理へ遷移
  - UIで「今回は物語の区切りとなります」等のメッセージ表示

## 5. リザルト処理フロー

### 5.1 処理ステップ
1. **セッションサマリー生成**
   - Historian AIがメッセージ履歴から要約生成
   - 重要イベントの抽出

2. **経験値・報酬計算**
   - State Manager AIが成長要素を計算
   - スキル経験値の配分

3. **Neo4j知識グラフ更新**
   - NPC Manager AIがNPC関係性を更新
   - World AIが世界状態を更新

4. **継続コンテキスト生成**
   - Dramatist AIが次回への引きを作成
   - 未解決プロットの整理

### 5.2 非同期処理
```python
# Celeryタスクとして実装
@celery_task
async def process_session_result(session_id: str):
    # 1. セッションデータ取得
    # 2. 各AI エージェントによる処理
    # 3. 結果の保存
    # 4. WebSocketで完了通知
```

## 6. 最初のセッションの特別仕様

### 6.1 初回セッションの流れ
キャラクターの最初のセッションは、世界観への導入と基本的なゲームプレイの理解を促す特別な構成となります。

1. **イントロダクション**
   - 世界観の概要説明（ゲスタロカの世界、ログシステムの説明）
   - キャラクターが基点都市ネクサスへ到着する描写
   - 「これからどうする？」という提案形式の問いかけ
     - ゲスタロカの基本的なゲームフローに則り、以下の形式で提示：
       1. 三つの選択肢（例：「街を探索する」「誰かに話しかける」「周囲を観察する」）
       2. 自由記述（プレイヤーが独自の行動を入力可能）
     - この選択システムを通じて、プレイヤーは最初からゲームの基本的な意思決定方法を体験

2. **初期位置とクエスト**
   - 開始位置：基点都市ネクサスの入口
   - 自動的に全ての初期クエストが開始される（「探求」を含む6つ）
   - プレイヤーは好きな順序でクエストを進められる

### 6.2 初期クエスト設計

キャラクター作成後の最初のセッションで、以下の6つのクエストが全て自動的に付与されます：

#### 初期クエスト一覧

**「探求」** - 世界を知る
- 目的：ゲスタロカの世界について理解を深める
- 内容：NPCとの対話、施設の訪問、基本的な世界観の学習
- 報酬：基礎経験値、初心者向けアイテム

**「最初の一歩」** - 基本操作の習得
- 目的：ゲームの基本的な操作とシステムを学ぶ
- 内容：戦闘チュートリアル、スキル使用、アイテム管理
- 報酬：初期装備、回復アイテム

**「シティボーイ/シティガール」** - 社交の基礎
- 目的：NPCとの交流システムを理解する
- 内容：3人のNPCと会話、好感度システムの体験
- 報酬：人脈ポイント、交渉スキル経験値

**「小さな依頼」** - クエストシステムの理解
- 目的：サブクエストの受注と完了の流れを学ぶ
- 内容：簡単な配達任務や情報収集
- 報酬：通貨、クエスト達成称号

**「ログの欠片」** - コアシステムの体験
- 目的：ログ収集システムの基礎を理解する
- 内容：最初のログフラグメントを発見・収集
- 報酬：ログポイント、編纂チュートリアル解放

**「街の外へ」** - 探索の開始
- 目的：ネクサス外の世界への興味を喚起
- 内容：街の外縁部の探索、簡単な戦闘遭遇
- 報酬：探索経験値、地図の一部

### 6.3 実装上の考慮事項
```python
class FirstSessionInitializer:
    """最初のセッション用の特別な初期化処理"""
    
    def create_first_session(self, character: Character) -> GameSession:
        session = GameSession(
            character_id=character.id,
            is_first_session=True,
            initial_location="nexus_entrance",
            session_data={
                "intro_completed": False,
                "tutorial_stage": "world_introduction"
            }
        )
        
        # 全ての初期クエストを自動付与
        self.assign_all_initial_quests(character)
        
        return session
    
    def generate_introduction(self) -> str:
        """世界観の導入テキストを生成"""
        return GESTALOKA_INTRO_TEMPLATE
    
    def generate_initial_choices(self) -> list[str]:
        """最初の選択肢を生成"""
        return [
            "街を探索して、どんな場所があるか見て回る",
            "近くにいる人に話しかけて、この街について聞く",
            "まずは周囲を観察して、状況を把握する"
        ]
        # プレイヤーは上記3つの選択肢に加えて、自由記述での行動も可能
    
    def assign_all_initial_quests(self, character: Character):
        """全ての初期クエストを一括で付与"""
        initial_quests = [
            "exploration",          # 探求
            "first_steps",          # 最初の一歩
            "city_boy_city_girl",   # シティボーイ/シティガール
            "small_errands",        # 小さな依頼
            "log_fragments",        # ログの欠片
            "beyond_walls"          # 街の外へ
        ]
        
        for quest_id in initial_quests:
            self.quest_service.assign_quest(character.id, quest_id)
```

## 7. UI/UX設計

### 7.1 セッション終了提案UI
```typescript
interface SessionEndingProposal {
  reason: string
  summaryPreview: string
  continuationHint: string
  rewardsPreview: {
    experience: number
    skills: Record<string, number>
    items: string[]
  }
}

// コンポーネント例
<SessionEndingDialog 
  proposal={proposal}
  onAccept={() => endSession()}
  onContinue={() => continueSession()}
  showContinueButton={!proposal.is_mandatory}  // 3回目は継続ボタン非表示
/>
```

### 7.2 リザルト画面
```typescript
interface SessionResultView {
  summary: string
  keyEvents: string[]
  rewards: {
    experience: number
    skillsImproved: Record<string, number>
    itemsAcquired: string[]
  }
  nextSessionHint: string
}
```

### 7.3 セッション履歴一覧
```typescript
interface SessionHistoryItem {
  id: string
  sessionNumber: number
  playedAt: string
  duration: number
  summary: string
  status: 'completed' | 'active' | 'abandoned'
}
```

## 8. API設計

### 8.1 新規エンドポイント

#### セッション終了提案を取得
```
GET /api/v1/game/sessions/{session_id}/ending-proposal
Response: SessionEndingProposal
```

#### セッション終了を承認
```
POST /api/v1/game/sessions/{session_id}/accept-ending
Response: { resultId: string, processingStatus: 'processing' }
```

#### セッション終了を拒否（継続）
```
POST /api/v1/game/sessions/{session_id}/reject-ending
Response: { 
  proposalCount: number,  // 現在の提案回数
  canRejectNext: boolean  // 次回も拒否可能か
}
```

#### リザルト取得
```
GET /api/v1/game/sessions/{session_id}/result
Response: SessionResult
```

#### セッション履歴一覧
```
GET /api/v1/game/sessions/history?character_id={id}
Response: SessionHistoryItem[]
```

#### 次セッション開始（前回リザルト引き継ぎ）
```
POST /api/v1/game/sessions/continue
Body: { characterId: string, previousSessionId: string }
Response: GameSession
```

### 8.2 WebSocketイベント

#### GM → クライアント
```typescript
// セッション終了提案
{
  type: 'session:ending_proposal',
  data: SessionEndingProposal
}

// リザルト処理完了
{
  type: 'session:result_ready',
  data: { sessionId: string, resultId: string }
}
```

## 9. 実装優先順位

### フェーズ1: 基盤整備 ✅ 完了（2025-07-08）
1. GameMessageテーブルの作成とマイグレーション ✅ 完了（2025-07-08）
2. SessionResultテーブルの作成とマイグレーション ✅ 完了（2025-07-08）
3. GameSessionモデルの拡張（新フィールド追加） ✅ 完了（2025-07-08）
4. メッセージ履歴のDB保存実装 ✅ 完了（2025-07-08）
5. メッセージ履歴DB保存のテスト実装 ✅ 完了（2025-07-08）
6. セッション履歴一覧API ✅ 完了（2025-07-08）
7. 次セッション開始API ✅ 完了（2025-07-08）

### フェーズ2: 終了判定
1. GM AIの終了判定ロジック実装
2. 終了提案UI実装
3. セッション終了フロー

### フェーズ3: リザルト処理
1. SessionResultモデル実装
2. リザルト生成Celeryタスク
3. リザルト画面UI

### フェーズ4: 継続性
1. セッション間の引き継ぎ実装
2. Neo4j知識グラフ連携
3. ストーリーアーク管理

## 10. 実装詳細

### 10.1 実装済みコンポーネント（2025-07-08）

#### GameMessageモデル
- メッセージタイプの文字列定数として実装（ENUM回避）
- `message_metadata`フィールドでJSON形式のメタデータ保存
- ターン番号でのインデックス実装

#### SessionResultモデル  
- セッション結果を保存するための独立したテーブル
- 知識グラフ更新内容、キー事象、継続コンテキストを保存
- `app/models/game/session_result.py`として実装

#### GameSessionモデル拡張
- `session_status`, `session_number`, `turn_count`, `word_count`等の新フィールド追加
- 終了提案追跡用のフィールド実装
- SessionResultとのリレーション定義

#### メッセージ保存機能
- `GameSessionService.save_message()`メソッド実装
- `execute_action()`, `create_session()`, `end_session()`に統合
- プレイヤーアクション、GMナラティブ、システムイベントの3種類のメッセージ保存

#### セッション履歴一覧API
- `GET /api/v1/game/sessions/history`エンドポイント実装
- ページネーション、ステータスフィルター対応
- `GameSessionService.get_session_history()`メソッド実装

#### 次セッション開始API
- `POST /api/v1/game/sessions/continue`エンドポイント実装
- `SessionContinueRequest`スキーマ追加
- `GameSessionService.continue_session()`メソッド実装
- 前回セッションの結果を引き継ぐ機能

#### テストカバレッジ
- 7つの包括的なテストケース実装
- 基本的なメッセージ保存、複数メッセージタイプ、メタデータ保存
- セッション作成/アクション実行/終了時のメッセージ保存検証
- セッション履歴取得のテスト実装済み

### 10.2 実装上の重要な判断

#### PostgreSQL ENUM型の回避
- 過去の経験から、ENUM型は避けて文字列フィールドを使用
- `documents/05_implementation/database/alembicIntegration.md`のベストプラクティスに従う
- マイグレーションの安定性向上

#### テストデータベースの管理
- 本番と同様のマイグレーションをテストDBにも適用
- `conftest.py`でのテストDB自動セットアップ

#### continue_sessionメソッドの設計
- 前回セッションの検証（存在確認、完了状態確認、所有権確認）
- SessionResultからの継続情報取得（任意）
- 新規セッションの作成時にセッション番号を自動インクリメント
- 前回の結果を`session_data`のJSONに格納
- AI統合は将来的に実装（TODOコメントとして配置）

## 11. 技術的考慮事項

### 11.1 パフォーマンス
- メッセージ履歴は適切なページネーション
- リザルト処理は非同期実行
- 古いセッションのアーカイブ機能

### 11.2 データ整合性
- セッション終了時のトランザクション管理
- リザルト処理失敗時のリトライ
- 部分的な処理完了の追跡

### 11.3 拡張性
- プラグイン可能なリザルト処理
- カスタマイズ可能な終了条件
- 将来的なマルチプレイヤー対応
