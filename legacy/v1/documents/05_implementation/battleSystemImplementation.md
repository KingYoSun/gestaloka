# 戦闘システム実装ガイド

## 概要

ゲスタロカの戦闘システムは、通常のストーリー展開と同じUIで進行する、物語的・戦術的コマンドバトルシステムです。

## 実装アーキテクチャ

### 1. データモデル

#### バックエンド（`app/schemas/battle.py`）

```python
# 戦闘状態の列挙型
class BattleState(str, Enum):
    NONE = "none"
    STARTING = "starting"
    IN_PROGRESS = "in_progress"
    PLAYER_TURN = "player_turn"
    ENEMY_TURN = "enemy_turn"
    ENDING = "ending"
    FINISHED = "finished"

# 戦闘参加者
class Combatant(BaseModel):
    id: str
    name: str
    type: CombatantType  # player, npc, monster, boss
    hp: int
    max_hp: int
    mp: int
    max_mp: int
    attack: int
    defense: int
    speed: int  # 行動順を決定
    status_effects: list[str]

# 戦闘データ（session_data内に格納）
class BattleData(BaseModel):
    state: BattleState
    turn_count: int
    combatants: list[Combatant]
    turn_order: list[str]  # 参加者IDの配列
    current_turn_index: int
    environment: Optional[BattleEnvironment]
    battle_log: list[dict[str, Any]]
```

#### データベースモデル（`app/models/character.py`）

CharacterStatsモデルに戦闘関連のステータスを追加：

```python
class CharacterStats(SQLModel, table=True):
    # ... 既存のフィールド ...
    attack: int = Field(default=10, ge=1)
    defense: int = Field(default=5, ge=0)
    agility: int = Field(default=10, ge=1)
```

### 2. サービス層

#### BattleService（`app/services/battle.py`）

主要なメソッド：

- `check_battle_trigger()`: アクション結果から戦闘開始を検出
- `initialize_battle()`: 戦闘データの初期化
- `get_battle_choices()`: 戦闘中の選択肢生成
- `process_battle_action()`: 戦闘アクションの処理
- `advance_turn()`: ターン進行管理
- `check_battle_end()`: 戦闘終了判定

#### GameSessionServiceとの統合

`execute_action()`メソッド内で戦闘状態をチェックし、適切な処理を実行：

```python
# 戦闘中かどうかをチェック
battle_data = session_data.get("battle_data")
current_battle_state = BattleState(battle_data["state"]) if battle_data else BattleState.NONE

if current_battle_state != BattleState.NONE and current_battle_state != BattleState.FINISHED:
    # 戦闘アクションの処理
    battle_choices = self._process_battle_turn(...)
else:
    # 通常のアクション処理後、戦闘開始をチェック
    if self.battle_service.check_battle_trigger(...):
        # 戦闘を開始
```

### 3. フロントエンド実装

#### BattleStatusコンポーネント（`src/features/game/components/BattleStatus.tsx`）

```tsx
export function BattleStatus({ battleData }: BattleStatusProps) {
  // プレイヤーと敵の情報を表示
  // HP/MPバー、状態異常、現在のターン表示
  // 環境情報（地形、利用可能なオブジェクト）
}
```

#### 既存UIとの統合

`src/routes/game/$sessionId.tsx`に戦闘状態表示を追加：

```tsx
{/* 戦闘状態 */}
{session.sessionData?.battle_data && (
  <BattleStatus battleData={session.sessionData.battle_data} />
)}
```

### 4. WebSocket統合

#### イベントタイプ

- `battle_start`: 戦闘開始の通知
- `battle_update`: 戦闘状態の更新（将来実装予定）

#### ハンドラー実装（`src/hooks/useWebSocket.ts`）

```typescript
const handleBattleStart = (data: any) => {
  console.log('Battle started:', data);
  toast.info('戦闘開始！', {
    description: '敵が現れた！',
  });
};
```

### 5. AI連携

#### StateManagerAgentの拡張

戦闘コンテキストの認識と戦闘ルールの適用：

```python
# 戦闘中かどうかを確認
battle_context = {}
if context.additional_context and "battle_data" in context.additional_context:
    battle_data = context.additional_context["battle_data"]
    if battle_data and battle_data.get("state") not in ["none", "finished"]:
        battle_context = {
            "is_in_battle": True,
            "battle_state": battle_data.get("state"),
            "battle_turn": battle_data.get("turn_count", 0),
            "combatants": battle_data.get("combatants", []),
            "battle_rules": {
                "damage_calculation": "base_attack - (defense / 2) + random(-20%, +20%)",
                "critical_chance": 0.1,
                "escape_base_chance": 0.5,
                "defense_damage_reduction": 0.5,
            }
        }
```

## 戦闘フロー

### 1. 戦闘開始

1. プレイヤーのアクション結果から戦闘トリガーを検出
2. `BattleService.initialize_battle()`で戦闘データを作成
3. session_data内に`battle_data`を格納
4. WebSocketで`battle_start`イベントを送信
5. 戦闘用の選択肢を生成して返却

### 2. ターン進行

1. プレイヤーが行動を選択（攻撃、防御、逃走、環境利用）
2. `_process_battle_turn()`で行動を処理
3. ダメージ計算と状態更新
4. 敵のターンの場合は自動で行動を決定・実行
5. 次のターンへ進む

### 3. 戦闘終了

1. HP0または逃走成功で戦闘終了を判定
2. 勝利の場合は報酬（経験値、ゴールド）を生成
3. `battle_data`のstateを`FINISHED`に設定
4. 通常のストーリー進行に戻る

## 拡張ポイント

### 将来的な実装予定

1. **スキルシステム**
   - スキルの定義とデータモデル
   - MP消費とクールダウン
   - スキル効果の実装

2. **アイテムシステム**
   - アイテム使用機能
   - インベントリ管理
   - 戦闘中のアイテム効果

3. **複数敵との戦闘**
   - 複数のCombatantの管理
   - ターゲット選択UI
   - 範囲攻撃の実装

4. **高度な戦闘メカニクス**
   - 属性相性
   - 状態異常の詳細実装
   - コンボシステム

## データベースマイグレーション

戦闘関連のカラムを追加する際の手順：

```bash
# マイグレーションの生成
docker-compose run --rm backend alembic revision --autogenerate -m "Add battle stats"

# マイグレーションの適用
docker-compose run --rm backend alembic upgrade head
```

## テスト方法

### 手動テスト

1. キャラクターを作成してゲームセッションを開始
2. 戦闘を引き起こすアクション（例：「森を探索する」「敵に攻撃する」）を実行
3. 戦闘UIが表示されることを確認
4. 各種戦闘アクションをテスト

### 自動テスト（今後実装予定）

- `test_battle_service.py`: 戦闘サービスのユニットテスト
- `test_battle_integration.py`: 戦闘システムの統合テスト