# 遭遇ストーリーシステム実装ガイド

最終更新: 2025-07-04

## 概要

遭遇ストーリーシステムは、ログNPCやプレイヤーとの遭遇を一時的なイベントではなく、継続的で意味のある物語として発展させるシステムです。本ドキュメントでは、その技術的な実装詳細を説明します。

## アーキテクチャ

### システム構成

```
┌─────────────────────┐
│  EncounterManager   │ ← 遭遇イベントの中核管理
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│StoryProgressionMgr  │ ← ストーリー進行管理
└──────────┬──────────┘
           │
      ┌────┴────┐
      │         │
┌─────▼───┐ ┌──▼──────┐
│NPC管理AI│ │世界の意識│ ← AI統合
└─────────┘ └─────────┘
```

## データモデル

### EncounterStory

```python
class EncounterStory(SQLModel, table=True):
    """遭遇から発展するストーリーモデル"""
    
    # 基本情報
    id: str
    character_id: str  # プレイヤーキャラクター
    encounter_entity_id: str  # 遭遇相手（NPC/ログ/プレイヤー）
    encounter_type: EncounterType
    
    # ストーリー情報
    story_arc_type: StoryArcType
    title: str
    current_chapter: int = 1
    total_chapters: Optional[int]  # 動的に変化可能
    
    # 関係性管理
    relationship_status: RelationshipStatus
    relationship_depth: float  # 0.0-1.0
    trust_level: float  # 0.0-1.0
    conflict_level: float  # 0.0-1.0
    
    # ストーリー進行
    story_beats: list[dict]  # 重要な転換点
    shared_memories: list[dict]  # 共有された記憶
    pending_plot_threads: list[str]  # 未解決のプロット
    
    # 世界への影響
    world_impact: dict[str, Any]
    character_growth: dict[str, Any]
```

### ストーリーアークタイプ

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

## 実装詳細

### 1. EncounterManager

主要な責務：
- 初回遭遇時のストーリーアーク決定
- 既存ストーリーの継続処理
- プレイヤー選択の処理

```python
async def process_encounter(
    self,
    character: Character,
    encounter_entity_id: str,
    encounter_type: EncounterType,
    context: AgentContext,
) -> dict[str, Any]:
    # 既存のストーリーがあるか確認
    existing_story = self._get_existing_story(character.id, encounter_entity_id)
    
    if existing_story:
        # 既存のストーリーを継続
        return await self._continue_story(existing_story, context)
    else:
        # 新しいストーリーを開始
        return await self._start_new_story(
            character, encounter_entity_id, encounter_type, context
        )
```

### 2. StoryProgressionManager

主要な責務：
- 複数ストーリーの並行管理
- 時間経過による自動進行
- 世界への影響の適用

```python
async def check_story_progression(
    self, character_id: str
) -> list[dict[str, Any]]:
    # アクティブなストーリーを取得
    stories = self._get_active_stories(character_id)
    
    # 進行が必要なストーリーを判定
    stories_to_progress = []
    for story in stories:
        if self._should_progress_story(story):
            urgency = self._calculate_urgency(story)
            stories_to_progress.append({
                "story": story,
                "urgency": urgency
            })
    
    # 緊急度でソート
    return sorted(stories_to_progress, key=lambda x: x["urgency"], reverse=True)
```

### 3. 関係性の進化アルゴリズム

```python
def _calculate_relationship_progression(self, story: EncounterStory) -> float:
    # 基本進展度
    base_progression = 0.1
    
    # ストーリーアークによる調整
    arc_modifiers = {
        StoryArcType.ROMANCE: 1.5,
        StoryArcType.ALLIANCE: 1.3,
        StoryArcType.MENTORSHIP: 1.2,
        StoryArcType.RIVALRY: 0.8,
        StoryArcType.CONFLICT: 0.5,
    }
    
    modifier = arc_modifiers.get(story.story_arc_type, 1.0)
    
    # 時間経過による減衰
    time_since_last = datetime.utcnow() - story.last_interaction_at
    if time_since_last > timedelta(days=7):
        modifier *= 0.5
    
    return base_progression * modifier
```

### 4. プレイヤー行動分析

```python
def _analyze_choice_patterns(self, choices: list[EncounterChoice]) -> dict:
    tendencies = {
        "aggressive": 0,
        "diplomatic": 0,
        "cautious": 0,
        "curious": 0,
    }
    
    for choice in choices:
        if choice.player_choice:
            # 選択内容から傾向を分析
            if "attack" in choice.player_choice:
                tendencies["aggressive"] += 1
            elif "talk" in choice.player_choice:
                tendencies["diplomatic"] += 1
            # ... 他の分析
    
    # 最も多い傾向と一貫性を計算
    dominant = max(tendencies.items(), key=lambda x: x[1])
    consistency = dominant[1] / sum(tendencies.values())
    
    return {
        "tendency": dominant[0],
        "consistency": consistency,
        "all_tendencies": tendencies,
    }
```

## AI統合

### GMAIServiceとの連携

```python
# ストーリー展開の生成
ai_response = await self.gm_ai_service.generate_ai_response(
    prompt,
    agent_type="dramatist",  # 物語生成は脚本家AI
    character_name=character.name,
    metadata={
        "story_id": story.id,
        "chapter": story.current_chapter,
        "relationship_status": story.relationship_status,
    }
)

# レスポンス解析
result = self._parse_story_development_response(ai_response)
```

### 世界の意識AIとの統合

```python
# ストーリーの影響を世界に適用
await self.world_ai.apply_story_impact(
    story_id=story.id,
    impact_data={
        "peace_change": -0.1,  # 対立による平和度低下
        "faction_impact": {
            "merchants_guild": 0.2  # 商人ギルドとの関係改善
        }
    },
    context=prompt_context,
)
```

## 使用例

### 1. 初回遭遇

```python
# NPCとの初回遭遇
result = await encounter_manager.process_encounter(
    character=player_character,
    encounter_entity_id="log_npc_123",
    encounter_type=EncounterType.LOG_NPC,
    context=agent_context,
)

# 結果
{
    "story_id": "story_456",
    "story_arc": "MYSTERY",
    "title": "謎めいた旅人との出会い",
    "first_event": {
        "description": "霧の中から現れた旅人は...",
        "choices": [
            {"id": "approach", "text": "慎重に近づく"},
            {"id": "greet", "text": "友好的に挨拶する"},
            {"id": "observe", "text": "距離を置いて観察する"}
        ]
    },
    "quest_generated": True
}
```

### 2. ストーリー進行

```python
# 時間経過による自動進行チェック
stories_to_progress = await story_manager.check_story_progression(
    character_id="char_789"
)

# 最も緊急なストーリーを進行
if stories_to_progress:
    most_urgent = stories_to_progress[0]
    result = await story_manager.progress_story(
        story_id=most_urgent["story_id"],
        context=context,
        player_action="古代遺跡を探索した"
    )
```

### 3. プレイヤーの選択処理

```python
# プレイヤーが「協力を申し出る」を選択
result = await encounter_manager.process_player_choice(
    story_id="story_456",
    session_id="session_789",
    choice_id="help",
    context=context,
)

# 結果
{
    "choice_id": "help",
    "immediate_result": "旅人は驚いたような表情を見せ...",
    "relationship_impact": {
        "trust": 0.2,
        "conflict": -0.1
    },
    "story_continues": True
}
```

## パフォーマンス考慮事項

### 1. ストーリー進行の最適化

- バッチ処理: 複数のストーリー進行を一度に処理
- キャッシング: アクティブなストーリーをRedisにキャッシュ
- 非同期処理: Celeryタスクで時間のかかる処理を非同期化

### 2. データベース最適化

```sql
-- インデックスの作成
CREATE INDEX idx_encounter_stories_character_status 
ON encounter_stories(character_id, relationship_status)
WHERE relationship_status != 'CONCLUDED';

CREATE INDEX idx_encounter_stories_next_beat 
ON encounter_stories(next_expected_beat)
WHERE next_expected_beat IS NOT NULL;
```

## テスト戦略

### 1. ユニットテスト

```python
def test_relationship_progression():
    story = EncounterStory(
        story_arc_type=StoryArcType.ROMANCE,
        relationship_depth=0.5,
        last_interaction_at=datetime.utcnow()
    )
    
    manager = StoryProgressionManager(db)
    progression = manager._calculate_relationship_progression(story)
    
    assert 0.1 <= progression <= 0.2  # ロマンスは進展が早い
```

### 2. 統合テスト

```python
async def test_full_story_cycle():
    # 初回遭遇
    encounter_result = await encounter_manager.process_encounter(...)
    assert encounter_result["story_id"]
    
    # ストーリー進行
    progress_result = await story_manager.progress_story(...)
    assert progress_result["new_chapter"] == 2
    
    # 関係性の確認
    story = db.get(EncounterStory, encounter_result["story_id"])
    assert story.relationship_depth > 0
```

## 今後の拡張

### 1. ストーリー間の相互作用

- 複数のストーリーが影響し合うシステム
- 三角関係や複雑な人間関係の実装

### 2. コミュニティイベント

- 複数プレイヤーが関わる大規模ストーリー
- 世界規模のイベントとの連動

### 3. ビジュアル化

- 関係性マップの実装
- ストーリー進行のタイムライン表示

## トラブルシューティング

### よくある問題

1. **ストーリーが進行しない**
   - `next_expected_beat`の値を確認
   - `relationship_status`が`CONCLUDED`でないか確認

2. **関係性が深まらない**
   - プレイヤーの選択パターンを確認
   - ストーリーアークタイプの特性を考慮

3. **パフォーマンスの問題**
   - アクティブストーリー数の制限
   - 非同期処理の活用

## 関連ドキュメント

- [記憶継承システム仕様](../../03_worldbuilding/game_mechanics/memoryInheritance.md)
- [NPC管理AI実装](../ai_agents/npc_manager.md)
- [世界の意識AI実装](../ai_agents/the_world.md)