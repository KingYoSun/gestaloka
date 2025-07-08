# セッションシステム再設計フェーズ4 - ストーリーアーク管理システム実装

作成日: 2025-07-08
作成者: Claude

## 実装概要

複数セッションに跨る大きな物語の流れを管理する「ストーリーアーク管理システム」を実装しました。これにより、プレイヤーの長期的な物語体験を追跡し、適切なタイミングで物語の節目を提供できるようになりました。

## 実装内容

### 1. データモデル設計

#### StoryArcモデル（`app/models/story_arc.py`）
```python
class StoryArc(SQLModel, table=True):
    # 基本情報
    id: str
    character_id: str
    title: str
    description: str
    arc_type: StoryArcType  # MAIN_QUEST, SIDE_QUEST, CHARACTER_ARC等
    status: StoryArcStatus  # ACTIVE, COMPLETED, ABANDONED, SUSPENDED
    
    # 進行状況
    progress_percentage: float  # 0.0-100.0
    current_phase: int  # 現在のフェーズ
    total_phases: int  # 総フェーズ数
    
    # 物語要素
    key_npcs: list[str]  # 関連NPC
    key_locations: list[str]  # 関連場所
    key_items: list[str]  # 関連アイテム
    central_conflict: str  # 中心的な対立
    themes: list[str]  # テーマ（友情、裏切り、成長など）
    plot_points: list[dict]  # プロットポイント
```

#### StoryArcMilestoneモデル
```python
class StoryArcMilestone(SQLModel, table=True):
    # マイルストーン情報
    story_arc_id: str
    title: str
    description: str
    phase_number: int
    
    # 達成条件と報酬
    achievement_criteria: dict  # 達成条件
    is_completed: bool
    rewards: dict  # マイルストーン達成報酬
    triggers_next_phase: bool  # 次フェーズへの移行トリガー
```

### 2. StoryArcService実装

#### 主要機能
- **create_story_arc**: 新しいストーリーアークを作成
- **get_active_story_arc**: キャラクターの現在アクティブなアークを取得
- **update_arc_progress**: アークの進行状況を更新
- **complete_story_arc**: アークを完了状態にする
- **create_milestone**: マイルストーンを作成
- **check_milestone_completion**: マイルストーンの達成条件をチェック
- **suggest_next_arc**: 完了したアークに基づいて次のアークを提案

#### 進行管理ロジック
```python
def update_arc_progress(self, story_arc, progress_delta, phase_completed):
    # 進行率を更新
    story_arc.progress_percentage += progress_delta
    
    # フェーズ完了時の処理
    if phase_completed and story_arc.current_phase < story_arc.total_phases:
        story_arc.current_phase += 1
    
    # 全フェーズ完了チェック
    if story_arc.current_phase >= story_arc.total_phases and 
       story_arc.progress_percentage >= 100.0:
        self.complete_story_arc(story_arc)
```

### 3. 既存システムとの統合

#### GameSessionService
- 新規セッション作成時にアクティブなアークがない場合、基本的な個人の物語アークを自動作成
- continue_sessionでアークの引き継ぎと進行状況チェック
- アークが80%以上進行している場合、次のアーク提案を検討

#### SessionResultService
- `_evaluate_story_arc_progress`メソッドを追加
- セッション終了時にアークの進行を評価
- キャラクターの行動から進行率を算出（基本5%＋重要行動ボーナス）

#### CoordinatorAI
- `evaluate_story_arc_progress`メソッドを追加
- メッセージ履歴とキャラクター行動から進行状況を評価
- フェーズ完了判定ロジック

### 4. データベース対応

#### マイグレーション
- `story_arcs`テーブルの作成
- `story_arc_milestones`テーブルの作成
- `session_results`テーブルに`story_arc_progress`カラムを追加
- PostgreSQL互換性のためENUM型を避けVARCHAR型を使用

## 技術的詳細

### 非同期/同期処理の調整
SessionResultServiceは非同期処理を使用しているため、同期的なStoryArcServiceの呼び出しには`run_in_executor`を使用：

```python
async def _evaluate_story_arc_progress(self, session, character, messages):
    def _update_arc_sync():
        # 同期的なDB操作
        arc_service = StoryArcService(db)
        active_arc = arc_service.get_active_story_arc(character)
        # ...
    
    # 非同期で同期処理を実行
    loop = asyncio.get_event_loop()
    progress_info = await loop.run_in_executor(None, _update_arc_sync)
```

### アークタイプの設計
- **MAIN_QUEST**: メインストーリー
- **SIDE_QUEST**: サイドクエスト
- **CHARACTER_ARC**: キャラクター個人の成長物語
- **WORLD_EVENT**: 世界規模のイベント
- **PERSONAL_STORY**: 個人的な物語

### マイルストーン達成条件
```python
achievement_criteria = {
    "completed_quests": ["quest1", "quest2"],  # 完了必須クエスト
    "talked_to_npcs": ["npc1"],  # 会話必須NPC
    "visited_locations": ["location1"],  # 訪問必須場所
    "items_collected": ["item1"],  # 収集必須アイテム
}
```

## テスト実装

`tests/services/test_story_arc_service.py`に5つのテストケースを実装：
- ストーリーアーク作成
- アクティブなアーク取得
- 進行状況更新とフェーズ進行
- マイルストーン作成
- マイルストーン達成チェック

## 今後の拡張可能性

1. **AIによる動的アーク生成**
   - プレイヤーの行動履歴からAIが新しいアークを提案
   - 世界の状況に応じたダイナミックなアーク生成

2. **マルチプレイヤーアーク**
   - 複数のプレイヤーが関わる大規模なストーリーアーク
   - プレイヤー間の相互作用によるアーク進行

3. **分岐アーク**
   - プレイヤーの選択によって分岐するストーリーライン
   - 複数の結末を持つアーク

4. **アーク間の関連性**
   - 完了したアークが新しいアークの前提条件になる
   - アークの連鎖による壮大な物語

## 成果

✅ ストーリーアーク管理の基盤システムが完成
✅ 複数セッションに跨る物語の追跡が可能に
✅ マイルストーンによる達成感の演出
✅ 既存システムとのシームレスな統合
✅ 将来的な拡張を考慮した設計